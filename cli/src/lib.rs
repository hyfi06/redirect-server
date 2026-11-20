pub mod api;
pub mod cli;
pub mod commands;
pub mod config;
pub mod output;
pub mod resolve;

use std::io::{IsTerminal, Write};
use std::time::SystemTime;

use anyhow::Result;

use api::ApiClient;
use cli::{Cli, Command};
use commands::auth::{AuthIo, StdinLineReader, SystemBrowser};
use commands::delete::ConfirmIo;

/// `stdout` and `stderr` are injected so tests can capture output, messages and warnings.
pub fn run(cli: Cli, stdout: &mut dyn Write, stderr: &mut dyn Write) -> Result<()> {
    match cli.command {
        Command::Login => {
            let hostname = commands::auth::hostname()?;
            let mut io = AuthIo {
                browser: &mut SystemBrowser,
                input: &mut StdinLineReader,
                stderr,
            };
            commands::auth::login(&config::path()?, &mut io, &hostname, SystemTime::now())
        }
        Command::Logout => {
            let mut io = AuthIo {
                browser: &mut SystemBrowser,
                input: &mut StdinLineReader,
                stderr,
            };
            commands::auth::logout(&config::path()?, &mut io)
        }
        Command::Set(args) => commands::set::run(&config::path()?, &args.api_url, stderr),
        Command::List(args) => commands::list::run(&configured_client()?, &args, cli.json, stdout),
        Command::View(args) => {
            commands::view::run(&configured_client()?, &args.target, cli.json, stdout)
        }
        Command::Create(args) => {
            commands::create::run(&configured_client()?, &args, cli.json, stdout)
        }
        Command::Edit(args) => {
            commands::edit::run(&configured_client()?, &args, cli.json, stdout, stderr)
        }
        Command::Delete(args) => {
            let mut io = ConfirmIo {
                stdin_is_terminal: std::io::stdin().is_terminal(),
                input: &mut StdinLineReader,
                stderr,
            };
            commands::delete::run(&configured_client()?, &args, cli.json, &mut io, stdout)
        }
    }
}

fn configured_client() -> Result<ApiClient> {
    Ok(ApiClient::from_config(&config::load()?))
}
