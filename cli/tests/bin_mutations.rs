//! Plan §3 through the real `rserver` binary: exit codes, stderr messages and `--json` stdout
//! for `create` and `delete` (Foco 5). Each child gets its own `HOME`/`XDG_CONFIG_HOME` temp
//! dir, so the parent's environment and the real `~/.config` are never touched.

mod common;

use std::io::Write;
use std::process::{Command, Output, Stdio};

use common::{redirect_json, redirect_with, redirects_server, write_config, MockServer, Reply};
use serde_json::{json, Value};
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

/// Runs the binary with `stdin` piped (never a terminal) and `input` written to it.
fn rserver(api_url: &str, args: &[&str], input: &str) -> Run {
    let home = TempDir::new().unwrap();
    write_config(home.path(), api_url, true);
    let mut child = Command::new(env!("CARGO_BIN_EXE_rserver"))
        .args(args)
        .env("HOME", home.path())
        .env("XDG_CONFIG_HOME", home.path())
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // The child may exit before reading; a broken pipe here is expected and harmless.
    let _ = child.stdin.take().unwrap().write_all(input.as_bytes());
    Run {
        output: child.wait_with_output().unwrap(),
    }
}

fn delete_server() -> MockServer {
    redirects_server(
        json!([redirect_with("id-x", "/fc/x", "https://x.test", &[])]),
        |req| match req.method.as_str() {
            "DELETE" => Reply::json(
                200,
                json!({ "message": "redirect deleted", "data": "id-x" }),
            ),
            _ => Reply::error(404, "unexpected route in mock"),
        },
    )
}

#[test]
fn create_bad_request_prints_api_message_and_fails() {
    let server = MockServer::always(Reply::error(400, "\"path\" already taken"));
    let run = rserver(&server.url, &["create", "promo", "https://x.test"], "");
    assert!(
        run.failed() && run.stderr().contains("\"path\" already taken"),
        "{}",
        run.stderr()
    );
}

#[test]
fn create_generic_404_points_to_set_api_url_and_fails() {
    let server = MockServer::always(Reply::error(404, "Not Found"));
    let run = rserver(&server.url, &["create", "promo", "https://x.test"], "");
    let stderr = run.stderr();
    assert!(
        run.failed() && stderr.contains(&server.url) && stderr.contains("rserver set --api-url"),
        "{stderr}"
    );
}

#[test]
fn create_json_prints_only_parseable_data_on_stdout() {
    let data = redirect_json("id-1", "/fc/seminar");
    let server = MockServer::always(Reply::json(
        201,
        json!({ "message": "redirect created", "data": data }),
    ));
    let run = rserver(
        &server.url,
        &[
            "create",
            "seminar",
            "https://x.test",
            "--group",
            "fc",
            "--json",
        ],
        "",
    );
    assert!(!run.failed(), "{}", run.stderr());
    assert_eq!(serde_json::from_str::<Value>(&run.stdout()).unwrap(), data);
}

#[test]
fn foco5_delete_without_yes_on_piped_stdin_fails_without_any_request() {
    let server = delete_server();
    let run = rserver(&server.url, &["delete", "/fc/x"], "y\n");
    assert!(
        run.failed() && run.stderr().contains("--yes"),
        "{}",
        run.stderr()
    );
    assert_eq!(server.request_count(), 0);
}

#[test]
fn delete_yes_json_prints_only_the_deleted_id_as_json() {
    let server = delete_server();
    let run = rserver(&server.url, &["delete", "/fc/x", "--yes", "--json"], "");
    assert!(!run.failed(), "{}", run.stderr());
    assert_eq!(
        serde_json::from_str::<Value>(&run.stdout()).unwrap(),
        json!("id-x")
    );
}

#[test]
fn edit_without_change_flags_fails_without_any_request() {
    let server = delete_server();
    let run = rserver(&server.url, &["edit", "/fc/x"], "");
    assert!(run.failed());
    assert_eq!(server.request_count(), 0);
}
