use std::{
    collections::HashMap,
    env,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordVerifier},
};
use axum::http::{
    HeaderMap, HeaderValue,
    header::{COOKIE, SET_COOKIE},
};
use uuid::Uuid;

const DEFAULT_SESSION_TTL_HOURS: u64 = 12;
const DEFAULT_LOGIN_WINDOW_SECONDS: u64 = 15 * 60;
const DEFAULT_LOGIN_LOCKOUT_SECONDS: u64 = 15 * 60;
const DEFAULT_MAX_FAILED_ATTEMPTS: u32 = 5;

#[derive(Clone)]
pub struct AuthService {
    username: String,
    password_hash: String,
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
struct SessionEntry {
    username: String,
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
    pub username: String,
}

#[derive(Debug)]
pub enum AuthError {
    Unauthorized(String),
    TooManyRequests(String),
    Internal(String),
}

impl AuthService {
    pub fn from_env() -> Result<Self, String> {
        let username = required_env("AUTH_USERNAME")?;
        let password_hash = required_env("AUTH_PASSWORD_HASH")?;
        validate_password_hash(&password_hash)?;

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

        Ok(Self {
            username,
            password_hash,
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
        username: &str,
        password: &str,
    ) -> Result<(SessionUser, HeaderValue), AuthError> {
        let fingerprint = client_fingerprint(headers);
        self.enforce_rate_limit(&fingerprint)?;

        let verified =
            username.trim() == self.username && verify_password_hash(&self.password_hash, password);

        if !verified {
            self.register_failed_attempt(&fingerprint)?;
            return Err(AuthError::Unauthorized("用户名或密码错误。".to_string()));
        }

        self.clear_failed_attempts(&fingerprint)?;
        self.cleanup_expired_sessions()?;

        let session_id = Uuid::new_v4().to_string();
        let user = SessionUser {
            username: self.username.clone(),
        };

        self.sessions
            .write()
            .map_err(|_| AuthError::Internal("failed to write session store".to_string()))?
            .insert(
                session_id.clone(),
                SessionEntry {
                    username: user.username.clone(),
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

        Ok(Some(SessionUser {
            username: entry.username.clone(),
        }))
    }

    pub fn require_user(&self, headers: &HeaderMap) -> Result<SessionUser, String> {
        self.current_user(headers)?
            .ok_or_else(|| "请先登录。".to_string())
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
}

fn required_env(name: &str) -> Result<String, String> {
    let value =
        env::var(name).map_err(|_| format!("missing required environment variable {name}"))?;
    let trimmed = value.trim();

    if trimmed.is_empty()
        || matches!(
            trimmed,
            "..." | "your_username" | "your_password" | "your_password_hash"
        )
    {
        return Err(format!(
            "environment variable {name} is empty or still set to a placeholder"
        ));
    }

    Ok(trimmed.to_string())
}

fn read_u64_env(name: &str) -> Option<u64> {
    env::var(name).ok()?.trim().parse().ok()
}

fn read_u32_env(name: &str) -> Option<u32> {
    env::var(name).ok()?.trim().parse().ok()
}

fn validate_password_hash(password_hash: &str) -> Result<(), String> {
    PasswordHash::new(password_hash)
        .map(|_| ())
        .map_err(|error| format!("AUTH_PASSWORD_HASH is not a valid password hash: {error}"))
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
}
