use std::io::Write;

use anyhow::Result;

use crate::api::{fetch_all, ApiClient, Redirect};
use crate::cli::SearchArgs;
use crate::output;

/// Keeps the redirects that satisfy every given filter (AND). `path` and `url` match a fragment
/// ignoring case; `category` must equal one of the redirect's categories exactly (case-sensitive).
/// A `None` filter does not restrict.
pub fn filter_redirects(
    items: Vec<Redirect>,
    path: Option<&str>,
    url: Option<&str>,
    category: Option<&str>,
) -> Vec<Redirect> {
    let path = path.map(str::to_lowercase);
    let url = url.map(str::to_lowercase);
    items
        .into_iter()
        .filter(|redirect| {
            path.as_ref()
                .is_none_or(|fragment| redirect.path.to_lowercase().contains(fragment))
                && url
                    .as_ref()
                    .is_none_or(|fragment| redirect.url.to_lowercase().contains(fragment))
                && category.is_none_or(|wanted| redirect.categories.iter().any(|c| c == wanted))
        })
        .collect()
}

/// Reads every page of `GET /redirects` and filters locally (the API has no search). With no
/// matches the exit code is still 0: an empty table plus a notice on `stderr`, or `[]` with `--json`.
pub fn run(
    client: &ApiClient,
    args: &SearchArgs,
    json: bool,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> Result<()> {
    let matches = filter_redirects(
        fetch_all(client)?,
        args.path.as_deref(),
        args.url.as_deref(),
        args.category.as_deref(),
    );
    if json {
        return output::print_json(stdout, &matches);
    }
    output::print_redirect_table(stdout, &matches)?;
    if matches.is_empty() {
        writeln!(stderr, "no se encontraron redirects con esos filtros")?;
    }
    Ok(())
}
