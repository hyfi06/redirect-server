use std::io::Write;

use anyhow::Result;
use serde::Serialize;

use crate::api::{ApiClient, Redirect};
use crate::cli::EditArgs;
use crate::output;
use crate::resolve::resolve_target;

/// Only the fields that change. `categories` is sent whole: the API replaces the array on `PATCH`.
#[derive(Serialize)]
struct EditBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    categories: Option<Vec<String>>,
}

/// Existing order is kept, new categories are appended without duplicates, then removals apply
/// (so a category both added and removed ends up absent). Removing a missing category is a no-op.
pub fn apply_category_changes(
    current: &[String],
    add: &[String],
    remove: &[String],
) -> Vec<String> {
    let mut result = current.to_vec();
    for category in add {
        if !result.contains(category) {
            result.push(category.clone());
        }
    }
    result.retain(|category| !remove.contains(category));
    result
}

/// Resolves the target and sends one `PATCH /redirects/:id` with the changed fields. When nothing
/// would change, no request is made: a notice goes to `stderr` and the current redirect is printed.
pub fn run(
    client: &ApiClient,
    args: &EditArgs,
    json: bool,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> Result<()> {
    let current = resolve_target(client, &args.target)?;
    let categories = apply_category_changes(
        &current.categories,
        &args.add_categories,
        &args.remove_categories,
    );
    let body = EditBody {
        url: args.url.as_deref().filter(|url| *url != current.url),
        categories: (categories != current.categories).then_some(categories),
    };

    let redirect = if body.url.is_none() && body.categories.is_none() {
        writeln!(
            stderr,
            "sin cambios: `{}` ya tiene esa URL y esas categorías; no se envió ninguna petición",
            current.path
        )?;
        current
    } else {
        client.patch::<_, Redirect>(&["redirects", &current.id], &body)?
    };

    if json {
        output::print_json(stdout, &redirect)
    } else {
        output::print_redirect_detail(stdout, &redirect)?;
        Ok(())
    }
}
