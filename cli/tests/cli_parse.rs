//! Argument validation done by clap before any request (`Cli::try_parse_from`).

use clap::Parser;
use rserver::cli::{Cli, Command, ORDER_VALUES};

fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
    Cli::try_parse_from(std::iter::once("rserver").chain(args.iter().copied()))
}

fn list_args(args: &[&str]) -> rserver::cli::ListArgs {
    match parse(args).unwrap().command {
        Command::List(list) => list,
        other => panic!("expected list, got {other:?}"),
    }
}

#[test]
fn list_defaults_to_page_1_limit_20_and_no_order() {
    let args = list_args(&["list"]);
    assert_eq!((args.page, args.limit, args.order), (1, 20, None));
}

#[test]
fn list_accepts_page_limit_and_descending_order() {
    let args = list_args(&[
        "list", "--page", "3", "--limit", "10", "--order", "-created",
    ]);
    assert_eq!(
        (args.page, args.limit, args.order.as_deref()),
        (3, 10, Some("-created"))
    );
}

#[test]
fn list_accepts_every_documented_order_value() {
    let accepted: Vec<String> = ORDER_VALUES
        .iter()
        .filter_map(|value| list_args(&["list", "--order", value]).order)
        .collect();
    assert_eq!(accepted, ORDER_VALUES.to_vec());
}

#[test]
fn list_rejects_unknown_order() {
    assert!(parse(&["list", "--order", "foo"]).is_err());
}

#[test]
fn list_rejects_page_zero() {
    assert!(parse(&["list", "--page", "0"]).is_err());
}

#[test]
fn list_rejects_limit_zero() {
    assert!(parse(&["list", "--limit", "0"]).is_err());
}

#[test]
fn list_rejects_negative_page() {
    assert!(parse(&["list", "--page", "-1"]).is_err());
}

#[test]
fn json_flag_is_global_after_the_subcommand() {
    assert!(parse(&["list", "--json"]).unwrap().json);
}

#[test]
fn view_takes_the_target_positionally() {
    match parse(&["view", "/fc/seminar"]).unwrap().command {
        Command::View(view) => assert_eq!(view.target, "/fc/seminar"),
        other => panic!("expected view, got {other:?}"),
    }
}

#[test]
fn view_requires_a_target() {
    assert!(parse(&["view"]).is_err());
}
