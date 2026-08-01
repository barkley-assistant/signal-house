#!/usr/bin/env bash
# Deploy Signal House V2 from the rewrite/bun-native branch to the live
# systemd service (port 8999).
#
#   live dir:  ~/.local/share/signal-house-v2   (checked out on the branch)
#   env file:  ~/.config/signal-house/.env       (shared with the service)
#   service:   signal-house.service              (user systemd unit)
#
# Safe to re-run: pulls the branch, installs, builds, restarts. The service
# runs from source (bun run src/server.ts) so a rebuild of dist/ is not
# strictly required, but keeping it current costs nothing.

set -euo pipefail

BRANCH="main"
LIVE_DIR="${SIGNAL_HOUSE_LIVE_DIR:-$HOME/.local/share/signal-house-v2}"
ENV_FILE="$HOME/.config/signal-house/.env"
SERVICE="signal-house.service"

echo "→ Signal House V2 deploy (branch: $BRANCH)"

if [ ! -d "$LIVE_DIR/.git" ]; then
  echo "→ cloning $BRANCH into $LIVE_DIR"
  git clone -b "$BRANCH" --single-branch \
    git@github.com:barkley-assistant/signal-house.git "$LIVE_DIR"
else
  echo "→ fetching + checking out $BRANCH"
  git -C "$LIVE_DIR" fetch origin "$BRANCH"
  git -C "$LIVE_DIR" checkout -f "$BRANCH"
  git -C "$LIVE_DIR" reset --hard "origin/$BRANCH"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "→ warning: $ENV_FILE missing — copying .env.example (no secrets!)"
  cp "$LIVE_DIR/.env.example" "$ENV_FILE"
fi

echo "→ installing dependencies"
(cd "$LIVE_DIR" && bun install --frozen-lockfile)

echo "→ building (web bundle + server)"
(cd "$LIVE_DIR" && bun run build)

echo "→ restarting $SERVICE"
systemctl --user restart "$SERVICE"

echo "→ waiting for health check"
for i in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://localhost:8999/api/health" >/dev/null 2>&1; then
    echo "→ live ✓ (commit: $(git -C "$LIVE_DIR" rev-parse --short HEAD) on $BRANCH)"
    exit 0
  fi
  sleep 1
done

echo "→ ERROR: service did not become healthy after deploy" >&2
journalctl --user -u "$SERVICE" --since "30 sec ago" --no-pager | tail -15 >&2
exit 1
