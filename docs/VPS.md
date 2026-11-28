# Running Call Harbison on a Vultr VPS

The whole site runs on one Linux server: one Node process serves the pages and the API, and keeps the leads in its
own database and the visitor statistics in its own files, all on the server's disk. There is no outside database or
hosting account. Email alerts (Resend) are optional.

**Status (2026-11-27):** tested on a development machine, not yet on a real server. What was run there: the test
suite; the real `server.mjs` as a process, creating its database, taking a lead, signing in to HQ, changing the
lead's stage, refusing a second copy of itself, stopping on SIGTERM, starting again with everything still there, and
writing its first daily backup; a backup restored with `scripts/restore-database.mjs`. The deploy script was
exercised earlier with stand-ins for `sudo`, `systemctl` and `npm`. Not yet run: the systemd unit, the Caddyfile,
Node 22 on Ubuntu, and the database on a Vultr disk. Read the first deploy's output carefully.

## What runs where

| Piece | Job |
| --- | --- |
| Caddy, ports 80 and 443 | HTTPS certificates, compression, the redirect from `callharbison.com` to `www.callharbison.com` |
| Node app, `127.0.0.1:3000` (`server.mjs`) | Serves `./dist` and the four API routes. Reads `vercel.json` for redirects, rewrites and headers (the file keeps its name). Opens the database before it answers anything |
| `/var/lib/call-harbison` (the state folder) | Everything that changes: `db/` (the database), `backups/`, `analytics/`, `signing-key`. Releases never touch it |
| Resend (optional) | Email alerts for new leads. Without it, a lead is stored and shows in `/hq`, nobody is emailed |

## What the server needs

A Vultr Cloud Compute server with Ubuntu 24.04 LTS and **2 GB of memory**. The site itself uses about 250-300 MB, but
a deploy also runs the tests, which start databases of their own and need up to about 1 GB more for a minute. A 1 GB
server works if every deploy uses `SKIP_TESTS=1` (GitHub already runs the tests on every push). 25 GB of disk is
plenty. When you create the server, turn on Vultr's **automatic backups**: they copy the whole disk, including the
state folder.

## One-time setup

Written for Ubuntu 24.04 (22.04 also works). Sign in as root (`ssh root@<server address>`, the password is on the
server's page at Vultr) and run these. Replace `OWNER/REPO` with the GitHub repository.

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

Two settings are needed: `SITE_URL` and `HQ_PASSWORD` (long and unique; changing it later signs everyone out). For
email alerts, also fill in `RESEND_API_KEY`, `LEAD_NOTIFY_EMAIL` and `LEAD_FROM_EMAIL`. Everything else in the file is
optional and explained there. One `KEY=value` per line, no spaces around `=`, and double quotes around a value that
contains spaces.

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

The first start creates the database in `/var/lib/call-harbison/db` and sets up its tables, which takes a few
seconds. `journalctl -u call-harbison -n 20` then shows `[db] applied 9 schema file(s)` and `Database: …`.

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

A release that brings a new database change (a new file in `supabase/migrations/`) applies it when it starts. If
the change fails, nothing of it is applied, that release refuses to start, and the script puts the previous release
back, so the site keeps running on the database as it was.

Options: `BRANCH=other-branch`, `SKIP_TESTS=1` (CI already runs the tests on every push; useful on a server with
little memory), `KEEP=5` (releases to keep).

## Rolling back

```bash
ls /srv/call-harbison/releases
sudo -u callharbison ln -sfn /srv/call-harbison/releases/<an-older-folder> /srv/call-harbison/current
sudo systemctl restart call-harbison
```

Rolling back the code does not roll back the database: an older release runs on the database as the newer one left
it. The changes in `supabase/migrations/` only add tables and columns, so that works. To go back to an earlier copy of
the data itself, restore a backup (below).

## Checking on it

```bash
systemctl status call-harbison
journalctl -u call-harbison -f          # one line per API request: method, path, status, time. No addresses, no bodies
journalctl -u caddy -f
curl -s http://127.0.0.1:3000/healthz
ls -l /var/lib/call-harbison/backups     # one file a day
```

Changing a setting: edit `/etc/call-harbison.env`, then `sudo systemctl restart call-harbison`. Settings that are
baked into the pages (`SITE_URL`, `GA_MEASUREMENT_ID`, `GTM_ID`, `METRICOOL_HASH`) need a deploy instead.

Other details of this setup:

- **Routing rules.** `vercel.json` is the one place for redirects, rewrites and headers; `server.mjs` reads it at start.
- **Visitor addresses.** The rate limits read `X-Real-IP`, which `server.mjs` sets from what Caddy reports and never
  from what a visitor sends. If the proxy is not on the same machine (Docker, a load balancer), set `TRUST_PROXY=private`.
- **Request size.** Requests over 4.5 MB are refused.
- **Nothing else is scheduled.** The two worker scripts in `scripts/` are off and manual, and refuse to run against
  the server's own database (only the running site may open it).
- **Compression and HTTPS** are Caddy's job. The Node app speaks plain HTTP on 127.0.0.1 only.

## The database

The leads, the HQ pipeline, partners and ad spend live in a PostgreSQL database that runs inside the site's own Node
process (PGlite), with its files in `/var/lib/call-harbison/db`. There is no separate database program to install or
look after, and nothing listens on the network for it.

- **It sets itself up.** The first start creates it; every start applies any new file in `supabase/migrations/`,
  each exactly once. If one fails, the site does not start and the journal names the file.
- **One process at a time.** Only the running site may open the folder. A second copy (a second server, a script)
  is refused with a message naming the process that has it open. Stop the site before restoring a backup.
- **What survives what.** Every saved change is written to the disk before the visitor or HQ is told it was saved.
  A crash, a `kill` or a reboot loses nothing that was saved; the next start tidies up by itself, as any PostgreSQL
  does. A failing disk can still lose data, which is what the backups are for.
- **Don't** copy, edit or delete files inside `db/` while the site runs. Use the backups.
- `signing-key` next to it signs HQ sign-ins and the thank-you page links. Deleting it signs everyone out of HQ.

## Backups and restore

The site writes a copy of the whole database to `/var/lib/call-harbison/backups/db-YYYY-MM-DD.tar.gz` a minute
after it starts and then once a day, and keeps the newest 14. Each is a single file (about 5 MB to begin with) that
holds every lead, so treat it like the database: it is readable only by the app user.

Keep copies off the server too. Vultr's automatic backups cover the whole disk. To take a copy home:

```bash
scp root@<server>:/var/lib/call-harbison/backups/db-2026-11-27.tar.gz .
```

**To restore** (the site is off for about a minute):

```bash
sudo systemctl stop call-harbison
sudo -u callharbison env STATE_DIRECTORY=/var/lib/call-harbison \
  node /srv/call-harbison/current/scripts/restore-database.mjs /var/lib/call-harbison/backups/db-2026-11-27.tar.gz
sudo systemctl start call-harbison
```

The script first opens the backup in a new folder to check it is whole and says how many leads it holds; only then
does it swap it in. The database it replaced is kept beside it as `db.before-restore-<time>`; delete that folder once
you are happy. If the site is still running, or the file is not a good backup, nothing is changed. Anything saved
after the backup was taken is not in it.

## Site analytics

The site records its own visitor statistics on this server, and HQ's website stats read them from here. (With
`ANALYTICS_STORE=shared` they would go to the shared collector at Harbison Standard instead.) They start from zero on
the server; earlier history stays at Harbison Standard.

