use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "rserver",
    version,
    about = "Administra los redirects de 1kg.me a través de la API v1"
)]
pub struct Cli {
    /// Emite solo el `data` de la respuesta como JSON en stdout
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Inicia sesión con Google y guarda una API Key de 90 días para esta máquina
    Login,
    /// Revoca la API Key de esta máquina en el servidor y la borra de la configuración
    Logout,
    /// Cambia la configuración local
    Set(SetArgs),
    /// Lista los redirects visibles, una página a la vez
    List(ListArgs),
    /// Muestra todos los campos de un redirect
    View(ViewArgs),
}

#[derive(Debug, Args)]
pub struct SetArgs {
    /// URL base del servidor (http o https), p. ej. https://1kg.me
    #[arg(long, value_name = "URL")]
    pub api_url: String,
}

/// Values accepted by `list --order`; a leading `-` sorts descending.
pub const ORDER_VALUES: [&str; 6] = [
    "created", "-created", "updated", "-updated", "path", "-path",
];

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Número de página, empezando en 1
    #[arg(long, value_name = "N", default_value_t = 1, value_parser = clap::value_parser!(u32).range(1..))]
    pub page: u32,

    /// Redirects por página
    #[arg(long, value_name = "N", default_value_t = 20, value_parser = clap::value_parser!(u32).range(1..))]
    pub limit: u32,

    /// Campo de orden: created, updated o path; con prefijo `-` es descendente
    #[arg(long, value_name = "CAMPO", allow_hyphen_values = true, value_parser = ORDER_VALUES)]
    pub order: Option<String>,
}

#[derive(Debug, Args)]
pub struct ViewArgs {
    /// Id del redirect, o su path completo empezando con `/` (p. ej. /fc/seminar)
    #[arg(value_name = "ID|PATH")]
    pub target: String,
}
