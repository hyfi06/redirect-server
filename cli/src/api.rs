use std::fmt;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ureq::http::Response;
use ureq::{Agent, Body};
use url::Url;

use crate::config::Config;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const GLOBAL_TIMEOUT: Duration = Duration::from_secs(30);
const API_PREFIX: [&str; 2] = ["api", "v1"];
/// Page size used internally by [`fetch_all`].
pub const FETCH_ALL_PAGE_SIZE: u32 = 100;

/// A redirect as returned by the API v1. Dates are kept as the ISO 8601 strings the API sends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Redirect {
    pub id: String,
    pub path: String,
    pub url: String,
    pub owner: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub permission: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click_count: Option<u64>,
    pub created: String,
    pub updated: String,
}

/// Failure of an API call, already classified for the user-facing message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// No bearer token configured; detected before any request is made.
    MissingApiKey,
    /// 401 — carries the API `message` (`API key expired`, `API key revoked`, `Invalid API key`, …).
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    /// 400 — Joi validation or business-rule message from the API.
    BadRequest(String),
    /// Any other error status that came with a well-formed API error body.
    Status {
        status: u16,
        message: String,
    },
    /// Connection refused, DNS failure, timeout, or the connection dropped mid-response.
    Unreachable {
        api_url: String,
        detail: String,
    },
    /// The server answered, but not with the API v1 JSON format (HTML page, other service, …).
    NotApi {
        api_url: String,
        status: u16,
    },
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::MissingApiKey => {
                write!(f, "no hay una API Key configurada: ejecuta `rserver login`")
            }
            ApiError::Unauthorized(message) => write!(
                f,
                "tu API Key expiró o fue revocada: ejecuta `rserver login` (API: {message})"
            ),
            ApiError::Forbidden(message) => write!(f, "permiso denegado: {message}"),
            ApiError::NotFound(message) => write!(f, "no encontrado: {message}"),
            ApiError::BadRequest(message) => write!(f, "petición rechazada por la API: {message}"),
            ApiError::Status { status, message } => {
                write!(f, "la API respondió HTTP {status}: {message}")
            }
            ApiError::Unreachable { api_url, detail } => write!(
                f,
                "no se pudo conectar con {api_url} ({detail}); verifica que el servidor esté en marcha o cambia la URL con `rserver set --api-url <url>`"
            ),
            ApiError::NotApi { api_url, status } => write!(
                f,
                "{api_url} respondió HTTP {status} sin el formato de la API v1; verifica la URL con `rserver set --api-url <url>`"
            ),
        }
    }
}

impl std::error::Error for ApiError {}

#[derive(Deserialize)]
struct SuccessBody<T> {
    data: T,
}

#[derive(Deserialize)]
struct ErrorBody {
    message: String,
}

/// Blocking client for `{api_url}/api/v1`. Every request sends `Authorization: Bearer <token>`;
/// without a token every method fails with [`ApiError::MissingApiKey`] before touching the network.
pub struct ApiClient {
    api_url: String,
    token: Option<String>,
    agent: Agent,
}

