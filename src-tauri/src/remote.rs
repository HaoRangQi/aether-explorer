use crate::{format_size, AppError, FileEntry};
use keyring::Entry;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::blocking::Client;
use reqwest::header::{HeaderName, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use ssh2::{ErrorCode as SshErrorCode, MethodType, Session, Sftp};
use std::collections::{hash_map::DefaultHasher, HashMap};
use std::env;
use std::hash::{Hash, Hasher};
use std::io::ErrorKind;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use suppaftp::{list::File as FtpFile, FtpError, FtpStream};
use tauri_plugin_store::StoreExt;

const REMOTE_CONNECTIONS_FILE: &str = "remote-connections.json";
const REMOTE_CONNECTIONS_KEY: &str = "connections";
const KEYCHAIN_SERVICE: &str = "Aether Explorer Remote Access";
const REMOTE_OPERATION_TIMEOUT_SECS: u64 = 5;
const REMOTE_IO_STEP_TIMEOUT_SECS: u64 = 2;
const REMOTE_CONNECT_ATTEMPT_TIMEOUT_MS: u64 = 500;
const SFTP_SESSION_IDLE_TTL_SECS: u64 = 600;
const LIBSSH2_ERROR_KEX_FAILURE: i32 = -5;
const LIBSSH2_ERROR_KEY_EXCHANGE_FAILURE: i32 = -8;
const LIBSSH2_ERROR_METHOD_NOT_SUPPORTED: i32 = -33;
const LIBSSH2_ERROR_ALGO_UNSUPPORTED: i32 = -51;
const SFTP_KEX_PREFS: &str = concat!(
    "curve25519-sha256,curve25519-sha256@libssh.org,",
    "ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,",
    "diffie-hellman-group-exchange-sha256,diffie-hellman-group16-sha512,",
    "diffie-hellman-group18-sha512,diffie-hellman-group14-sha256,",
    "diffie-hellman-group14-sha1"
);
const SFTP_HOSTKEY_PREFS: &str = concat!(
    "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,",
    "ecdsa-sha2-nistp521,rsa-sha2-512,rsa-sha2-256,ssh-rsa"
);
const SFTP_CIPHER_PREFS: &str = concat!(
    "chacha20-poly1305@openssh.com,aes128-gcm@openssh.com,",
    "aes256-gcm@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,",
    "aes128-cbc,aes256-cbc,3des-cbc"
);
const SFTP_MAC_PREFS: &str = concat!(
    "hmac-sha2-256,hmac-sha2-512,hmac-sha2-256-etm@openssh.com,",
    "hmac-sha2-512-etm@openssh.com,hmac-sha1"
);

struct SftpClient {
    session: Session,
    sftp: Arc<Sftp>,
}

#[derive(Clone)]
struct SftpClientHandle {
    session: Session,
    sftp: Arc<Sftp>,
}

struct SftpSessionCacheEntry {
    signature: String,
    client: SftpClient,
    last_used: Instant,
}

static SFTP_SESSION_CACHE: OnceLock<Mutex<HashMap<String, SftpSessionCacheEntry>>> =
    OnceLock::new();

fn remote_operation_timeout() -> Duration {
    Duration::from_secs(REMOTE_OPERATION_TIMEOUT_SECS)
}

fn remote_io_step_timeout() -> Duration {
    Duration::from_secs(REMOTE_IO_STEP_TIMEOUT_SECS)
}

fn remote_connect_attempt_timeout(remaining: Duration) -> Duration {
    remaining.min(Duration::from_millis(REMOTE_CONNECT_ATTEMPT_TIMEOUT_MS))
}

fn remote_timeout_error(protocol: &str, action: &str) -> AppError {
    AppError::unavailable(format!(
        "{} {}超时（{} 秒）。请检查服务器地址、端口、防火墙或网络。",
        protocol, action, REMOTE_OPERATION_TIMEOUT_SECS
    ))
}

fn run_remote_command_with_timeout<T, F>(
    protocol: &'static str,
    action: &'static str,
    task: F,
) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let result = task();
        let _ = sender.send(result);
    });
    match receiver.recv_timeout(remote_operation_timeout()) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(remote_timeout_error(protocol, action)),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(AppError::internal(format!(
            "{} {}任务异常结束",
            protocol, action
        ))),
    }
}

fn map_remote_io_error(protocol: &str, action: &str, error: std::io::Error) -> AppError {
    if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) {
        return remote_timeout_error(protocol, action);
    }
    AppError::unavailable(format!("{} {}失败: {}", protocol, action, error))
}

fn map_sftp_error(action: &str, error: ssh2::Error) -> AppError {
    let code = error.code();
    let raw_message = error.to_string();
    let detail = error.message().to_string();
    let message = error.to_string();
    let io_error: std::io::Error = error.into();
    if matches!(io_error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) {
        return remote_timeout_error("SFTP", action);
    }
    if is_sftp_algorithm_negotiation_error(code, &detail) {
        return AppError::unavailable(format!(
            "SFTP {}失败: SSH 算法协商失败，客户端和服务器没有共同的 key exchange / host key / cipher / MAC 算法。请在服务器 SSH 配置中启用 curve25519-sha256、ecdh-sha2-nistp256、diffie-hellman-group14-sha256、ssh-ed25519、rsa-sha2-256/512、aes128-ctr 或 hmac-sha2-256 后重试。原始错误: {}",
            action, raw_message
        ));
    }
    AppError::unavailable(format!("SFTP {}失败: {}", action, message))
}

fn is_sftp_algorithm_negotiation_error(code: SshErrorCode, message: &str) -> bool {
    match code {
        SshErrorCode::Session(
            LIBSSH2_ERROR_KEX_FAILURE
            | LIBSSH2_ERROR_KEY_EXCHANGE_FAILURE
            | LIBSSH2_ERROR_METHOD_NOT_SUPPORTED
            | LIBSSH2_ERROR_ALGO_UNSUPPORTED,
        ) => true,
        _ => {
            let normalized = message.to_ascii_lowercase();
            normalized.contains("exchange encryption keys")
                || normalized.contains("kex failure")
                || normalized.contains("key exchange failure")
                || normalized.contains("algorithm unsupported")
                || normalized.contains("method not supported")
        }
    }
}

fn map_ftp_error(action: &str, error: FtpError) -> AppError {
    match error {
        FtpError::ConnectionError(io_error) => map_remote_io_error("FTP", action, io_error),
        other => AppError::unavailable(format!("FTP {}失败: {}", action, other)),
    }
}

fn resolve_remote_socket_addrs(
    connection: &RemoteConnection,
    protocol: &str,
) -> Result<Vec<SocketAddr>, AppError> {
    let addrs: Vec<SocketAddr> = (connection.host.as_str(), connection.port)
        .to_socket_addrs()
        .map_err(|e| map_remote_io_error(protocol, "解析地址", e))?
        .collect();
    if addrs.is_empty() {
        return Err(AppError::unavailable(format!(
            "无法解析 {} 服务器地址: {}:{}",
            protocol, connection.host, connection.port
        )));
    }
    Ok(addrs)
}

