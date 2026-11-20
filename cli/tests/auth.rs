//! Plan §2 — `rserver login` / `logout`: pasted-token parsing (Foco 3), API Key expiry date,
//! the API Key lifecycle against the mock (`login_with_jwt` / `logout_with_jwt`) and the full
//! `login` / `logout` flows with an injected browser and stdin.
//!
//! Config files live in per-test temp dirs passed explicitly to `login`/`logout`; the only
//! binary tests give the child its own `HOME`/`XDG_CONFIG_HOME` and a `PATH` without
//! `xdg-open`, so no real browser, no real network and no real `~/.config` are ever used.

mod common;

use std::cell::Cell;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::{
    api_key_json, api_keys_server, config_file, created_key_reply, revoked_reply, write_config,
    MockServer, Recorded, Reply, JWT, TOKEN,
};
use rserver::commands::auth::{
    api_key_expires_at, api_key_name, extract_jwt, login, login_with_jwt, logout, logout_with_jwt,
    AuthIo, Revocation,
};
use rserver::config::{self, ApiKeyConfig};
use serde_json::{json, Value};
use tempfile::TempDir;

const HOST: &str = "host-test";
const NAME: &str = "rserver@host-test";
const NEW_ID: &str = "new-key";
const NEW_TOKEN: &str = "sk_1kg_NEWnewNEWnewNEWnewNEWnewNEWn";
const KEYS_PATH: &str = "/api/v1/users/me/api-keys";
/// 2026-11-19T12:34:56Z; + 90 days = 2027-02-17T12:34:56Z.
const NOW_SECS: u64 = 1_795_091_696;
const NOW_PLUS_90: &str = "2027-02-17T12:34:56Z";

fn at(secs: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(secs)
}

fn now() -> SystemTime {
    at(NOW_SECS)
}

fn bearer_jwt() -> String {
    format!("Bearer {JWT}")
}

fn body_json(req: &Recorded) -> Value {
    serde_json::from_str(&req.body).unwrap()
}

fn method_and_path(requests: &[Recorded]) -> Vec<(String, String)> {
    requests
        .iter()
        .map(|r| (r.method.clone(), r.path().to_string()))
        .collect()
}

fn get_post() -> Vec<(String, String)> {
    vec![
        ("GET".into(), KEYS_PATH.into()),
        ("POST".into(), KEYS_PATH.into()),
    ]
}

/// Mock with no existing keys whose `POST` creates `NEW_ID` / `NEW_TOKEN`.
fn fresh_server() -> MockServer {
    api_keys_server(
        json!([]),
        revoked_reply,
        created_key_reply(NEW_ID, NAME, NEW_TOKEN),
    )
}

// ---------- Foco 3: extract_jwt ----------

#[test]
fn extract_jwt_trims_surrounding_whitespace_and_newline() {
    assert_eq!(extract_jwt(&format!("  {JWT}\n")).as_deref(), Some(JWT));
}

#[test]
fn extract_jwt_strips_surrounding_double_quotes() {
    assert_eq!(extract_jwt(&format!("\"{JWT}\"")).as_deref(), Some(JWT));
}

#[test]
fn extract_jwt_strips_quotes_inside_whitespace() {
    assert_eq!(extract_jwt(&format!("  '{JWT}'\r\n")).as_deref(), Some(JWT));
}

#[test]
fn extract_jwt_returns_data_token_from_the_callback_json() {
    let callback = json!({
        "message": "login successful",
        "data": { "token": JWT, "user": { "id": "user-1", "email": "a@b.c", "role": "user" } }
    })
    .to_string();
    assert_eq!(extract_jwt(&callback).as_deref(), Some(JWT));
}

#[test]
fn extract_jwt_returns_data_token_from_pretty_printed_callback_json() {
    let callback = serde_json::to_string_pretty(&json!({
        "message": "login successful",
        "data": { "token": JWT, "user": { "id": "user-1" } }
    }))
    .unwrap();
    assert_eq!(
        extract_jwt(&format!("  {callback}\n")).as_deref(),
        Some(JWT)
    );
}

