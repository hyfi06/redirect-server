//! Plan §3 — `rserver edit`: the pure `apply_category_changes`, the single `PATCH` built by
//! `edit::run` against the mock, the "no changes" short-circuit and the clap usage error.

mod common;

use clap::Parser;
use common::{mutations, redirect_with, redirects_server, MockServer, Recorded, Reply, TOKEN};
use rserver::api::ApiClient;
use rserver::cli::{Cli, Command, EditArgs};
use rserver::commands::edit::{self, apply_category_changes};
use serde_json::{json, Value};

const URL: &str = "https://example.com/x";

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

// ---------- apply_category_changes ----------

#[test]
fn adds_new_and_removes_existing_preserving_order() {
    assert_eq!(
        apply_category_changes(&strings(&["a", "c"]), &strings(&["b"]), &strings(&["a"])),
        strings(&["c", "b"])
    );
}

#[test]
fn adding_an_existing_category_does_not_duplicate_it() {
    assert_eq!(
        apply_category_changes(&strings(&["a", "c"]), &strings(&["c"]), &[]),
        strings(&["a", "c"])
    );
}

#[test]
fn adding_and_removing_the_same_category_leaves_it_out() {
    assert_eq!(
        apply_category_changes(&strings(&["a"]), &strings(&["b"]), &strings(&["b"])),
        strings(&["a"])
    );
}

#[test]
fn removing_a_missing_category_is_a_no_op() {
    assert_eq!(
        apply_category_changes(&strings(&["a", "c"]), &[], &strings(&["zz"])),
        strings(&["a", "c"])
    );
}

#[test]
fn repeated_add_flags_append_once() {
    assert_eq!(
        apply_category_changes(&[], &strings(&["b", "b"]), &[]),
        strings(&["b"])
    );
}

// ---------- edit::run ----------

fn edit_args(args: &[&str]) -> EditArgs {
    let argv = ["rserver", "edit"].iter().chain(args.iter()).copied();
    match Cli::try_parse_from(argv).unwrap().command {
        Command::Edit(args) => args,
        other => panic!("expected edit, got {other:?}"),
    }
}

struct Outcome {
    result: anyhow::Result<()>,
    stdout: String,
    stderr: String,
}

fn run_edit(server: &MockServer, args: &[&str], json: bool) -> Outcome {
    let client = ApiClient::new(server.url.clone(), Some(TOKEN.to_string()));
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let result = edit::run(&client, &edit_args(args), json, &mut stdout, &mut stderr);
    Outcome {
        result,
        stdout: String::from_utf8(stdout).unwrap(),
        stderr: String::from_utf8(stderr).unwrap(),
    }
}

/// `/fc/x` (id `id-x`) with categories `["a","c"]`; `PATCH` echoes the redirect with the body applied.
fn server() -> MockServer {
    let current = redirect_with("id-x", "/fc/x", URL, &["a", "c"]);
    let items = json!([redirect_with("id-y", "/fc/y", URL, &[]), current.clone()]);
    redirects_server(items, move |req| {
        let mut updated = current.clone();
        if let Ok(Value::Object(changes)) = serde_json::from_str::<Value>(&req.body) {
            for (key, value) in changes {
                updated[key] = value;
            }
        }
        Reply::data(updated)
    })
}

fn single_patch(server: &MockServer) -> Recorded {
    let mutations = mutations(server);
    assert_eq!(mutations.len(), 1, "expected one PATCH: {mutations:#?}");
    mutations.into_iter().next().unwrap()
}

fn body(request: &Recorded) -> Value {
    serde_json::from_str(&request.body).unwrap()
}

#[test]
fn categories_change_by_path_sends_only_final_categories_to_the_resolved_id() {
    let server = server();
    run_edit(
        &server,
        &["/fc/x", "--add-category", "b", "--remove-category", "a"],
        false,
    )
    .result
    .unwrap();
    let patch = single_patch(&server);
    assert_eq!(
        (patch.method.as_str(), patch.path(), body(&patch)),
        (
            "PATCH",
            "/api/v1/redirects/id-x",
            json!({ "categories": ["c", "b"] })
        )
    );
}

#[test]
fn by_id_patches_that_id() {
    let server = server();
    run_edit(&server, &["id-x", "--add-category", "b"], false)
        .result
        .unwrap();
    assert_eq!(single_patch(&server).path(), "/api/v1/redirects/id-x");
}

#[test]
fn adding_an_existing_category_alone_sends_no_patch() {
    let server = server();
    run_edit(&server, &["/fc/x", "--add-category", "c"], false)
        .result
        .unwrap();
    assert!(mutations(&server).is_empty());
}

#[test]
fn url_and_categories_go_in_a_single_patch() {
    let server = server();
    run_edit(
        &server,
        &["/fc/x", "--url", "https://new.test", "--add-category", "b"],
        false,
    )
    .result
    .unwrap();
    assert_eq!(
        body(&single_patch(&server)),
        json!({ "url": "https://new.test", "categories": ["a", "c", "b"] })
    );
}

#[test]
fn url_equal_to_the_current_one_is_not_sent() {
    let server = server();
    run_edit(
        &server,
        &["/fc/x", "--url", URL, "--add-category", "b"],
        false,
    )
    .result
    .unwrap();
    assert_eq!(
        body(&single_patch(&server)),
        json!({ "categories": ["a", "c", "b"] })
    );
}

#[test]
fn no_effective_change_makes_no_patch_and_says_so_on_stderr() {
    let server = server();
    let outcome = run_edit(
        &server,
        &["/fc/x", "--url", URL, "--remove-category", "zz"],
        false,
    );
    assert!(outcome.result.is_ok(), "{:?}", outcome.result);
    assert!(mutations(&server).is_empty());
    assert!(outcome.stderr.contains("sin cambios"), "{}", outcome.stderr);
}

#[test]
fn no_effective_change_with_json_prints_the_current_redirect() {
    let server = server();
    let outcome = run_edit(&server, &["/fc/x", "--remove-category", "zz"], true);
    outcome.result.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&outcome.stdout).unwrap(),
        redirect_with("id-x", "/fc/x", URL, &["a", "c"])
    );
}

#[test]
fn json_prints_the_patched_redirect_data() {
    let server = server();
    let outcome = run_edit(&server, &["/fc/x", "--url", "https://new.test"], true);
    outcome.result.unwrap();
    let printed: Value = serde_json::from_str(&outcome.stdout).unwrap();
    assert_eq!(printed["url"], json!("https://new.test"));
}

#[test]
fn unknown_path_fails_without_patch() {
    let server = server();
    let outcome = run_edit(&server, &["/fc/nope", "--add-category", "b"], false);
    assert!(outcome.result.is_err());
    assert!(mutations(&server).is_empty());
}

#[test]
fn edit_without_any_change_flag_is_a_usage_error() {
    assert!(Cli::try_parse_from(["rserver", "edit", "/x"]).is_err());
}
