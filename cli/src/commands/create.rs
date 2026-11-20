use std::io::Write;

use anyhow::Result;
use serde::Serialize;

use crate::api::{ApiClient, ApiError, Redirect};
use crate::cli::CreateArgs;
use crate::output;

/// 404 message of `POST /redirects` when the `--group` slug does not exist (or was deleted).
const GROUP_NOT_FOUND: &str = "Group not found";

/// Only the fields the user passed: validation (path format, url, permission format) is the API's.
#[derive(Serialize)]
struct CreateBody<'a> {
    path: &'a str,
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<&'a str>,
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    categories: &'a [String],
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    permission: &'a [String],
}

/// `POST /redirects`; prints the created redirect (detail, or its `data` with `--json`).
pub fn run(
    client: &ApiClient,
    args: &CreateArgs,
    json: bool,
    stdout: &mut dyn Write,
) -> Result<()> {
    let body = CreateBody {
        path: &args.path,
        url: &args.url,
        group: args.group.as_deref(),
        categories: &args.categories,
        permission: &args.permissions,
    };
    let created: Redirect = client
        .post(&["redirects"], &body)
        .map_err(|err| match err {
            // The collection route always exists in API v1, so apart from the API's own
            // "Group not found" a 404 means api_url points at a server without it.
            ApiError::NotFound(message) if message != GROUP_NOT_FOUND => ApiError::NotApi {
                api_url: client.api_url().to_string(),
                status: 404,
            },
            other => other,
        })?;
    if json {
        output::print_json(stdout, &created)
    } else {
        output::print_redirect_detail(stdout, &created)?;
        Ok(())
    }
}
