//! Shared helpers for the `rserver` integration tests: a minimal HTTP/1.1 mock server on
//! `127.0.0.1:0` (std::net, one thread, `Connection: close`), request recording, redirect
//! fixtures and a helper that yields a closed local port. No real network is ever used.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use rserver::config::{self, ApiKeyConfig, Config};
use serde_json::{json, Value};

pub const TOKEN: &str = "sk_1kg_test_token";

/// One request as received by the mock.
#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    /// Raw request target, e.g. `/api/v1/redirects?limit=20`.
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// Path without the query string, still percent-encoded.
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap()
    }

    /// Decoded query pairs, in the order they were sent.
    pub fn query(&self) -> Vec<(String, String)> {
        let url = url::Url::parse(&format!("http://mock{}", self.target)).unwrap();
        url.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    pub fn query_value(&self, key: &str) -> Option<String> {
        self.query()
            .into_iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }
}

/// What the mock answers.
#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: String,
}

impl Reply {
    pub fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            content_type: "application/json; charset=utf-8",
            body: body.to_string(),
        }
    }

    /// `200 { message, data }`, the API v1 success envelope.
    pub fn data(data: Value) -> Self {
        Self::json(200, json!({ "message": "ok", "data": data }))
    }

    /// API v1 error envelope (`{ statusCode, error, message }`).
    pub fn error(status: u16, message: &str) -> Self {
        Self::json(
            status,
            json!({ "statusCode": status, "error": "Error", "message": message }),
        )
    }

    pub fn html(status: u16) -> Self {
        Self {
            status,
            content_type: "text/html; charset=utf-8",
            body: "<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>".to_string(),
        }
    }
}

type Handler = dyn Fn(&Recorded) -> Reply + Send + Sync + 'static;

pub struct MockServer {
    pub url: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl MockServer {
    /// Starts the mock; `handler` decides the reply for every request.
    pub fn start(handler: impl Fn(&Recorded) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&requests);
        let handler: Arc<Handler> = Arc::new(handler);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                serve(stream, &recorded, handler.as_ref());
            }
        });
        Self { url, requests }
    }

    /// Always answers the same reply.
    pub fn always(reply: Reply) -> Self {
        Self::start(move |_| reply.clone())
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    pub fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    /// The only request received; panics if there were zero or several.
    pub fn single_request(&self) -> Recorded {
        let requests = self.requests();
        assert_eq!(
            requests.len(),
            1,
            "expected exactly one request: {requests:#?}"
        );
        requests.into_iter().next().unwrap()
    }
}

fn serve(stream: TcpStream, recorded: &Mutex<Vec<Recorded>>, handler: &Handler) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();

    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.push((key.trim().to_string(), value.trim().to_string()));
        }
    }
    let length = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();

    let request = Recorded {
        method,
        target,
        headers,
        body: String::from_utf8(body).unwrap(),
    };
    let reply = handler(&request);
    recorded.lock().unwrap().push(request);

    let mut stream = stream;
    let response = format!(
        "HTTP/1.1 {} Mock\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply.status,
        reply.content_type,
        reply.body.len(),
        reply.body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// URL of a local port with nothing listening (bound, then released).
pub fn closed_port_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    format!("http://127.0.0.1:{port}")
}

/// A redirect as the API serializes it (every field present).
pub fn redirect_json(id: &str, path: &str) -> Value {
    json!({
        "id": id,
        "path": path,
        "url": format!("https://example.com{path}"),
        "owner": "user-1",
        "categories": ["docs", "fc"],
        "permission": ["read:fc", "edit:fc"],
        "clickCount": 7,
        "created": "2026-11-19T12:34:56.789Z",
        "updated": "2026-11-20T08:00:01.000Z"
    })
}

/// `count` redirects with ids `{prefix}-{n}` and paths `/{prefix}/{n}`.
pub fn redirect_page(prefix: &str, count: usize) -> Value {
    Value::Array(
        (0..count)
            .map(|n| redirect_json(&format!("{prefix}-{n}"), &format!("/{prefix}/{n}")))
            .collect(),
    )
}

/// Config file path under a temp `XDG_CONFIG_HOME`.
pub fn config_file(xdg: &Path) -> PathBuf {
    xdg.join("rserver").join("config.toml")
}

