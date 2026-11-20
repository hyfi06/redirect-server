//! `rserver::run(cli, stdout, stderr)` end to end for `list` and `view`: argv → clap → config
//! loaded from a temp `XDG_CONFIG_HOME` → mock API → captured stdout.
//!
//! `run` reads the config through `config::path()`, i.e. process-global env vars. Every test
//! takes `ENV_LOCK` for its whole duration and points both `HOME` and `XDG_CONFIG_HOME` at its
//! own temp dir, so tests in this file never race and the real `~/.config` is never touched.

mod common;

use std::env;
use std::sync::Mutex;

use clap::Parser;
use common::{redirect_json, write_config, MockServer, Reply, TOKEN};
use rserver::cli::Cli;
use serde_json::{json, Value};
use tempfile::TempDir;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct Outcome {
    result: anyhow::Result<()>,
    stdout: String,
}

impl Outcome {
    fn error(&self) -> String {
        format!("{:#}", self.result.as_ref().unwrap_err())
    }
}

fn run_cli(api_url: &str, with_key: bool, args: &[&str]) -> Outcome {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let xdg = TempDir::new().unwrap();
    write_config(xdg.path(), api_url, with_key);
    env::set_var("HOME", xdg.path());
    env::set_var("XDG_CONFIG_HOME", xdg.path());

    let cli = Cli::try_parse_from(std::iter::once("rserver").chain(args.iter().copied())).unwrap();
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let result = rserver::run(cli, &mut stdout, &mut stderr);
    Outcome {
        result,
        stdout: String::from_utf8(stdout).unwrap(),
    }
}

// ---------- list ----------

#[test]
fn list_sends_bearer_token_and_default_limit_without_offset() {
    let server = MockServer::always(Reply::data(json!([])));
    run_cli(&server.url, true, &["list"]).result.unwrap();
    let request = server.single_request();
    assert_eq!(
        (
            request.header("authorization"),
            request.path(),
            request.query()
        ),
        (
            Some(format!("Bearer {TOKEN}").as_str()),
            "/api/v1/redirects",
            vec![("limit".to_string(), "20".to_string())]
        )
    );
}

#[test]
fn list_page_3_limit_10_sends_offset_20() {
    let server = MockServer::always(Reply::data(json!([])));
    run_cli(&server.url, true, &["list", "--page", "3", "--limit", "10"])
        .result
        .unwrap();
    let request = server.single_request();
    assert_eq!(
        (request.query_value("offset"), request.query_value("limit")),
        (Some("20".to_string()), Some("10".to_string()))
    );
}

#[test]
fn list_page_1_with_custom_limit_omits_offset() {
    let server = MockServer::always(Reply::data(json!([])));
    run_cli(&server.url, true, &["list", "--limit", "5"])
        .result
        .unwrap();
    assert_eq!(server.single_request().query_value("offset"), None);
}

#[test]
fn list_order_is_sent_as_order_by() {
    let server = MockServer::always(Reply::data(json!([])));
    run_cli(&server.url, true, &["list", "--order", "-created"])
        .result
        .unwrap();
    assert_eq!(
        server.single_request().query_value("orderBy"),
        Some("-created".to_string())
    );
}

#[test]
fn list_with_offset_overflow_fails_without_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let outcome = run_cli(
        &server.url,
        true,
        &["list", "--page", &u32::MAX.to_string(), "--limit", "2"],
    );
    assert!(
        outcome.error().contains("excede el máximo"),
        "{}",
        outcome.error()
    );
    assert_eq!(server.request_count(), 0);
}

