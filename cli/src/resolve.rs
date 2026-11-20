use anyhow::{anyhow, bail, Result};

use crate::api::{fetch_all, ApiClient, ApiError, Redirect};

/// An argument starting with `/` is a path, resolved by exact match over every page (the API has
/// no lookup by path); anything else is a Firestore id fetched with `GET /redirects/:id`.
pub fn resolve_target(client: &ApiClient, arg: &str) -> Result<Redirect> {
    if arg.is_empty() {
        bail!("indica el id o el path (empezando con `/`) del redirect");
    }
    if arg.starts_with('/') {
        return fetch_all(client)?
            .into_iter()
            .find(|redirect| redirect.path == arg)
            .ok_or_else(|| anyhow!("no se encontró un redirect con path `{arg}`"));
    }
    client.get_redirect(arg).map_err(|err| match err {
        ApiError::NotFound(_) => anyhow!(
            "no se encontró un redirect con id `{arg}`; si es un path, debe empezar con `/` (p. ej. `/{arg}`)"
        ),
        other => other.into(),
    })
}
