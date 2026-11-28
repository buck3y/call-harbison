#!/usr/bin/env bash
# Deploys the newest commit of a branch on the VPS, once CI has passed for it on GitHub.
#
# Root runs this script, so it is installed once as a root-owned copy and run from there, never from a release
# (a copy inside /srv/call-harbison belongs to the app user and comes from whoever last pushed to main):
#
#   sudo install -m 755 -o root -g root /srv/call-harbison/repo/deploy/deploy.sh /usr/local/sbin/call-harbison-deploy
#   sudo call-harbison-deploy
#
# Update that copy deliberately, after reading what changed (docs/VPS.md, "Updating the deploy script").
#
# Each deploy gets its own folder under releases/. Install, tests and build all happen there, so the live site
# is never touched until the new one is ready. Then "current" is switched over, the service restarts, and the
# script checks that the site answers. If it does not, the previous release is put back.
#
# Settings (environment variables, all optional):
#   APP_ROOT=/srv/call-harbison   APP_USER=callharbison   ENV_FILE=/etc/call-harbison.env
#   SERVICE=call-harbison         BRANCH=main             KEEP=5 (releases to keep)
#   CI_CHECK=test-and-build       the GitHub Actions job that must have passed for the commit
#   SKIP_CI_CHECK=1 deploy without asking GitHub whether CI passed (GitHub unreachable, or its hourly limit reached)
#   SKIP_TESTS=1    skip the test suite (CI already runs it on every push)
#   SKIP_RESTART=1  build and switch, but leave the service alone
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/call-harbison}"
APP_USER="${APP_USER:-callharbison}"
ENV_FILE="${ENV_FILE:-/etc/call-harbison.env}"
SERVICE="${SERVICE:-call-harbison}"
BRANCH="${BRANCH:-main}"
KEEP="${KEEP:-5}"
CI_CHECK="${CI_CHECK:-test-and-build}"

REPO="$APP_ROOT/repo"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"

# The only settings the build may see: the ones that end up in the pages (site.config.mjs, src/), and the four
# switches lib/command-phase.js checks so a build refuses an accidental activation. Every other line of the settings
# file (passwords, keys, tokens) stays out of the build. VERCEL is left out on purpose: this server is not Vercel.
BUILD_SETTINGS=(SITE_URL GA_MEASUREMENT_ID GTM_ID METRICOOL_HASH ANALYTICS_DEFAULTS VERCEL_INSIGHTS ASSISTANT ASSISTANT_PROVIDER_NAME
  LEAD_RELIABILITY_ENABLED LEAD_RELIABILITY_DISPATCH_ENABLED SELLER_COMMAND_RECOVERY_ENABLED SELLER_OUTBOX_DISPATCH_ENABLED)

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nDeploy stopped: %s\n' "$*" >&2; exit 1; }
warn() { printf '\nWarning: %s\n' "$*" >&2; }

