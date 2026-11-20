use std::io::Write;
use std::path::Path;

use anyhow::{bail, Context, Result};
use url::Url;

use crate::config::{self, Config};

/// Validates the scheme (`http`/`https`) and strips trailing `/`.
pub fn normalize_api_url(input: &str) -> Result<String> {
    let trimmed = input.trim();
    let parsed = Url::parse(trimmed).with_context(|| format!("URL inválida: {trimmed}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("la URL debe usar http o https: {trimmed}");
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

/// Creates the config file when missing; keeps a stored API key but warns when the URL changes.
pub fn run(config_path: &Path, api_url: &str, stderr: &mut dyn Write) -> Result<()> {
    let api_url = normalize_api_url(api_url)?;

    let config = if config_path.try_exists()? {
        let mut existing = config::load_from(config_path)?;
        if existing.api_key.is_some() && existing.api_url != api_url {
            writeln!(
                stderr,
                "advertencia: la API Key guardada pertenece a {}; probablemente debas ejecutar `rserver login`",
                existing.api_url
            )?;
        }
        existing.api_url = api_url;
        existing
    } else {
        Config {
            api_url,
            api_key: None,
        }
    };

    config::save_to(config_path, &config)?;
    writeln!(
        stderr,
        "api_url = {} guardada en {}",
        config.api_url,
        config_path.display()
    )?;
    Ok(())
}
