//! Plan §4 — `rserver search`: the pure `filter_redirects`, the "at least one filter" usage
//! rule, `search::run` against a paged mock (every page walked through `fetch_all`) and the
//! real binary's exit codes and `--json` stdout. No real network, never the real `~/.config`.

mod common;

use std::process::{Command, Output, Stdio};

use clap::Parser;
use common::{redirect_with, write_config, MockServer, Reply, REDIRECTS_PATH, TOKEN};
use rserver::api::{ApiClient, Redirect, FETCH_ALL_PAGE_SIZE};
use rserver::cli::{Cli, Command as CliCommand, SearchArgs};
use rserver::commands::search::{self, filter_redirects};
use serde_json::{json, Value};
use tempfile::TempDir;

fn redirect(id: &str, path: &str, url: &str, categories: &[&str]) -> Redirect {
    serde_json::from_value(redirect_with(id, path, url, categories)).unwrap()
}

fn ids(items: &[Redirect]) -> Vec<&str> {
    items.iter().map(|r| r.id.as_str()).collect()
}

/// A small fixed set covering every filter.
fn fixtures() -> Vec<Redirect> {
    vec![
        redirect(
            "drive",
            "/fc/drive",
            "https://drive.google.com/x",
            &["docs"],
        ),
        redirect(
            "seminar",
            "/fc/seminar",
            "https://example.com/s",
            &["eventos"],
        ),
        redirect("promo", "/promo", "https://shop.test/p", &["x"]),
        redirect("fc-x", "/fc/otro", "https://example.com/o", &["x", "docs"]),
        redirect("bare", "/fc/bare", "https://example.com/b", &[]),
    ]
}

// ---------- filter_redirects ----------

#[test]
fn url_filter_matches_a_fragment_ignoring_case() {
    let found = filter_redirects(fixtures(), None, Some("DRIVE.google"), None);
    assert_eq!(ids(&found), ["drive"]);
}

#[test]
fn path_filter_matches_a_fragment_ignoring_case() {
    let found = filter_redirects(fixtures(), Some("semi"), None, None);
    assert_eq!(ids(&found), ["seminar"]);
}

#[test]
fn path_filter_with_uppercase_fragment_still_matches() {
    let found = filter_redirects(fixtures(), Some("SEMI"), None, None);
    assert_eq!(ids(&found), ["seminar"]);
}

#[test]
fn category_filter_is_exact_and_case_sensitive() {
    let found = filter_redirects(fixtures(), None, None, Some("Docs"));
    assert!(found.is_empty(), "{:?}", ids(&found));
}

#[test]
fn category_filter_matches_any_of_the_categories() {
    let found = filter_redirects(fixtures(), None, None, Some("docs"));
    assert_eq!(ids(&found), ["drive", "fc-x"]);
}

#[test]
fn category_filter_does_not_match_a_fragment() {
    let found = filter_redirects(fixtures(), None, None, Some("doc"));
    assert!(found.is_empty(), "{:?}", ids(&found));
}

#[test]
fn several_filters_must_all_hold() {
    // "promo" has category x but no "fc" in its path; "drive"/"seminar"/"bare" have "fc" but not x.
    let found = filter_redirects(fixtures(), Some("fc"), None, Some("x"));
    assert_eq!(ids(&found), ["fc-x"]);
}

#[test]
fn no_matches_yields_an_empty_list() {
    let found = filter_redirects(fixtures(), Some("does-not-exist"), None, None);
    assert!(found.is_empty());
}

#[test]
fn redirect_without_categories_never_matches_a_category_filter() {
    let items = vec![redirect("bare", "/fc/bare", "https://example.com/b", &[])];
    assert!(filter_redirects(items, None, None, Some("x")).is_empty());
}

#[test]
fn filtering_keeps_the_original_order() {
    let found = filter_redirects(fixtures(), Some("/fc/"), None, None);
    assert_eq!(ids(&found), ["drive", "seminar", "fc-x", "bare"]);
}