- **Where:** `/var/lib/call-harbison/analytics` (the unit's `StateDirectory`; `ANALYTICS_DIR` moves it). `live.json`
  holds today in detail, `days/YYYY-MM-DD.json` one finished day each as counters, plus `meta.json` and `secret` (the
  key for the visitor hash, unless `ANALYTICS_SECRET` is set). The format is described at the top of
  `lib/analytics-store.js`.
- **It lives in the state folder** with the database. Deploys and rollbacks leave it alone; Vultr's automatic backups
  cover it (the daily database backups do not). Losing it loses the stats history and nothing else.
- **Collected:** page views per path, the first and last page of a visit, active time (at most 30 minutes a visit),
  the kind of source (direct, search, social, referral) and the referring site's name, device type, browser and
  operating system as a few broad categories, the hour of the day, and four steps by name only: form started, lead
  sent, call click, text click.
- **Not collected:** IP addresses, user-agent strings, query strings, page titles, form fields, cookies. Robots are
  ignored, and so are browsers that send Do Not Track or Global Privacy Control, visitors who declined the consent
  banner, and anyone who used the opt-out on `/privacy`. Visitors are counted with a daily keyed hash of the date and
  the address, kept only for that day. There is no country or city.
- **Retention:** detail for the current day only (Bakersfield time). After midnight the day is reduced to counters
  and its session ids and visitor hashes are deleted. The counters stay for as long as the files exist.
- The app writes to disk every few seconds and when it stops, so a restart loses nothing and a crash at most the
  last few seconds. Run one app process per folder.

## Settings

`/etc/call-harbison.env` (start from `.env.example`):

| Setting | Needed? | What it does |
| --- | --- | --- |
| `SITE_URL` | yes | The site's address, for links, the sitemap and search engines |
| `HQ_PASSWORD` | yes | The password for `/hq` |
| `RESEND_API_KEY`, `LEAD_NOTIFY_EMAIL`, `LEAD_FROM_EMAIL` | for email alerts | Email for every new lead (Resend account) |
| `GA_MEASUREMENT_ID`, `METRICOOL_HASH`, `GTM_ID` | no | Google Analytics, Metricool, Tag Manager: loaded only when set, after the visitor accepts |
| `PORT`, `HOST`, `TRUST_PROXY` | no | Where the app listens and which proxy it believes |
| `HQ_SESSION_SECRET` | no | Your own key for HQ sign-ins instead of the generated `signing-key` |
| `DATABASE_DIR`, `ANALYTICS_DIR` | no | Keep the database or the statistics somewhere other than the state folder |

To use a hosted Supabase database instead of the server's own, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Moving the live domain from Vercel

The old site on Vercel keeps its leads in Supabase; this server has its own, empty database. So the leads have to be
carried over, and any that arrive on the old site while the domain moves have to be picked up.

1. Finish the setup above and check the site on the server.
2. A day ahead, lower the TTL on the domain's records to a few minutes.
3. In the old HQ, `Export CSV` (view: all). In the new HQ, `Import` that file: it shows a preview, skips leads it
   already has, and keeps each lead's contact details, address, situation, timeline, stage and source. Notes, money
   fields, follow-up dates and the activity log are not in the export, so copy those by hand for open leads.
4. Change the A and AAAA records to the server.
5. Watch `journalctl -u caddy -f` for the certificates, then load the site and submit a test lead.
6. For a few days, leads can still land on the old site from visitors whose DNS has not caught up. Check the old HQ,
   export again and import: leads already imported are skipped.
7. Then remove the domain from the Vercel project.
