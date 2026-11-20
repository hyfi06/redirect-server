#!/usr/bin/env bash
# Builds rserver and installs it for the current user. Safe to run repeatedly:
# rebuilds, replaces the binary and the completion, and never touches an existing config.
set -euo pipefail

readonly DEFAULT_API_URL="https://1kg.me"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate_dir="${repo_root}/cli"
bin_dir="${HOME}/.local/bin"
bin_path="${bin_dir}/rserver"

# A relative XDG_* value is ignored, as the XDG spec requires (same rule as cli/src/config.rs).
xdg_dir() {
  local value="$1" fallback="$2"
  if [[ "${value}" == /* ]]; then
    printf '%s' "${value}"
  else
    printf '%s' "${fallback}"
  fi
}

config_path="$(xdg_dir "${XDG_CONFIG_HOME:-}" "${HOME}/.config")/rserver/config.toml"
completion_dir="$(xdg_dir "${XDG_DATA_HOME:-}" "${HOME}/.local/share")/bash-completion/completions"
completion_path="${completion_dir}/rserver"

if ! command -v cargo >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: no se encontró `cargo`.
Instala Rust con rustup (https://rustup.rs):
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
y abre una terminal nueva (o ejecuta `source "$HOME/.cargo/env"`) antes de reintentar.
EOF
  exit 1
fi

echo "==> Compilando rserver (cargo build --release)"
cargo build --release --manifest-path "${crate_dir}/Cargo.toml"

echo "==> Instalando ${bin_path}"
mkdir -p "${bin_dir}"
# Copy then rename: replacing the inode atomically keeps a running rserver intact.
tmp_bin="$(mktemp "${bin_dir}/.rserver.XXXXXX")"
trap 'rm -f "${tmp_bin}"' EXIT
install -m 755 "${crate_dir}/target/release/rserver" "${tmp_bin}"
mv -f "${tmp_bin}" "${bin_path}"
trap - EXIT

case ":${PATH}:" in
  *":${bin_dir}:"*) path_ok=true ;;
  *) path_ok=false ;;
esac

if [[ -e "${config_path}" ]]; then
  echo "==> Se conserva la configuración existente: ${config_path}"
  config_created=false
else
  echo "==> Creando ${config_path} con api_url = ${DEFAULT_API_URL}"
  "${bin_path}" set --api-url "${DEFAULT_API_URL}"
  config_created=true
fi

echo "==> Instalando bash completion en ${completion_path}"
mkdir -p "${completion_dir}"
tmp_completion="$(mktemp "${completion_dir}/.rserver.XXXXXX")"
trap 'rm -f "${tmp_completion}"' EXIT
"${bin_path}" completions bash >"${tmp_completion}"
chmod 644 "${tmp_completion}"
mv -f "${tmp_completion}" "${completion_path}"
trap - EXIT

echo
echo "rserver instalado."
if [[ "${path_ok}" == false ]]; then
  echo "Advertencia: ${bin_dir} no está en tu PATH. Agrega a tu ~/.bashrc:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
echo "Siguientes pasos:"
if [[ "${config_created}" == true ]]; then
  echo "  - Mientras la API de dev no esté en producción, apunta al servidor local:"
  echo "      rserver set --api-url http://localhost:3000"
fi
echo "  - Inicia sesión: rserver login"
echo "  - El autocompletado se activa en terminales nuevas (requiere bash-completion 2.x)."
