pub mod api;
pub mod cli;
pub mod commands;
pub mod config;
pub mod output;
pub mod resolve;

use std::io::Write;

use anyhow::Result;

use api::ApiClient;
use cli::{Cli, Command};

/// `stdout` and `stderr` are injected so tests can capture output, messages and warnings.
pub fn run(cli: Cli, stdout: &mut dyn Write, stderr: &mut dyn Write) -> Result<()> {
    match cli.command {
        Command::Set(args) => commands::set::run(&config::path()?, &args.api_url, stderr),
        Command::List(args) => commands::list::run(&configured_client()?, &args, cli.json, stdout),
        Command::View(args) => {
            commands::view::run(&configured_client()?, &args.target, cli.json, stdout)
        }
    }
}

fn configured_client() -> Result<ApiClient> {
    Ok(ApiClient::from_config(&config::load()?))
}