/// Writes `{xdg}/rserver/config.toml` with the given URL and, optionally, the test token.
pub fn write_config(xdg: &Path, api_url: &str, with_key: bool) {
    let cfg = Config {
        api_url: api_url.to_string(),
        api_key: with_key.then(|| ApiKeyConfig {
            id: "key-1".to_string(),
            token: TOKEN.to_string(),
        }),
    };
    config::save_to(&config_file(xdg), &cfg).unwrap();
}

/// A JWT-shaped string (three base64url parts, no whitespace) used as the pasted token.
pub const JWT: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl";

/// An API Key as `GET /users/me/api-keys` serializes it (`toPublic()`: no hash, no token).
pub fn api_key_json(id: &str, name: &str, active: bool) -> Value {
    json!({
        "id": id,
        "name": name,
        "prefix": "sk_1kg_x",
        "scopes": ["read:redirects", "write:redirects"],
        "active": active,
        "createdAt": "2026-11-01T00:00:00.000Z",
        "expiresAt": null
    })
}

/// Mock of `/api/v1/users/me/api-keys`, routed by method and path:
/// `GET` lists `keys`; `DELETE /{id}` answers `delete_reply(id)`; `POST` answers `post_reply`.
/// Anything else is a JSON 404, so an unexpected route shows up as a failure.
pub fn api_keys_server(
    keys: Value,
    delete_reply: impl Fn(&str) -> Reply + Send + Sync + 'static,
    post_reply: Reply,
) -> MockServer {
    const BASE: &str = "/api/v1/users/me/api-keys";
    MockServer::start(move |req| match (req.method.as_str(), req.path()) {
        ("GET", BASE) => Reply::data(keys.clone()),
        ("POST", BASE) => post_reply.clone(),
        ("DELETE", path) if path.starts_with(&format!("{BASE}/")) => {
            delete_reply(&path[BASE.len() + 1..])
        }
        _ => Reply::error(404, "unexpected route in mock"),
    })
}

/// `201` with the created key and its one-time plaintext `token`, as `POST /users/me/api-keys` answers.
pub fn created_key_reply(id: &str, name: &str, token: &str) -> Reply {
    let mut data = api_key_json(id, name, true);
    data["token"] = json!(token);
    Reply::json(201, json!({ "message": "api key created", "data": data }))
}

/// `200 { id }`, as `DELETE /users/me/api-keys/:keyId` answers.
pub fn revoked_reply(id: &str) -> Reply {
    Reply::json(
        200,
        json!({ "message": "api key revoked", "data": { "id": id } }),
    )
}

/// Collection path of the redirects API.
pub const REDIRECTS_PATH: &str = "/api/v1/redirects";

/// A redirect with an explicit `url` and `categories` (other fields as in [`redirect_json`]).
pub fn redirect_with(id: &str, path: &str, url: &str, categories: &[&str]) -> Value {
    let mut redirect = redirect_json(id, path);
    redirect["url"] = json!(url);
    redirect["categories"] = json!(categories);
    redirect
}

/// Mock of `/api/v1/redirects`, routed by method and path: `GET /redirects` lists `items`
/// (a single page, enough for `fetch_all`); `GET /redirects/{id}` answers the item with that id
/// or a JSON 404 `redirect not found`; every other request (`POST`, `PATCH`, `DELETE`, …)
/// answers `mutate(request)`.
pub fn redirects_server(
    items: Value,
    mutate: impl Fn(&Recorded) -> Reply + Send + Sync + 'static,
) -> MockServer {
    MockServer::start(move |req| match (req.method.as_str(), req.path()) {
        ("GET", REDIRECTS_PATH) => Reply::data(items.clone()),
        ("GET", path) if path.starts_with(&format!("{REDIRECTS_PATH}/")) => {
            let id = &path[REDIRECTS_PATH.len() + 1..];
            items
                .as_array()
                .and_then(|all| all.iter().find(|r| r["id"] == id))
                .map(|r| Reply::data(r.clone()))
                .unwrap_or_else(|| Reply::error(404, "redirect not found"))
        }
        _ => mutate(req),
    })
}

/// Requests other than `GET` received by the mock (the mutations).
pub fn mutations(server: &MockServer) -> Vec<Recorded> {
    server
        .requests()
        .into_iter()
        .filter(|req| req.method != "GET")
        .collect()
}
