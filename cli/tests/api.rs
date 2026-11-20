//! `ApiClient` against a local mock server: URL building, bearer header, generic verbs,
//! `ApiError` classification and `fetch_all` pagination.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};

use common::{closed_port_url, redirect_json, redirect_page, MockServer, Reply, TOKEN};
use rserver::api::{fetch_all, fetch_all_with_page_size, ApiClient, ApiError, Redirect};
use serde_json::{json, Value};

fn client(server: &MockServer) -> ApiClient {
    ApiClient::new(server.url.clone(), Some(TOKEN.to_string()))
}

// ---------- Redirect deserialization ----------

#[test]
fn redirect_deserializes_camel_case_click_count_and_defaults_missing_arrays() {
    let redirect: Redirect = serde_json::from_value(json!({
        "id": "a", "path": "/a", "url": "https://a", "owner": "u",
        "clickCount": 3, "created": "c", "updated": "u"
    }))
    .unwrap();
    assert_eq!(
        (
            redirect.click_count,
            redirect.categories,
            redirect.permission
        ),
        (Some(3), vec![], vec![])
    );
}

#[test]
fn redirect_without_click_count_round_trips_without_the_field() {
    let redirect: Redirect = serde_json::from_value(json!({
        "id": "a", "path": "/a", "url": "https://a", "owner": "u",
        "created": "c", "updated": "u"
    }))
    .unwrap();
    let back = serde_json::to_value(&redirect).unwrap();
    assert!(back.get("clickCount").is_none(), "{back}");
}

// ---------- list_redirects ----------

