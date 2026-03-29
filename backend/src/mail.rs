use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection};
use uuid::Uuid;

use crate::{
    auth::SessionUser,
    models::{
        DeleteMailResponse, MailFolder, MailMessage, MailboxResponse, SaveDraftRequest,
        SendMailRequest, UserRole,
    },
};

#[derive(Clone)]
pub struct MailService {
    database_path: PathBuf,
}

#[derive(Clone)]
struct MailAddressOwner {
    user_id: String,
    email: String,
}

impl MailService {
    pub fn load(database_path: &Path) -> Result<Self, String> {
        let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
        initialize_schema(&connection)?;

        Ok(Self {
            database_path: database_path.to_path_buf(),
        })
    }

    pub fn list_mailbox(
        &self,
        user: &SessionUser,
        folder: MailFolder,
    ) -> Result<MailboxResponse, String> {
        let address = user
            .email
            .clone()
            .ok_or_else(|| "current user does not have a mailbox address".to_string())?;
        let connection = self.open_connection()?;
        let messages = load_messages(&connection, &user.id, folder)?;

        Ok(MailboxResponse {
            address,
            folder,
            messages,
        })
    }

    pub fn send_mail(
        &self,
        user: &SessionUser,
        request: SendMailRequest,
    ) -> Result<MailboxResponse, String> {
        let sender_address = user
            .email
            .clone()
            .ok_or_else(|| "current user does not have a mailbox address".to_string())?;
        validate_mail_content(&request.to, &request.subject, &request.body)?;

        let mut connection = self.open_connection()?;
        let recipient = find_mailbox_owner(&connection, &request.to)?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let timestamp = Utc::now().to_rfc3339();

        if let Some(draft_id) = request.draft_id.as_deref() {
            transaction
                .execute(
                    "DELETE FROM mail_messages WHERE id = ?1 AND owner_user_id = ?2 AND folder = 'drafts'",
                    params![draft_id, &user.id],
                )
                .map_err(|error| error.to_string())?;
        }

        insert_message(
            &transaction,
            &MailMessageRowInput {
                id: Uuid::new_v4().to_string(),
                owner_user_id: user.id.clone(),
                folder: MailFolder::Sent,
                from_address: sender_address.clone(),
                to_address: recipient.email.clone(),
                subject: request.subject.trim().to_string(),
                body: request.body.trim().to_string(),
                is_read: true,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                sent_at: Some(timestamp.clone()),
                reply_to_message_id: request.reply_to_message_id.clone(),
            },
        )?;

        insert_message(
            &transaction,
            &MailMessageRowInput {
                id: Uuid::new_v4().to_string(),
                owner_user_id: recipient.user_id.clone(),
                folder: MailFolder::Inbox,
                from_address: sender_address,
                to_address: recipient.email,
                subject: request.subject.trim().to_string(),
                body: request.body.trim().to_string(),
                is_read: false,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                sent_at: Some(timestamp),
                reply_to_message_id: request.reply_to_message_id,
            },
        )?;

        transaction.commit().map_err(|error| error.to_string())?;
        self.list_mailbox(user, MailFolder::Sent)
    }

    pub fn save_draft(
        &self,
        user: &SessionUser,
        request: SaveDraftRequest,
    ) -> Result<MailboxResponse, String> {
        let sender_address = user
            .email
            .clone()
            .ok_or_else(|| "current user does not have a mailbox address".to_string())?;

        let to = request.to.trim().to_ascii_lowercase();
        let subject = request.subject.trim().to_string();
        let body = request.body.trim().to_string();
        let timestamp = Utc::now().to_rfc3339();
        let connection = self.open_connection()?;

        if let Some(draft_id) = request.draft_id.as_deref() {
            connection
                .execute(
                    "
                    UPDATE mail_messages
                    SET to_address = ?2,
                        subject = ?3,
                        body = ?4,
                        updated_at = ?5,
                        reply_to_message_id = ?6
                    WHERE id = ?1 AND owner_user_id = ?7 AND folder = 'drafts'
                    ",
                    params![
                        draft_id,
                        to,
                        subject,
                        body,
                        timestamp,
                        request.reply_to_message_id,
                        &user.id
                    ],
                )
                .map_err(|error| error.to_string())?;
        } else {
            insert_message(
                &connection,
                &MailMessageRowInput {
                    id: Uuid::new_v4().to_string(),
                    owner_user_id: user.id.clone(),
                    folder: MailFolder::Drafts,
                    from_address: sender_address,
                    to_address: to,
                    subject,
                    body,
                    is_read: true,
                    created_at: timestamp.clone(),
                    updated_at: timestamp,
                    sent_at: None,
                    reply_to_message_id: request.reply_to_message_id,
                },
            )?;
        }

        self.list_mailbox(user, MailFolder::Drafts)
    }

