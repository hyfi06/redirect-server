//! Plan §3 — `rserver create`: request body, error mapping (400, generic 404 vs.
//! "Group not found") and `--json` output, driven through `create::run` against the mock.

mod common;

use clap::Parser;
use common::{redirect_json, MockServer, Recorded, Reply, REDIRECTS_PATH, TOKEN};
use rserver::api::ApiClient;
use rserver::cli::{Cli, Command, CreateArgs};
use rserver::commands::create;
use serde_json::{json, Value};

fn create_args(args: &[&str]) -> CreateArgs {
    let argv = ["rserver", "create"].iter().chain(args.iter()).copied();
    match Cli::try_parse_from(argv).unwrap().command {
        Command::Create(args) => args,
        other => panic!("expected create, got {other:?}"),
    }
}

struct Outcome {
    result: anyhow::Result<()>,
    stdout: String,
}

impl Outcome {
    fn error(&self) -> String {
        format!("{:#}", self.result.as_ref().unwrap_err())
    }
}

fn run_create(server: &MockServer, args: &[&str], json: bool) -> Outcome {
    let client = ApiClient::new(server.url.clone(), Some(TOKEN.to_string()));
    let mut stdout = Vec::new();
    let result = create::run(&client, &create_args(args), json, &mut stdout);
    Outcome {
        result,
        stdout: String::from_utf8(stdout).unwrap(),
    }
}

fn created(data: Value) -> Reply {
    Reply::json(201, json!({ "message": "redirect created", "data": data }))
}

fn body(request: &Recorded) -> Value {
    serde_json::from_str(&request.body).unwrap()
}

#[test]
fn sends_post_to_redirects_collection_with_bearer() {
    let server = MockServer::always(created(redirect_json("id-1", "/promo")));
    run_create(&server, &["promo", "https://example.com/promo"], false)
        .result
        .unwrap();
    let request = server.single_request();
    assert_eq!(
        (
            request.method.as_str(),
            request.path(),
            request.header("authorization")
        ),
        (
            "POST",
            REDIRECTS_PATH,
            Some(format!("Bearer {TOKEN}").as_str())
        )
    );
}

#[test]
fn with_group_categories_and_perm_sends_exactly_those_fields() {
    let server = MockServer::always(created(redirect_json("id-1", "/fc/seminar")));
    run_create(
        &server,
        &[
            "seminar",
            "https://example.com/s",
            "--group",
            "fc",
            "--category",
            "a",
            "--category",
            "b",
            "--perm",
            "read:fc",
        ],
        false,
    )
    .result
    .unwrap();
    assert_eq!(
        body(&server.single_request()),
        json!({
            "path": "seminar",
            "url": "https://example.com/s",
            "group": "fc",
            "categories": ["a", "b"],
            "permission": ["read:fc"]
        })
    );
}

#[test]
fn without_optional_flags_sends_only_path_and_url() {
    let server = MockServer::always(created(redirect_json("id-1", "/promo")));
    run_create(&server, &["promo", "https://example.com/promo"], false)
        .result
        .unwrap();
    assert_eq!(
        body(&server.single_request()),
        json!({ "path": "promo", "url": "https://example.com/promo" })
    );
}

#[test]
fn bad_request_carries_the_api_message() {
    let server = MockServer::always(Reply::error(400, "\"path\" already taken"));
    let outcome = run_create(&server, &["promo", "https://example.com/promo"], false);
    assert!(
        outcome.error().contains("\"path\" already taken"),
        "{}",
        outcome.error()
    );
}

#[test]
fn generic_404_is_reported_as_not_the_api_v1() {
    let server = MockServer::always(Reply::error(404, "Not Found"));
    let outcome = run_create(&server, &["promo", "https://example.com/promo"], false);
    let error = outcome.error();
    assert!(
        error.contains(&server.url) && error.contains("rserver set --api-url"),
        "{error}"
    );
}

#[test]
fn group_not_found_404_stays_a_not_found_error() {
    let server = MockServer::always(Reply::error(404, "Group not found"));
    let outcome = run_create(
        &server,
        &["seminar", "https://example.com/s", "--group", "zz"],
        false,
    );
    let error = outcome.error();
    assert!(
        error.contains("no encontrado: Group not found") && !error.contains("--api-url"),
        "{error}"
    );
}

#[test]
fn json_prints_the_created_data_as_parseable_json() {
    let data = redirect_json("id-1", "/fc/seminar");
    let server = MockServer::always(created(data.clone()));
    let outcome = run_create(
        &server,
        &["seminar", "https://x.test", "--group", "fc"],
        true,
    );
    outcome.result.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&outcome.stdout).unwrap(),
        data
    );
}

#[test]
fn without_json_prints_the_created_redirect_detail() {
    let server = MockServer::always(created(redirect_json("id-1", "/fc/seminar")));
    let outcome = run_create(
        &server,
        &["seminar", "https://x.test", "--group", "fc"],
        false,
    );
    outcome.result.unwrap();
    assert!(
        outcome.stdout.contains("id-1") && outcome.stdout.contains("/fc/seminar"),
        "{}",
        outcome.stdout
    );
}