impl ApiClient {
    /// `token` is any bearer: the stored API Key, or a JWT during `login`/`logout`.
    pub fn new(api_url: impl Into<String>, token: Option<String>) -> Self {
        let agent = Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(GLOBAL_TIMEOUT))
            .http_status_as_error(false)
            .build()
            .into();
        Self {
            api_url: api_url.into(),
            token,
            agent,
        }
    }

    /// Authenticates with the stored API Key, if any.
    pub fn from_config(config: &Config) -> Self {
        Self::new(
            config.api_url.clone(),
            config.api_key.as_ref().map(|key| key.token.clone()),
        )
    }

    pub fn api_url(&self) -> &str {
        &self.api_url
    }

    /// `GET /api/v1/{segments…}?{query}`; returns the response `data`.
    pub fn get<T: DeserializeOwned>(
        &self,
        segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<T, ApiError> {
        let (token, url) = self.prepare(segments, query)?;
        let response = self
            .agent
            .get(url.as_str())
            .header("Authorization", bearer(token))
            .call();
        self.handle(response)
    }

    /// `POST /api/v1/{segments…}` with a JSON body; returns the response `data`.
    pub fn post<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        segments: &[&str],
        body: &B,
    ) -> Result<T, ApiError> {
        let (token, url) = self.prepare(segments, &[])?;
        let response = self
            .agent
            .post(url.as_str())
            .header("Authorization", bearer(token))
            .content_type("application/json")
            .send(to_json(body));
        self.handle(response)
    }

    /// `PATCH /api/v1/{segments…}` with a JSON body; returns the response `data`.
    pub fn patch<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        segments: &[&str],
        body: &B,
    ) -> Result<T, ApiError> {
        let (token, url) = self.prepare(segments, &[])?;
        let response = self
            .agent
            .patch(url.as_str())
            .header("Authorization", bearer(token))
            .content_type("application/json")
            .send(to_json(body));
        self.handle(response)
    }

    /// `DELETE /api/v1/{segments…}`; returns the response `data`.
    pub fn delete<T: DeserializeOwned>(&self, segments: &[&str]) -> Result<T, ApiError> {
        let (token, url) = self.prepare(segments, &[])?;
        let response = self
            .agent
            .delete(url.as_str())
            .header("Authorization", bearer(token))
            .call();
        self.handle(response)
    }

    /// `GET /redirects`. `offset` must be `None` instead of `0`: the API requires `offset >= 1`.
    pub fn list_redirects(
        &self,
        offset: Option<u32>,
        limit: u32,
        order_by: Option<&str>,
    ) -> Result<Vec<Redirect>, ApiError> {
        let mut query = vec![("limit", limit.to_string())];
        if let Some(offset) = offset {
            query.push(("offset", offset.to_string()));
        }
        if let Some(order_by) = order_by {
            query.push(("orderBy", order_by.to_string()));
        }
        // The collection route always exists in API v1, so a 404 here means api_url points at a
        // server without it (e.g. `main`, whose catch-all answers `/api/**` with a JSON 404).
        self.get(&["redirects"], &query).map_err(|err| match err {
            ApiError::NotFound(_) => ApiError::NotApi {
                api_url: self.api_url.clone(),
                status: 404,
            },
            other => other,
        })
    }

    /// `GET /redirects/:id`.
    pub fn get_redirect(&self, id: &str) -> Result<Redirect, ApiError> {
        self.get(&["redirects", id], &[])
    }

    fn prepare(
        &self,
        segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<(&str, Url), ApiError> {
        let token = self.token.as_deref().ok_or(ApiError::MissingApiKey)?;
        Ok((token, self.endpoint(segments, query)?))
    }

    /// Segments are percent-encoded, so an id containing `/` stays a single path segment.
    fn endpoint(&self, segments: &[&str], query: &[(&str, String)]) -> Result<Url, ApiError> {
        let mut url = Url::parse(&self.api_url).map_err(|err| ApiError::Unreachable {
            api_url: self.api_url.clone(),
            detail: format!("URL inválida: {err}"),
        })?;
        url.path_segments_mut()
            .map_err(|()| ApiError::Unreachable {
                api_url: self.api_url.clone(),
                detail: "la URL no admite rutas".to_string(),
            })?
            .pop_if_empty()
            .extend(API_PREFIX)
            .extend(segments);
        if !query.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(query.iter().map(|(key, value)| (key, value)));
        }
        Ok(url)
    }

    fn handle<T: DeserializeOwned>(
        &self,
        response: Result<Response<Body>, ureq::Error>,
    ) -> Result<T, ApiError> {
        let unreachable = |err: ureq::Error| ApiError::Unreachable {
            api_url: self.api_url.clone(),
            detail: err.to_string(),
        };
        let mut response = response.map_err(unreachable)?;
        let status = response.status().as_u16();
        let bytes = response.body_mut().read_to_vec().map_err(unreachable)?;
        let not_api = || ApiError::NotApi {
            api_url: self.api_url.clone(),
            status,
        };

        if (200..300).contains(&status) {
            return serde_json::from_slice::<SuccessBody<T>>(&bytes)
                .map(|body| body.data)
                .map_err(|_| not_api());
        }

        let message = serde_json::from_slice::<ErrorBody>(&bytes)
            .map_err(|_| not_api())?
            .message;
        Err(match status {
            400 => ApiError::BadRequest(message),
            401 => ApiError::Unauthorized(message),
            403 => ApiError::Forbidden(message),
            404 => ApiError::NotFound(message),
            _ => ApiError::Status { status, message },
        })
    }
}

/// Walks every page of `GET /redirects` with [`FETCH_ALL_PAGE_SIZE`].
pub fn fetch_all(client: &ApiClient) -> Result<Vec<Redirect>, ApiError> {
    fetch_all_with_page_size(client, FETCH_ALL_PAGE_SIZE)
}

/// [`fetch_all`] with an explicit page size; stops at the first page shorter than `page_size`.
pub fn fetch_all_with_page_size(
    client: &ApiClient,
    page_size: u32,
) -> Result<Vec<Redirect>, ApiError> {
    let mut all: Vec<Redirect> = Vec::new();
    loop {
        let offset = (!all.is_empty()).then_some(all.len() as u32);
        let page = client.list_redirects(offset, page_size, None)?;
        let is_last = page.len() < page_size as usize;
        all.extend(page);
        if is_last {
            return Ok(all);
        }
    }
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

fn to_json<B: Serialize + ?Sized>(body: &B) -> String {
    serde_json::to_string(body).expect("request bodies are plain data and always serialize")
}
