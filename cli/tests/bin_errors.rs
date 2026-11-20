//! Plan focos 1, 2 and 4 through the real `rserver` binary: exit code ≠ 0 and the message
//! printed on stderr by `main`. Each child process gets its own `HOME`/`XDG_CONFIG_HOME` temp
//! dir, so the parent's environment and the real `~/.config` are never touched.

mod common;

use std::process::{Command, Output};

use common::{closed_port_url, redirect_json, write_config, MockServer, Reply};
use serde_json::json;
use tempfile::TempDir;

struct Run {
    output: Output,
}

impl Run {
    fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.output.stderr).into_owned()
    }

    fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.output.stdout).into_owned()
    }

    fn failed(&self) -> bool {
        !self.output.status.success()
    }
}

fn rserver(api_url: &str, with_key: bool, args: &[&str]) -> Run {
    let home = TempDir::new().unwrap();
    write_config(home.path(), api_url, with_key);
    let output = Command::new(env!("CARGO_BIN_EXE_rserver"))
        .args(args)
        .env("HOME", home.path())
        .env("XDG_CONFIG_HOME", home.path())
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .output()
        .unwrap();
    Run { output }
}

fn assert_points_to_api_url(run: &Run, api_url: &str) {
    let stderr = run.stderr();
    assert!(run.failed(), "expected failure, stderr: {stderr}");
    assert!(
        stderr.contains(api_url) && stderr.contains("rserver set --api-url"),
        "{stderr}"
    );
}

// ---------- Foco 1: api_url is not the API v1 ----------

#[test]
fn foco1_closed_port_names_api_url_and_set_command() {
    let api_url = closed_port_url();
    let run = rserver(&api_url, true, &["list"]);
    assert_points_to_api_url(&run, &api_url);
}

#[test]
fn foco1_html_404_names_api_url_and_set_command() {
    let server = MockServer::always(Reply::html(404));
    let run = rserver(&server.url, true, &["list"]);
    assert_points_to_api_url(&run, &server.url);
}

#[test]
fn foco1_html_200_names_api_url_and_set_command() {
    let server = MockServer::always(Reply::html(200));
    let run = rserver(&server.url, true, &["list"]);
    assert_points_to_api_url(&run, &server.url);
}

#[test]
fn foco1_json_404_on_list_from_main_names_api_url_and_set_command() {
    let server = MockServer::always(Reply::error(404, "Not Found"));
    let run = rserver(&server.url, true, &["list"]);
    assert_points_to_api_url(&run, &server.url);
}

#[test]
fn foco1_view_by_path_against_html_names_api_url_and_set_command() {
    let server = MockServer::always(Reply::html(404));
    let run = rserver(&server.url, true, &["view", "/fc/seminar"]);
    assert_points_to_api_url(&run, &server.url);
}

#[test]
fn foco1_view_by_id_against_closed_port_names_api_url_and_set_command() {
    let api_url = closed_port_url();
    let run = rserver(&api_url, true, &["view", "abc123"]);
    assert_points_to_api_url(&run, &api_url);
}

// ---------- Foco 2: expired/revoked key or no key ----------

#[test]
fn foco2_expired_key_suggests_login() {
    let server = MockServer::always(Reply::json(401, json!({ "message": "API key expired" })));
    let run = rserver(&server.url, true, &["list"]);
    assert!(
        run.failed() && run.stderr().contains("rserver login"),
        "{}",
        run.stderr()
    );
}

#[test]
fn foco2_revoked_key_on_view_suggests_login() {
    let server = MockServer::always(Reply::json(401, json!({ "message": "API key revoked" })));
    let run = rserver(&server.url, true, &["view", "abc123"]);
    assert!(
        run.failed() && run.stderr().contains("rserver login"),
        "{}",
        run.stderr()
    );
}

#[test]
fn foco2_missing_key_suggests_login_without_any_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let run = rserver(&server.url, false, &["list"]);
    assert!(
        run.failed() && run.stderr().contains("rserver login"),
        "{}",
        run.stderr()
    );
    assert_eq!(server.request_count(), 0);
}

#[test]
fn foco2_missing_key_on_view_by_path_makes_no_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let run = rserver(&server.url, false, &["view", "/fc/seminar"]);
    assert!(
        run.failed() && run.stderr().contains("rserver login"),
        "{}",
        run.stderr()
    );
    assert_eq!(server.request_count(), 0);
}

// ---------- Foco 4: unknown or ambiguous references ----------

#[test]
fn foco4_view_unknown_id_prints_readable_not_found() {
    let server = MockServer::always(Reply::error(404, "redirect not found"));
    let run = rserver(&server.url, true, &["view", "abc123"]);
    let stderr = run.stderr();
    assert!(
        run.failed() && stderr.contains("no se encontró un redirect con id `abc123`"),
        "{stderr}"
    );
}

#[test]
fn foco4_view_unknown_path_prints_readable_not_found() {
    let server = MockServer::always(Reply::data(json!([redirect_json("id-2", "/fc/seminar-2")])));
    let run = rserver(&server.url, true, &["view", "/fc/seminar"]);
    let stderr = run.stderr();
    assert!(
        run.failed() && stderr.contains("no se encontró un redirect con path `/fc/seminar`"),
        "{stderr}"
    );
}

#[test]
fn foco4_view_path_without_slash_is_an_id_and_hint_suggests_the_slash() {
    let server = MockServer::always(Reply::error(404, "redirect not found"));
    let run = rserver(&server.url, true, &["view", "fc/seminar"]);
    assert_eq!(
        server.single_request().path(),
        "/api/v1/redirects/fc%2Fseminar"
    );
    assert!(run.stderr().contains("`/fc/seminar`"), "{}", run.stderr());
}

// ---------- clap rejections never reach the network ----------

#[test]
fn invalid_order_fails_without_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let run = rserver(&server.url, true, &["list", "--order", "foo"]);
    assert!(run.failed());
    assert_eq!(server.request_count(), 0);
}

#[test]
fn page_zero_fails_without_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let run = rserver(&server.url, true, &["list", "--page", "0"]);
    assert!(run.failed());
    assert_eq!(server.request_count(), 0);
}

// ---------- success path writes only to stdout ----------

#[test]
fn successful_list_json_exits_zero_with_clean_stderr() {
    let server = MockServer::always(Reply::data(json!([redirect_json("a1", "/fc/a")])));
    let run = rserver(&server.url, true, &["list", "--json"]);
    assert!(!run.failed(), "{}", run.stderr());
    assert_eq!(run.stderr(), "");
    assert!(serde_json::from_str::<serde_json::Value>(&run.stdout()).is_ok());
}
