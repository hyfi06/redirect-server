use clap::{ArgGroup, Args, Parser, Subcommand};

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
    /// Crea un redirect
    Create(CreateArgs),
    /// Cambia la URL de destino o las categorías de un redirect
    Edit(EditArgs),
    /// Borra un redirect de forma definitiva
    Delete(DeleteArgs),
    /// Busca entre todos los redirects visibles; varios filtros se combinan (AND)
    Search(SearchArgs),
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

#[derive(Debug, Args)]
pub struct CreateArgs {
    /// Path sin `/` inicial; con --group, sin el prefijo del grupo (p. ej. seminar)
    #[arg(value_name = "PATH")]
    pub path: String,

    /// URL de destino
    #[arg(value_name = "URL")]
    pub url: String,

    /// Slug del grupo; la API construye /{grupo}/{path}
    #[arg(long, value_name = "SLUG")]
    pub group: Option<String>,

    /// Categoría (repetible)
    #[arg(long = "category", value_name = "CATEGORIA")]
    pub categories: Vec<String>,

    /// Permiso `read|edit|delete:<grupo>` (repetible)
    #[arg(long = "perm", value_name = "SCOPE:GRUPO")]
    pub permissions: Vec<String>,
}

#[derive(Debug, Args)]
#[command(group(
    ArgGroup::new("changes")
        .required(true)
        .multiple(true)
        .args(["url", "add_categories", "remove_categories"])
))]
pub struct EditArgs {
    /// Id del redirect, o su path completo empezando con `/` (p. ej. /fc/seminar)
    #[arg(value_name = "ID|PATH")]
    pub target: String,

    /// Nueva URL de destino
    #[arg(long, value_name = "URL")]
    pub url: Option<String>,

    /// Categoría a agregar (repetible)
    #[arg(long = "add-category", value_name = "CATEGORIA")]
    pub add_categories: Vec<String>,

    /// Categoría a quitar (repetible); quitar una que no existe no es error
    #[arg(long = "remove-category", value_name = "CATEGORIA")]
    pub remove_categories: Vec<String>,
}

#[derive(Debug, Args)]
pub struct DeleteArgs {
    /// Id del redirect, o su path completo empezando con `/` (p. ej. /fc/seminar)
    #[arg(value_name = "ID|PATH")]
    pub target: String,

    /// Borra sin pedir confirmación (obligatorio si stdin no es una terminal)
    #[arg(long)]
    pub yes: bool,
}

#[derive(Debug, Args)]
#[command(group(
    ArgGroup::new("filters")
        .required(true)
        .multiple(true)
        .args(["path", "url", "category"])
))]
pub struct SearchArgs {
    /// Fragmento del path, sin distinguir mayúsculas
    #[arg(long, value_name = "TEXTO")]
    pub path: Option<String>,

    /// Fragmento de la URL de destino, sin distinguir mayúsculas
    #[arg(long, value_name = "TEXTO")]
    pub url: Option<String>,

    /// Categoría exacta (distingue mayúsculas)
    #[arg(long, value_name = "CATEGORIA")]
    pub category: Option<String>,
}
