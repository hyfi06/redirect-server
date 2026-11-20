# rserver

CLI para administrar los redirects de 1kg.me a través de la API v1. Toda escritura pasa por las validaciones y permisos de la API; el CLI nunca toca Firestore.

## Instalación

Requisitos: `cargo` (Rust vía [rustup](https://rustup.rs)) y `bash-completion` 2.x para el autocompletado.

```bash
npm run install:cli
```

El script compila en modo release, instala el binario en `~/.local/bin/rserver`, crea la config con `api_url = https://1kg.me` solo si no existe e instala el completion en `${XDG_DATA_HOME:-~/.local/share}/bash-completion/completions/rserver`. Se puede ejecutar de nuevo para actualizar; la config existente se conserva.

La config vive en `${XDG_CONFIG_HOME:-~/.config}/rserver/config.toml` (modo `600`).

## Primer uso

```bash
# Mientras la API de dev no esté en producción, apunta al servidor local
rserver set --api-url http://localhost:3000

# Abre Google en el navegador; pega el token del JSON del callback.
# Guarda una API Key de 90 días llamada rserver@<hostname>.
rserver login
```

Cuando la key expire o sea revocada, los comandos piden ejecutar `rserver login` de nuevo.

## Comandos

`<ID|PATH>` acepta el id del redirect o su path completo empezando con `/`. Sin `/` inicial se trata como id.

```bash
# Lista paginada (20 por página); orden: created, updated o path, con `-` descendente
rserver list --page 2 --limit 50 --order -created

# Todos los campos de un redirect
rserver view /fc/seminar

# Búsqueda en todos los redirects visibles; los filtros se combinan (AND).
# --path y --url: fragmento sin distinguir mayúsculas; --category: exacta
rserver search --path fc --category eventos

# Crea /fc/seminar dentro del grupo fc
rserver create seminar https://example.com/seminario --group fc \
  --category eventos --perm read:fc

# Cambia la URL y las categorías en un solo PATCH
rserver edit /fc/seminar --url https://example.com/nuevo \
  --add-category 2026 --remove-category eventos

# Pide confirmación; --yes es obligatorio si stdin no es una terminal
rserver delete /fc/seminar --yes

# Revoca la API Key en el servidor (pide un JWT de nuevo) y la borra de la config
rserver logout

# Cambia el servidor
rserver set --api-url https://1kg.me

# Script de autocompletado (solo bash); el instalador ya lo deja en su lugar
rserver completions bash > ~/.local/share/bash-completion/completions/rserver
```

### Salida JSON

`--json` emite solo el `data` de la respuesta en stdout; mensajes y advertencias van a stderr.

```bash
rserver search --url drive.google --json | jq -r '.[].path'
rserver view /fc/seminar --json | jq '.clickCount'
```

## Desarrollo

```bash
cd cli
cargo test         # servidor HTTP mock local en tests/common/, sin red real
cargo fmt --check
```