#[test]
fn extract_jwt_is_none_for_empty_or_blank_input() {
    for input in ["", "   ", "\n", " \t\r\n", "\"\"", "''"] {
        assert_eq!(extract_jwt(input), None, "input: {input:?}");
    }
}

#[test]
fn extract_jwt_is_none_for_json_without_data_token() {
    for input in [
        json!({ "message": "ok" }).to_string(),
        json!({ "data": {} }).to_string(),
        json!({ "data": { "user": { "id": "u" } } }).to_string(),
        json!({ "token": JWT }).to_string(),
        json!({ "data": { "token": 42 } }).to_string(),
        json!({ "data": { "token": "   " } }).to_string(),
    ] {
        assert_eq!(extract_jwt(&input), None, "input: {input}");
    }
}

#[test]
fn extract_jwt_is_none_for_truncated_json() {
    assert_eq!(
        extract_jwt(&format!("{{ \"data\": {{ \"token\": \"{JWT}\"")),
        None
    );
}

#[test]
fn extract_jwt_is_none_for_text_with_inner_whitespace() {
    for input in [
        format!("{JWT} extra"),
        "eyJhbGci OiJIUzI1NiJ9.x.y".to_string(),
        format!("\"{JWT}\" \"{JWT}\""),
        "token: abc".to_string(),
    ] {
        assert_eq!(extract_jwt(&input), None, "input: {input:?}");
    }
}

// ---------- api_key_name / api_key_expires_at ----------

#[test]
fn api_key_name_prefixes_the_hostname() {
    assert_eq!(api_key_name(HOST), NAME);
}

#[test]
fn expires_at_is_now_plus_90_days_keeping_the_time_of_day() {
    assert_eq!(api_key_expires_at(now()), NOW_PLUS_90);
}

#[test]
fn expires_at_crosses_year_end_into_a_leap_day() {
    // 2023-12-01T00:00:00Z + 90 days lands exactly on 2024-02-29.
    assert_eq!(
        api_key_expires_at(at(1_701_388_800)),
        "2024-02-29T00:00:00Z"
    );
}

#[test]
fn expires_at_skips_february_29_in_a_common_year() {
    // 2024-12-01T00:00:00Z + 90 days: 2025 has no Feb 29, so it lands on March 1.
    assert_eq!(
        api_key_expires_at(at(1_733_011_200)),
        "2025-03-01T00:00:00Z"
    );
}

#[test]
fn expires_at_from_the_last_second_of_a_year() {
    // 2023-12-31T23:59:59Z + 90 days, through the 2024 leap February.
    assert_eq!(
        api_key_expires_at(at(1_704_067_199)),
        "2024-03-30T23:59:59Z"
    );
}

#[test]
fn expires_at_ignores_sub_second_precision() {
    let with_nanos = now() + Duration::from_millis(999);
    assert_eq!(api_key_expires_at(with_nanos), NOW_PLUS_90);
}

#[test]
fn expires_at_has_the_iso_8601_utc_shape() {
    let value = api_key_expires_at(SystemTime::now());
    let bytes = value.as_bytes();
    assert_eq!(bytes.len(), 20, "{value}");
    for (i, b) in bytes.iter().enumerate() {
        match i {
            4 | 7 => assert_eq!(*b, b'-', "{value}"),
            10 => assert_eq!(*b, b'T', "{value}"),
            13 | 16 => assert_eq!(*b, b':', "{value}"),
            19 => assert_eq!(*b, b'Z', "{value}"),
            _ => assert!(b.is_ascii_digit(), "{value}"),
        }
    }
}

// ---------- login_with_jwt ----------

#[test]
fn login_with_jwt_posts_exact_body_with_jwt_bearer() {
    let server = fresh_server();
    login_with_jwt(&server.url, JWT, HOST, now()).unwrap();

    let post = server
        .requests()
        .into_iter()
        .find(|r| r.method == "POST")
        .expect("POST request");
    assert_eq!(post.path(), KEYS_PATH);
    assert_eq!(post.header("authorization"), Some(bearer_jwt().as_str()));
    assert_eq!(
        body_json(&post),
        json!({
            "name": NAME,
            "scopes": ["read:redirects", "write:redirects"],
            "expiresAt": NOW_PLUS_90,
        })
    );
}

