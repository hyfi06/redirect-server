use std::io::{self, BufRead, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Result};
use serde::de::IgnoredAny;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ApiClient, ApiError};
use crate::config::{self, ApiKeyConfig};

/// Scopes of the API Key created by `rserver login`.
pub const API_KEY_SCOPES: [&str; 2] = ["read:redirects", "write:redirects"];
/// Lifetime of the API Key created by `rserver login`.
pub const API_KEY_TTL_DAYS: u64 = 90;
const API_KEYS_SEGMENTS: [&str; 3] = ["users", "me", "api-keys"];
const SECONDS_PER_DAY: u64 = 86_400;

/// Opens a URL in the user's browser. Implemented for closures so tests can stub it.
pub trait Browser {
    fn open(&mut self, url: &str) -> io::Result<()>;
}

impl<F: FnMut(&str) -> io::Result<()>> Browser for F {
    fn open(&mut self, url: &str) -> io::Result<()> {
        self(url)
    }
}

/// Reads one line of user input; `Ok(None)` means end of input. Implemented for closures so tests can stub it.
pub trait LineReader {
    fn read_line(&mut self) -> io::Result<Option<String>>;
}

impl<F: FnMut() -> io::Result<Option<String>>> LineReader for F {
    fn read_line(&mut self) -> io::Result<Option<String>> {
        self()
    }
}

/// Delegates to `xdg-open` (`open` on macOS); fails when the opener is missing or exits with an error.
pub struct SystemBrowser;

impl Browser for SystemBrowser {
    fn open(&mut self, url: &str) -> io::Result<()> {
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        // Null stdio: the opener or the browser must never write into our stdout (`--json` pipes).
        let status = Command::new(opener)
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!("{opener} terminó con {status}")))
        }
    }
}

/// Reads from the process stdin; the pasted JWT is echoed by the terminal, not hidden.
pub struct StdinLineReader;

impl LineReader for StdinLineReader {
    fn read_line(&mut self) -> io::Result<Option<String>> {
        let mut line = String::new();
        let read = io::stdin().lock().read_line(&mut line)?;
        Ok((read > 0).then_some(line))
    }
}

/// External effects of `login`/`logout`: browser, user input and the message stream (stderr).
pub struct AuthIo<'a> {
    pub browser: &'a mut dyn Browser,
    pub input: &'a mut dyn LineReader,
    pub stderr: &'a mut dyn Write,
}

/// Result of revoking the stored key on the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Revocation {
    Revoked,
    /// The API answered its own "API key not found" 404: the key no longer exists server-side.
    AlreadyGone,
}

#[derive(Deserialize)]
struct ApiKeySummary {
    id: String,
    name: String,
    active: bool,
}

#[derive(Deserialize)]
struct CreatedApiKey {
    id: String,
    token: String,
}

/// Accepts the bare JWT (surrounding whitespace and quotes are ignored) or the whole callback
/// JSON (`{ "message": …, "data": { "token": … } }`). `None` when nothing usable remains.
pub fn extract_jwt(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let candidate = if trimmed.starts_with('{') {
        let body: Value = serde_json::from_str(trimmed).ok()?;
        body.get("data")?.get("token")?.as_str()?.trim().to_string()
    } else {
        trimmed
            .trim_matches(|c| c == '"' || c == '\'')
            .trim()
            .to_string()
    };
    // A JWT never contains whitespace; anything that does is a partial or mangled paste.
    if candidate.is_empty() || candidate.contains(char::is_whitespace) {
        return None;
    }
    Some(candidate)
}

/// `rserver@<hostname>`: identifies the machine's key so a new `login` can revoke the previous one.
pub fn api_key_name(hostname: &str) -> String {
    format!("rserver@{hostname}")
}

/// `now` + [`API_KEY_TTL_DAYS`] as ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`).
pub fn api_key_expires_at(now: SystemTime) -> String {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
        + API_KEY_TTL_DAYS * SECONDS_PER_DAY;
    format_iso8601_utc(seconds)
}

