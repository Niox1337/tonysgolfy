use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::http::{
    HeaderMap, HeaderValue,
    header::{COOKIE, SET_COOKIE},
};
use chrono::Utc;
use rand_core::OsRng;
use rusqlite::{Connection, params};
use uuid::Uuid;

use crate::models::{SessionUserInfo, UserRecord, UserRole};

const DEFAULT_SESSION_TTL_HOURS: u64 = 12;
const DEFAULT_LOGIN_WINDOW_SECONDS: u64 = 15 * 60;
const DEFAULT_LOGIN_LOCKOUT_SECONDS: u64 = 15 * 60;
const DEFAULT_MAX_FAILED_ATTEMPTS: u32 = 5;
const MIN_PASSWORD_LENGTH: usize = 8;

#[derive(Clone)]
pub struct AuthService {
    database_path: PathBuf,
    accounts: Arc<RwLock<HashMap<String, UserAccount>>>,
    cookie_name: String,
    secure_cookie: bool,
    session_ttl: Duration,
    max_failed_attempts: u32,
    login_window: Duration,
    login_lockout: Duration,
    sessions: Arc<RwLock<HashMap<String, SessionEntry>>>,
    login_attempts: Arc<RwLock<HashMap<String, LoginAttemptState>>>,
}

#[derive(Clone)]
struct UserAccount {
    id: String,
    username: String,
    name: String,
    phone: Option<String>,
    email: Option<String>,
    password_hash: String,
    role: UserRole,
    active: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Clone)]
struct SessionEntry {
    user: SessionUser,
    expires_at: Instant,
}

#[derive(Clone)]
struct LoginAttemptState {
    failed_attempts: u32,
    window_started_at: Instant,
    blocked_until: Option<Instant>,
}

#[derive(Debug, Clone)]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub role: UserRole,
}

#[derive(Debug)]
pub enum AuthError {
    Unauthorized(String),
    Forbidden(String),
    TooManyRequests(String),
    BadRequest(String),
    Internal(String),
}