#[test]
fn login_with_jwt_authenticates_every_request_with_the_jwt() {
    let server = api_keys_server(
        json!([api_key_json("old-1", NAME, true)]),
        revoked_reply,
        created_key_reply(NEW_ID, NAME, NEW_TOKEN),
    );
    login_with_jwt(&server.url, JWT, HOST, now()).unwrap();

    let requests = server.requests();
    assert_eq!(requests.len(), 3, "{requests:#?}");
    for req in &requests {
        assert_eq!(
            req.header("authorization"),
            Some(bearer_jwt().as_str()),
            "{} {}",
            req.method,
            req.target
        );
    }
}

#[test]
fn login_with_jwt_returns_id_and_token_from_the_post_response() {
    let server = fresh_server();
    let key = login_with_jwt(&server.url, JWT, HOST, now()).unwrap();
    assert_eq!(
        key,
        ApiKeyConfig {
            id: NEW_ID.to_string(),
            token: NEW_TOKEN.to_string()
        }
    );
}

#[test]
fn login_with_jwt_without_previous_keys_only_lists_and_creates() {
    let server = fresh_server();
    login_with_jwt(&server.url, JWT, HOST, now()).unwrap();
    assert_eq!(method_and_path(&server.requests()), get_post());
}

#[test]
fn login_with_jwt_revokes_only_active_keys_with_the_same_name_before_creating() {
    let server = api_keys_server(
        json!([
            api_key_json("old-1", NAME, true),
            api_key_json("inactive", NAME, false),
            api_key_json("other-host", "rserver@otra-maquina", true),
            api_key_json("script", "mi-script", true),
            api_key_json("prefix", "rserver@host-test-2", true),
            api_key_json("old-2", NAME, true),
        ]),
        revoked_reply,
        created_key_reply(NEW_ID, NAME, NEW_TOKEN),
    );
    login_with_jwt(&server.url, JWT, HOST, now()).unwrap();

    let delete = |id: &str| ("DELETE".to_string(), format!("{KEYS_PATH}/{id}"));
    assert_eq!(
        method_and_path(&server.requests()),
        vec![
            ("GET".to_string(), KEYS_PATH.to_string()),
            delete("old-1"),
            delete("old-2"),
            ("POST".to_string(), KEYS_PATH.to_string()),
        ]
    );
}

#[test]
fn login_with_jwt_ignores_404_when_revoking_an_old_key() {
    let server = api_keys_server(
        json!([
            api_key_json("gone", NAME, true),
            api_key_json("old-2", NAME, true)
        ]),
        |id| match id {
            "gone" => Reply::error(404, "API key not found"),
            other => revoked_reply(other),
        },
        created_key_reply(NEW_ID, NAME, NEW_TOKEN),
    );
    let key = login_with_jwt(&server.url, JWT, HOST, now()).unwrap();

    assert_eq!(key.id, NEW_ID);
    assert_eq!(server.request_count(), 4, "{:#?}", server.requests());
}

#[test]
fn login_with_jwt_stops_without_creating_when_revoking_fails_with_500() {
    let server = api_keys_server(
        json!([api_key_json("old-1", NAME, true)]),
        |_| Reply::error(500, "boom"),
        created_key_reply(NEW_ID, NAME, NEW_TOKEN),
    );
    let err = login_with_jwt(&server.url, JWT, HOST, now()).unwrap_err();

    assert!(format!("{err:#}").contains("HTTP 500"), "{err:#}");
    assert!(
        server.requests().iter().all(|r| r.method != "POST"),
        "{:#?}",
        server.requests()
    );
}

#[test]
fn login_with_jwt_401_says_the_pasted_token_is_invalid_and_creates_nothing() {
    let server = MockServer::always(Reply::error(401, "Invalid token"));
    let err = format!(
        "{:#}",
        login_with_jwt(&server.url, JWT, HOST, now()).unwrap_err()
    );

    assert!(err.contains("token pegado es inválido o expiró"), "{err}");
    assert!(err.contains("rserver login"), "{err}");
    assert!(err.contains("Invalid token"), "{err}");
    assert_eq!(server.request_count(), 1);
}

