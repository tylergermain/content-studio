#!/bin/bash
# agent-office-serve sync [port...], for an office on a Mac with the Tailscale app: serve exactly these
# workers' ports on the tailnet, each pointed at the office (see src/server/tailnet.ts), so a teammate
# on the tailnet opens https://<this Mac>.ts.net:<port> and the office relays it to the worker's
# server once they're signed in. It only ever adds or takes away ports it added itself (kept in
# $STATE): whatever else this Mac serves (the office's own port among them) is never touched.
# Install it as ~/.local/bin/agent-office-serve and start the office with
# AGENT_OFFICE_SERVE_HELPER=~/.local/bin/agent-office-serve AGENT_OFFICE_TAILSCALE_HOST=<this Mac>.ts.net.
set -euo pipefail
TS=${TAILSCALE:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}
OFFICE=${AGENT_OFFICE_URL:-http://127.0.0.1:4600}
STATE=${AGENT_OFFICE_SERVE_STATE:-$HOME/.agent-office-serve-ports}
[[ "${1:-}" == sync ]] || { echo "usage: agent-office-serve sync [port...]" >&2; exit 64; }
shift
want=" "
for p in "$@"; do
  [[ "$p" =~ ^[0-9]{4,5}$ && $p -ge 1024 && $p -le 65535 ]] || { echo "not a port to serve: $p" >&2; exit 64; }
  want+="$p "
done
# One sync at a time.
exec 9>"$STATE.lock"
lockf -s 9 2>/dev/null || true
have=" $(cat "$STATE" 2>/dev/null || true) "
# What this Mac serves already that isn't ours: never taken over.
taken=" $("$TS" serve status --json 2>/dev/null | /usr/bin/python3 -c '
import json, sys
try: web = (json.load(sys.stdin) or {}).get("Web") or {}
except Exception: web = {}
print(" ".join(hp.rsplit(":", 1)[-1] for hp in web))' ) "
kept=""
for p in $have; do
  if [[ "$want" == *" $p "* ]]; then kept+="$p "; else "$TS" serve --yes --https="$p" off >/dev/null 2>&1 || true; fi
done
for p in $want; do
  [[ " $kept " == *" $p "* ]] && continue
  [[ "$taken" == *" $p "* ]] && continue
  "$TS" serve --bg --yes --https="$p" "$OFFICE" >/dev/null
  kept+="$p "
done
echo "$kept" > "$STATE"
