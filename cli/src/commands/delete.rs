use std::io::Write;

use anyhow::{bail, Result};

use crate::api::ApiClient;
use crate::cli::DeleteArgs;
use crate::commands::auth::LineReader;
use crate::output;
use crate::resolve::resolve_target;

/// Interactive side of `delete`, injected so tests can stub the terminal and the answer.
pub struct ConfirmIo<'a> {
    /// Whether stdin is an interactive terminal; without one (and without `--yes`) `delete` aborts.
    pub stdin_is_terminal: bool,
    pub input: &'a mut dyn LineReader,
    /// Prompt and messages.
    pub stderr: &'a mut dyn Write,
}

/// `y`/`yes` in any case; anything else, including an empty line or end of input, means no.
pub fn is_confirmation(answer: &str) -> bool {
    matches!(answer.trim().to_lowercase().as_str(), "y" | "yes")
}

/// Resolves the target, asks for confirmation unless `--yes`, then `DELETE /redirects/:id`.
/// Declining is not an error: nothing is deleted and nothing is printed on `stdout`.
/// `stdout` only receives the deleted id (the API's `data`) with `--json`; otherwise the
/// confirmation message goes to `stderr`.
pub fn run(
    client: &ApiClient,
    args: &DeleteArgs,
    json: bool,
    io: &mut ConfirmIo,
    stdout: &mut dyn Write,
) -> Result<()> {
    // Checked before any request so a pipe or script without `--yes` fails fast instead of hanging.
    if !args.yes && !io.stdin_is_terminal {
        bail!("stdin no es una terminal: usa `--yes` para borrar sin confirmación");
    }
    let redirect = resolve_target(client, &args.target)?;

    if !args.yes {
        write!(
            io.stderr,
            "¿Borrar definitivamente el redirect {} → {}? [y/N] ",
            redirect.path, redirect.url
        )?;
        io.stderr.flush()?;
        let answer = io.input.read_line()?.unwrap_or_default();
        if !is_confirmation(&answer) {
            writeln!(io.stderr, "Cancelado: no se borró nada.")?;
            return Ok(());
        }
    }

    let deleted_id: String = client.delete(&["redirects", &redirect.id])?;
    if json {
        output::print_json(stdout, &deleted_id)
    } else {
        writeln!(
            io.stderr,
            "Se borró el redirect {} (id {deleted_id})",
            redirect.path
        )?;
        Ok(())
    }
}