#[test]
fn login_with_jwt_401_on_create_says_the_pasted_token_is_invalid() {
    let server = api_keys_server(json!([]), revoked_reply, Reply::error(401, "Token expired"));
    let err = format!(
        "{:#}",
        login_with_jwt(&server.url, JWT, HOST, now()).unwrap_err()
    );
    assert!(err.contains("token pegado es inválido o expiró"), "{err}");
}

#[test]
fn login_with_jwt_404_on_the_key_list_points_to_api_url() {
    let server = MockServer::always(Reply::error(404, "Not Found"));
    let err = format!(
        "{:#}",
        login_with_jwt(&server.url, JWT, HOST, now()).unwrap_err()
    );
    assert!(
        err.contains(&server.url) && err.contains("rserver set --api-url"),
        "{err}"
    );
}

// ---------- logout_with_jwt ----------

#[test]
fn logout_with_jwt_deletes_the_key_with_jwt_bearer() {
    let server = MockServer::always(revoked_reply("key-1"));
    let revocation = logout_with_jwt(&server.url, JWT, "key-1").unwrap();

    let req = server.single_request();
    assert_eq!(revocation, Revocation::Revoked);
    assert_eq!(
        (req.method.as_str(), req.path()),
        ("DELETE", "/api/v1/users/me/api-keys/key-1")
    );
    assert_eq!(req.header("authorization"), Some(bearer_jwt().as_str()));
}

#[test]
fn logout_with_jwt_404_is_already_gone() {
    let server = MockServer::always(Reply::error(404, "API key not found"));
    assert_eq!(
        logout_with_jwt(&server.url, JWT, "key-1").unwrap(),
        Revocation::AlreadyGone
    );
}

#[test]
fn logout_with_jwt_500_is_an_error() {
    let server = MockServer::always(Reply::error(500, "boom"));
    let err = format!(
        "{:#}",
        logout_with_jwt(&server.url, JWT, "key-1").unwrap_err()
    );
    assert!(err.contains("HTTP 500") && err.contains("boom"), "{err}");
}

#[test]
fn logout_with_jwt_401_says_the_pasted_token_is_invalid() {
    let server = MockServer::always(Reply::error(401, "Invalid token"));
    let err = format!(
        "{:#}",
        logout_with_jwt(&server.url, JWT, "key-1").unwrap_err()
    );
    assert!(err.contains("token pegado es inválido o expiró"), "{err}");
    assert!(err.contains("rserver logout"), "{err}");
}

// ---------- full login / logout with injected browser and stdin ----------

struct Flow {
    result: anyhow::Result<()>,
    stderr: String,
    opened: Vec<String>,
    lines_read: usize,
}

impl Flow {
    fn error(&self) -> String {
        format!("{:#}", self.result.as_ref().unwrap_err())
    }
}

#[derive(Clone, Copy)]
enum Cmd {
    Login,
    Logout,
}

/// Runs `login`/`logout` on `path`. `lines` are what stdin yields, then EOF.
fn flow(cmd: Cmd, path: &Path, lines: &[&str], browser_works: bool) -> Flow {
    let mut opened = Vec::new();
    let mut browser = |url: &str| -> io::Result<()> {
        opened.push(url.to_string());
        if browser_works {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                "xdg-open not found",
            ))
        }
    };
    let lines_read = Cell::new(0);
    let mut queue = lines.iter().map(|line| line.to_string());
    let mut input = || -> io::Result<Option<String>> {
        let next = queue.next();
        if next.is_some() {
            lines_read.set(lines_read.get() + 1);
        }
        Ok(next)
    };
    let mut stderr = Vec::new();
    let result = {
        let mut io = AuthIo {
            browser: &mut browser,
            input: &mut input,
            stderr: &mut stderr,
        };
        match cmd {
            Cmd::Login => login(path, &mut io, HOST, now()),
            Cmd::Logout => logout(path, &mut io),
        }
    };
    Flow {
        result,
        stderr: String::from_utf8(stderr).unwrap(),
        opened,
        lines_read: lines_read.get(),
    }
}

