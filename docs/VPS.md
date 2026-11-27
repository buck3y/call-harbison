# Running Call Harbison on a VPS

The site was built for Vercel. This is how to run the same site on one Linux server instead.

**Status (2026-11-27):** `server.mjs` is covered by `test/server.test.js` and was run against a full build. The deploy
script was exercised end to end with stand-ins for `sudo`, `systemctl` and `npm`. The systemd unit and the Caddyfile
have not been run on a real server yet, so read the first deploy's output carefully.

## What runs where

| Piece | Job |
| --- | --- |
| Caddy, ports 80 and 443 | HTTPS certificates, compression, the redirect from `callharbison.com` to `www.callharbison.com` |
| Node app, `127.0.0.1:3000` (`server.mjs`) | Serves `./dist` and the four API routes. Reads `vercel.json` for redirects, rewrites and headers, so both hosts answer the same way |
| Neon or Supabase, Resend, Twilio | Unchanged. Leads and HQ data stay in the hosted database. Nothing is stored on the server |

## One-time setup

Written for Ubuntu 22.04 or 24.04. Run these as root. Replace `OWNER/REPO` with the GitHub repository.

**1. Install Node 22, Caddy and git.** If either installer has changed, use the current instructions from
nodesource.com and caddyserver.com/docs/install.

```bash
apt-get update && apt-get install -y git curl gpg debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

**2. Create the app user and its folders.** The app never runs as root.

```bash
useradd --system --create-home --home-dir /srv/call-harbison --shell /usr/sbin/nologin callharbison
sudo -u callharbison mkdir -p /srv/call-harbison/releases
sudo -u callharbison mkdir -m 700 /srv/call-harbison/.ssh
```

**3. Give the server read access to the repository.** Create a key, add the public half in GitHub under
Settings → Deploy keys (leave "Allow write access" off), then clone.

```bash
sudo -u callharbison ssh-keygen -t ed25519 -N "" -C call-harbison-vps -f /srv/call-harbison/.ssh/id_ed25519
cat /srv/call-harbison/.ssh/id_ed25519.pub
sudo -u callharbison -H git clone git@github.com:OWNER/REPO.git /srv/call-harbison/repo
```

**4. Create the settings file.** It holds secrets, so only root and the app user can read it.

```bash
install -m 640 -o root -g callharbison /srv/call-harbison/repo/.env.example /etc/call-harbison.env
nano /etc/call-harbison.env
```

Set `SITE_URL`, at least one lead destination, `HQ_PASSWORD`, and remove the `#` in front of `VERCEL_INSIGHTS=off`.
The same values the Vercel project uses will work. One `KEY=value` per line, no spaces around `=`, and double quotes
around a value that contains spaces.

**5. Install the service and the Caddy config.**

```bash
cp /srv/call-harbison/repo/deploy/call-harbison.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable call-harbison
cp /srv/call-harbison/repo/deploy/Caddyfile /etc/caddy/Caddyfile
```

**6. Deploy for the first time, then open the firewall.**

```bash
bash /srv/call-harbison/repo/deploy/deploy.sh
curl -s http://127.0.0.1:3000/healthz        # prints: ok
systemctl reload caddy
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
```

**7. Point the domain at the server.** Add A records (and AAAA if the server has IPv6) for `callharbison.com` and
`www.callharbison.com`. Caddy gets its certificates by itself once the names resolve to this server. Until then the
app can be checked on the server with `curl -s http://127.0.0.1:3000/ | head`.

## Deploying an update

```bash
sudo bash /srv/call-harbison/current/deploy/deploy.sh
```

The script fetches `main`, unpacks it into a new folder under `/srv/call-harbison/releases/`, installs, runs the tests
with an empty environment (so they cannot reach the live database or send a message), builds, switches the `current`
link, restarts the service and checks `/healthz`. The live site is not touched until the new release is ready. If the
new release does not answer, the previous one is put back and the script exits with an error.

Options: `BRANCH=other-branch`, `SKIP_TESTS=1` (CI already runs the tests on every push; useful on a server with
little memory), `KEEP=5` (releases to keep).

## Rolling back

```bash
ls /srv/call-harbison/releases
sudo -u callharbison ln -sfn /srv/call-harbison/releases/<an-older-folder> /srv/call-harbison/current
sudo systemctl restart call-harbison
```

## Checking on it

```bash
systemctl status call-harbison
journalctl -u call-harbison -f          # one line per API request: method, path, status, time. No addresses, no bodies
journalctl -u caddy -f
curl -s http://127.0.0.1:3000/healthz
```

Changing a setting: edit `/etc/call-harbison.env`, then `sudo systemctl restart call-harbison`. Settings that are
baked into the pages (`SITE_URL`, `GA_MEASUREMENT_ID`, `GTM_ID`, `VERCEL_INSIGHTS`) need a deploy instead.

## What is different from Vercel

- **Routing rules.** `vercel.json` is still the only place for redirects, rewrites and headers. `server.mjs` reads it
  at start, so a rule added there works on both hosts.
- **Vercel Web Analytics and Speed Insights** do not exist off Vercel. `VERCEL_INSIGHTS=off` keeps their scripts out
  of the pages. Google Analytics, Tag Manager, Metricool and the first-party stats in HQ work as before.
- **Visitor addresses.** The rate limits read `X-Real-IP`. On Vercel the platform sets it. Here `server.mjs` sets it
  from what the local proxy reports and ignores anything a visitor sends. If the proxy is not on the same machine
  (Docker, a load balancer), set `TRUST_PROXY=private`.
- **Request size.** The 4.5 MB limit Vercel applies to a function is kept.
- **Nothing is scheduled**, as on Vercel. The scripts in `scripts/` remain manual.
- **Compression and HTTPS** are Caddy's job. The Node app speaks plain HTTP on 127.0.0.1 only.

## Moving the live domain from Vercel

1. Finish the setup above and check the site on the server.
2. A day ahead, lower the TTL on the domain's records to a few minutes.
3. Change the A and AAAA records to the server. Both hosts use the same database, so a lead reaches HQ whichever one
   a visitor lands on while the change spreads.
4. Watch `journalctl -u caddy -f` for the certificates, then load the site and submit a test lead.
5. Leave the Vercel project in place for a few days before removing the domain from it.
