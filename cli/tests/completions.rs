//! `rserver completions bash`: generated from the real clap definition.

use std::process::Command;

#[test]
fn bash_completion_exits_zero_and_lists_every_subcommand() {
    let output = Command::new(env!("CARGO_BIN_EXE_rserver"))
        .args(["completions", "bash"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");

    let script = String::from_utf8(output.stdout).unwrap();
    assert!(script.contains("complete -F _rserver"), "{script}");
    for sub in [
        "list", "view", "create", "edit", "delete", "search", "login", "logout", "set",
    ] {
        assert!(script.contains(sub), "missing subcommand `{sub}`");
    }
}

#[test]
fn only_bash_is_supported() {
    let output = Command::new(env!("CARGO_BIN_EXE_rserver"))
        .args(["completions", "zsh"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
}