/// Temp dir holding a config that points at `api_url`, with or without the stored test key.
fn setup(api_url: &str, with_key: bool) -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    write_config(dir.path(), api_url, with_key);
    let path = config_file(dir.path());
    (dir, path)
}

fn jwt_line() -> String {
    format!("{JWT}\n")
}

#[test]
fn login_saves_the_id_and_token_returned_by_the_api_and_keeps_api_url() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let flow = flow(Cmd::Login, &path, &[&jwt_line()], true);
    flow.result.unwrap();

    let saved = config::load_from(&path).unwrap();
    assert_eq!(saved.api_url, server.url);
    assert_eq!(
        saved.api_key,
        Some(ApiKeyConfig {
            id: NEW_ID.to_string(),
            token: NEW_TOKEN.to_string()
        })
    );
}

#[test]
fn login_never_writes_the_jwt_to_the_config_file() {
    let server = fresh_server();
    let (dir, path) = setup(&server.url, false);
    flow(Cmd::Login, &path, &[&jwt_line()], true)
        .result
        .unwrap();

    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains(NEW_TOKEN), "{content}");
    assert!(!content.contains(JWT), "{content}");
    // No leftover file (e.g. the temp file of an atomic write) holds it either.
    for entry in fs::read_dir(path.parent().unwrap()).unwrap() {
        let file = entry.unwrap().path();
        assert!(
            !fs::read_to_string(&file).unwrap_or_default().contains(JWT),
            "{}",
            file.display()
        );
    }
    drop(dir);
}

#[test]
fn login_replaces_the_previous_key_of_this_machine() {
    let server = api_keys_server(
        json!([api_key_json("key-1", NAME, true)]),
        revoked_reply,
        created_key_reply(NEW_ID, NAME, NEW_TOKEN),
    );
    let (_dir, path) = setup(&server.url, true);
    flow(Cmd::Login, &path, &[&jwt_line()], true)
        .result
        .unwrap();

    assert!(server
        .requests()
        .iter()
        .any(|r| r.method == "DELETE" && r.path() == format!("{KEYS_PATH}/key-1")));
    assert_eq!(
        config::load_from(&path).unwrap().api_key.unwrap().id,
        NEW_ID
    );
}

#[test]
fn login_opens_the_google_sign_in_url_of_the_configured_api() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let flow = flow(Cmd::Login, &path, &[&jwt_line()], true);

    assert_eq!(
        flow.opened,
        vec![format!("{}/api/v1/auth/google", server.url)]
    );
}

#[test]
fn login_confirms_name_and_expiry_on_stderr_without_any_token() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let flow = flow(Cmd::Login, &path, &[&jwt_line()], true);
    flow.result.as_ref().unwrap();

    assert!(flow.stderr.contains(NAME), "{}", flow.stderr);
    assert!(
        flow.stderr.contains("2027-02-17 12:34:56 UTC"),
        "{}",
        flow.stderr
    );
    assert!(!flow.stderr.contains("sk_"), "{}", flow.stderr);
    assert!(!flow.stderr.contains(JWT), "{}", flow.stderr);
}

#[test]
fn login_prints_the_url_on_stderr_when_the_browser_cannot_be_opened() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let flow = flow(Cmd::Login, &path, &[&jwt_line()], false);

    flow.result.as_ref().unwrap();
    assert!(
        flow.stderr.contains("No se pudo abrir el navegador")
            && flow
                .stderr
                .contains(&format!("{}/api/v1/auth/google", server.url)),
        "{}",
        flow.stderr
    );
}

#[test]
fn login_asks_again_after_empty_or_unusable_lines() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let flow = flow(
        Cmd::Login,
        &path,
        &["\n", "   \n", "no es un token\n", &jwt_line()],
        true,
    );
    flow.result.as_ref().unwrap();

    assert_eq!(flow.lines_read, 4);
    assert_eq!(
        flow.stderr.matches("inténtalo de nuevo").count(),
        3,
        "{}",
        flow.stderr
    );
    assert_eq!(
        flow.stderr.matches("pega aquí").count(),
        4,
        "{}",
        flow.stderr
    );
    // Nothing reached the API until a usable token was pasted.
    assert_eq!(method_and_path(&server.requests()), get_post());
}

