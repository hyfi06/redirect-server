use std::fs::{self, DirBuilder, OpenOptions, Permissions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

const DIR_NAME: &str = "rserver";
const FILE_NAME: &str = "config.toml";
const DIR_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Config {
    pub api_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<ApiKeyConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiKeyConfig {
    pub id: String,
    pub token: String,
}

/// `${XDG_CONFIG_HOME:-~/.config}/rserver/config.toml`. A relative `XDG_CONFIG_HOME` is ignored, as the XDG spec requires.
pub fn path() -> Result<PathBuf> {
    let base = match std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
        Some(dir) if dir.is_absolute() => dir,
        _ => dirs::home_dir()
            .ok_or_else(|| anyhow!("no se pudo determinar el directorio home del usuario"))?
            .join(".config"),
    };
    Ok(base.join(DIR_NAME).join(FILE_NAME))
}

pub fn load() -> Result<Config> {
    load_from(&path()?)
}

pub fn save(config: &Config) -> Result<()> {
    save_to(&path()?, config)
}

pub fn load_from(path: &Path) -> Result<Config> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => bail!(
            "no existe el archivo de configuración {}: ejecuta `npm run install:cli` o `rserver set --api-url <url>`",
            path.display()
        ),
        Err(err) => {
            return Err(err).with_context(|| format!("no se pudo leer {}", path.display()))
        }
    };
    toml::from_str(&content).with_context(|| {
        format!(
            "el archivo de configuración {} no es válido",
            path.display()
        )
    })
}

/// Writes through a temp file + rename so a failed write never leaves a truncated config behind.
pub fn save_to(path: &Path, config: &Config) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| anyhow!("ruta de configuración inválida: {}", path.display()))?;
    ensure_private_dir(dir)?;

    let content = toml::to_string(config).context("no se pudo serializar la configuración")?;
    let tmp_path = path.with_extension("toml.tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(FILE_MODE)
        .open(&tmp_path)
        .with_context(|| format!("no se pudo escribir {}", tmp_path.display()))?;
    // `mode()` only applies on creation; a leftover temp file could carry wider permissions.
    file.set_permissions(Permissions::from_mode(FILE_MODE))?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    fs::rename(&tmp_path, path)
        .with_context(|| format!("no se pudo escribir {}", path.display()))?;
    Ok(())
}

fn ensure_private_dir(dir: &Path) -> Result<()> {
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("no se pudo crear {}", parent.display()))?;
    }
    if !dir.exists() {
        DirBuilder::new()
            .mode(DIR_MODE)
            .create(dir)
            .with_context(|| format!("no se pudo crear {}", dir.display()))?;
    }
    fs::set_permissions(dir, Permissions::from_mode(DIR_MODE))
        .with_context(|| format!("no se pudieron ajustar los permisos de {}", dir.display()))?;
    Ok(())
}
