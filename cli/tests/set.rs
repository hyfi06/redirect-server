//! `rserver set --api-url` (`commands::set::run`) and `normalize_api_url`, against temp dirs.

use std::fs;
use std::path::{Path, PathBuf};

use rserver::commands::set::{normalize_api_url, run};
use rserver::config::{self, ApiKeyConfig, Config};
use tempfile::TempDir;

const WARNING: &str = "advertencia";

fn config_path(tmp: &TempDir) -> PathBuf {
    tmp.path().join("rserver").join("config.toml")
}

fn write_raw(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn key() -> ApiKeyConfig {
    ApiKeyConfig {
        id: "key-1".to_string(),
        token: "sk_1kg_token".to_string(),
    }
}

/// Runs `set` and returns `(result, stderr)`.
fn run_set(path: &Path, url: &str) -> (anyhow::Result<()>, String) {
    let mut stderr = Vec::new();
    let result = run(path, url, &mut stderr);
    (result, String::from_utf8(stderr).unwrap())
}

// ---------- normalize_api_url ----------

#[test]
fn normalize_strips_single_trailing_slash() {
    assert_eq!(
        normalize_api_url("http://localhost:3000/").unwrap(),
        "http://localhost:3000"
    );
}

#[test]
fn normalize_strips_multiple_trailing_slashes() {
    assert_eq!(
        normalize_api_url("https://1kg.me///").unwrap(),
        "https://1kg.me"
    );
}

#[test]
fn normalize_trims_surrounding_whitespace() {
    assert_eq!(
        normalize_api_url("  https://1kg.me/ \n").unwrap(),
        "https://1kg.me"
    );
}

#[test]
fn normalize_keeps_url_without_trailing_slash_unchanged() {
    assert_eq!(
        normalize_api_url("https://1kg.me").unwrap(),
        "https://1kg.me"
    );
}

#[test]
fn normalize_keeps_path_prefix_but_strips_its_trailing_slash() {
    assert_eq!(
        normalize_api_url("https://example.com/base/").unwrap(),
        "https://example.com/base"
    );
}

#[test]
fn normalize_rejects_non_http_scheme() {
    let err = normalize_api_url("ftp://x").unwrap_err();
    assert!(format!("{err:#}").contains("http o https"));
}

#[test]
fn normalize_rejects_unparseable_url() {
    let err = normalize_api_url("not a url").unwrap_err();
    assert!(format!("{err:#}").contains("URL inválida"));
}

#[test]
fn normalize_rejects_url_without_scheme() {
    assert!(normalize_api_url("localhost:3000").is_err());
}

#[test]
fn normalize_rejects_empty_input() {
    assert!(normalize_api_url("   ").is_err());
}

// ---------- set ----------

#[test]
fn set_on_missing_config_creates_it_with_normalized_url_and_no_key() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);

    let (result, _) = run_set(&path, "http://localhost:3000/");

    result.unwrap();
    assert_eq!(
        config::load_from(&path).unwrap(),
        Config {
            api_url: "http://localhost:3000".to_string(),
            api_key: None
        }
    );
}

#[test]
fn set_with_non_http_scheme_fails_and_leaves_file_byte_identical() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    let original = "api_url = \"https://1kg.me\"\n\n# hand-written comment\n[api_key]\nid = \"key-1\"\ntoken = \"sk_1kg_token\"\n";
    write_raw(&path, original);

    let (result, _) = run_set(&path, "ftp://x");

    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), original.as_bytes());
}

#[test]
fn set_with_non_http_scheme_on_missing_config_does_not_create_it() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);

    let (result, _) = run_set(&path, "ftp://x");

    assert!(result.is_err());
    assert!(!path.parent().unwrap().exists());
}

#[test]
fn set_with_invalid_toml_fails_without_overwriting_the_file() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    let original = "api_url = = broken\n";
    write_raw(&path, original);

    let (result, _) = run_set(&path, "https://1kg.me");

    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), original.as_bytes());
}

#[test]
fn set_changing_url_keeps_stored_api_key() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    config::save_to(
        &path,
        &Config {
            api_url: "https://old.example".to_string(),
            api_key: Some(key()),
        },
    )
    .unwrap();

    let (result, _) = run_set(&path, "https://new.example/");

    result.unwrap();
    assert_eq!(
        config::load_from(&path).unwrap(),
        Config {
            api_url: "https://new.example".to_string(),
            api_key: Some(key())
        }
    );
}

#[test]
fn set_changing_url_with_stored_key_warns_on_stderr_naming_old_server_and_login() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    config::save_to(
        &path,
        &Config {
            api_url: "https://old.example".to_string(),
            api_key: Some(key()),
        },
    )
    .unwrap();

    let (_, stderr) = run_set(&path, "https://new.example");

    assert!(stderr.contains(WARNING), "{stderr}");
    assert!(stderr.contains("https://old.example"), "{stderr}");
    assert!(stderr.contains("rserver login"), "{stderr}");
}

#[test]
fn set_with_same_url_and_stored_key_does_not_warn() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    config::save_to(
        &path,
        &Config {
            api_url: "https://1kg.me".to_string(),
            api_key: Some(key()),
        },
    )
    .unwrap();

    // Trailing slash normalizes to the stored URL, so it counts as the same URL.
    let (result, stderr) = run_set(&path, "https://1kg.me/");

    result.unwrap();
    assert!(!stderr.contains(WARNING), "{stderr}");
}

#[test]
fn set_changing_url_without_stored_key_does_not_warn() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    config::save_to(
        &path,
        &Config {
            api_url: "https://old.example".to_string(),
            api_key: None,
        },
    )
    .unwrap();

    let (result, stderr) = run_set(&path, "https://new.example");

    result.unwrap();
    assert!(!stderr.contains(WARNING), "{stderr}");
}

#[test]
fn set_confirms_saved_url_and_path_on_stderr() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);

    let (_, stderr) = run_set(&path, "https://1kg.me/");

    assert!(stderr.contains("https://1kg.me"), "{stderr}");
    assert!(stderr.contains(&path.display().to_string()), "{stderr}");
}

#[test]
fn set_writes_file_with_private_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);

    run_set(&path, "https://1kg.me").0.unwrap();

    let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    let dir_mode = fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!((file_mode, dir_mode), (0o600, 0o700));
}
