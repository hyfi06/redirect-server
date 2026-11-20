//! `config::load_from` / `config::save_to` against temp directories (never the real `~/.config`).

use std::fs::{self, Permissions};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use rserver::config::{self, ApiKeyConfig, Config};
use tempfile::TempDir;

fn config_path(tmp: &TempDir) -> PathBuf {
    tmp.path().join("rserver").join("config.toml")
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn config_with_key() -> Config {
    Config {
        api_url: "https://1kg.me".to_string(),
        api_key: Some(ApiKeyConfig {
            id: "key-123".to_string(),
            token: "sk_1kg_secret".to_string(),
        }),
    }
}

#[test]
fn round_trip_without_api_key_returns_same_config() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    let original = Config {
        api_url: "http://localhost:3000".to_string(),
        api_key: None,
    };

    config::save_to(&path, &original).unwrap();

    assert_eq!(config::load_from(&path).unwrap(), original);
}

#[test]
fn round_trip_with_api_key_returns_same_config() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    let original = config_with_key();

    config::save_to(&path, &original).unwrap();

    assert_eq!(config::load_from(&path).unwrap(), original);
}

#[test]
fn save_without_api_key_omits_the_api_key_table() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    let cfg = Config {
        api_url: "http://localhost:3000".to_string(),
        api_key: None,
    };

    config::save_to(&path, &cfg).unwrap();

    assert!(!fs::read_to_string(&path).unwrap().contains("api_key"));
}

#[test]
fn save_creates_missing_directory_with_mode_700() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);

    config::save_to(&path, &config_with_key()).unwrap();

    assert_eq!(mode(path.parent().unwrap()), 0o700);
}

#[test]
fn save_creates_file_with_mode_600() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);

    config::save_to(&path, &config_with_key()).unwrap();

    assert_eq!(mode(&path), 0o600);
}

#[test]
fn save_tightens_preexisting_644_file_to_600() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "api_url = \"http://old\"\n").unwrap();
    fs::set_permissions(&path, Permissions::from_mode(0o644)).unwrap();

    config::save_to(&path, &config_with_key()).unwrap();

    assert_eq!(mode(&path), 0o600);
}

#[test]
fn save_tightens_preexisting_755_directory_to_700() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    let dir = path.parent().unwrap();
    fs::create_dir_all(dir).unwrap();
    fs::set_permissions(dir, Permissions::from_mode(0o755)).unwrap();

    config::save_to(&path, &config_with_key()).unwrap();

    assert_eq!(mode(dir), 0o700);
}

#[test]
fn save_overwrites_previous_content_and_leaves_no_temp_file() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    config::save_to(&path, &config_with_key()).unwrap();
    let updated = Config {
        api_url: "https://other.example".to_string(),
        api_key: None,
    };

    config::save_to(&path, &updated).unwrap();

    let entries: Vec<_> = fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(config::load_from(&path).unwrap(), updated);
    assert_eq!(entries, vec![std::ffi::OsString::from("config.toml")]);
}

#[test]
fn load_from_missing_file_suggests_install_or_set() {
    let tmp = TempDir::new().unwrap();

    let err = config::load_from(&config_path(&tmp)).unwrap_err();

    let msg = format!("{err:#}");
    assert!(msg.contains("npm run install:cli"), "{msg}");
    assert!(msg.contains("rserver set --api-url"), "{msg}");
}

#[test]
fn load_from_invalid_toml_fails_naming_the_file() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "this is = = not toml").unwrap();

    let err = config::load_from(&path).unwrap_err();

    assert!(format!("{err:#}").contains(&path.display().to_string()));
}

#[test]
fn load_from_toml_without_api_url_fails() {
    let tmp = TempDir::new().unwrap();
    let path = config_path(&tmp);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "[api_key]\nid = \"a\"\ntoken = \"b\"\n").unwrap();

    assert!(config::load_from(&path).is_err());
}