    pub fn delete_messages(
        &self,
        user: &SessionUser,
        ids: &[String],
    ) -> Result<DeleteMailResponse, String> {
        if ids.is_empty() {
            return Ok(DeleteMailResponse { updated: 0 });
        }

        let connection = self.open_connection()?;
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE mail_messages SET folder = 'trash', updated_at = ?1 WHERE owner_user_id = ?2 AND id IN ({placeholders}) AND folder != 'trash'"
        );

        let now = Utc::now().to_rfc3339();
        let mut values = Vec::with_capacity(ids.len() + 2);
        values.push(now);
        values.push(user.id.clone());
        values.extend(ids.iter().cloned());

        let updated = connection
            .execute(&sql, params_from_iter(values.iter()))
            .map_err(|error| error.to_string())?;

        Ok(DeleteMailResponse { updated })
    }

    fn open_connection(&self) -> Result<Connection, String> {
        Connection::open(&self.database_path).map_err(|error| error.to_string())
    }
}

struct MailMessageRowInput {
    id: String,
    owner_user_id: String,
    folder: MailFolder,
    from_address: String,
    to_address: String,
    subject: String,
    body: String,
    is_read: bool,
    created_at: String,
    updated_at: String,
    sent_at: Option<String>,
    reply_to_message_id: Option<String>,
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS mail_messages (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                from_address TEXT NOT NULL,
                to_address TEXT NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                sent_at TEXT,
                reply_to_message_id TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_mail_owner_folder ON mail_messages(owner_user_id, folder, updated_at DESC);
            ",
        )
        .map_err(|error| error.to_string())
}

fn load_messages(connection: &Connection, owner_user_id: &str, folder: MailFolder) -> Result<Vec<MailMessage>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, folder, from_address, to_address, subject, body, is_read, created_at, updated_at, sent_at, reply_to_message_id
            FROM mail_messages
            WHERE owner_user_id = ?1 AND folder = ?2
            ORDER BY updated_at DESC, created_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![owner_user_id, folder_as_str(folder)], |row| {
            Ok(MailMessage {
                id: row.get(0)?,
                folder: folder_from_str(&row.get::<_, String>(1)?).unwrap_or(MailFolder::Inbox),
                from_address: row.get(2)?,
                to_address: row.get(3)?,
                subject: row.get(4)?,
                body: row.get(5)?,
                is_read: row.get::<_, i64>(6)? != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                sent_at: row.get(9)?,
                reply_to_message_id: row.get(10)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn insert_message(connection: &Connection, input: &MailMessageRowInput) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO mail_messages (
                id, owner_user_id, folder, from_address, to_address, subject, body, is_read, created_at, updated_at, sent_at, reply_to_message_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ",
            params![
                &input.id,
                &input.owner_user_id,
                folder_as_str(input.folder),
                &input.from_address,
                &input.to_address,
                &input.subject,
                &input.body,
                if input.is_read { 1 } else { 0 },
                &input.created_at,
                &input.updated_at,
                &input.sent_at,
                &input.reply_to_message_id
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn find_mailbox_owner(connection: &Connection, to: &str) -> Result<MailAddressOwner, String> {
    let normalized = to.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("收件人邮箱不能为空。".to_string());
    }

    connection
        .query_row(
            "
            SELECT id, email
            FROM users
            WHERE active = 1
              AND LOWER(email) = ?1
              AND role IN ('employee', 'admin')
            ",
            params![normalized],
            |row| {
                Ok(MailAddressOwner {
                    user_id: row.get(0)?,
                    email: row.get(1)?,
                })
            },
        )
        .map_err(|_| "找不到这个工作邮箱对应的员工或管理员。".to_string())
}

fn validate_mail_content(to: &str, subject: &str, body: &str) -> Result<(), String> {
    if to.trim().is_empty() {
        return Err("收件人邮箱不能为空。".to_string());
    }
    if subject.trim().is_empty() {
        return Err("邮件主题不能为空。".to_string());
    }
    if body.trim().is_empty() {
        return Err("邮件正文不能为空。".to_string());
    }
    Ok(())
}

fn folder_as_str(folder: MailFolder) -> &'static str {
    match folder {
        MailFolder::Inbox => "inbox",
        MailFolder::Sent => "sent",
        MailFolder::Drafts => "drafts",
        MailFolder::Trash => "trash",
    }
}

fn folder_from_str(value: &str) -> Option<MailFolder> {
    match value {
        "inbox" => Some(MailFolder::Inbox),
        "sent" => Some(MailFolder::Sent),
        "drafts" => Some(MailFolder::Drafts),
        "trash" => Some(MailFolder::Trash),
        _ => None,
    }
}

#[allow(dead_code)]
fn _role_is_mail_enabled(role: UserRole) -> bool {
    matches!(role, UserRole::Employee | UserRole::Admin)
}