#[test]
fn login_eof_aborts_without_requests_or_config_changes() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, true);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Login, &path, &[], true);

    assert!(flow.error().contains("se canceló"), "{}", flow.error());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(server.request_count(), 0);
}

#[test]
fn login_eof_after_unusable_lines_aborts_without_config_changes() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Login, &path, &["\n", "{ \"data\": {\n"], true);

    assert!(flow.error().contains("se canceló"), "{}", flow.error());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(server.request_count(), 0);
}

#[test]
fn login_accepts_the_callback_json_pasted_pretty_printed_over_several_lines() {
    let server = fresh_server();
    let (_dir, path) = setup(&server.url, false);
    let pretty = serde_json::to_string_pretty(&json!({
        "message": "login successful",
        "data": {
            "token": JWT,
            "user": { "id": "user-1", "email": "a@b.c", "role": "user", "groups": ["fc"] }
        }
    }))
    .unwrap();
    let lines: Vec<String> = pretty.lines().map(|line| format!("{line}\n")).collect();
    assert!(lines.len() > 5);
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();

    let flow = flow(Cmd::Login, &path, &refs, true);
    flow.result.as_ref().unwrap();

    assert_eq!(flow.lines_read, lines.len());
    assert!(
        !flow.stderr.contains("inténtalo de nuevo"),
        "{}",
        flow.stderr
    );
    let requests = server.requests();
    assert_eq!(
        requests[0].header("authorization"),
        Some(bearer_jwt().as_str())
    );
}

#[test]
fn login_with_rejected_jwt_reports_invalid_token_and_keeps_the_config() {
    let server = MockServer::always(Reply::error(401, "Invalid token"));
    let (_dir, path) = setup(&server.url, true);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Login, &path, &[&jwt_line()], true);

    assert!(
        flow.error().contains("token pegado es inválido o expiró"),
        "{}",
        flow.error()
    );
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn login_without_config_file_fails_before_opening_the_browser() {
    let dir = TempDir::new().unwrap();
    let path = config_file(dir.path());
    let flow = flow(Cmd::Login, &path, &[&jwt_line()], true);

    assert!(flow
        .error()
        .contains("no existe el archivo de configuración"));
    assert!(flow.opened.is_empty());
    assert_eq!(flow.lines_read, 0);
    assert!(!path.exists());
}

#[test]
fn logout_200_removes_the_key_and_keeps_api_url() {
    let server = MockServer::always(revoked_reply("key-1"));
    let (_dir, path) = setup(&server.url, true);
    let flow = flow(Cmd::Logout, &path, &[&jwt_line()], true);
    flow.result.as_ref().unwrap();

    let saved = config::load_from(&path).unwrap();
    assert_eq!(saved.api_key, None);
    assert_eq!(saved.api_url, server.url);
    assert!(flow.stderr.contains("revocada"), "{}", flow.stderr);
}

#[test]
fn logout_revokes_the_stored_key_id_with_the_pasted_jwt() {
    let server = MockServer::always(revoked_reply("key-1"));
    let (_dir, path) = setup(&server.url, true);
    flow(Cmd::Logout, &path, &[&jwt_line()], true)
        .result
        .unwrap();

    let req = server.single_request();
    assert_eq!(
        (req.method.as_str(), req.path()),
        ("DELETE", "/api/v1/users/me/api-keys/key-1")
    );
    assert_eq!(req.header("authorization"), Some(bearer_jwt().as_str()));
}

#[test]
fn logout_404_also_removes_the_key_locally() {
    let server = MockServer::always(Reply::error(404, "API key not found"));
    let (_dir, path) = setup(&server.url, true);
    let flow = flow(Cmd::Logout, &path, &[&jwt_line()], true);
    flow.result.as_ref().unwrap();

    let saved = config::load_from(&path).unwrap();
    assert_eq!(saved.api_key, None);
    assert_eq!(saved.api_url, server.url);
    assert!(flow.stderr.contains("ya no existía"), "{}", flow.stderr);
}

