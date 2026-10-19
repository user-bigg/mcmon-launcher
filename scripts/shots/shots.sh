#!/usr/bin/env bash
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
out="${SHOTS_OUT:-$repo/dist/shots}"
all=(main offline stale prepare-offline load-welcome load-home load-catalog load-server load-launch)

usage() {
  cat <<'EOF'
Usage: npm run shots -- [--out DIR] <scene|all>...

Scenes are scripts/shots/scenes/<scene>.json (or a path to a .json file).
"all" runs: main offline stale prepare-offline load-*; prepare, demo, skins, load-skins and login* run only by name.
A step may answer IPC channels itself ("ipc": {"channel": answer}, {"$in": ms} is a time from now)
and push an event ("send": ["channel", payload]): login shows its states without a browser.
"clock": "<ISO time>" moves the page clock from the next reload on (null puts it back).
Screenshots go to DIR (default dist/shots), logs to DIR/logs, profiles to DIR/profiles.
The staging site and its certificate come from .env (MCMONITOR_API_BASE, NODE_EXTRA_CA_CERTS).
Needs a build: npm run build (or SHOT_MAIN=<path to main/index.js>).
EOF
}

scenes=()
while (($# > 0)); do
  case "$1" in
    --out)
      out="$2"
      shift 2
      ;;
    --out=*)
      out="${1#--out=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    all)
      scenes+=("${all[@]}")
      shift
      ;;
    *)
      scenes+=("$1")
      shift
      ;;
  esac
done

if ((${#scenes[@]} == 0)); then
  usage
  exit 2
fi

env_file() {
  if [[ -n "${SHOTS_ENV:-}" ]]; then
    echo "$SHOTS_ENV"
    return
  fi
  if [[ -f "$repo/.env" ]]; then
    echo "$repo/.env"
    return
  fi
  local common
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"
  echo "$(dirname "$common")/.env"
}

load_env() {
  local file="$1" line key value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%\"}"
    value="${value#\"}"
    if [[ -n "$value" && -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done <"$file"
}

load_env "$(env_file)"

main="${SHOT_MAIN:-$repo/out/main/index.js}"
if [[ ! -f "$main" ]]; then
  echo "No build at $main: run npm run build first" >&2
  exit 2
fi

electron="$repo/node_modules/.bin/electron"
mkdir -p "$out/logs"
failed=0

for name in "${scenes[@]}"; do
  if [[ "$name" == *.json ]]; then
    file="$(cd "$(dirname "$name")" && pwd)/$(basename "$name")"
  else
    file="$here/scenes/$name.json"
  fi
  if [[ ! -f "$file" ]]; then
    echo "== $name: no scene $file" >&2
    failed=1
    continue
  fi
  log="$out/logs/$(basename "$file" .json).log"
  echo "== $name"
  (
    cd "$repo" &&
      SHOT_REPO="$repo" SHOT_DIR="$out" SHOT_SCENE="$file" SHOT_MAIN="$main" \
        "$electron" "$here/shot.mjs" 2>&1
  ) | grep -v 'Electron Security Warning' >"$log"
  grep -E '^\[shot\] ([0-9A-Za-z_-]+ [0-9]+x[0-9]+$|WARN|ERROR|note|timeout)' "$log"
  if grep -qE '^\[shot\] (WARN|ERROR|timeout)' "$log"; then
    failed=1
  fi
done

echo "screenshots: $out"
exit "$failed"