#[test]
fn list_json_prints_exactly_the_mock_data() {
    let data = json!([
        redirect_json("a1", "/fc/a"),
        json!({
            "id": "b2", "path": "/promo", "url": "https://b", "owner": "admin",
            "created": "2026-01-01T00:00:00.000Z", "updated": "2026-01-02T00:00:00.000Z"
        }),
    ]);
    let server = MockServer::always(Reply::data(data.clone()));
    let outcome = run_cli(&server.url, true, &["--json", "list"]);
    outcome.result.as_ref().unwrap();
    let printed: Value = serde_json::from_str(&outcome.stdout).unwrap();
    // `categories`/`permission` are filled with `[]` when the API omits them.
    let mut expected = data;
    expected[1]["categories"] = json!([]);
    expected[1]["permission"] = json!([]);
    assert_eq!(printed, expected);
}

#[test]
fn list_table_contains_only_id_path_and_url() {
    let server = MockServer::always(Reply::data(json!([redirect_json("a1", "/fc/a")])));
    let outcome = run_cli(&server.url, true, &["list"]);
    outcome.result.as_ref().unwrap();
    let rows: Vec<Vec<&str>> = outcome
        .stdout
        .lines()
        .map(|line| line.split_whitespace().collect())
        .collect();
    assert_eq!(
        rows,
        vec![
            vec!["ID", "PATH", "URL"],
            vec!["a1", "/fc/a", "https://example.com/fc/a"],
        ]
    );
}

// ---------- view ----------

#[test]
fn view_by_path_prints_the_detail_of_the_exact_match() {
    let server = MockServer::always(Reply::data(json!([
        redirect_json("id-2", "/fc/seminar-2"),
        redirect_json("id-1", "/fc/seminar"),
    ])));
    let outcome = run_cli(&server.url, true, &["view", "/fc/seminar"]);
    outcome.result.as_ref().unwrap();
    let id_line = outcome.stdout.lines().next().unwrap().to_string();
    assert_eq!(
        id_line.split_whitespace().collect::<Vec<_>>(),
        ["id", "id-1"],
        "{}",
        outcome.stdout
    );
}

#[test]
fn view_detail_lists_every_field_with_formatted_dates() {
    let server = MockServer::always(Reply::data(redirect_json("abc123", "/fc/x")));
    let outcome = run_cli(&server.url, true, &["view", "abc123"]);
    outcome.result.as_ref().unwrap();
    let labels: Vec<&str> = outcome
        .stdout
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .collect();
    assert_eq!(
        labels,
        [
            "id",
            "path",
            "url",
            "owner",
            "categories",
            "permission",
            "clickCount",
            "created",
            "updated"
        ]
    );
    assert!(
        outcome.stdout.contains("2026-11-19 12:34:56 UTC"),
        "{}",
        outcome.stdout
    );
}

#[test]
fn view_json_prints_the_redirect_data() {
    let server = MockServer::always(Reply::data(redirect_json("abc123", "/fc/x")));
    let outcome = run_cli(&server.url, true, &["view", "abc123", "--json"]);
    outcome.result.as_ref().unwrap();
    let printed: Value = serde_json::from_str(&outcome.stdout).unwrap();
    assert_eq!(printed, redirect_json("abc123", "/fc/x"));
}

#[test]
fn view_without_leading_slash_is_fetched_as_an_id() {
    let server = MockServer::always(Reply::data(redirect_json("x", "/x")));
    run_cli(&server.url, true, &["view", "fc/seminar"])
        .result
        .unwrap();
    assert_eq!(
        server.single_request().path(),
        "/api/v1/redirects/fc%2Fseminar"
    );
}

#[test]
fn view_unknown_id_returns_a_readable_not_found_error() {
    let server = MockServer::always(Reply::error(404, "redirect not found"));
    let outcome = run_cli(&server.url, true, &["view", "missing"]);
    assert!(
        outcome
            .error()
            .contains("no se encontró un redirect con id `missing`"),
        "{}",
        outcome.error()
    );
}

// ---------- auth ----------

#[test]
fn missing_key_fails_with_login_advice_and_no_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let outcome = run_cli(&server.url, false, &["list"]);
    assert!(
        outcome.error().contains("rserver login"),
        "{}",
        outcome.error()
    );
    assert_eq!(server.request_count(), 0);
}
