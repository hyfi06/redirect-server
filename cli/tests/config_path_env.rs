//! `config::path()`, `config::load()` and `config::save()` read process-global env vars
//! (`XDG_CONFIG_HOME`, `HOME`). Each file under `tests/` is its own process, and this file holds a
//! single `#[test]`, so mutating the environment here cannot race with any other test.
//! `HOME` is always pointed at a temp dir, so the real `~/.config` is never touched.

use std::env;
use std::path::PathBuf;

use rserver::config::{self, ApiKeyConfig, Config};
use tempfile::TempDir;

#[test]
fn path_resolution_respects_xdg_config_home_and_falls_back_to_home() {
    let home = TempDir::new().unwrap();
    let xdg = TempDir::new().unwrap();
    env::set_var("HOME", home.path());

    // Absolute XDG_CONFIG_HOME is used as the base directory.
    env::set_var("XDG_CONFIG_HOME", xdg.path());
    assert_eq!(
        config::path().unwrap(),
        xdg.path().join("rserver").join("config.toml"),
        "absolute XDG_CONFIG_HOME must be respected"
    );

    // save()/load() go through path(), so they land under XDG_CONFIG_HOME.
    let cfg = Config {
        api_url: "https://1kg.me".to_string(),
        api_key: Some(ApiKeyConfig {
            id: "k1".to_string(),
            token: "sk_1kg_x".to_string(),
        }),
    };
    config::save(&cfg).unwrap();
    assert!(xdg.path().join("rserver").join("config.toml").is_file());
    assert_eq!(config::load().unwrap(), cfg);
    assert!(!home.path().join(".config").exists());

    // Relative XDG_CONFIG_HOME is ignored (XDG spec) and ~/.config is used instead.
    env::set_var("XDG_CONFIG_HOME", "relative/dir");
    assert_eq!(
        config::path().unwrap(),
        home.path()
            .join(".config")
            .join("rserver")
            .join("config.toml"),
        "relative XDG_CONFIG_HOME must be ignored"
    );

    // Empty XDG_CONFIG_HOME is also relative, so ignored.
    env::set_var("XDG_CONFIG_HOME", "");
    assert_eq!(
        config::path().unwrap(),
        home.path()
            .join(".config")
            .join("rserver")
            .join("config.toml"),
        "empty XDG_CONFIG_HOME must be ignored"
    );

    // Unset XDG_CONFIG_HOME falls back to ~/.config.
    env::remove_var("XDG_CONFIG_HOME");
    let expected: PathBuf = home
        .path()
        .join(".config")
        .join("rserver")
        .join("config.toml");
    assert_eq!(
        config::path().unwrap(),
        expected,
        "unset XDG_CONFIG_HOME falls back to HOME"
    );
}
