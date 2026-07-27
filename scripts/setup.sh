#!/usr/bin/env bash
#
# One-command setup. Checks your Node version, generates a token, writes
# .env if it doesn't exist, then starts the service and tells you where to
# finish the job on your phone.
#
#   ./scripts/setup.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

bold=$(tput bold 2>/dev/null || echo "")
dim=$(tput dim 2>/dev/null || echo "")
red=$(tput setaf 1 2>/dev/null || echo "")
green=$(tput setaf 2 2>/dev/null || echo "")
reset=$(tput sgr0 2>/dev/null || echo "")

say()  { printf "%s\n" "$*"; }
fail() { printf "%s%s%s\n" "$red" "$*" "$reset" >&2; exit 1; }
ok()   { printf "%s✓%s %s\n" "$green" "$reset" "$*"; }

say ""
say "${bold}Corpus Vivens — setup${reset}"
say ""

# ── Node ─────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail \
  "Node isn't installed. Install it with:  brew install node"

node_version=$(node -p "process.versions.node")
node_major=$(node -p "process.versions.node.split('.')[0]")
node_minor=$(node -p "process.versions.node.split('.')[1]")

if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 5 ]; }; then
  fail "Node $node_version is too old — this needs 22.5 or later (it uses the
built-in SQLite). Upgrade with:  brew upgrade node"
fi
ok "Node $node_version"

# ── .env ─────────────────────────────────────────────────────
if [ -f .env ]; then
  ok ".env already exists — leaving it alone"
else
  if command -v openssl >/dev/null 2>&1; then
    token=$(openssl rand -hex 32)
  else
    token=$(node -p "require('crypto').randomBytes(32).toString('hex')")
  fi
  sed "s|^INGEST_TOKEN=.*|INGEST_TOKEN=$token|" .env.example > .env
  chmod 600 .env
  ok "Wrote .env with a fresh token"
fi

# ── go ───────────────────────────────────────────────────────
port=$(grep -E '^PORT=' .env | cut -d= -f2 || true)
port=${port:-8080}

say ""
say "${bold}Starting the service.${reset}"
say ""
say "  Open ${bold}http://localhost:$port/setup${reset} on this Mac."
say "  ${dim}That page shows the exact URL and header to paste into Health${reset}"
say "  ${dim}Auto Export, and goes green when your phone's first sync lands.${reset}"
say ""
say "  ${dim}macOS will ask whether node may accept incoming connections.${reset}"
say "  ${dim}You must click Allow, or your phone cannot reach this.${reset}"
say ""

# Keep the Mac awake while the service is in the foreground, so posts
# from the phone aren't silently dropped during setup.
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -s npm start
else
  exec npm start
fi
