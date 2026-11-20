use std::io::Write;

use anyhow::Result;
use clap::CommandFactory;
use clap_complete::{generate, shells::Bash};

use crate::cli::{Cli, CompletionShell};

const BIN_NAME: &str = "rserver";

/// Writes the completion script generated from the clap definition, so it never drifts from the real arguments.
pub fn run(shell: CompletionShell, stdout: &mut dyn Write) -> Result<()> {
    match shell {
        CompletionShell::Bash => generate(Bash, &mut Cli::command(), BIN_NAME, stdout),
    }
    Ok(())
}