#[test]
fn list_sends_bearer_token_header() {
    let server = MockServer::always(Reply::data(json!([])));
    client(&server).list_redirects(None, 20, None).unwrap();
    assert_eq!(
        server.single_request().header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
}

#[test]
fn list_without_offset_sends_only_limit() {
    let server = MockServer::always(Reply::data(json!([])));
    client(&server).list_redirects(None, 20, None).unwrap();
    let request = server.single_request();
    assert_eq!(
        (request.method.as_str(), request.path(), request.query()),
        (
            "GET",
            "/api/v1/redirects",
            vec![("limit".to_string(), "20".to_string())]
        )
    );
}

#[test]
fn list_sends_offset_and_order_by_when_given() {
    let server = MockServer::always(Reply::data(json!([])));
    client(&server)
        .list_redirects(Some(20), 10, Some("-created"))
        .unwrap();
    let request = server.single_request();
    assert_eq!(
        (
            request.query_value("offset"),
            request.query_value("limit"),
            request.query_value("orderBy")
        ),
        (
            Some("20".to_string()),
            Some("10".to_string()),
            Some("-created".to_string())
        )
    );
}

#[test]
fn list_returns_the_data_array_deserialized() {
    let server = MockServer::always(Reply::data(json!([redirect_json("a1", "/fc/a")])));
    let redirects = client(&server).list_redirects(None, 20, None).unwrap();
    assert_eq!(
        redirects,
        vec![serde_json::from_value::<Redirect>(redirect_json("a1", "/fc/a")).unwrap()]
    );
}

#[test]
fn api_url_with_path_prefix_keeps_the_prefix() {
    let server = MockServer::always(Reply::data(json!([])));
    let client = ApiClient::new(format!("{}/base/", server.url), Some(TOKEN.to_string()));
    client.list_redirects(None, 5, None).unwrap();
    assert_eq!(server.single_request().path(), "/base/api/v1/redirects");
}

#[test]
fn list_json_404_from_server_without_api_is_reported_as_not_api() {
    // `main` answers /api/** with a JSON 404 because the API is not mounted there.
    let server = MockServer::always(Reply::error(404, "Not Found"));
    let err = client(&server).list_redirects(None, 20, None).unwrap_err();
    assert_eq!(
        err,
        ApiError::NotApi {
            api_url: server.url.clone(),
            status: 404
        }
    );
}

// ---------- get_redirect ----------

#[test]
fn get_redirect_requests_the_id_segment() {
    let server = MockServer::always(Reply::data(redirect_json("abc123", "/fc/x")));
    let redirect = client(&server).get_redirect("abc123").unwrap();
    assert_eq!(
        (server.single_request().path().to_string(), redirect.id),
        ("/api/v1/redirects/abc123".to_string(), "abc123".to_string())
    );
}

#[test]
fn get_redirect_percent_encodes_a_slash_inside_the_id() {
    let server = MockServer::always(Reply::data(redirect_json("x", "/x")));
    client(&server).get_redirect("fc/seminar").unwrap();
    assert_eq!(
        server.single_request().path(),
        "/api/v1/redirects/fc%2Fseminar"
    );
}

#[test]
fn get_redirect_404_is_not_found_with_api_message() {
    let server = MockServer::always(Reply::error(404, "redirect not found"));
    let err = client(&server).get_redirect("nope").unwrap_err();
    assert_eq!(err, ApiError::NotFound("redirect not found".to_string()));
}

// ---------- generic verbs ----------

#[test]
fn post_sends_json_body_with_bearer_and_returns_data() {
    let server = MockServer::always(Reply::json(
        201,
        json!({ "message": "created", "data": { "id": "new" } }),
    ));
    let data: Value = client(&server)
        .post(
            &["redirects"],
            &json!({ "path": "/fc/x", "url": "https://x" }),
        )
        .unwrap();
    let request = server.single_request();
    assert_eq!(data, json!({ "id": "new" }));
    assert_eq!(request.method, "POST");
    assert_eq!(request.path(), "/api/v1/redirects");
    assert_eq!(
        request.header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert!(request
        .header("content-type")
        .unwrap()
        .starts_with("application/json"));
    assert_eq!(
        serde_json::from_str::<Value>(&request.body).unwrap(),
        json!({ "path": "/fc/x", "url": "https://x" })
    );
}

#[test]
fn patch_sends_json_body_to_the_segments() {
    let server = MockServer::always(Reply::data(json!({ "id": "a" })));
    let _: Value = client(&server)
        .patch(&["redirects", "a"], &json!({ "url": "https://y" }))
        .unwrap();
    let request = server.single_request();
    assert_eq!(
        (
            request.method.as_str(),
            request.path(),
            serde_json::from_str::<Value>(&request.body).unwrap()
        ),
        (
            "PATCH",
            "/api/v1/redirects/a",
            json!({ "url": "https://y" })
        )
    );
}

#[test]
fn delete_calls_delete_on_the_segments_with_bearer() {
    let server = MockServer::always(Reply::data(json!({ "id": "a" })));
    let _: Value = client(&server).delete(&["redirects", "a"]).unwrap();
    let request = server.single_request();
    assert_eq!(
        (
            request.method.as_str(),
            request.path(),
            request.header("authorization")
        ),
        (
            "DELETE",
            "/api/v1/redirects/a",
            Some(format!("Bearer {TOKEN}").as_str())
        )
    );
}

// ---------- ApiError classification ----------

#[test]
fn missing_token_fails_before_any_request() {
    let server = MockServer::always(Reply::data(json!([])));
    let client = ApiClient::new(server.url.clone(), None);
    let errors = [
        client.list_redirects(None, 20, None).unwrap_err(),
        client.get_redirect("a").unwrap_err(),
        client
            .post::<_, Value>(&["redirects"], &json!({}))
            .unwrap_err(),
        client
            .patch::<_, Value>(&["redirects", "a"], &json!({}))
            .unwrap_err(),
        client.delete::<Value>(&["redirects", "a"]).unwrap_err(),
    ];
    assert!(
        errors.iter().all(|e| *e == ApiError::MissingApiKey),
        "{errors:?}"
    );
    assert_eq!(server.request_count(), 0);
}

#[test]
fn status_400_is_bad_request_with_api_message() {
    let server = MockServer::always(Reply::error(400, "\"path\" already taken"));
    let err = client(&server).get_redirect("a").unwrap_err();
    assert_eq!(
        err,
        ApiError::BadRequest("\"path\" already taken".to_string())
    );
}

#[test]
fn status_401_is_unauthorized_with_api_message() {
    let server = MockServer::always(Reply::json(401, json!({ "message": "API key expired" })));
    let err = client(&server).list_redirects(None, 20, None).unwrap_err();
    assert_eq!(err, ApiError::Unauthorized("API key expired".to_string()));
}

#[test]
fn status_403_is_forbidden_with_api_message() {
    let server = MockServer::always(Reply::error(403, "insufficient scope"));
    let err = client(&server).get_redirect("a").unwrap_err();
    assert_eq!(err, ApiError::Forbidden("insufficient scope".to_string()));
}

#[test]
fn other_error_status_with_api_body_keeps_status_and_message() {
    let server = MockServer::always(Reply::error(500, "boom"));
    let err = client(&server).get_redirect("a").unwrap_err();
    assert_eq!(
        err,
        ApiError::Status {
            status: 500,
            message: "boom".to_string()
        }
    );
}

#[test]
fn html_error_response_is_not_api() {
    let server = MockServer::always(Reply::html(404));
    let err = client(&server).get_redirect("a").unwrap_err();
    assert_eq!(
        err,
        ApiError::NotApi {
            api_url: server.url.clone(),
            status: 404
        }
    );
}

#[test]
fn html_success_response_is_not_api() {
    let server = MockServer::always(Reply::html(200));
    let err = client(&server).list_redirects(None, 20, None).unwrap_err();
    assert_eq!(
        err,
        ApiError::NotApi {
            api_url: server.url.clone(),
            status: 200
        }
    );
}

#[test]
fn json_success_without_data_envelope_is_not_api() {
    let server = MockServer::always(Reply::json(200, json!({ "hello": "world" })));
    let err = client(&server).get_redirect("a").unwrap_err();
    assert!(
        matches!(err, ApiError::NotApi { status: 200, .. }),
        "{err:?}"
    );
}

#[test]
fn closed_port_is_unreachable_with_api_url() {
    let api_url = closed_port_url();
    let client = ApiClient::new(api_url.clone(), Some(TOKEN.to_string()));
    let err = client.list_redirects(None, 20, None).unwrap_err();
    assert!(
        matches!(&err, ApiError::Unreachable { api_url: url, .. } if *url == api_url),
        "{err:?}"
    );
}

#[test]
fn invalid_api_url_is_unreachable_instead_of_panicking() {
    let client = ApiClient::new("not a url", Some(TOKEN.to_string()));
    let err = client.get_redirect("a").unwrap_err();
    assert!(matches!(err, ApiError::Unreachable { .. }), "{err:?}");
}

// ---------- ApiError messages ----------

#[test]
fn unauthorized_message_suggests_login_and_keeps_api_message() {
    let msg = ApiError::Unauthorized("API key revoked".to_string()).to_string();
    assert!(
        msg.contains("rserver login") && msg.contains("API key revoked"),
        "{msg}"
    );
}

#[test]
fn missing_api_key_message_suggests_login() {
    assert!(ApiError::MissingApiKey
        .to_string()
        .contains("rserver login"));
}

#[test]
fn unreachable_message_names_api_url_and_set_command() {
    let msg = ApiError::Unreachable {
        api_url: "http://localhost:3000".to_string(),
        detail: "refused".to_string(),
    }
    .to_string();
    assert!(
        msg.contains("http://localhost:3000") && msg.contains("rserver set --api-url"),
        "{msg}"
    );
}

#[test]
fn not_api_message_names_api_url_and_set_command() {
    let msg = ApiError::NotApi {
        api_url: "https://1kg.me".to_string(),
        status: 404,
    }
    .to_string();
    assert!(
        msg.contains("https://1kg.me") && msg.contains("rserver set --api-url"),
        "{msg}"
    );
}

#[test]
fn bad_request_message_includes_the_api_message() {
    let msg = ApiError::BadRequest("\"url\" must be a valid uri".to_string()).to_string();
    assert!(msg.contains("\"url\" must be a valid uri"), "{msg}");
}

// ---------- fetch_all ----------

/// Mock that serves `pages[n]` for the n-th request.
fn paged_server(pages: Vec<Value>) -> MockServer {
    let calls = AtomicUsize::new(0);
    MockServer::start(move |_| {
        let n = calls.fetch_add(1, Ordering::SeqCst);
        Reply::data(pages.get(n).cloned().unwrap_or_else(|| json!([])))
    })
}

#[test]
fn fetch_all_stops_at_first_partial_page_after_exactly_three_requests() {
    let server = paged_server(vec![
        redirect_page("p1", 2),
        redirect_page("p2", 2),
        redirect_page("p3", 1),
    ]);
    let all = fetch_all_with_page_size(&client(&server), 2).unwrap();
    let ids: Vec<&str> = all.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["p1-0", "p1-1", "p2-0", "p2-1", "p3-0"]);
    assert_eq!(server.request_count(), 3);
}

#[test]
fn fetch_all_advances_offset_by_page_size_and_omits_it_on_first_page() {
    let server = paged_server(vec![
        redirect_page("p1", 2),
        redirect_page("p2", 2),
        redirect_page("p3", 1),
    ]);
    fetch_all_with_page_size(&client(&server), 2).unwrap();
    let pages: Vec<(Option<String>, Option<String>)> = server
        .requests()
        .iter()
        .map(|r| (r.query_value("offset"), r.query_value("limit")))
        .collect();
    let s = |v: &str| Some(v.to_string());
    assert_eq!(
        pages,
        vec![(None, s("2")), (s("2"), s("2")), (s("4"), s("2"))]
    );
}

#[test]
fn fetch_all_with_exactly_full_pages_stops_on_the_trailing_empty_page() {
    let server = paged_server(vec![redirect_page("p1", 2), redirect_page("p2", 2)]);
    let all = fetch_all_with_page_size(&client(&server), 2).unwrap();
    assert_eq!((all.len(), server.request_count()), (4, 3));
}

#[test]
fn fetch_all_with_empty_collection_makes_one_request() {
    let server = paged_server(vec![]);
    let all = fetch_all_with_page_size(&client(&server), 2).unwrap();
    assert_eq!((all.len(), server.request_count()), (0, 1));
}

#[test]
fn fetch_all_uses_page_size_100() {
    let server = paged_server(vec![redirect_page("p1", 3)]);
    fetch_all(&client(&server)).unwrap();
    assert_eq!(
        server.single_request().query_value("limit"),
        Some("100".to_string())
    );
}

#[test]
fn fetch_all_propagates_errors_from_a_later_page() {
    let calls = AtomicUsize::new(0);
    let server = MockServer::start(move |_| match calls.fetch_add(1, Ordering::SeqCst) {
        0 => Reply::data(redirect_page("p1", 2)),
        _ => Reply::json(401, json!({ "message": "API key revoked" })),
    });
    let err = fetch_all_with_page_size(&client(&server), 2).unwrap_err();
    assert_eq!(err, ApiError::Unauthorized("API key revoked".to_string()));
}