fn connect_tcp_with_timeout(
    connection: &RemoteConnection,
    protocol: &str,
) -> Result<TcpStream, AppError> {
    let addrs = resolve_remote_socket_addrs(connection, protocol)?;
    let started_at = Instant::now();
    let mut last_error = None;
    for addr in addrs {
        let elapsed = started_at.elapsed();
        if elapsed >= remote_operation_timeout() {
            break;
        }
        let remaining = remote_operation_timeout().saturating_sub(elapsed);
        match TcpStream::connect_timeout(&addr, remote_connect_attempt_timeout(remaining)) {
            Ok(stream) => {
                stream
                    .set_read_timeout(Some(remote_io_step_timeout()))
                    .map_err(|e| map_remote_io_error(protocol, "设置读取超时", e))?;
                stream
                    .set_write_timeout(Some(remote_io_step_timeout()))
                    .map_err(|e| map_remote_io_error(protocol, "设置写入超时", e))?;
                return Ok(stream);
            }
            Err(error) => last_error = Some(error),
        }
    }
    let Some(error) = last_error else {
        return Err(remote_timeout_error(protocol, "连接"));
    };
    if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock)
        || started_at.elapsed() >= remote_operation_timeout()
    {
        return Err(remote_timeout_error(protocol, "连接"));
    }
    Err(map_remote_io_error(protocol, "连接", error))
}

fn configure_tcp_stream_timeout(stream: &TcpStream, protocol: &str) -> Result<(), AppError> {
    stream
        .set_read_timeout(Some(remote_io_step_timeout()))
        .map_err(|e| map_remote_io_error(protocol, "设置读取超时", e))?;
    stream
        .set_write_timeout(Some(remote_io_step_timeout()))
        .map_err(|e| map_remote_io_error(protocol, "设置写入超时", e))
}

fn sftp_session_cache() -> &'static Mutex<HashMap<String, SftpSessionCacheEntry>> {
    SFTP_SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stable_secret_fingerprint(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn sftp_credential_signature(credential: Option<&RemoteCredential>) -> String {
    match credential {
        Some(RemoteCredential::Password(Some(password))) => {
            format!("password:{:016x}", stable_secret_fingerprint(password))
        }
        Some(RemoteCredential::Password(None)) => "password:none".to_string(),
        Some(RemoteCredential::PrivateKeyPassphrase(Some(passphrase))) => {
            format!("private-key:{:016x}", stable_secret_fingerprint(passphrase))
        }
        Some(RemoteCredential::PrivateKeyPassphrase(None)) => "private-key:none".to_string(),
        None => "credential:unknown".to_string(),
    }
}

fn sftp_connection_signature(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        connection.host,
        connection.port,
        connection.username.as_deref().unwrap_or(""),
        connection.auth_method_label(),
        connection.base_path,
        connection.private_key_path.as_deref().unwrap_or(""),
        sftp_credential_signature(credential),
    )
}

fn clear_sftp_session_cache(connection_id: &str) {
    if let Ok(mut cache) = sftp_session_cache().lock() {
        cache.remove(connection_id);
    }
}