#[test]
fn logout_500_fails_and_leaves_the_config_untouched() {
    let server = MockServer::always(Reply::error(500, "boom"));
    let (_dir, path) = setup(&server.url, true);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Logout, &path, &[&jwt_line()], true);

    assert!(flow.error().contains("HTTP 500"), "{}", flow.error());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn logout_with_rejected_jwt_reports_invalid_token_and_keeps_the_config() {
    let server = MockServer::always(Reply::error(401, "Invalid token"));
    let (_dir, path) = setup(&server.url, true);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Logout, &path, &[&jwt_line()], true);

    assert!(
        flow.error().contains("token pegado es inválido o expiró"),
        "{}",
        flow.error()
    );
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn logout_without_stored_key_fails_without_browser_input_or_requests() {
    let server = MockServer::always(revoked_reply("key-1"));
    let (_dir, path) = setup(&server.url, false);
    let flow = flow(Cmd::Logout, &path, &[&jwt_line()], true);

    assert!(flow.error().contains("no hay sesión"), "{}", flow.error());
    assert!(flow.opened.is_empty(), "browser opened: {:?}", flow.opened);
    assert_eq!(flow.lines_read, 0);
    assert_eq!(server.request_count(), 0);
}

#[test]
fn logout_eof_aborts_without_requests_or_config_changes() {
    let server = MockServer::always(revoked_reply("key-1"));
    let (_dir, path) = setup(&server.url, true);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Logout, &path, &[], true);

    assert!(flow.error().contains("se canceló"), "{}", flow.error());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(server.request_count(), 0);
}

// ---------- real binary: no browser (PATH without xdg-open), JWT on stdin ----------

fn rserver_with_stdin(home: &Path, args: &[&str], stdin: &str) -> Output {
    let empty_bin = TempDir::new().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_rserver"))
        .args(args)
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home)
        .env("PATH", empty_bin.path())
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn binary_login_json_writes_nothing_to_stdout_and_saves_the_key() {
    let server = api_keys_server(
        json!([]),
        revoked_reply,
        created_key_reply(NEW_ID, "rserver@whatever", NEW_TOKEN),
    );
    let home = TempDir::new().unwrap();
    write_config(home.path(), &server.url, false);

    let output = rserver_with_stdin(home.path(), &["login", "--json"], &jwt_line());
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(output.status.success(), "stderr: {stderr}");
    assert!(output.stdout.is_empty(), "stdout: {:?}", output.stdout);
    assert!(stderr.contains("No se pudo abrir el navegador"), "{stderr}");
    assert!(
        !stderr.contains(NEW_TOKEN) && !stderr.contains(JWT),
        "{stderr}"
    );
    let saved = config::load_from(&config_file(home.path())).unwrap();
    assert_eq!(saved.api_key.unwrap().token, NEW_TOKEN);
    let post = server
        .requests()
        .into_iter()
        .find(|r| r.method == "POST")
        .unwrap();
    assert!(
        body_json(&post)["name"]
            .as_str()
            .unwrap()
            .starts_with("rserver@"),
        "{}",
        post.body
    );
}

#[test]
fn binary_logout_500_exits_non_zero_and_keeps_the_config() {
    let server = MockServer::always(Reply::error(500, "boom"));
    let home = TempDir::new().unwrap();
    write_config(home.path(), &server.url, true);
    let path = config_file(home.path());
    let before = fs::read(&path).unwrap();

    let output = rserver_with_stdin(home.path(), &["logout"], &jwt_line());
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(!output.status.success(), "stderr: {stderr}");
    assert!(
        stderr.contains("error:") && stderr.contains("HTTP 500"),
        "{stderr}"
    );
    assert!(output.stdout.is_empty());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(fs::read_to_string(&path).unwrap().contains(TOKEN));
}

#[test]
fn logout_with_catch_all_404_is_not_api_and_keeps_the_config() {
    let server = MockServer::always(Reply::error(404, "Resource not found"));
    let (_dir, path) = setup(&server.url, true);
    let before = fs::read(&path).unwrap();
    let flow = flow(Cmd::Logout, &path, &[&jwt_line()], true);

    assert!(
        flow.error().contains("rserver set --api-url"),
        "{}",
        flow.error()
    );
    assert_eq!(fs::read(&path).unwrap(), before);
}
