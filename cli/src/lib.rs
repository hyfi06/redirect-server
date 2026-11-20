pub mod cli;
pub mod commands;
pub mod config;

use std::io::Write;

use anyhow::Result;

use cli::{Cli, Command};

pub fn run(cli: Cli, stderr: &mut dyn Write) -> Result<()> {
    match cli.command {
        Command::Set(args) => commands::set::run(&config::path()?, &args.api_url, stderr),
    }
}