// ---------- argument parsing ----------

#[test]
fn search_without_filters_is_a_usage_error() {
    assert!(Cli::try_parse_from(["rserver", "search"]).is_err());
}

#[test]
fn search_accepts_any_single_filter() {
    for argv in [
        ["rserver", "search", "--path", "fc"],
        ["rserver", "search", "--url", "drive"],
        ["rserver", "search", "--category", "docs"],
    ] {
        assert!(Cli::try_parse_from(argv).is_ok(), "{argv:?}");
    }
}

#[test]
fn search_accepts_several_filters_together() {
    let args = search_args(&["--path", "fc", "--url", "x", "--category", "c"]);
    assert_eq!(
        (
            args.path.as_deref(),
            args.url.as_deref(),
            args.category.as_deref()
        ),
        (Some("fc"), Some("x"), Some("c"))
    );
}

// ---------- search::run ----------

fn search_args(args: &[&str]) -> SearchArgs {
    let argv = ["rserver", "search"].iter().chain(args.iter()).copied();
    match Cli::try_parse_from(argv).unwrap().command {
        CliCommand::Search(args) => args,
        other => panic!("expected search, got {other:?}"),
    }
}

/// `total` redirects `id-{n}` → `/p/{n}` → `https://site.test/{n}`; ids 150 and 220 point
/// at `drive.google.com`, so the only matches live on the second and third pages.
fn many_redirects(total: usize) -> Vec<Value> {
    (0..total)
        .map(|n| {
            let url = if n == 150 || n == 220 {
                format!("https://drive.google.com/{n}")
            } else {
                format!("https://site.test/{n}")
            };
            redirect_with(&format!("id-{n}"), &format!("/p/{n}"), &url, &[])
        })
        .collect()
}

/// Mock of `GET /redirects` that honours `offset` and `limit`, like the API does.
fn paged_server(items: Vec<Value>) -> MockServer {
    MockServer::start(move |req| {
        if req.method != "GET" || req.path() != REDIRECTS_PATH {
            return Reply::error(404, "unexpected route in mock");
        }
        let offset: usize = req.query_value("offset").map_or(0, |v| v.parse().unwrap());
        let limit: usize = req.query_value("limit").unwrap().parse().unwrap();
        let page: Vec<Value> = items.iter().skip(offset).take(limit).cloned().collect();
        Reply::data(Value::Array(page))
    })
}

struct Outcome {
    result: anyhow::Result<()>,
    stdout: String,
    stderr: String,
}

fn run_search(server: &MockServer, args: &[&str], json: bool) -> Outcome {
    let client = ApiClient::new(server.url.clone(), Some(TOKEN.to_string()));
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let result = search::run(&client, &search_args(args), json, &mut stdout, &mut stderr);
    Outcome {
        result,
        stdout: String::from_utf8(stdout).unwrap(),
        stderr: String::from_utf8(stderr).unwrap(),
    }
}

#[test]
fn run_walks_every_page_of_the_mock() {
    let server = paged_server(many_redirects(230));
    run_search(&server, &["--url", "drive"], true)
        .result
        .unwrap();
    let pages: Vec<(Option<String>, Option<String>)> = server
        .requests()
        .iter()
        .map(|req| (req.query_value("offset"), req.query_value("limit")))
        .collect();
    let size = Some(FETCH_ALL_PAGE_SIZE.to_string());
    assert_eq!(
        pages,
        [
            (None, size.clone()),
            (Some("100".to_string()), size.clone()),
            (Some("200".to_string()), size),
        ]
    );
}

#[test]
fn run_finds_matches_beyond_the_first_page() {
    let server = paged_server(many_redirects(230));
    let out = run_search(&server, &["--url", "drive"], true);
    let found: Vec<Redirect> = serde_json::from_str(&out.stdout).unwrap();
    assert_eq!(ids(&found), ["id-150", "id-220"]);
}

