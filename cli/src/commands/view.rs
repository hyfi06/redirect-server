use std::io::Write;

use anyhow::Result;

use crate::api::ApiClient;
use crate::output;
use crate::resolve::resolve_target;

/// `target` is an id, or a path when it starts with `/` (see [`resolve_target`]).
pub fn run(client: &ApiClient, target: &str, json: bool, stdout: &mut dyn Write) -> Result<()> {
    let redirect = resolve_target(client, target)?;
    if json {
        output::print_json(stdout, &redirect)
    } else {
        output::print_redirect_detail(stdout, &redirect)?;
        Ok(())
    }
}