fn clear_stale_sftp_session_cache(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
) {
    if let Ok(mut cache) = sftp_session_cache().lock() {
        let Some(entry) = cache.get(&connection.id) else {
            return;
        };
        if entry.signature != sftp_connection_signature(connection, credential) {
            cache.remove(&connection.id);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteProtocol {
    Sftp,
    Ftp,
    WebdavHttps,
    WebdavHttp,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteAuthMethod {
    #[default]
    Password,
    PrivateKey,
}

impl RemoteProtocol {
    fn default_port(&self) -> u16 {
        match self {
            RemoteProtocol::Sftp => 22,
            RemoteProtocol::Ftp => 21,
            RemoteProtocol::WebdavHttps => 443,
            RemoteProtocol::WebdavHttp => 80,
        }
    }

    fn scheme(&self) -> &'static str {
        match self {
            RemoteProtocol::Sftp => "sftp",
            RemoteProtocol::Ftp => "ftp",
            RemoteProtocol::WebdavHttps => "https",
            RemoteProtocol::WebdavHttp => "http",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnection {
    pub id: String,
    pub name: String,
    pub protocol: RemoteProtocol,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub base_path: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub auth_method: RemoteAuthMethod,
    pub has_password: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub has_private_key_passphrase: bool,
}

impl RemoteConnection {
    fn auth_method_label(&self) -> &'static str {
        match self.auth_method {
            RemoteAuthMethod::Password => "password",
            RemoteAuthMethod::PrivateKey => "private-key",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRemoteConnectionInput {
    pub id: Option<String>,
    pub name: String,
    pub protocol: RemoteProtocol,
    pub host: String,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub base_path: Option<String>,
    pub password: Option<String>,
    pub auth_method: Option<RemoteAuthMethod>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRemoteDirectoryInput {
    pub connection_id: String,
    pub remote_path: String,
    pub show_hidden: bool,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct RemotePathParts {
    connection_id: String,
    remote_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteConnectionsStore {
    connections: Vec<RemoteConnection>,
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn store_error(context: &str, error: impl std::fmt::Display) -> AppError {
    AppError::unavailable(format!("{}: {}", context, error))
}

fn read_store(app: &tauri::AppHandle) -> Result<RemoteConnectionsStore, AppError> {
    let store = app
        .store(REMOTE_CONNECTIONS_FILE)
        .map_err(|e| store_error("无法打开远程连接 Store", e))?;
    let Some(value) = store.get(REMOTE_CONNECTIONS_KEY) else {
        return Ok(RemoteConnectionsStore::default());
    };
    if value.is_array() {
        let connections = serde_json::from_value(value)
            .map_err(|e| AppError::unavailable(format!("远程连接配置格式无效: {}", e)))?;
        return Ok(RemoteConnectionsStore { connections });
    }
    serde_json::from_value(value)
        .map_err(|e| AppError::unavailable(format!("远程连接配置格式无效: {}", e)))
}

fn write_store(
    app: &tauri::AppHandle,
    remote_store: &RemoteConnectionsStore,
) -> Result<(), AppError> {
    let store = app
        .store(REMOTE_CONNECTIONS_FILE)
        .map_err(|e| store_error("无法打开远程连接 Store", e))?;
    let value = serde_json::to_value(&remote_store.connections)
        .map_err(|e| AppError::internal(format!("无法序列化远程连接配置: {}", e)))?;
    store.set(REMOTE_CONNECTIONS_KEY, value);
    store
        .save()
        .map_err(|e| store_error("无法保存远程连接 Store", e))
}

pub fn normalize_remote_directory_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    let mut normalized = String::new();
    if !trimmed.starts_with('/') {
        normalized.push('/');
    }
    normalized.push_str(trimmed);
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

fn join_remote_path(base: &str, child: &str) -> String {
    let base = normalize_remote_directory_path(base);
    let child = child.trim_matches('/');
    if child.is_empty() {
        return base;
    }
    if base == "/" {
        format!("/{}", child)
    } else {
        format!("{}/{}", base, child)
    }
}

#[cfg(test)]
fn parse_remote_path(path: &str) -> Option<RemotePathParts> {
    let rest = path.strip_prefix("aether-remote://")?;
    let mut parts = rest.splitn(2, '/');
    let connection_id = parts.next()?.trim().to_string();
    if connection_id.is_empty() {
        return None;
    }
    let remote_path = normalize_remote_directory_path(parts.next().unwrap_or("/"));
    Some(RemotePathParts {
        connection_id,
        remote_path,
    })
}

pub fn keychain_account(connection_id: &str) -> String {
    format!("remote:{}", connection_id)
}

pub fn keychain_private_key_passphrase_account(connection_id: &str) -> String {
    format!("remote:{}:private-key-passphrase", connection_id)
}

fn keychain_entry(connection_id: &str) -> Result<Entry, AppError> {
    Entry::new(KEYCHAIN_SERVICE, &keychain_account(connection_id))
        .map_err(|e| AppError::unavailable(format!("无法访问 Keychain: {}", e)))
}

fn keychain_private_key_passphrase_entry(connection_id: &str) -> Result<Entry, AppError> {
    Entry::new(
        KEYCHAIN_SERVICE,
        &keychain_private_key_passphrase_account(connection_id),
    )
    .map_err(|e| AppError::unavailable(format!("无法访问 Keychain: {}", e)))
}

fn set_connection_password(connection_id: &str, password: Option<&str>) -> Result<bool, AppError> {
    let Some(password) = password else {
        return Ok(false);
    };
    if password.is_empty() {
        let _ = keychain_entry(connection_id)?.delete_credential();
        return Ok(false);
    }
    keychain_entry(connection_id)?
        .set_password(password)
        .map_err(|e| AppError::unavailable(format!("无法保存远程连接密码: {}", e)))?;
    Ok(true)
}

fn set_private_key_passphrase(
    connection_id: &str,
    passphrase: Option<&str>,
) -> Result<bool, AppError> {
    let Some(passphrase) = passphrase else {
        return Ok(false);
    };
    if passphrase.is_empty() {
        let _ = keychain_private_key_passphrase_entry(connection_id)?.delete_credential();
        return Ok(false);
    }
    keychain_private_key_passphrase_entry(connection_id)?
        .set_password(passphrase)
        .map_err(|e| AppError::unavailable(format!("无法保存 SFTP 私钥口令: {}", e)))?;
    Ok(true)
}

fn get_connection_password(connection_id: &str) -> Result<Option<String>, AppError> {
    match keychain_entry(connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::unavailable(format!(
            "无法读取远程连接密码: {}",
            e
        ))),
    }
}

fn get_private_key_passphrase(connection_id: &str) -> Result<Option<String>, AppError> {
    match keychain_private_key_passphrase_entry(connection_id)?.get_password() {
        Ok(passphrase) => Ok(Some(passphrase)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::unavailable(format!(
            "无法读取 SFTP 私钥口令: {}",
            e
        ))),
    }
}

fn delete_connection_password(connection_id: &str) -> Result<(), AppError> {
    match keychain_entry(connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::unavailable(format!(
            "无法删除远程连接密码: {}",
            e
        ))),
    }
}

fn delete_private_key_passphrase(connection_id: &str) -> Result<(), AppError> {
    match keychain_private_key_passphrase_entry(connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::unavailable(format!(
            "无法删除 SFTP 私钥口令: {}",
            e
        ))),
    }
}

fn sanitize_id_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn build_connection_id(input: &SaveRemoteConnectionInput, now: u64) -> String {
    input
        .id
        .as_ref()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| {
            let host = sanitize_id_part(&input.host);
            let name = sanitize_id_part(&input.name);
            format!("{}-{}-{}", host, name, now)
        })
}

fn normalize_remote_auth_method(
    protocol: &RemoteProtocol,
    auth_method: Option<RemoteAuthMethod>,
) -> RemoteAuthMethod {
    match (protocol, auth_method) {
        (RemoteProtocol::Sftp, Some(RemoteAuthMethod::PrivateKey)) => RemoteAuthMethod::PrivateKey,
        _ => RemoteAuthMethod::Password,
    }
}

fn normalize_private_key_path(
    protocol: &RemoteProtocol,
    auth_method: &RemoteAuthMethod,
    path: Option<&str>,
) -> Result<Option<String>, AppError> {
    if protocol != &RemoteProtocol::Sftp || auth_method != &RemoteAuthMethod::PrivateKey {
        return Ok(None);
    }
    let path = path.unwrap_or("").trim().to_string();
    if path.is_empty() {
        return Err(AppError::invalid_path("请选择私钥文件", None));
    }
    Ok(Some(path))
}

fn expand_private_key_path(path: &str, home_dir: Option<&str>) -> PathBuf {
    if path == "~" {
        return home_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home_dir) = home_dir {
            return Path::new(home_dir).join(rest);
        }
    }
    PathBuf::from(path)
}

fn private_key_path_for_auth(path: &str) -> PathBuf {
    expand_private_key_path(path, env::var("HOME").ok().as_deref())
}

fn normalize_connection_input(
    input: SaveRemoteConnectionInput,
    existing: Option<&RemoteConnection>,
    now: u64,
) -> Result<RemoteConnection, AppError> {
    let id = build_connection_id(&input, now);
    let name = input.name.trim().to_string();
    let host = input.host.trim().to_string();
    if name.is_empty() {
        return Err(AppError::invalid_path("请输入连接名称", None));
    }
    if host.is_empty() {
        return Err(AppError::invalid_path("请输入服务器地址", None));
    }
    let port = input.port.unwrap_or_else(|| input.protocol.default_port());
    if port == 0 {
        return Err(AppError::invalid_path("端口需在 1-65535 之间", None));
    }
    let auth_method = normalize_remote_auth_method(&input.protocol, input.auth_method.clone());
    let private_key_path = normalize_private_key_path(
        &input.protocol,
        &auth_method,
        input.private_key_path.as_deref(),
    )?;
    let created_at = existing.map(|item| item.created_at).unwrap_or(now);
    let existing_has_password = existing.map(|item| item.has_password).unwrap_or(false);
    let existing_has_private_key_passphrase = existing
        .map(|item| item.has_private_key_passphrase)
        .unwrap_or(false);
    let has_private_key_passphrase =
        if auth_method == RemoteAuthMethod::PrivateKey && input.private_key_passphrase.is_some() {
            !input
                .private_key_passphrase
                .as_deref()
                .unwrap_or("")
                .is_empty()
        } else if auth_method == RemoteAuthMethod::PrivateKey {
            existing_has_private_key_passphrase
        } else {
            false
        };
    Ok(RemoteConnection {
        id,
        name,
        protocol: input.protocol.clone(),
        host,
        port,
        username: input
            .username
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        base_path: normalize_remote_directory_path(input.base_path.as_deref().unwrap_or("/")),
        created_at,
        updated_at: now,
        auth_method: auth_method.clone(),
        has_password: auth_method == RemoteAuthMethod::Password && existing_has_password,
        private_key_path,
        has_private_key_passphrase,
    })
}

fn non_empty_secret(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.is_empty())
}

pub fn redact_connection_secret(connection: &RemoteConnection) -> RemoteConnection {
    connection.clone()
}

#[tauri::command]
pub fn list_remote_connections(app: tauri::AppHandle) -> Result<Vec<RemoteConnection>, AppError> {
    let mut connections = read_store(&app)?.connections;
    connections.sort_by_key(|item| item.name.to_lowercase());
    Ok(connections)
}

#[tauri::command]
pub fn save_remote_connection(
    app: tauri::AppHandle,
    input: SaveRemoteConnectionInput,
) -> Result<RemoteConnection, AppError> {
    let mut store = read_store(&app)?;
    let now = now_millis();
    let existing = input
        .id
        .as_ref()
        .and_then(|id| store.connections.iter().find(|item| &item.id == id));
    let mut next = normalize_connection_input(input.clone(), existing, now)?;
    match next.auth_method {
        RemoteAuthMethod::Password => {
            if input.password.is_some() {
                next.has_password = set_connection_password(&next.id, input.password.as_deref())?;
            } else {
                next.has_password = existing.map(|item| item.has_password).unwrap_or(false);
            }
            next.has_private_key_passphrase = false;
            let _ = delete_private_key_passphrase(&next.id);
        }
        RemoteAuthMethod::PrivateKey => {
            next.has_password = false;
            let _ = delete_connection_password(&next.id);
            if input.private_key_passphrase.is_some() {
                next.has_private_key_passphrase =
                    set_private_key_passphrase(&next.id, input.private_key_passphrase.as_deref())?;
            } else {
                next.has_private_key_passphrase = existing
                    .map(|item| item.has_private_key_passphrase)
                    .unwrap_or(false);
            }
        }
    }
    store.connections.retain(|item| item.id != next.id);
    store.connections.push(next.clone());
    write_store(&app, &store)?;
    if next.protocol == RemoteProtocol::Sftp {
        let credential = load_connection_credential(&next)?;
        clear_stale_sftp_session_cache(&next, Some(&credential));
    }
    Ok(redact_connection_secret(&next))
}

#[tauri::command]
pub fn delete_remote_connection(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<(), AppError> {
    let mut store = read_store(&app)?;
    store.connections.retain(|item| item.id != connection_id);
    write_store(&app, &store)?;
    clear_sftp_session_cache(&connection_id);
    delete_connection_password(&connection_id)?;
    delete_private_key_passphrase(&connection_id)
}

fn load_connection(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> Result<RemoteConnection, AppError> {
    read_store(app)?
        .connections
        .into_iter()
        .find(|item| item.id == connection_id)
        .ok_or_else(|| {
            AppError::new(
                crate::AppErrorKind::NotFound,
                "远程连接不存在",
                Some(connection_id.to_string()),
            )
        })
}

#[tauri::command]
pub fn test_remote_connection(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<(), AppError> {
    run_remote_command_with_timeout("远程服务器", "测试连接", move || {
        let connection = load_connection(&app, &connection_id)?;
        let credential = load_connection_credential(&connection)?;
        test_remote_connection_impl(&connection, Some(&credential))
    })
}

fn test_connection_credential(
    input: &SaveRemoteConnectionInput,
    connection: &RemoteConnection,
    existing: Option<&RemoteConnection>,
) -> Result<RemoteCredential, AppError> {
    match connection.auth_method {
        RemoteAuthMethod::Password => {
            let password = non_empty_secret(input.password.clone());
            if password.is_some() || existing.is_none() {
                return Ok(RemoteCredential::Password(password));
            }
            Ok(RemoteCredential::Password(get_connection_password(
                &connection.id,
            )?))
        }
        RemoteAuthMethod::PrivateKey => {
            let passphrase = non_empty_secret(input.private_key_passphrase.clone());
            if passphrase.is_some() || existing.is_none() {
                return Ok(RemoteCredential::PrivateKeyPassphrase(passphrase));
            }
            Ok(RemoteCredential::PrivateKeyPassphrase(
                get_private_key_passphrase(&connection.id)?,
            ))
        }
    }
}

#[tauri::command]
pub fn test_remote_connection_input(
    app: tauri::AppHandle,
    input: SaveRemoteConnectionInput,
) -> Result<(), AppError> {
    run_remote_command_with_timeout("远程服务器", "测试连接", move || {
        let store = read_store(&app)?;
        let now = now_millis();
        let existing = input
            .id
            .as_ref()
            .and_then(|id| store.connections.iter().find(|item| &item.id == id));
        let connection = normalize_connection_input(input.clone(), existing, now)?;
        let credential = test_connection_credential(&input, &connection, existing)?;
        test_remote_connection_impl(&connection, Some(&credential))
    })
}

#[tauri::command]
pub async fn list_remote_directory(
    app: tauri::AppHandle,
    input: ListRemoteDirectoryInput,
) -> Result<Vec<FileEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        run_remote_command_with_timeout("远程服务器", "加载目录", move || {
            let connection = load_connection(&app, &input.connection_id)?;
            let credential = load_connection_credential(&connection)?;
            let remote_path = normalize_remote_directory_path(&input.remote_path);
            list_remote_directory_impl(
                &connection,
                &remote_path,
                input.show_hidden,
                Some(&credential),
            )
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("远程目录加载任务失败: {}", e)))?
}

#[derive(Debug, Clone)]
enum RemoteCredential {
    Password(Option<String>),
    PrivateKeyPassphrase(Option<String>),
}

fn load_connection_credential(connection: &RemoteConnection) -> Result<RemoteCredential, AppError> {
    match connection.auth_method {
        RemoteAuthMethod::Password => Ok(RemoteCredential::Password(get_connection_password(
            &connection.id,
        )?)),
        RemoteAuthMethod::PrivateKey => Ok(RemoteCredential::PrivateKeyPassphrase(
            get_private_key_passphrase(&connection.id)?,
        )),
    }
}

fn list_remote_directory_impl(
    connection: &RemoteConnection,
    remote_path: &str,
    show_hidden: bool,
    credential: Option<&RemoteCredential>,
) -> Result<Vec<FileEntry>, AppError> {
    match connection.protocol {
        RemoteProtocol::Sftp => {
            list_sftp_directory(connection, remote_path, show_hidden, credential)
        }
        RemoteProtocol::Ftp => list_ftp_directory(
            connection,
            remote_path,
            show_hidden,
            credential.and_then(|item| match item {
                RemoteCredential::Password(password) => password.as_deref(),
                RemoteCredential::PrivateKeyPassphrase(_) => None,
            }),
        ),
        RemoteProtocol::WebdavHttps | RemoteProtocol::WebdavHttp => list_webdav_directory(
            connection,
            remote_path,
            show_hidden,
            credential.and_then(|item| match item {
                RemoteCredential::Password(password) => password.as_deref(),
                RemoteCredential::PrivateKeyPassphrase(_) => None,
            }),
        ),
    }
}

fn test_remote_connection_impl(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
) -> Result<(), AppError> {
    match connection.protocol {
        RemoteProtocol::Sftp => test_sftp_connection(connection, credential),
        RemoteProtocol::Ftp | RemoteProtocol::WebdavHttps | RemoteProtocol::WebdavHttp => {
            let remote_path = connection.base_path.clone();
            list_remote_directory_impl(connection, &remote_path, false, credential).map(|_| ())
        }
    }
}

fn remote_entry_path(connection_id: &str, remote_path: &str) -> String {
    let connection_id = encode_uri_component(connection_id);
    let remote_path = normalize_remote_directory_path(remote_path);
    let encoded_path = if remote_path == "/" {
        "/".to_string()
    } else {
        format!(
            "/{}",
            remote_path
                .split('/')
                .filter(|part| !part.is_empty())
                .map(encode_uri_component)
                .collect::<Vec<_>>()
                .join("/")
        )
    };
    format!("aether-remote://{}{}", connection_id, encoded_path)
}

fn remote_file_entry(
    connection_id: &str,
    name: String,
    remote_path: String,
    is_dir: bool,
    size: Option<u64>,
    modified: String,
) -> FileEntry {
    remote_file_entry_with_type(
        connection_id,
        name,
        remote_path,
        is_dir,
        size,
        modified,
        None,
    )
}

fn remote_file_entry_with_type(
    connection_id: &str,
    name: String,
    remote_path: String,
    is_dir: bool,
    size: Option<u64>,
    modified: String,
    file_type_override: Option<&str>,
) -> FileEntry {
    FileEntry {
        name: name.clone(),
        path: remote_entry_path(connection_id, &remote_path),
        is_dir,
        size: if is_dir {
            "--".into()
        } else {
            format_size(size.unwrap_or(0))
        },
        modified,
        created: String::new(),
        added: String::new(),
        last_opened: String::new(),
        open_with: String::new(),
        file_type: file_type_override
            .map(ToString::to_string)
            .unwrap_or_else(|| {
                if is_dir {
                    "folder".into()
                } else {
                    crate::detect_mime(&name, false)
                }
            }),
        icon_path: None,
        child_count: None,
    }
}

fn sort_entries(mut entries: Vec<FileEntry>) -> Vec<FileEntry> {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

fn include_remote_name(name: &str, show_hidden: bool) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    show_hidden || !name.starts_with('.')
}

fn list_sftp_directory(
    connection: &RemoteConnection,
    remote_path: &str,
    show_hidden: bool,
    credential: Option<&RemoteCredential>,
) -> Result<Vec<FileEntry>, AppError> {
    if let Some(client) = get_cached_sftp_client(connection, credential) {
        match list_sftp_directory_with_client(connection, &client, remote_path, show_hidden) {
            Ok(entries) => return Ok(entries),
            Err(_) => clear_sftp_session_cache(&connection.id),
        }
    }
    let client = connect_sftp_client(connection, credential)?;
    let handle = client.handle();
    let entries = list_sftp_directory_with_client(connection, &handle, remote_path, show_hidden)?;
    cache_sftp_client(connection, credential, client);
    Ok(entries)
}

fn test_sftp_connection(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
) -> Result<(), AppError> {
    if let Some(client) = get_cached_sftp_client(connection, credential) {
        if let Ok(()) = test_sftp_connection_with_client(connection, &client) {
            return Ok(());
        }
        clear_sftp_session_cache(&connection.id);
    }
    let client = connect_sftp_client(connection, credential)?;
    let handle = client.handle();
    test_sftp_connection_with_client(connection, &handle)?;
    cache_sftp_client(connection, credential, client);
    Ok(())
}

fn test_sftp_connection_with_client(
    connection: &RemoteConnection,
    client: &SftpClientHandle,
) -> Result<(), AppError> {
    client
        .session
        .set_timeout(remote_io_step_timeout().as_millis() as u32);
    let _ = client.session.keepalive_send();
    let base_path = normalize_remote_directory_path(&connection.base_path);
    let sftp = client.sftp.as_ref();
    let stat = sftp.stat(Path::new(&base_path));
    let stat = stat.map_err(|e| map_sftp_error("检查起始目录", e))?;
    if !stat.is_dir() {
        return Err(AppError::invalid_path(
            "SFTP 起始路径不是目录",
            Some(base_path),
        ));
    }
    Ok(())
}

impl SftpClient {
    fn handle(&self) -> SftpClientHandle {
        SftpClientHandle {
            session: self.session.clone(),
            sftp: self.sftp.clone(),
        }
    }
}

fn get_cached_sftp_client(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
) -> Option<SftpClientHandle> {
    let signature = sftp_connection_signature(connection, credential);
    let mut cache = sftp_session_cache().lock().ok()?;
    let entry = cache.get_mut(&connection.id)?;
    if entry.signature != signature
        || entry.last_used.elapsed() > Duration::from_secs(SFTP_SESSION_IDLE_TTL_SECS)
    {
        cache.remove(&connection.id);
        return None;
    }
    if !entry.client.session.authenticated() {
        cache.remove(&connection.id);
        return None;
    }
    entry.last_used = Instant::now();
    Some(entry.client.handle())
}

fn cache_sftp_client(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
    client: SftpClient,
) {
    if let Ok(mut cache) = sftp_session_cache().lock() {
        cache.insert(
            connection.id.clone(),
            SftpSessionCacheEntry {
                signature: sftp_connection_signature(connection, credential),
                client,
                last_used: Instant::now(),
            },
        );
    }
}

fn apply_sftp_algorithm_preferences(session: &Session) -> Result<(), AppError> {
    session
        .method_pref(MethodType::Kex, SFTP_KEX_PREFS)
        .map_err(|e| map_sftp_error("配置 key exchange 算法", e))?;
    session
        .method_pref(MethodType::HostKey, SFTP_HOSTKEY_PREFS)
        .map_err(|e| map_sftp_error("配置 host key 算法", e))?;
    session
        .method_pref(MethodType::CryptCs, SFTP_CIPHER_PREFS)
        .map_err(|e| map_sftp_error("配置加密算法", e))?;
    session
        .method_pref(MethodType::CryptSc, SFTP_CIPHER_PREFS)
        .map_err(|e| map_sftp_error("配置加密算法", e))?;
    session
        .method_pref(MethodType::MacCs, SFTP_MAC_PREFS)
        .map_err(|e| map_sftp_error("配置 MAC 算法", e))?;
    session
        .method_pref(MethodType::MacSc, SFTP_MAC_PREFS)
        .map_err(|e| map_sftp_error("配置 MAC 算法", e))
}

fn connect_sftp_client(
    connection: &RemoteConnection,
    credential: Option<&RemoteCredential>,
) -> Result<SftpClient, AppError> {
    let tcp = connect_tcp_with_timeout(connection, "SFTP")?;
    let mut session =
        Session::new().map_err(|e| AppError::unavailable(format!("无法创建 SFTP 会话: {}", e)))?;
    session.set_timeout(remote_io_step_timeout().as_millis() as u32);
    apply_sftp_algorithm_preferences(&session)?;
    session.set_tcp_stream(tcp);
    session.set_keepalive(false, 30);
    session.handshake().map_err(|e| map_sftp_error("握手", e))?;
    let username = connection.username.as_deref().unwrap_or("");
    match connection.auth_method {
        RemoteAuthMethod::Password => {
            let password = match credential {
                Some(RemoteCredential::Password(password)) => password.as_deref().unwrap_or(""),
                _ => "",
            };
            session
                .userauth_password(username, password)
                .map_err(|e| map_sftp_error("登录", e))?;
        }
        RemoteAuthMethod::PrivateKey => {
            let private_key_path = connection
                .private_key_path
                .as_deref()
                .ok_or_else(|| AppError::invalid_path("请选择私钥文件", None))?;
            let passphrase = match credential {
                Some(RemoteCredential::PrivateKeyPassphrase(passphrase)) => passphrase.as_deref(),
                _ => None,
            };
            session
                .userauth_pubkey_file(
                    username,
                    None,
                    &private_key_path_for_auth(private_key_path),
                    passphrase,
                )
                .map_err(|e| map_sftp_error("私钥登录", e))?;
        }
    }
    let sftp = session.sftp();
    let sftp = sftp.map_err(|e| map_sftp_error("打开文件系统", e))?;
    Ok(SftpClient {
        session,
        sftp: Arc::new(sftp),
    })
}

fn list_sftp_directory_with_client(
    connection: &RemoteConnection,
    client: &SftpClientHandle,
    remote_path: &str,
    show_hidden: bool,
) -> Result<Vec<FileEntry>, AppError> {
    client
        .session
        .set_timeout(remote_io_step_timeout().as_millis() as u32);
    let _ = client.session.keepalive_send();
    let rows = client
        .sftp
        .readdir(Path::new(remote_path))
        .map_err(|e| map_sftp_error("读取目录", e))?;
    let entries = rows
        .into_iter()
        .filter_map(|(path, stat)| {
            let name = path.file_name()?.to_string_lossy().to_string();
            if !include_remote_name(&name, show_hidden) {
                return None;
            }
            let child_path = join_remote_path(remote_path, &name);
            let is_dir = stat.is_dir();
            let file_type_override = if !is_dir && !stat.is_file() {
                Some("remote-unknown")
            } else {
                None
            };
            Some(remote_file_entry_with_type(
                &connection.id,
                name,
                child_path,
                is_dir,
                stat.size,
                String::new(),
                file_type_override,
            ))
        })
        .collect();
    Ok(sort_entries(entries))
}

fn list_ftp_directory(
    connection: &RemoteConnection,
    remote_path: &str,
    show_hidden: bool,
    password: Option<&str>,
) -> Result<Vec<FileEntry>, AppError> {
    let passive_timeout = remote_io_step_timeout();
    let tcp = connect_tcp_with_timeout(connection, "FTP")?;
    let mut ftp = FtpStream::connect_with_stream(tcp)
        .map_err(|e| map_ftp_error("连接", e))?
        .passive_stream_builder(move |addr| {
            let stream = TcpStream::connect_timeout(&addr, passive_timeout)
                .map_err(FtpError::ConnectionError)?;
            stream
                .set_read_timeout(Some(passive_timeout))
                .map_err(FtpError::ConnectionError)?;
            stream
                .set_write_timeout(Some(passive_timeout))
                .map_err(FtpError::ConnectionError)?;
            Ok(stream)
        });
    configure_tcp_stream_timeout(ftp.get_ref(), "FTP")?;
    ftp.login(
        connection.username.as_deref().unwrap_or("anonymous"),
        password.unwrap_or("anonymous@"),
    )
    .map_err(|e| map_ftp_error("登录", e))?;
    ftp.cwd(remote_path)
        .map_err(|e| map_ftp_error("进入目录", e))?;

    if let Ok(rows) = ftp.mlsd(None) {
        let entries = rows
            .into_iter()
            .filter_map(|line| {
                let file = FtpFile::from_mlsx_line(&line).ok()?;
                let name = file.name().to_string();
                if !include_remote_name(&name, show_hidden) {
                    return None;
                }
                let child_path = join_remote_path(remote_path, &name);
                let is_dir = file.is_directory();
                let size = if is_dir {
                    None
                } else {
                    Some(file.size() as u64)
                };
                Some(remote_file_entry(
                    &connection.id,
                    name,
                    child_path,
                    is_dir,
                    size,
                    String::new(),
                ))
            })
            .collect();
        let _ = ftp.quit();
        return Ok(sort_entries(entries));
    }

    let names = ftp.nlst(None).map_err(|e| map_ftp_error("读取目录", e))?;
    let mut entries = Vec::new();
    for raw_name in names {
        let name = raw_name.rsplit('/').next().unwrap_or(&raw_name).to_string();
        if !include_remote_name(&name, show_hidden) {
            continue;
        }
        let child_path = join_remote_path(remote_path, &name);
        entries.push(remote_file_entry_with_type(
            &connection.id,
            name,
            child_path,
            false,
            None,
            String::new(),
            Some("remote-unknown"),
        ));
    }
    let _ = ftp.quit();
    Ok(sort_entries(entries))
}

fn connection_base_url(connection: &RemoteConnection) -> String {
    let default_port = connection.protocol.default_port();
    let port = if connection.port == default_port {
        String::new()
    } else {
        format!(":{}", connection.port)
    };
    format!(
        "{}://{}{}",
        connection.protocol.scheme(),
        connection.host,
        port
    )
}

fn encode_uri_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

fn encode_webdav_path(path: &str) -> String {
    path.split('/')
        .filter(|part| !part.is_empty())
        .map(encode_uri_component)
        .collect::<Vec<_>>()
        .join("/")
}

fn webdav_url(connection: &RemoteConnection, remote_path: &str) -> String {
    let root = connection_base_url(connection);
    let encoded = encode_webdav_path(remote_path);
    if encoded.is_empty() {
        format!("{}/", root)
    } else {
        format!("{}/{}", root, encoded)
    }
}

fn resolve_webdav_request_path(connection: &RemoteConnection, remote_path: &str) -> String {
    let remote = normalize_remote_directory_path(remote_path);
    let base = normalize_remote_directory_path(&connection.base_path);
    if base == "/" || remote == base || remote.starts_with(&(base.clone() + "/")) {
        remote
    } else {
        join_remote_path(&base, &remote)
    }
}

fn list_webdav_directory(
    connection: &RemoteConnection,
    remote_path: &str,
    show_hidden: bool,
    password: Option<&str>,
) -> Result<Vec<FileEntry>, AppError> {
    let client = Client::builder()
        .connect_timeout(remote_operation_timeout())
        .timeout(remote_operation_timeout())
        .build()
        .map_err(|e| AppError::unavailable(format!("无法创建 WebDAV 客户端: {}", e)))?;
    let method = reqwest::Method::from_bytes(b"PROPFIND")
        .map_err(|e| AppError::internal(format!("无法创建 WebDAV 请求: {}", e)))?;
    let request_path = resolve_webdav_request_path(connection, remote_path);
    let mut request = client
        .request(method, webdav_url(connection, &request_path))
        .header(HeaderName::from_static("depth"), "1")
        .header(CONTENT_TYPE, "application/xml")
        .body(r#"<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:displayname/></D:prop></D:propfind>"#);
    if let Some(username) = &connection.username {
        request = request.basic_auth(username, password.map(ToString::to_string));
    }
    let response = request
        .send()
        .map_err(|e| AppError::unavailable(format!("WebDAV 请求失败: {}", e)))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::unavailable(format!(
            "WebDAV 服务器返回 {}",
            status
        )));
    }
    let text = response
        .text()
        .map_err(|e| AppError::unavailable(format!("无法读取 WebDAV 响应: {}", e)))?;
    Ok(sort_entries(parse_webdav_propfind_with_base(
        &connection.id,
        &connection.base_path,
        &request_path,
        &text,
        show_hidden,
    )))
}

#[derive(Debug, Default)]
struct WebdavResponse {
    href: String,
    display_name: String,
    is_collection: bool,
    size: Option<u64>,
    modified: String,
}

fn webdav_href_path(href: &str) -> String {
    let without_query = href.split(['?', '#']).next().unwrap_or(href);
    if let Some((_, rest)) = without_query.split_once("://") {
        if let Some(path_start) = rest.find('/') {
            return normalize_remote_directory_path(&rest[path_start..]);
        }
        return "/".to_string();
    }
    normalize_remote_directory_path(without_query)
}

fn remote_path_from_webdav_href(href: &str, base_path: &str) -> String {
    let href_path = webdav_href_path(href);
    let base = normalize_remote_directory_path(base_path);
    if base == "/" {
        return href_path;
    }
    if href_path == base {
        return "/".to_string();
    }
    href_path
        .strip_prefix(&(base.clone() + "/"))
        .map(normalize_remote_directory_path)
        .unwrap_or(href_path)
}

pub fn parse_webdav_propfind_with_base(
    connection_id: &str,
    base_path: &str,
    requested_path: &str,
    xml: &str,
    show_hidden: bool,
) -> Vec<FileEntry> {
    let requested = normalize_remote_directory_path(requested_path);
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut responses = Vec::new();
    let mut current: Option<WebdavResponse> = None;
    let mut current_tag = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "response" {
                    current = Some(WebdavResponse::default());
                } else {
                    if let Some(item) = current.as_mut() {
                        if name == "collection" {
                            item.is_collection = true;
                        }
                    }
                    current_tag = name;
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if let Some(item) = current.as_mut() {
                    if name == "collection" {
                        item.is_collection = true;
                    }
                }
            }
            Ok(Event::Text(e)) => {
                if let Some(item) = current.as_mut() {
                    let value = e.decode().map(|text| text.to_string()).unwrap_or_default();
                    match current_tag.as_str() {
                        "href" => item.href = value,
                        "displayname" => item.display_name = value,
                        "getcontentlength" => item.size = value.parse::<u64>().ok(),
                        "getlastmodified" => item.modified = value,
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "response" {
                    if let Some(item) = current.take() {
                        responses.push(item);
                    }
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    responses
        .into_iter()
        .filter_map(|item| {
            let remote_path = remote_path_from_webdav_href(&item.href, base_path);
            if remote_path == requested {
                return None;
            }
            let name = if !item.display_name.trim().is_empty() {
                item.display_name.trim_matches('/').to_string()
            } else {
                item.href
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("")
                    .to_string()
            };
            if !include_remote_name(&name, show_hidden) {
                return None;
            }
            Some(remote_file_entry(
                connection_id,
                name,
                remote_path,
                item.is_collection,
                item.size,
                item.modified,
            ))
        })
        .collect()
}

#[cfg(test)]
fn parse_webdav_propfind(
    connection_id: &str,
    requested_path: &str,
    xml: &str,
    show_hidden: bool,
) -> Vec<FileEntry> {
    parse_webdav_propfind_with_base(connection_id, "/", requested_path, xml, show_hidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_remote_directory_paths() {
        assert_eq!(normalize_remote_directory_path(""), "/");
        assert_eq!(normalize_remote_directory_path("foo//bar/"), "/foo/bar");
        assert_eq!(normalize_remote_directory_path("/foo/bar/"), "/foo/bar");
    }

    #[test]
    fn parses_remote_paths() {
        assert_eq!(
            parse_remote_path("aether-remote://conn-1/sites/public"),
            Some(RemotePathParts {
                connection_id: "conn-1".into(),
                remote_path: "/sites/public".into(),
            })
        );
        assert_eq!(parse_remote_path("aether://favorites"), None);
    }

    #[test]
    fn builds_stable_keychain_account() {
        assert_eq!(keychain_account("abc"), "remote:abc");
    }

    #[test]
    fn builds_stable_private_key_passphrase_account() {
        assert_eq!(
            keychain_private_key_passphrase_account("abc"),
            "remote:abc:private-key-passphrase"
        );
    }

    #[test]
    fn remote_connection_timeout_is_short_enough_for_ui_feedback() {
        assert_eq!(
            remote_operation_timeout(),
            Duration::from_secs(REMOTE_OPERATION_TIMEOUT_SECS)
        );
        assert!(REMOTE_OPERATION_TIMEOUT_SECS <= 5);
        assert!(remote_io_step_timeout() < remote_operation_timeout());
        assert_eq!(
            remote_connect_attempt_timeout(Duration::from_secs(2)),
            Duration::from_millis(REMOTE_CONNECT_ATTEMPT_TIMEOUT_MS),
        );
        assert!(REMOTE_CONNECT_ATTEMPT_TIMEOUT_MS <= 500);
        assert_eq!(
            remote_connect_attempt_timeout(Duration::from_millis(250)),
            Duration::from_millis(250),
        );
        let err = remote_timeout_error("SFTP", "连接");
        assert!(err.message.contains("超时"));
    }

    #[test]
    fn explains_sftp_algorithm_negotiation_failures() {
        let err = map_sftp_error(
            "握手",
            ssh2::Error::new(
                SshErrorCode::Session(LIBSSH2_ERROR_KEY_EXCHANGE_FAILURE),
                "Unable to exchange encryption keys",
            ),
        );

        assert!(err.message.contains("SSH 算法协商失败"));
        assert!(err.message.contains("curve25519-sha256"));
        assert!(err.message.contains("rsa-sha2-256/512"));
        assert!(err.message.contains("Unable to exchange encryption keys"));
    }

    #[test]
    fn keeps_modern_sftp_algorithm_preferences_available() {
        assert!(SFTP_KEX_PREFS.contains("curve25519-sha256"));
        assert!(SFTP_KEX_PREFS.contains("diffie-hellman-group14-sha256"));
        assert!(SFTP_HOSTKEY_PREFS.contains("ssh-ed25519"));
        assert!(SFTP_HOSTKEY_PREFS.contains("rsa-sha2-256"));
        assert!(SFTP_CIPHER_PREFS.contains("aes128-ctr"));
        assert!(SFTP_MAC_PREFS.contains("hmac-sha2-256"));
    }

    #[test]
    fn normalizes_sftp_private_key_connection_config_without_passphrase() {
        let input = SaveRemoteConnectionInput {
            id: Some("deploy".into()),
            name: " Deploy ".into(),
            protocol: RemoteProtocol::Sftp,
            host: " debian.local ".into(),
            port: None,
            username: Some(" root ".into()),
            base_path: Some("/var/www/".into()),
            password: Some("ignored".into()),
            auth_method: Some(RemoteAuthMethod::PrivateKey),
            private_key_path: Some(" ~/.ssh/codex_debian ".into()),
            private_key_passphrase: Some("secret".into()),
        };

        let connection =
            normalize_connection_input(input, None, 123).expect("valid private-key connection");

        assert_eq!(connection.auth_method, RemoteAuthMethod::PrivateKey);
        assert_eq!(
            connection.private_key_path.as_deref(),
            Some("~/.ssh/codex_debian")
        );
        assert!(!connection.has_password);
        assert!(connection.has_private_key_passphrase);
    }

    #[test]
    fn validates_sftp_private_key_path() {
        let input = SaveRemoteConnectionInput {
            id: Some("deploy".into()),
            name: "Deploy".into(),
            protocol: RemoteProtocol::Sftp,
            host: "debian.local".into(),
            port: None,
            username: Some("root".into()),
            base_path: Some("/".into()),
            password: None,
            auth_method: Some(RemoteAuthMethod::PrivateKey),
            private_key_path: Some(" ".into()),
            private_key_passphrase: None,
        };

        assert!(normalize_connection_input(input, None, 123).is_err());
    }

    #[test]
    fn expands_private_key_home_path() {
        assert_eq!(
            expand_private_key_path("~/.ssh/codex_debian", Some("/Users/test")).to_string_lossy(),
            "/Users/test/.ssh/codex_debian"
        );
        assert_eq!(
            expand_private_key_path("/tmp/id_rsa", Some("/Users/test")).to_string_lossy(),
            "/tmp/id_rsa"
        );
    }

    #[test]
    fn parses_webdav_propfind_response() {
        let xml = r#"
          <D:multistatus xmlns:D="DAV:">
            <D:response>
              <D:href>/dav/root/</D:href>
              <D:propstat><D:prop><D:displayname>root</D:displayname><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
            </D:response>
            <D:response>
              <D:href>/dav/root/docs/</D:href>
              <D:propstat><D:prop><D:displayname>docs</D:displayname><D:resourcetype><D:collection/></D:resourcetype><D:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</D:getlastmodified></D:prop></D:propstat>
            </D:response>
            <D:response>
              <D:href>/dav/root/readme.txt</D:href>
              <D:propstat><D:prop><D:displayname>readme.txt</D:displayname><D:resourcetype/><D:getcontentlength>12</D:getcontentlength></D:prop></D:propstat>
            </D:response>
          </D:multistatus>
        "#;

        let entries = parse_webdav_propfind_with_base("conn", "/dav/root", "/", xml, false);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "docs");
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].path, "aether-remote://conn/docs");
        assert_eq!(entries[1].name, "readme.txt");
        assert_eq!(entries[1].size, "12 B");
    }

    #[test]
    fn encodes_remote_entry_paths_by_segment() {
        assert_eq!(
            remote_entry_path("server/1", "/Sites/My Files/#draft?.txt"),
            "aether-remote://server%2F1/Sites/My%20Files/%23draft%3F.txt"
        );
    }

    #[test]
    fn resolves_webdav_request_path_without_repeating_base_path() {
        let connection = RemoteConnection {
            id: "conn".into(),
            name: "DAV".into(),
            protocol: RemoteProtocol::WebdavHttps,
            host: "dav.example.com".into(),
            port: 443,
            username: None,
            base_path: "/dav/root".into(),
            created_at: 1,
            updated_at: 1,
            auth_method: RemoteAuthMethod::Password,
            has_password: false,
            private_key_path: None,
            has_private_key_passphrase: false,
        };

        assert_eq!(resolve_webdav_request_path(&connection, "/"), "/dav/root");
        assert_eq!(
            resolve_webdav_request_path(&connection, "/docs"),
            "/dav/root/docs"
        );
        assert_eq!(
            resolve_webdav_request_path(&connection, "/dav/root/docs"),
            "/dav/root/docs"
        );
    }

    #[test]
    fn hidden_webdav_entries_respect_show_hidden() {
        let xml = r#"
          <D:multistatus xmlns:D="DAV:">
            <D:response><D:href>/dav/.env</D:href><D:propstat><D:prop><D:displayname>.env</D:displayname><D:getcontentlength>4</D:getcontentlength></D:prop></D:propstat></D:response>
          </D:multistatus>
        "#;

        assert!(parse_webdav_propfind("conn", "/", xml, false).is_empty());
        assert_eq!(parse_webdav_propfind("conn", "/", xml, true).len(), 1);
    }
}
