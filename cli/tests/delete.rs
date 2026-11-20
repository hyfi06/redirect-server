//! Plan §3 — `rserver delete`: `is_confirmation`, `--yes`, the injected confirmation prompt
//! and the non-TTY guard (Foco 5), driven through `delete::run` against the mock.

mod common;

use std::io;

use clap::Parser;
use common::{mutations, redirect_with, redirects_server, MockServer, Reply, TOKEN};
use rserver::api::ApiClient;
use rserver::cli::{Cli, Command, DeleteArgs};
use rserver::commands::delete::{self, is_confirmation, ConfirmIo};
use serde_json::{json, Value};

// ---------- is_confirmation ----------

#[test]
fn y_and_yes_in_any_case_confirm() {
    for answer in ["y", "Y", "yes", "YES", "Yes", " y \n", "yes\n"] {
        assert!(is_confirmation(answer), "{answer:?} should confirm");
    }
}

#[test]
fn anything_else_declines() {
    for answer in ["", "\n", "n", "N", "no", "yep", "si", "ye s", "yess"] {
        assert!(!is_confirmation(answer), "{answer:?} should decline");
    }
}

// ---------- delete::run ----------

fn delete_args(args: &[&str]) -> DeleteArgs {
    let argv = ["rserver", "delete"].iter().chain(args.iter()).copied();
    match Cli::try_parse_from(argv).unwrap().command {
        Command::Delete(args) => args,
        other => panic!("expected delete, got {other:?}"),
    }
}

/// `/fc/x` → id `id-x`; `DELETE` answers `{ data: <id> }` as the API does.
fn server() -> MockServer {
    let items = json!([
        redirect_with("id-y", "/fc/y", "https://y.test", &[]),
        redirect_with("id-x", "/fc/x", "https://x.test", &[]),
    ]);
    redirects_server(items, |req| match req.method.as_str() {
        "DELETE" => {
            let id = req.path().rsplit('/').next().unwrap().to_string();
            Reply::json(200, json!({ "message": "redirect deleted", "data": id }))
        }
        _ => Reply::error(404, "unexpected route in mock"),
    })
}

struct Outcome {
    result: anyhow::Result<()>,
    stdout: String,
    stderr: String,
    prompts_read: usize,
}

/// Runs `delete::run`; `answer` is what the stubbed stdin returns (`None` = EOF).
fn run_delete(
    server: &MockServer,
    args: &[&str],
    json: bool,
    is_terminal: bool,
    answer: Option<&str>,
) -> Outcome {
    let client = ApiClient::new(server.url.clone(), Some(TOKEN.to_string()));
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let mut prompts_read = 0;
    let mut input = || -> io::Result<Option<String>> {
        prompts_read += 1;
        Ok(answer.map(str::to_string))
    };
    let result = {
        let mut io = ConfirmIo {
            stdin_is_terminal: is_terminal,
            input: &mut input,
            stderr: &mut stderr,
        };
        delete::run(&client, &delete_args(args), json, &mut io, &mut stdout)
    };
    Outcome {
        result,
        stdout: String::from_utf8(stdout).unwrap(),
        stderr: String::from_utf8(stderr).unwrap(),
        prompts_read,
    }
}

fn deleted_paths(server: &MockServer) -> Vec<String> {
    mutations(server)
        .into_iter()
        .map(|req| format!("{} {}", req.method, req.path()))
        .collect()
}

#[test]
fn yes_by_path_deletes_the_resolved_id_without_prompting() {
    let server = server();
    let outcome = run_delete(&server, &["/fc/x", "--yes"], false, true, None);
    outcome.result.unwrap();
    assert_eq!(
        (deleted_paths(&server), outcome.prompts_read),
        (vec!["DELETE /api/v1/redirects/id-x".to_string()], 0)
    );
}

#[test]
fn yes_by_id_deletes_that_id() {
    let server = server();
    run_delete(&server, &["id-x", "--yes"], false, true, None)
        .result
        .unwrap();
    assert_eq!(
        deleted_paths(&server),
        vec!["DELETE /api/v1/redirects/id-x".to_string()]
    );
}

#[test]
fn prompt_shows_path_and_url_on_stderr() {
    let server = server();
    let outcome = run_delete(&server, &["/fc/x"], false, true, Some("n\n"));
    assert!(
        outcome.stderr.contains("/fc/x")
            && outcome.stderr.contains("https://x.test")
            && outcome.stderr.contains("[y/N]"),
        "{}",
        outcome.stderr
    );
}

#[test]
fn declining_answers_do_not_delete_and_report_cancelled() {
    for answer in [Some("n\n"), Some("\n"), None] {
        let server = server();
        let outcome = run_delete(&server, &["/fc/x"], false, true, answer);
        assert!(outcome.result.is_ok(), "{answer:?}: {:?}", outcome.result);
        assert!(deleted_paths(&server).is_empty(), "{answer:?}");
        assert!(
            outcome.stderr.contains("Cancelado") && outcome.stdout.is_empty(),
            "{answer:?}: {}",
            outcome.stderr
        );
    }
}

#[test]
fn confirming_answers_delete() {
    for answer in ["y\n", "YES\n"] {
        let server = server();
        run_delete(&server, &["/fc/x"], false, true, Some(answer))
            .result
            .unwrap();
        assert_eq!(
            deleted_paths(&server),
            vec!["DELETE /api/v1/redirects/id-x".to_string()],
            "{answer:?}"
        );
    }
}

#[test]
fn foco5_non_tty_without_yes_fails_without_any_request() {
    let server = server();
    let outcome = run_delete(&server, &["/fc/x"], false, false, Some("y\n"));
    let error = format!("{:#}", outcome.result.unwrap_err());
    assert!(error.contains("--yes"), "{error}");
    assert_eq!((server.request_count(), outcome.prompts_read), (0, 0));
}

#[test]
fn non_tty_with_yes_deletes() {
    let server = server();
    run_delete(&server, &["/fc/x", "--yes"], false, false, None)
        .result
        .unwrap();
    assert_eq!(deleted_paths(&server).len(), 1);
}

#[test]
fn yes_with_json_prints_only_the_deleted_id_as_json() {
    let server = server();
    let outcome = run_delete(&server, &["/fc/x", "--yes"], true, true, None);
    outcome.result.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&outcome.stdout).unwrap(),
        json!("id-x")
    );
}

#[test]
fn unknown_path_fails_without_delete() {
    let server = server();
    let outcome = run_delete(&server, &["/fc/nope", "--yes"], false, true, None);
    assert!(outcome.result.is_err());
    assert!(deleted_paths(&server).is_empty());
}