/// Machine hostname, used in [`api_key_name`].
pub fn hostname() -> Result<String> {
    gethostname::gethostname()
        .into_string()
        .ok()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| anyhow!("no se pudo determinar el hostname de la máquina"))
}

/// Revokes the active keys named `rserver@<hostname>`, then creates a new one with that name.
/// `jwt` authenticates every request; it is never stored. Revocation runs before creation, so a
/// failed `POST` leaves this machine without a key: repeating `rserver login` is the recovery.
pub fn login_with_jwt(
    api_url: &str,
    jwt: &str,
    hostname: &str,
    now: SystemTime,
) -> Result<ApiKeyConfig> {
    let client = ApiClient::new(api_url, Some(jwt.to_string()));
    let name = api_key_name(hostname);

    let keys: Vec<ApiKeySummary> = client
        .get(&API_KEYS_SEGMENTS, &[])
        .map_err(|err| jwt_request_error(&client, err, "login"))?;
    for key in keys.iter().filter(|key| key.active && key.name == name) {
        match client.delete::<IgnoredAny>(&key_segments(&key.id)) {
            // Listed a moment ago: a 404 means it was removed concurrently, which is the goal anyway.
            Ok(_) | Err(ApiError::NotFound(_)) => {}
            Err(err) => return Err(jwt_request_error(&client, err, "login")),
        }
    }

    let body = json!({
        "name": name,
        "scopes": API_KEY_SCOPES,
        "expiresAt": api_key_expires_at(now),
    });
    let created: CreatedApiKey = client
        .post(&API_KEYS_SEGMENTS, &body)
        .map_err(|err| jwt_request_error(&client, err, "login"))?;
    Ok(ApiKeyConfig {
        id: created.id,
        token: created.token,
    })
}

/// Message the API returns when the key id does not exist for the user.
const API_KEY_NOT_FOUND: &str = "API key not found";

/// `DELETE /users/me/api-keys/{key_id}` authenticated with `jwt`. The API's own
/// "API key not found" 404 is not an error ([`Revocation::AlreadyGone`]).
pub fn logout_with_jwt(api_url: &str, jwt: &str, key_id: &str) -> Result<Revocation> {
    let client = ApiClient::new(api_url, Some(jwt.to_string()));
    match client.delete::<IgnoredAny>(&key_segments(key_id)) {
        Ok(_) => Ok(Revocation::Revoked),
        // Only the API's own "API key not found" means the key is gone; any other 404 (e.g. the
        // catch-all of a server without API v1) must not clear the local key unrevoked.
        Err(ApiError::NotFound(message)) if message == API_KEY_NOT_FOUND => {
            Ok(Revocation::AlreadyGone)
        }
        Err(ApiError::NotFound(_)) => Err(jwt_request_error(
            &client,
            ApiError::NotApi {
                api_url: client.api_url().to_string(),
                status: 404,
            },
            "logout",
        )),
        Err(err) => Err(jwt_request_error(&client, err, "logout")),
    }
}

/// `rserver login`: browser → pasted JWT → new API Key saved in the config at `config_path`.
pub fn login(config_path: &Path, io: &mut AuthIo, hostname: &str, now: SystemTime) -> Result<()> {
    let mut config = config::load_from(config_path)?;
    let jwt = obtain_jwt(&config.api_url, io)?;
    let api_key = login_with_jwt(&config.api_url, &jwt, hostname, now)?;
    config.api_key = Some(api_key);
    config::save_to(config_path, &config)?;

    let expires_at = api_key_expires_at(now);
    writeln!(
        io.stderr,
        "Sesión iniciada: se guardó la API Key `{}` (vence el {} UTC) en {}",
        api_key_name(hostname),
        expires_at.trim_end_matches('Z').replace('T', " "),
        config_path.display()
    )?;
    Ok(())
}

