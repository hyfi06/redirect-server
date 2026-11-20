use std::process::ExitCode;

use clap::Parser;
use rserver::cli::Cli;

fn main() -> ExitCode {
    let cli = Cli::parse();
    match rserver::run(cli, &mut std::io::stderr()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err:#}");
            ExitCode::FAILURE
        }
    }
}
