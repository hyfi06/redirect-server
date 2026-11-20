use std::io::{self, Write};

use anyhow::Result;
use serde::Serialize;

use crate::api::Redirect;

const TABLE_HEADERS: [&str; 3] = ["ID", "PATH", "URL"];
const EMPTY_FIELD: &str = "-";

/// Table with only the `id`, `path` and `url` columns, as `list` and `search` show it.
pub fn print_redirect_table(out: &mut dyn Write, redirects: &[Redirect]) -> io::Result<()> {
    let rows: Vec<[&str; 3]> = redirects
        .iter()
        .map(|r| [r.id.as_str(), r.path.as_str(), r.url.as_str()])
        .collect();
    let mut widths = TABLE_HEADERS.map(|header| header.chars().count());
    for row in &rows {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(cell.chars().count());
        }
    }
    for row in std::iter::once(&TABLE_HEADERS).chain(&rows) {
        // The last column is not padded so lines carry no trailing spaces.
        writeln!(
            out,
            "{:<id_w$}  {:<path_w$}  {}",
            row[0],
            row[1],
            row[2],
            id_w = widths[0],
            path_w = widths[1]
        )?;
    }
    Ok(())
}

/// Every field of a redirect, one per line.
pub fn print_redirect_detail(out: &mut dyn Write, redirect: &Redirect) -> io::Result<()> {
    let fields = [
        ("id", redirect.id.clone()),
        ("path", redirect.path.clone()),
        ("url", redirect.url.clone()),
        ("owner", redirect.owner.clone()),
        ("categories", join_or_empty(&redirect.categories)),
        ("permission", join_or_empty(&redirect.permission)),
        ("clickCount", redirect.click_count.unwrap_or(0).to_string()),
        ("created", format_timestamp(&redirect.created)),
        ("updated", format_timestamp(&redirect.updated)),
    ];
    let width = fields
        .iter()
        .map(|(label, _)| label.len())
        .max()
        .unwrap_or(0);
    for (label, value) in fields {
        writeln!(out, "{label:<width$}  {value}")?;
    }
    Ok(())
}

/// `--json` output: the API `data`, pretty-printed and nothing else.
pub fn print_json<T: Serialize + ?Sized>(out: &mut dyn Write, data: &T) -> Result<()> {
    serde_json::to_writer_pretty(&mut *out, data)?;
    writeln!(out)?;
    Ok(())
}

/// `2026-11-19T12:34:56.789Z` → `2026-11-19 12:34:56 UTC`; anything else is returned unchanged.
pub fn format_timestamp(iso: &str) -> String {
    let Some(utc) = iso.strip_suffix('Z') else {
        return iso.to_string();
    };
    let without_millis = utc.split('.').next().unwrap_or(utc);
    match without_millis.split_once('T') {
        Some((date, time)) if date.len() == 10 && time.len() == 8 => format!("{date} {time} UTC"),
        _ => iso.to_string(),
    }
}

fn join_or_empty(items: &[String]) -> String {
    if items.is_empty() {
        EMPTY_FIELD.to_string()
    } else {
        items.join(", ")
    }
}