# Everything that touches the code runs as the app user, never as root.
as_app() {
  if [ "$(id -un)" = "$APP_USER" ]; then "$@"; else sudo -u "$APP_USER" -H "$@"; fi
}
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# "OWNER/REPO" from the clone's origin: git@github.com:OWNER/REPO.git, ssh://git@github.com/OWNER/REPO or https://github.com/OWNER/REPO
github_repo() {
  local url
  url="$(as_app git -C "$REPO" config --get remote.origin.url)" || return 1
  url="${url%.git}"
  case "$url" in
    git@github.com:*) url="${url#git@github.com:}" ;;
    ssh://git@github.com/*) url="${url#ssh://git@github.com/}" ;;
    https://github.com/*) url="${url#https://github.com/}" ;;
    *) return 1 ;;
  esac
  [[ "$url" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 1
  printf '%s\n' "$url"
}

# Prints NAME=value<NUL> for each name in BUILD_SETTINGS that the settings file sets (the last line wins, as it does
# for systemd). Read as the app user; the values reach nothing but the build below.
public_settings() {
  as_app env -i PATH="$PATH" node -e '
    const fs = require("fs");
    const [file, ...names] = process.argv.slice(1);
    const wanted = new Set(names);
    const found = new Map();
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || !wanted.has(m[1])) continue;
      const quoted = /^(["\x27])(.*)\1$/.exec(m[2]);
      found.set(m[1], quoted ? quoted[2] : m[2].replace(/\s+#.*$/, ""));
    }
    for (const [name, value] of found) process.stdout.write(`${name}=${value}\0`);
  ' "$ENV_FILE" "${BUILD_SETTINGS[@]}"
}

self="$(readlink -f "${BASH_SOURCE[0]}")"
if [ "$(stat -c %u "$self")" != "0" ] || [ -n "$(find "$self" -perm /022 2>/dev/null)" ]; then
  warn "this copy of the deploy script ($self) is not a root-owned file that only root can change. Install it as /usr/local/sbin/call-harbison-deploy (docs/VPS.md) and run that instead."
fi

[ -d "$REPO/.git" ] || [ -f "$REPO/HEAD" ] || fail "no git clone at $REPO (see docs/VPS.md, one-time setup)"
[ -r "$ENV_FILE" ] || as_app test -r "$ENV_FILE" || fail "$ENV_FILE is missing or not readable by $APP_USER"
command -v node >/dev/null || fail "node is not installed"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "Node 22 or newer is required (found $(node --version))"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"

say "Fetching $BRANCH"
as_app git -C "$REPO" fetch --prune origin
SHA="$(as_app git -C "$REPO" rev-parse "origin/$BRANCH")"

# Only a commit that passed CI is built: GitHub's public API, no token needed while the repository is public.
if [ "${SKIP_CI_CHECK:-}" = "1" ]; then
  say "Not checking CI (SKIP_CI_CHECK=1): ${SHA:0:7} is deployed without proof that its tests passed"
else
  say "Checking that CI ($CI_CHECK) passed for ${SHA:0:7}"
  GH_REPO="$(github_repo)" || fail "cannot tell the GitHub repository from the clone's origin URL. Run again with SKIP_CI_CHECK=1 to deploy without the CI check"
  if ! runs="$(curl -fsS --max-time 20 -A call-harbison-deploy -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
      "https://api.github.com/repos/$GH_REPO/commits/$SHA/check-runs?check_name=$CI_CHECK&filter=latest")"; then
    fail "could not ask GitHub whether CI passed for ${SHA:0:7} (no connection, or the public API's hourly limit). Try again later, or run again with SKIP_CI_CHECK=1 to deploy without the CI check"
  fi
  verdict="$(printf '%s' "$runs" | as_app node -e '
    let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      const [name, sha] = process.argv.slice(1);
      let runs;
      try { runs = JSON.parse(raw).check_runs.filter((r) => r.name === name && r.head_sha === sha); } catch { return console.log("unreadable"); }
      if (!runs.length) return console.log("none");
      if (runs.some((r) => r.status !== "completed")) return console.log("pending");
      const bad = runs.map((r) => r.conclusion).filter((c) => c !== "success");
      console.log(bad.length ? bad.join(",") : "success");
    });
  ' "$CI_CHECK" "$SHA")"
  case "$verdict" in
    success) say "CI passed for ${SHA:0:7}" ;;
    pending) fail "CI is still running for ${SHA:0:7}. Wait until it has finished (the Actions tab on GitHub) and run this again" ;;
    none) fail "GitHub has no CI result named $CI_CHECK for ${SHA:0:7} ($GH_REPO). Check the Actions tab; SKIP_CI_CHECK=1 deploys without the check" ;;
    *) fail "CI did not pass for ${SHA:0:7} (result: $verdict). Fix it on GitHub first; SKIP_CI_CHECK=1 deploys anyway" ;;
  esac
fi

RELEASE="$RELEASES/$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}"
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"

say "Preparing $RELEASE"
as_app mkdir -p "$RELEASE"
as_app git -C "$REPO" archive "$SHA" | as_app tar -x -C "$RELEASE"

cd "$RELEASE"
say "Installing dependencies"
# --ignore-scripts: no package gets to run code while it is installed (package-lock.json has none that needs to).
as_app npm ci --ignore-scripts --no-audit --no-fund

if [ "${SKIP_TESTS:-}" = "1" ]; then
  say "Skipping tests (SKIP_TESTS=1)"
else
  say "Running tests"
  # A near-empty environment: the tests can never see a real database address or a messaging key.
  test_env=(PATH="$PATH" HOME="$APP_HOME")
  if [ -n "${TMPDIR:-}" ]; then test_env+=(TMPDIR="$TMPDIR"); fi
  as_app env -i "${test_env[@]}" npm test
fi

settings_file="$(mktemp)"
trap 'rm -f "$settings_file"' EXIT
public_settings >"$settings_file" || fail "could not read the public settings from $ENV_FILE"
mapfile -d '' build_env <"$settings_file"
rm -f "$settings_file"
names=""
for entry in "${build_env[@]}"; do names="$names ${entry%%=*}"; done
say "Building (settings passed to the build:${names:- none})"
as_app env -i PATH="$PATH" HOME="$APP_HOME" "${build_env[@]}" node build.mjs

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
      # A release that failed is not kept: it must never become a rollback target. (Step out of it first.)
      cd "$APP_ROOT"
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
