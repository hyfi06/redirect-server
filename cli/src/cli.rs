use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "rserver", version, about = "Administra los redirects de 1kg.me a través de la API v1")]
pub struct Cli {
    /// Emite solo el `data` de la respuesta como JSON en stdout
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Cambia la configuración local
    Set(SetArgs),
}

#[derive(Debug, Args)]
pub struct SetArgs {
    /// URL base del servidor (http o https), p. ej. https://1kg.me
    #[arg(long, value_name = "URL")]
    pub api_url: String,
}
