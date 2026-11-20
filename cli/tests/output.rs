//! `output`: table, detail view, `--json` and `format_timestamp`. Pure functions, no I/O.

use rserver::api::Redirect;
use rserver::output::{format_timestamp, print_json, print_redirect_detail, print_redirect_table};
use serde_json::Value;

fn redirect() -> Redirect {
    Redirect {
        id: "abc123".to_string(),
        path: "/fc/seminar".to_string(),
        url: "https://example.com/seminar".to_string(),
        owner: "user-1".to_string(),
        categories: vec!["docs".to_string(), "fc".to_string()],
        permission: vec!["read:fc".to_string(), "edit:fc".to_string()],
        click_count: Some(42),
        created: "2026-11-19T12:34:56.789Z".to_string(),
        updated: "2026-11-20T08:00:01Z".to_string(),
    }
}

fn render(f: impl FnOnce(&mut Vec<u8>)) -> String {
    let mut out = Vec::new();
    f(&mut out);
    String::from_utf8(out).unwrap()
}

/// `label  value` lines of the detail view, as a lookup.
fn detail_value(text: &str, label: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once(' ')?;
        (key == label).then(|| value.trim().to_string())
    })
}

// ---------- format_timestamp ----------

#[test]
fn format_timestamp_formats_iso_with_millis() {
    assert_eq!(
        format_timestamp("2026-11-19T12:34:56.789Z"),
        "2026-11-19 12:34:56 UTC"
    );
}

#[test]
fn format_timestamp_formats_iso_without_millis() {
    assert_eq!(
        format_timestamp("2026-11-19T12:34:56Z"),
        "2026-11-19 12:34:56 UTC"
    );
}

#[test]
fn format_timestamp_returns_non_iso_input_unchanged() {
    assert_eq!(format_timestamp("ayer por la tarde"), "ayer por la tarde");
}

#[test]
fn format_timestamp_returns_iso_without_z_suffix_unchanged() {
    assert_eq!(
        format_timestamp("2026-11-19T12:34:56+02:00"),
        "2026-11-19T12:34:56+02:00"
    );
}

#[test]
fn format_timestamp_returns_malformed_iso_with_z_unchanged() {
    assert_eq!(format_timestamp("2026-1-9T1:2:3Z"), "2026-1-9T1:2:3Z");
}

#[test]
fn format_timestamp_returns_empty_string_unchanged() {
    assert_eq!(format_timestamp(""), "");
}

// ---------- detail ----------

#[test]
fn detail_shows_every_field() {
    let text = render(|out| print_redirect_detail(out, &redirect()).unwrap());
    let fields: Vec<(&str, Option<String>)> = [
        "id",
        "path",
        "url",
        "owner",
        "categories",
        "permission",
        "clickCount",
        "created",
        "updated",
    ]
    .into_iter()
    .map(|label| (label, detail_value(&text, label)))
    .collect();
    let s = |v: &str| Some(v.to_string());
    assert_eq!(
        fields,
        vec![
            ("id", s("abc123")),
            ("path", s("/fc/seminar")),
            ("url", s("https://example.com/seminar")),
            ("owner", s("user-1")),
            ("categories", s("docs, fc")),
            ("permission", s("read:fc, edit:fc")),
            ("clickCount", s("42")),
            ("created", s("2026-11-19 12:34:56 UTC")),
            ("updated", s("2026-11-20 08:00:01 UTC")),
        ],
        "{text}"
    );
}

#[test]
fn detail_shows_placeholder_for_empty_lists_and_zero_for_missing_click_count() {
    let mut r = redirect();
    r.categories.clear();
    r.permission.clear();
    r.click_count = None;
    let text = render(|out| print_redirect_detail(out, &r).unwrap());
    assert_eq!(
        (
            detail_value(&text, "categories"),
            detail_value(&text, "permission"),
            detail_value(&text, "clickCount")
        ),
        (
            Some("-".to_string()),
            Some("-".to_string()),
            Some("0".to_string())
        )
    );
}

// ---------- table ----------

#[test]
fn table_has_header_and_one_row_per_redirect_with_only_id_path_url() {
    let mut other = redirect();
    other.id = "z9".to_string();
    other.path = "/promo".to_string();
    other.url = "https://example.com/promo".to_string();
    let text = render(|out| print_redirect_table(out, &[redirect(), other]).unwrap());
    let rows: Vec<Vec<&str>> = text
        .lines()
        .map(|line| line.split_whitespace().collect())
        .collect();
    assert_eq!(
        rows,
        vec![
            vec!["ID", "PATH", "URL"],
            vec!["abc123", "/fc/seminar", "https://example.com/seminar"],
            vec!["z9", "/promo", "https://example.com/promo"],
        ]
    );
}

#[test]
fn table_aligns_columns_and_has_no_trailing_spaces() {
    let mut short = redirect();
    short.id = "a".to_string();
    short.path = "/p".to_string();
    let text = render(|out| print_redirect_table(out, &[redirect(), short]).unwrap());
    let url_columns: Vec<usize> = text
        .lines()
        .map(|line| line.find(" https").or_else(|| line.find(" URL")).unwrap())
        .collect();
    assert!(url_columns.windows(2).all(|w| w[0] == w[1]), "{text}");
    assert!(text.lines().all(|line| !line.ends_with(' ')), "{text}");
}

#[test]
fn table_with_no_redirects_prints_only_the_header() {
    let text = render(|out| print_redirect_table(out, &[]).unwrap());
    assert_eq!(text.lines().collect::<Vec<_>>().len(), 1, "{text}");
}

// ---------- json ----------

#[test]
fn print_json_writes_parseable_json_that_round_trips() {
    let text = render(|out| print_json(out, &vec![redirect()]).unwrap());
    let parsed: Vec<Redirect> = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed, vec![redirect()]);
}

#[test]
fn print_json_uses_api_camel_case_field_names() {
    let text = render(|out| print_json(out, &redirect()).unwrap());
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["clickCount"], 42);
}