#[test]
fn run_json_prints_only_the_filtered_redirects_with_every_field() {
    let server = paged_server(vec![
        redirect_with("a", "/fc/seminar", "https://a.test", &["docs"]),
        redirect_with("b", "/promo", "https://b.test", &["docs"]),
    ]);
    let out = run_search(&server, &["--path", "semi"], true);
    let printed: Value = serde_json::from_str(&out.stdout).unwrap();
    assert_eq!(
        printed,
        json!([redirect_with(
            "a",
            "/fc/seminar",
            "https://a.test",
            &["docs"]
        )])
    );
}

#[test]
fn run_table_shows_only_id_path_and_url() {
    let server = paged_server(vec![
        redirect_with("id-a", "/fc/seminar", "https://a.test/s", &["docs"]),
        redirect_with("id-b", "/promo", "https://b.test", &[]),
    ]);
    let out = run_search(&server, &["--path", "semi"], false);
    let lines: Vec<Vec<&str>> = out
        .stdout
        .lines()
        .map(|line| line.split_whitespace().collect())
        .collect();
    assert_eq!(
        lines,
        [
            vec!["ID", "PATH", "URL"],
            vec!["id-a", "/fc/seminar", "https://a.test/s"],
        ]
    );
}

#[test]
fn run_table_with_matches_writes_nothing_to_stderr() {
    let server = paged_server(vec![redirect_with(
        "a",
        "/fc/seminar",
        "https://a.test",
        &[],
    )]);
    let out = run_search(&server, &["--path", "semi"], false);
    assert_eq!(out.stderr, "");
}

#[test]
fn run_without_matches_succeeds() {
    let server = paged_server(many_redirects(3));
    assert!(run_search(&server, &["--url", "nowhere"], false)
        .result
        .is_ok());
}

#[test]
fn run_json_without_matches_prints_an_empty_array() {
    let server = paged_server(many_redirects(3));
    let out = run_search(&server, &["--url", "nowhere"], true);
    assert_eq!(
        (out.result.is_ok(), out.stdout.trim(), out.stderr.as_str()),
        (true, "[]", "")
    );
}

#[test]
fn run_table_without_matches_prints_only_the_header_and_a_notice() {
    let server = paged_server(many_redirects(3));
    let out = run_search(&server, &["--url", "nowhere"], false);
    assert_eq!(
        (
            out.stdout.split_whitespace().collect::<Vec<_>>(),
            out.stderr.trim()
        ),
        (
            vec!["ID", "PATH", "URL"],
            "no se encontraron redirects con esos filtros"
        )
    );
}

#[test]
fn run_propagates_api_errors() {
    let server = MockServer::always(Reply::error(401, "invalid api key"));
    let out = run_search(&server, &["--path", "x"], false);
    assert!(
        out.result.is_err() && out.stdout.is_empty(),
        "{}",
        out.stdout
    );
}

// ---------- the real binary ----------

/// Runs the binary with its own temp `HOME`/`XDG_CONFIG_HOME`, so `~/.config` is never touched.
fn rserver(api_url: &str, args: &[&str]) -> Output {
    let home = TempDir::new().unwrap();
    write_config(home.path(), api_url, true);
    Command::new(env!("CARGO_BIN_EXE_rserver"))
        .args(args)
        .env("HOME", home.path())
        .env("XDG_CONFIG_HOME", home.path())
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

#[test]
fn binary_search_without_filters_exits_2_without_requests() {
    let server = paged_server(many_redirects(3));
    let output = rserver(&server.url, &["search"]);
    assert_eq!((output.status.code(), server.request_count()), (Some(2), 0));
}

#[test]
fn binary_search_json_without_matches_prints_empty_array_and_exits_0() {
    let server = paged_server(many_redirects(3));
    let output = rserver(&server.url, &["search", "--url", "x", "--json"]);
    assert_eq!(
        (
            output.status.code(),
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        ),
        (Some(0), "[]".to_string())
    );
}
