#!/usr/bin/env bash
# Deploys the newest commit of a branch on the VPS. Run it as root or with sudo:
#
#   sudo bash /srv/call-harbison/current/deploy/deploy.sh
#
# Each deploy gets its own folder under releases/. Install, tests and build all happen there, so the live site
# is never touched until the new one is ready. Then "current" is switched over, the service restarts, and the
# script checks that the site answers. If it does not, the previous release is put back.
#
# Settings (environment variables, all optional):
#   APP_ROOT=/srv/call-harbison   APP_USER=callharbison   ENV_FILE=/etc/call-harbison.env
#   SERVICE=call-harbison         BRANCH=main             KEEP=5 (releases to keep)
#   SKIP_TESTS=1    skip the test suite (CI already runs it on every push)
#   SKIP_RESTART=1  build and switch, but leave the service alone
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/call-harbison}"
APP_USER="${APP_USER:-callharbison}"
ENV_FILE="${ENV_FILE:-/etc/call-harbison.env}"
SERVICE="${SERVICE:-call-harbison}"
BRANCH="${BRANCH:-main}"
KEEP="${KEEP:-5}"

REPO="$APP_ROOT/repo"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nDeploy stopped: %s\n' "$*" >&2; exit 1; }

# Everything that touches the code runs as the app user, never as root.
as_app() {
  if [ "$(id -un)" = "$APP_USER" ]; then "$@"; else sudo -u "$APP_USER" -H "$@"; fi
}
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

[ -d "$REPO/.git" ] || [ -f "$REPO/HEAD" ] || fail "no git clone at $REPO (see docs/VPS.md, one-time setup)"
[ -r "$ENV_FILE" ] || as_app test -r "$ENV_FILE" || fail "$ENV_FILE is missing or not readable by $APP_USER"
command -v node >/dev/null || fail "node is not installed"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "Node 22 or newer is required (found $(node --version))"

say "Fetching $BRANCH"
as_app git -C "$REPO" fetch --prune origin
SHA="$(as_app git -C "$REPO" rev-parse "origin/$BRANCH")"
RELEASE="$RELEASES/$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}"
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"

say "Preparing $RELEASE"
as_app mkdir -p "$RELEASE"
as_app git -C "$REPO" archive "$SHA" | as_app tar -x -C "$RELEASE"

cd "$RELEASE"
say "Installing dependencies"
as_app npm ci --no-audit --no-fund

if [ "${SKIP_TESTS:-}" = "1" ]; then
  say "Skipping tests (SKIP_TESTS=1)"
else
  say "Running tests"
  # A near-empty environment: the tests can never see a real database address or a messaging key.
  test_env=(PATH="$PATH" HOME="$(getent passwd "$APP_USER" | cut -d: -f6)")
  if [ -n "${TMPDIR:-}" ]; then test_env+=(TMPDIR="$TMPDIR"); fi
  as_app env -i "${test_env[@]}" npm test
fi

say "Building"
# The build reads the public settings (SITE_URL, GA_MEASUREMENT_ID, METRICOOL_HASH, GTM_ID) from the same file the service uses.
as_app node --env-file="$ENV_FILE" build.mjs

say "Switching to the new release"
as_app ln -sfn "$RELEASE" "$CURRENT.next"
as_app mv -T "$CURRENT.next" "$CURRENT"

if [ "${SKIP_RESTART:-}" = "1" ]; then
  say "Left the service alone (SKIP_RESTART=1)"
else
  PORT="$(as_app sed -n 's/^PORT=//p' "$ENV_FILE" | tail -n 1 | tr -d "\"' \r")"
  PORT="${PORT:-3000}"
  # Up to thirty seconds for the app to answer after a restart: it opens its database (and, the very first time,
  # creates it) before it listens.
  answers() {
    for _ in $(seq 1 60); do
      if curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz"; then return 0; fi
      sleep 0.5
    done
    return 1
  }

  say "Restarting $SERVICE"
  as_root systemctl restart "$SERVICE"
  if ! answers; then
    hint="Check: journalctl -u $SERVICE -n 50"
    if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
      say "The new release did not answer on port $PORT. Putting the previous release back"
      as_app ln -sfn "$PREVIOUS" "$CURRENT.next"
      as_app mv -T "$CURRENT.next" "$CURRENT"
      as_root systemctl restart "$SERVICE"
      # A release that failed is not kept: it must never become a rollback target.
      as_app rm -rf "$RELEASE"
      if answers; then fail "the new release did not answer, so $(basename "$PREVIOUS") is live again. $hint"; fi
      fail "the new release did not answer, and $(basename "$PREVIOUS") is not answering either. The site is down. $hint"
    fi
    fail "the new release did not answer on port $PORT and there is no earlier release to put back. $hint"
  fi
fi

say "Removing old releases (keeping $KEEP)"
LIVE="$(readlink -f "$CURRENT")"
as_app find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort | head -n "-$KEEP" | while read -r old; do
  [ "$old" = "$LIVE" ] || as_app rm -rf "$old"
done

say "Live: $(basename "$RELEASE") ($SHA)"
