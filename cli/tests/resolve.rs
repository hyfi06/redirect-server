//! `resolve_target`: `/path` → exact match over `fetch_all`; anything else → `GET /redirects/:id`.

mod common;

use common::{redirect_json, MockServer, Reply, TOKEN};
use rserver::api::ApiClient;
use rserver::resolve::resolve_target;
use serde_json::json;

fn client(server: &MockServer) -> ApiClient {
    ApiClient::new(server.url.clone(), Some(TOKEN.to_string()))
}

/// List with the target path sandwiched between prefix-sharing neighbours.
fn list_server() -> MockServer {
    MockServer::always(Reply::data(json!([
        redirect_json("id-2", "/fc/seminar-2"),
        redirect_json("id-1", "/fc/seminar"),
        redirect_json("id-3", "/fc/seminar/extra"),
    ])))
}

#[test]
fn path_returns_the_exact_match_not_a_prefix_sibling() {
    let server = list_server();
    let redirect = resolve_target(&client(&server), "/fc/seminar").unwrap();
    assert_eq!(
        (redirect.id.as_str(), redirect.path.as_str()),
        ("id-1", "/fc/seminar")
    );
}

#[test]
fn path_is_resolved_through_the_list_endpoint() {
    let server = list_server();
    resolve_target(&client(&server), "/fc/seminar").unwrap();
    let request = server.single_request();
    assert_eq!(
        (request.path(), request.query_value("limit")),
        ("/api/v1/redirects", Some("100".to_string()))
    );
}

#[test]
fn path_match_is_case_sensitive() {
    let server = list_server();
    let err = resolve_target(&client(&server), "/FC/seminar").unwrap_err();
    assert!(format!("{err:#}").contains("no se encontró"), "{err:#}");
}

#[test]
fn missing_path_reports_not_found_with_the_path() {
    let server = list_server();
    let err = resolve_target(&client(&server), "/fc/nope").unwrap_err();
    let msg = format!("{err:#}");
    assert!(
        msg.contains("no se encontró un redirect con path") && msg.contains("/fc/nope"),
        "{msg}"
    );
}

#[test]
fn id_calls_get_redirect_by_id() {
    let server = MockServer::always(Reply::data(redirect_json("abc123", "/fc/x")));
    let redirect = resolve_target(&client(&server), "abc123").unwrap();
    assert_eq!(
        (server.single_request().path().to_string(), redirect.id),
        ("/api/v1/redirects/abc123".to_string(), "abc123".to_string())
    );
}

#[test]
fn path_without_leading_slash_is_treated_as_an_encoded_id() {
    let server = MockServer::always(Reply::data(redirect_json("x", "/x")));
    resolve_target(&client(&server), "fc/seminar").unwrap();
    assert_eq!(
        server.single_request().path(),
        "/api/v1/redirects/fc%2Fseminar"
    );
}

#[test]
fn unknown_id_reports_not_found_and_suggests_leading_slash() {
    let server = MockServer::always(Reply::error(404, "redirect not found"));
    let err = resolve_target(&client(&server), "fc/seminar").unwrap_err();
    let msg = format!("{err:#}");
    assert!(
        msg.contains("no se encontró un redirect con id `fc/seminar`")
            && msg.contains("`/fc/seminar`"),
        "{msg}"
    );
}

#[test]
fn non_404_errors_on_id_lookup_keep_their_api_error_message() {
    let server = MockServer::always(Reply::json(401, json!({ "message": "API key expired" })));
    let err = resolve_target(&client(&server), "abc123").unwrap_err();
    assert!(format!("{err:#}").contains("rserver login"), "{err:#}");
}

#[test]
fn empty_argument_fails_without_any_request() {
    let server = list_server();
    let err = resolve_target(&client(&server), "").unwrap_err();
    assert!(format!("{err:#}").contains("indica el id o el path"));
    assert_eq!(server.request_count(), 0);
}

#[test]
fn dot_segments_are_rejected_as_ids_without_any_request() {
    let server = list_server();
    for arg in [".", ".."] {
        let err = resolve_target(&client(&server), arg).unwrap_err();
        assert!(
            format!("{err:#}").contains("no es un id válido"),
            "{arg}: {err:#}"
        );
    }
    assert_eq!(server.request_count(), 0);
}