/// `rserver logout`: browser → pasted JWT → revoke the stored key, then drop it from the config.
/// The config is left untouched unless the server confirms the revocation (or answers "API key not found").
pub fn logout(config_path: &Path, io: &mut AuthIo) -> Result<()> {
    let mut config = config::load_from(config_path)?;
    let Some(key_id) = config.api_key.as_ref().map(|key| key.id.clone()) else {
        bail!(
            "no hay sesión: no hay una API Key guardada en {}",
            config_path.display()
        );
    };

    let jwt = obtain_jwt(&config.api_url, io)?;
    let revocation = logout_with_jwt(&config.api_url, &jwt, &key_id)?;
    config.api_key = None;
    config::save_to(config_path, &config)?;

    let detail = match revocation {
        Revocation::Revoked => "la API Key fue revocada en el servidor",
        Revocation::AlreadyGone => "la API Key ya no existía en el servidor",
    };
    writeln!(
        io.stderr,
        "Sesión cerrada: {detail} y se borró de la configuración"
    )?;
    Ok(())
}

/// Opens the Google sign-in page (printing the URL when the browser cannot be opened) and reads the pasted JWT.
fn obtain_jwt(api_url: &str, io: &mut AuthIo) -> Result<String> {
    let url = format!("{api_url}/api/v1/auth/google");
    match io.browser.open(&url) {
        Ok(()) => writeln!(io.stderr, "Se abrió el navegador en {url}")?,
        Err(_) => writeln!(
            io.stderr,
            "No se pudo abrir el navegador. Abre esta URL manualmente:\n  {url}"
        )?,
    }
    prompt_jwt(io)
}

/// Re-prompts until something usable is pasted; fails only at end of input.
fn prompt_jwt(io: &mut AuthIo) -> Result<String> {
    loop {
        writeln!(
            io.stderr,
            "Inicia sesión con Google y pega aquí el valor de `token` del JSON que muestra el navegador:"
        )?;
        let Some(mut pasted) = io.input.read_line()? else {
            bail!("no se recibió ningún token: se canceló el inicio de sesión");
        };
        // A pretty-printed callback JSON arrives over several lines: keep reading until it parses.
        while pasted.trim_start().starts_with('{') && is_incomplete_json(&pasted) {
            match io.input.read_line()? {
                Some(line) => pasted.push_str(&line),
                None => break,
            }
        }
        if let Some(jwt) = extract_jwt(&pasted) {
            return Ok(jwt);
        }
        writeln!(
            io.stderr,
            "No se encontró un token en lo pegado; inténtalo de nuevo."
        )?;
    }
}

fn is_incomplete_json(text: &str) -> bool {
    matches!(serde_json::from_str::<Value>(text), Err(err) if err.is_eof())
}

/// The bearer here is the pasted JWT, so a 401 means the JWT, not a stored API Key, was rejected.
fn jwt_request_error(client: &ApiClient, err: ApiError, command: &str) -> anyhow::Error {
    match err {
        ApiError::Unauthorized(message) => anyhow!(
            "el token pegado es inválido o expiró (API: {message}); repite `rserver {command}` e inicia sesión de nuevo en el navegador"
        ),
        // `/users/me/api-keys` always exists in API v1: a 404 on it means api_url is not the API.
        ApiError::NotFound(_) if command == "login" => anyhow!(ApiError::NotApi {
            api_url: client.api_url().to_string(),
            status: 404,
        }),
        other => anyhow!(other),
    }
}

fn key_segments(key_id: &str) -> [&str; 4] {
    let [users, me, api_keys] = API_KEYS_SEGMENTS;
    [users, me, api_keys, key_id]
}

/// Seconds since the Unix epoch → `YYYY-MM-DDTHH:MM:SSZ` (proleptic Gregorian, UTC).
fn format_iso8601_utc(epoch_seconds: u64) -> String {
    let days = (epoch_seconds / SECONDS_PER_DAY) as i64;
    let second_of_day = epoch_seconds % SECONDS_PER_DAY;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        second_of_day / 3600,
        second_of_day % 3600 / 60,
        second_of_day % 60
    )
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 → (year, month, day).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
