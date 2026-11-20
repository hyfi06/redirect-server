use std::io::Write;

use anyhow::{anyhow, Result};

use crate::api::ApiClient;
use crate::cli::ListArgs;
use crate::output;

/// `GET /redirects` for one page. `offset` is omitted on the first page because the API rejects `0`.
pub fn run(client: &ApiClient, args: &ListArgs, json: bool, stdout: &mut dyn Write) -> Result<()> {
    let offset = (args.page - 1).checked_mul(args.limit).ok_or_else(|| {
        anyhow!(
            "--page {} con --limit {} excede el máximo",
            args.page,
            args.limit
        )
    })?;
    let redirects = client.list_redirects(
        (offset > 0).then_some(offset),
        args.limit,
        args.order.as_deref(),
    )?;
    if json {
        output::print_json(stdout, &redirects)
    } else {
        output::print_redirect_table(stdout, &redirects)?;
        Ok(())
    }
}