impl AuthService {
    pub fn load(database_path: &Path) -> Result<Self, String> {
        let cookie_name =
            env::var("SESSION_COOKIE_NAME").unwrap_or_else(|_| "tonysgolfy_session".to_string());
        let secure_cookie = env::var("APP_SECURE_COOKIE")
            .ok()
            .map(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false);

        let mut connection = Connection::open(database_path).map_err(|error| error.to_string())?;
        initialize_schema(&connection)?;
        migrate_schema(&connection)?;
        bootstrap_admin_if_needed(&mut connection)?;
        let accounts = load_accounts(&connection)?;

        if accounts.is_empty() {
            return Err(
                "no auth accounts found in database and no bootstrap admin credentials were provided"
                    .to_string(),
            );
        }

        Ok(Self {
            database_path: database_path.to_path_buf(),
            accounts: Arc::new(RwLock::new(
                accounts
                    .into_iter()
                    .map(|account| (account.id.clone(), account))
                    .collect(),
            )),
            cookie_name,
            secure_cookie,
            session_ttl: Duration::from_secs(
                read_u64_env("SESSION_TTL_HOURS").unwrap_or(DEFAULT_SESSION_TTL_HOURS) * 60 * 60,
            ),
            max_failed_attempts: read_u32_env("AUTH_MAX_FAILED_ATTEMPTS")
                .unwrap_or(DEFAULT_MAX_FAILED_ATTEMPTS),
            login_window: Duration::from_secs(
                read_u64_env("AUTH_LOGIN_WINDOW_SECONDS").unwrap_or(DEFAULT_LOGIN_WINDOW_SECONDS),
            ),
            login_lockout: Duration::from_secs(
                read_u64_env("AUTH_LOGIN_LOCKOUT_SECONDS").unwrap_or(DEFAULT_LOGIN_LOCKOUT_SECONDS),
            ),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            login_attempts: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    pub fn login(
        &self,
        headers: &HeaderMap,
        identifier: &str,
        password: &str,
    ) -> Result<(SessionUser, HeaderValue), AuthError> {
        let fingerprint = client_fingerprint(headers);
        self.enforce_rate_limit(&fingerprint)?;

        let identifier = normalize_identifier(identifier);
        let account = self
            .accounts
            .read()
            .map_err(|_| AuthError::Internal("failed to read account cache".to_string()))?
            .values()
            .find(|account| account.active && account_matches_identifier(account, &identifier))
            .cloned();

        let verified = account
            .as_ref()
            .map(|account| verify_password_hash(&account.password_hash, password))
            .unwrap_or(false);

        if !verified {
            self.register_failed_attempt(&fingerprint)?;
            return Err(AuthError::Unauthorized(
                "手机号、邮箱或密码错误。".to_string(),
            ));
        }

        let account = account.expect("verified account should exist");
        self.clear_failed_attempts(&fingerprint)?;
        self.cleanup_expired_sessions()?;

        let user = SessionUser {
            id: account.id.clone(),
            name: account.name.clone(),
            role: account.role,
        };
        let session_id = Uuid::new_v4().to_string();

        self.sessions
            .write()
            .map_err(|_| AuthError::Internal("failed to write session store".to_string()))?
            .insert(
                session_id.clone(),
                SessionEntry {
                    user: user.clone(),
                    expires_at: Instant::now() + self.session_ttl,
                },
            );

        let cookie = self.build_session_cookie(&session_id, Some(self.session_ttl.as_secs()));
        let header = HeaderValue::from_str(&cookie).map_err(|error| {
            AuthError::Internal(format!("failed to encode session cookie: {error}"))
        })?;

        Ok((user, header))
    }

    pub fn current_user(&self, headers: &HeaderMap) -> Result<Option<SessionUser>, String> {
        let Some(session_id) = read_cookie(headers, &self.cookie_name) else {
            return Ok(None);
        };

        let now = Instant::now();
        let mut sessions = self
            .sessions
            .write()
            .map_err(|_| "failed to read session store".to_string())?;
        sessions.retain(|_, entry| entry.expires_at > now);

        let Some(entry) = sessions.get_mut(session_id) else {
            return Ok(None);
        };

        entry.expires_at = now + self.session_ttl;
        Ok(Some(entry.user.clone()))
    }

    pub fn require_user(&self, headers: &HeaderMap) -> Result<SessionUser, String> {
        self.current_user(headers)?
            .ok_or_else(|| "请先登录。".to_string())
    }

    pub fn require_admin(&self, headers: &HeaderMap) -> Result<SessionUser, AuthError> {
        let user = self
            .require_user(headers)
            .map_err(AuthError::Unauthorized)?;

        if user.role != UserRole::Admin {
            return Err(AuthError::Forbidden(
                "只有管理员可以访问这个页面。".to_string(),
            ));
        }

        Ok(user)
    }

    pub fn logout(&self, headers: &HeaderMap) -> Result<HeaderValue, String> {
        if let Some(session_id) = read_cookie(headers, &self.cookie_name) {
            self.sessions
                .write()
                .map_err(|_| "failed to write session store".to_string())?
                .remove(session_id);
        }

        let cookie = self.build_session_cookie("", Some(0));
        HeaderValue::from_str(&cookie)
            .map_err(|error| format!("failed to encode session cookie: {error}"))
    }

    pub fn list_users(&self) -> Result<Vec<UserRecord>, String> {
        let mut users = self
            .accounts
            .read()
            .map_err(|_| "failed to read account cache".to_string())?
            .values()
            .cloned()
            .map(user_record_from_account)
            .collect::<Vec<_>>();

        users.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(users)
    }

    pub fn create_user(
        &self,
        name: String,
        phone: Option<String>,
        email: Option<String>,
        role: UserRole,
        password: String,
    ) -> Result<UserRecord, AuthError> {
        let normalized =
            validate_user_profile(None, &name, phone.as_deref(), email.as_deref(), role)
                .map_err(AuthError::BadRequest)?;
        validate_new_password(&password).map_err(AuthError::BadRequest)?;

        {
            let accounts = self
                .accounts
                .read()
                .map_err(|_| AuthError::Internal("failed to read account cache".to_string()))?;
            ensure_unique_contact(
                &accounts,
                None,
                normalized.phone.as_deref(),
                normalized.email.as_deref(),
            )
            .map_err(AuthError::BadRequest)?;
        }

        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let username = derive_username(
            normalized.phone.as_deref(),
            normalized.email.as_deref(),
            &id,
        );
        let password_hash = hash_password(&password).map_err(AuthError::Internal)?;

        let account = UserAccount {
            id: id.clone(),
            username,
            name: normalized.name,
            phone: normalized.phone,
            email: normalized.email,
            password_hash,
            role: normalized.role,
            active: true,
            created_at: now.clone(),
            updated_at: now,
        };

        let connection = self.open_connection().map_err(AuthError::Internal)?;
        insert_account(&connection, &account).map_err(AuthError::Internal)?;

        self.accounts
            .write()
            .map_err(|_| AuthError::Internal("failed to write account cache".to_string()))?
            .insert(account.id.clone(), account.clone());

        Ok(user_record_from_account(account))
    }

    pub fn update_user(
        &self,
        user_id: &str,
        name: String,
        phone: Option<String>,
        email: Option<String>,
        role: UserRole,
    ) -> Result<UserRecord, AuthError> {
        let normalized = validate_user_profile(
            Some(user_id),
            &name,
            phone.as_deref(),
            email.as_deref(),
            role,
        )
        .map_err(AuthError::BadRequest)?;

        let mut accounts = self
            .accounts
            .write()
            .map_err(|_| AuthError::Internal("failed to write account cache".to_string()))?;
        let current_role = accounts
            .get(user_id)
            .map(|account| account.role)
            .ok_or_else(|| AuthError::BadRequest("用户不存在。".to_string()))?;
        ensure_unique_contact(
            &accounts,
            Some(user_id),
            normalized.phone.as_deref(),
            normalized.email.as_deref(),
        )
        .map_err(AuthError::BadRequest)?;

        if current_role == UserRole::Admin
            && role != UserRole::Admin
            && is_last_active_admin(&accounts, Some(user_id))
        {
            return Err(AuthError::BadRequest(
                "至少需要保留一个管理员账号。".to_string(),
            ));
        }

        let account = accounts
            .get_mut(user_id)
            .ok_or_else(|| AuthError::BadRequest("用户不存在。".to_string()))?;

        account.name = normalized.name;
        account.phone = normalized.phone;
        account.email = normalized.email;
        account.role = normalized.role;
        account.username = derive_username(
            account.phone.as_deref(),
            account.email.as_deref(),
            &account.id,
        );
        account.updated_at = Utc::now().to_rfc3339();

        let connection = self.open_connection().map_err(AuthError::Internal)?;
        update_account(&connection, account).map_err(AuthError::Internal)?;

        Ok(user_record_from_account(account.clone()))
    }

    pub fn deactivate_user(&self, actor_id: &str, user_id: &str) -> Result<UserRecord, AuthError> {
        if actor_id == user_id {
            return Err(AuthError::BadRequest(
                "不能注销当前登录中的管理员本人。".to_string(),
            ));
        }

        let mut accounts = self
            .accounts
            .write()
            .map_err(|_| AuthError::Internal("failed to write account cache".to_string()))?;
        let (current_role, current_active) = accounts
            .get(user_id)
            .map(|account| (account.role, account.active))
            .ok_or_else(|| AuthError::BadRequest("用户不存在。".to_string()))?;

        if !current_active {
            return Err(AuthError::BadRequest("该用户已经是注销状态。".to_string()));
        }

        if current_role == UserRole::Admin && is_last_active_admin(&accounts, Some(user_id)) {
            return Err(AuthError::BadRequest(
                "至少需要保留一个管理员账号。".to_string(),
            ));
        }

        let account = accounts
            .get_mut(user_id)
            .ok_or_else(|| AuthError::BadRequest("用户不存在。".to_string()))?;

        account.active = false;
        account.updated_at = Utc::now().to_rfc3339();

        let connection = self.open_connection().map_err(AuthError::Internal)?;
        update_account(&connection, account).map_err(AuthError::Internal)?;
        drop(accounts);
        self.sessions
            .write()
            .map_err(|_| AuthError::Internal("failed to write session store".to_string()))?
            .retain(|_, session| session.user.id != user_id);

        let account = self
            .accounts
            .read()
            .map_err(|_| AuthError::Internal("failed to read account cache".to_string()))?
            .get(user_id)
            .cloned()
            .expect("deactivated user should remain in cache");

        Ok(user_record_from_account(account))
    }

    pub fn change_password(
        &self,
        user_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), AuthError> {
        validate_new_password(new_password).map_err(AuthError::BadRequest)?;

        let mut accounts = self
            .accounts
            .write()
            .map_err(|_| AuthError::Internal("failed to write account cache".to_string()))?;
        let account = accounts
            .get_mut(user_id)
            .ok_or_else(|| AuthError::Unauthorized("当前用户不存在。".to_string()))?;

        if !verify_password_hash(&account.password_hash, current_password) {
            return Err(AuthError::Unauthorized("当前密码不正确。".to_string()));
        }

        let new_hash = hash_password(new_password).map_err(AuthError::Internal)?;
        account.password_hash = new_hash.clone();
        account.updated_at = Utc::now().to_rfc3339();

        let connection = self.open_connection().map_err(AuthError::Internal)?;
        connection
            .execute(
                "UPDATE users SET password_hash = ?2, updated_at = ?3 WHERE id = ?1",
                params![&account.id, new_hash, &account.updated_at],
            )
            .map_err(|error| AuthError::Internal(error.to_string()))?;

        Ok(())
    }

    fn build_session_cookie(&self, value: &str, max_age: Option<u64>) -> String {
        let mut cookie = format!(
            "{}={}; Path=/; HttpOnly; SameSite=Strict",
            self.cookie_name, value
        );

        if let Some(seconds) = max_age {
            cookie.push_str(&format!("; Max-Age={seconds}"));
        }

        if self.secure_cookie {
            cookie.push_str("; Secure");
        }

        cookie
    }

    fn cleanup_expired_sessions(&self) -> Result<(), AuthError> {
        let now = Instant::now();
        self.sessions
            .write()
            .map_err(|_| AuthError::Internal("failed to write session store".to_string()))?
            .retain(|_, entry| entry.expires_at > now);
        Ok(())
    }

    fn enforce_rate_limit(&self, fingerprint: &str) -> Result<(), AuthError> {
        let now = Instant::now();
        let mut attempts = self
            .login_attempts
            .write()
            .map_err(|_| AuthError::Internal("failed to write login attempts".to_string()))?;

        attempts.retain(|_, state| {
            state
                .blocked_until
                .map(|until| until > now)
                .unwrap_or(false)
                || now.duration_since(state.window_started_at) <= self.login_window
        });

        let Some(state) = attempts.get(fingerprint) else {
            return Ok(());
        };

        if let Some(blocked_until) = state.blocked_until {
            if blocked_until > now {
                let remaining = blocked_until.duration_since(now).as_secs().max(1);
                return Err(AuthError::TooManyRequests(format!(
                    "登录失败次数过多，请在 {remaining} 秒后重试。"
                )));
            }
        }

        Ok(())
    }

    fn register_failed_attempt(&self, fingerprint: &str) -> Result<(), AuthError> {
        let now = Instant::now();
        let mut attempts = self
            .login_attempts
            .write()
            .map_err(|_| AuthError::Internal("failed to write login attempts".to_string()))?;

        let state = attempts
            .entry(fingerprint.to_string())
            .or_insert(LoginAttemptState {
                failed_attempts: 0,
                window_started_at: now,
                blocked_until: None,
            });

        if now.duration_since(state.window_started_at) > self.login_window {
            state.failed_attempts = 0;
            state.window_started_at = now;
            state.blocked_until = None;
        }

        state.failed_attempts += 1;

        if state.failed_attempts >= self.max_failed_attempts {
            state.blocked_until = Some(now + self.login_lockout);
        }

        Ok(())
    }

    fn clear_failed_attempts(&self, fingerprint: &str) -> Result<(), AuthError> {
        self.login_attempts
            .write()
            .map_err(|_| AuthError::Internal("failed to write login attempts".to_string()))?
            .remove(fingerprint);
        Ok(())
    }

    fn open_connection(&self) -> Result<Connection, String> {
        Connection::open(&self.database_path).map_err(|error| error.to_string())
    }
}

struct NormalizedUserProfile {
    name: String,
    phone: Option<String>,
    email: Option<String>,
    role: UserRole,
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                phone TEXT,
                email TEXT,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
            ",
        )
        .map_err(|error| error.to_string())
}

fn migrate_schema(connection: &Connection) -> Result<(), String> {
    ensure_column(connection, "users", "name", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(connection, "users", "phone", "TEXT")?;
    ensure_column(connection, "users", "email", "TEXT")?;
    ensure_column(connection, "users", "active", "INTEGER NOT NULL DEFAULT 1")?;
    connection
        .execute("UPDATE users SET name = username WHERE TRIM(name) = ''", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    if columns.iter().any(|existing| existing == column) {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn bootstrap_admin_if_needed(connection: &mut Connection) -> Result<(), String> {
    let existing_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;

    if existing_count > 0 {
        return Ok(());
    }

    let name = bootstrap_env("BOOTSTRAP_ADMIN_NAME")
        .or_else(|| bootstrap_env("BOOTSTRAP_ADMIN_USERNAME"))
        .unwrap_or_else(|| "Admin".to_string());
    let phone = bootstrap_env("BOOTSTRAP_ADMIN_PHONE");
    let email = bootstrap_env("BOOTSTRAP_ADMIN_EMAIL");
    let password_hash = bootstrap_env("BOOTSTRAP_ADMIN_PASSWORD_HASH")
        .or_else(|| bootstrap_env("AUTH_PASSWORD_HASH"))
        .ok_or_else(|| "missing bootstrap admin password hash environment variable".to_string())?;

    validate_password_hash(&password_hash)?;
    let normalized = validate_user_profile(
        None,
        &name,
        phone.as_deref(),
        email.as_deref(),
        UserRole::Admin,
    )?;
    let timestamp = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let username = derive_username(
        normalized.phone.as_deref(),
        normalized.email.as_deref(),
        &id,
    );

    connection
        .execute(
            "
            INSERT INTO users (
                id, username, name, phone, email, password_hash, role, active, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9)
            ",
            params![
                id,
                username,
                normalized.name,
                normalized.phone,
                normalized.email,
                password_hash,
                role_as_str(UserRole::Admin),
                timestamp,
                timestamp
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn load_accounts(connection: &Connection) -> Result<Vec<UserAccount>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, username, name, phone, email, password_hash, role, active, created_at, updated_at
            FROM users
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(UserAccount {
                id: row.get(0)?,
                username: row.get(1)?,
                name: row.get(2)?,
                phone: row.get(3)?,
                email: row.get(4)?,
                password_hash: row.get(5)?,
                role: role_from_str(&row.get::<_, String>(6)?).unwrap_or(UserRole::Employee),
                active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn insert_account(connection: &Connection, account: &UserAccount) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO users (
                id, username, name, phone, email, password_hash, role, active, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ",
            params![
                &account.id,
                &account.username,
                &account.name,
                &account.phone,
                &account.email,
                &account.password_hash,
                role_as_str(account.role),
                if account.active { 1 } else { 0 },
                &account.created_at,
                &account.updated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_account(connection: &Connection, account: &UserAccount) -> Result<(), String> {
    connection
        .execute(
            "
            UPDATE users
            SET username = ?2,
                name = ?3,
                phone = ?4,
                email = ?5,
                role = ?6,
                active = ?7,
                updated_at = ?8
            WHERE id = ?1
            ",
            params![
                &account.id,
                &account.username,
                &account.name,
                &account.phone,
                &account.email,
                role_as_str(account.role),
                if account.active { 1 } else { 0 },
                &account.updated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn bootstrap_env(name: &str) -> Option<String> {
    let value = env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty()
        || matches!(
            trimmed,
            "..." | "your_username" | "your_password" | "your_password_hash" | "your_name"
        )
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn validate_user_profile(
    _id: Option<&str>,
    name: &str,
    phone: Option<&str>,
    email: Option<&str>,
    role: UserRole,
) -> Result<NormalizedUserProfile, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("姓名为必填项。".to_string());
    }

    let phone = normalize_phone(phone);
    let email = normalize_email(email);

    if phone.is_none() && email.is_none() {
        return Err("手机号和电子邮箱至少需要填写一项。".to_string());
    }

    Ok(NormalizedUserProfile {
        name: name.to_string(),
        phone,
        email,
        role,
    })
}

fn validate_new_password(password: &str) -> Result<(), String> {
    if password.trim().len() < MIN_PASSWORD_LENGTH {
        return Err(format!("密码至少需要 {MIN_PASSWORD_LENGTH} 位。"));
    }
    Ok(())
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| format!("failed to hash password: {error}"))
}

fn validate_password_hash(password_hash: &str) -> Result<(), String> {
    PasswordHash::new(password_hash)
        .map(|_| ())
        .map_err(|error| format!("password hash is not valid: {error}"))
}

fn verify_password_hash(password_hash: &str, password: &str) -> bool {
    let parsed = match PasswordHash::new(password_hash) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

fn ensure_unique_contact(
    accounts: &HashMap<String, UserAccount>,
    current_id: Option<&str>,
    phone: Option<&str>,
    email: Option<&str>,
) -> Result<(), String> {
    if let Some(phone) = phone {
        if accounts.values().any(|account| {
            Some(account.id.as_str()) != current_id && account.phone.as_deref() == Some(phone)
        }) {
            return Err("手机号已经被其他用户使用。".to_string());
        }
    }

    if let Some(email) = email {
        if accounts.values().any(|account| {
            Some(account.id.as_str()) != current_id && account.email.as_deref() == Some(email)
        }) {
            return Err("电子邮箱已经被其他用户使用。".to_string());
        }
    }

    Ok(())
}

fn is_last_active_admin(
    accounts: &HashMap<String, UserAccount>,
    excluding_id: Option<&str>,
) -> bool {
    accounts
        .values()
        .filter(|account| {
            account.active
                && account.role == UserRole::Admin
                && Some(account.id.as_str()) != excluding_id
        })
        .count()
        == 0
}

fn user_record_from_account(account: UserAccount) -> UserRecord {
    UserRecord {
        id: account.id,
        name: account.name,
        phone: account.phone,
        email: account.email,
        role: account.role,
        active: account.active,
        created_at: account.created_at,
        updated_at: account.updated_at,
    }
}

pub fn session_info_from_user(user: SessionUser) -> SessionUserInfo {
    SessionUserInfo {
        id: user.id,
        name: user.name,
        role: user.role,
    }
}

fn role_as_str(role: UserRole) -> &'static str {
    match role {
        UserRole::Judge => "judge",
        UserRole::Employee => "employee",
        UserRole::Admin => "admin",
    }
}

fn role_from_str(value: &str) -> Option<UserRole> {
    match value {
        "judge" => Some(UserRole::Judge),
        "employee" => Some(UserRole::Employee),
        "admin" => Some(UserRole::Admin),
        _ => None,
    }
}

fn normalize_identifier(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn normalize_email(value: Option<&str>) -> Option<String> {
    let email = value?.trim().to_ascii_lowercase();
    (!email.is_empty()).then_some(email)
}

fn normalize_phone(value: Option<&str>) -> Option<String> {
    let normalized = value?
        .chars()
        .filter(|char| char.is_ascii_digit() || *char == '+')
        .collect::<String>();
    (!normalized.is_empty()).then_some(normalized)
}

fn derive_username(phone: Option<&str>, email: Option<&str>, user_id: &str) -> String {
    if let Some(phone) = phone {
        return format!("phone:{phone}");
    }

    if let Some(email) = email {
        return format!("email:{email}");
    }

    format!("user:{user_id}")
}

fn account_matches_identifier(account: &UserAccount, identifier: &str) -> bool {
    account.username == identifier
        || account.phone.as_deref() == Some(identifier)
        || account.email.as_deref() == Some(identifier)
}

fn read_u64_env(name: &str) -> Option<u64> {
    env::var(name).ok()?.trim().parse().ok()
}

fn read_u32_env(name: &str) -> Option<u32> {
    env::var(name).ok()?.trim().parse().ok()
}

fn read_cookie<'a>(headers: &'a HeaderMap, target_name: &str) -> Option<&'a str> {
    let header = headers.get(COOKIE)?.to_str().ok()?;

    header
        .split(';')
        .filter_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            Some((name.trim(), value.trim()))
        })
        .find_map(|(name, value)| (name == target_name).then_some(value))
}

fn client_fingerprint(headers: &HeaderMap) -> String {
    for header_name in ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"] {
        if let Some(value) = headers
            .get(header_name)
            .and_then(|header| header.to_str().ok())
        {
            let first = value.split(',').next().unwrap_or_default().trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }

    "unknown".to_string()
}

pub fn set_cookie_header(headers: &mut HeaderMap, value: HeaderValue) {
    headers.insert(SET_COOKIE, value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use argon2::password_hash::{PasswordHasher, SaltString};

    #[test]
    fn parses_cookie_from_header_map() {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_static("foo=bar; tonysgolfy_session=abc123"),
        );

        assert_eq!(read_cookie(&headers, "tonysgolfy_session"), Some("abc123"));
    }

    #[test]
    fn validates_known_hash() {
        let salt =
            SaltString::encode_b64(b"tonysgolfy-test-salt").expect("salt encoding should succeed");
        let hash = Argon2::default()
            .hash_password("password123".as_bytes(), &salt)
            .expect("hash generation should succeed")
            .to_string();

        assert!(verify_password_hash(&hash, "password123"));
        assert!(!verify_password_hash(&hash, "wrong-password"));
    }

    #[test]
    fn normalizes_phone_for_login() {
        assert_eq!(
            normalize_phone(Some("138-0013-8000")),
            Some("13800138000".to_string())
        );
    }
}
