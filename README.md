# Call Harbison

Website for Call Harbison (callharbison.com): "Property problem? Call Harbison." Static pages plus four small API routes. It runs on one Linux server (a Vultr VPS): a single Node process serves the pages and the APIs, keeps the leads in its own database on the server's disk, and keeps its own visitor statistics. No outside accounts are needed. Setup, deploys, backups and restore: [docs/VPS.md](docs/VPS.md).

## One CRM for both websites

Call Harbison HQ can also be the shared intake desk for this website and Harbison Standard
(optional). The private `/api/intake` bridge accepts authenticated Standard inquiries into the
same lead table. HQ labels and filters by brand, preserves Standard buyer
profiles and messages, and keeps one pipeline for follow-up. Set `CRM_INGEST_SECRET`
to the same 32+ character server-only secret as Standard's `SHARED_CRM_SECRET`.
Customer SMS remains off unless `LEAD_ACK_ENABLED=true` and response consent is
recorded. See [the shared CRM runbook](docs/SHARED-CRM.md) for configuration,
verification limits, historical leads and items still awaiting broker review.

## What's included

| Page | URL |
| --- | --- |
| Home (hero + lead form, approach, situations, process, direct-vs-listing comparison, FAQ) | `/` |
| Situations overview | `/situations` |
| 11 situation pages (inherited, repairs, vacant, tenants, relocation, life change, fire/water, unfinished remodel, rental property, failed listing, land/development) | `/situations/<slug>` |
| Service-area pages | `/areas/bakersfield`, `/areas/tehachapi`, `/areas/stallion-springs`, `/areas/california-city`, `/areas/kern-county` |
| About Nathanael Harbison (credentials, E-E-A-T) | `/about` |
| Seller guides (as-is sales, cash vs. listing, inherited homes, renovate vs. as-is, what affects a cash offer, the walkthrough) | `/guides`, `/guides/<slug>` |
| How it works (process, walkthrough, interactive net estimator, offer math, seller promise), Contact, Accessibility | `/how-it-works`, `/contact`, `/accessibility` |
| Selling a loved one's house (family transition funnel + printable partner guide) | `/sell-loved-ones-house`, `/family-property-guide` |
| Thank-you (post-submit), Privacy, Terms, 404 | `/thank-you`, `/privacy`, `/terms` |
| Shared HQ CRM (dashboard, leads, partners & ROI, first-party website stats) | `/hq`, `/hq/leads`, `/hq/partners`, `/hq/stats/*` |

Also: lead form API (`/api/leads`), private Harbison Standard intake bridge (`/api/intake`), first-party privacy-preserving analytics (`/api/track`, stored on the server), `sitemap.xml`, `robots.txt` (AI crawlers explicitly allowed on public pages; `/hq` and `/thank-you` disallowed), `llms.txt`, favicon, Open Graph/Twitter tags, a connected Schema.org `@graph` on every page (RealEstateAgent, Person with DRE license credential, WebSite, WebPage, Service, Article, BreadcrumbList, FAQPage), answer-first "Quick answer" blocks, an "At a glance" facts section, optional GA4/GTM/Metricool (only with your own IDs), a sticky mobile call bar, spam honeypot + IP/phone rate limiting, signed thank-you detail tokens, and UTM tracking on leads.

## Project layout

```
site.config.mjs          ← phone, email, service area, site URL, GA4/GTM validation (edit once, used everywhere)
src/content.mjs          ← original situations, areas, FAQs, images
src/content-extra.mjs    ← About page, guides, "at a glance" facts, California City page
src/content-playbook.mjs ← site-playbook content: hero, 5 paths, seller promise, offer math, form options, new pages
src/family.mjs           ← "Selling a loved one's house" funnel content
src/templates.mjs        ← HTML layout, structured data, interactive net estimator, and page templates
static/                  ← fingerprinted styles.css / script.js / analytics.js, self-hosted fonts, images, /hq panel
api/leads.js             ← public website lead form + signed thank-you details
api/hq.js                ← HQ CRM, CSV import/export, partners/spend, health check
api/intake.js            ← authenticated server-to-server bridge from Harbison Standard
api/track.js             ← first-party analytics + CSP report sink
lib/local-database.js    ← the site's own database (PostgreSQL inside the Node process), its lock, backups, restore
lib/postgres-rest.js     ← turns the handlers' database requests into SQL
lib/analytics-store.js   ← the visitor statistics kept on the server
lib/                     ← also: intake normalizer, IP/rate-limit helper, retry helper, CSV/JSON importer
server.mjs               ← the production server: pages, APIs, database, shutdown
build.mjs                ← generates ./dist (pages, fingerprinted assets, sitemap.xml, robots.txt, llms.txt)
dev.mjs, dev/            ← local preview server and the HQ mock database
supabase/                ← schema.sql + migrations: the database's tables, applied by the site itself at start
scripts/                 ← restore-database.mjs, i18n checks, two manual workers (off)
deploy/                  ← systemd unit, Caddy config, release script
test/                    ← `npm test`
brand/                   ← logo originals (not deployed)
docs/                    ← shared CRM runbook, project record, sitemap overview, family-funnel notes
.github/workflows/ci.yml ← runs tests + build on every push
```

## Branches

`main` is the only long-lived branch and is what the server deploys (`deploy/deploy.sh` fetches it). Do new work on a short-lived branch, open a pull request (CI runs automatically), merge, then delete the branch. Past feature branches are preserved as `archive/*` tags.

## Local development

```bash
npm ci         # Node 22; the one dependency is PGlite, the database engine
npm run dev    # builds and serves http://localhost:3000 with the APIs and a database in ./.data/db
npm test
```

Set `HQ_PASSWORD` in your shell to sign in to `/hq` locally, or use `npm run dev -- --mock` for sample data (password `demo`).

## Running it on the server

[docs/VPS.md](docs/VPS.md) covers a Vultr VPS with Ubuntu, from an empty server to a live site: the systemd unit, Caddy for HTTPS, the release script (`deploy/deploy.sh` builds each release in its own folder, switches over, and rolls back if the new one does not answer), the settings file, backups and restore. The settings file needs only `SITE_URL` and `HQ_PASSWORD`; email alerts are optional.

A lead counts as received only once it is in the database. If it cannot be stored, `/api/leads` answers `502` and the visitor is asked to call, rather than being told it was sent. A failed email alert after a successful save is recorded on the lead's HQ activity timeline.

## Before launch checklist

- [ ] Set `SITE_URL` to the real domain
- [ ] Set `HQ_PASSWORD`, submit a test lead and find it in `/hq`
- [ ] Swap Unsplash stock photos (in `src/content.mjs`) for real local project photos
- [ ] Review copy, FAQ answers, and the Privacy/Terms pages (have an attorney review — especially the SMS consent language)
- [ ] Submit `sitemap.xml` in Google Search Console; set up Google Business Profile

## SEO / AI-search maintenance

- **Keep facts identical everywhere.** Name, phone, email, and service area must match on this site, harbisonstandard.com, Google Business Profile, Facebook, Yelp, etc. AI engines trust consistent facts.
- **Create a Google Business Profile** (service-area business, category "Real estate agent" or "Home buyer"), then add its URL to `businessProfiles` in `site.config.mjs`.
- **After launch:** verify the domain in Google Search Console and Bing Webmaster Tools (Bing feeds ChatGPT/Copilot search) and submit `/sitemap.xml`.
- **Add a guide every month or two** in `src/content-extra.mjs` — answer-first, question-style headings. Update the `updated` date when you revise one.
- **Reviews:** ask each seller for a Google review. Do not add review star markup to this site (Google ignores self-hosted reviews for local businesses).
- The guides are general information written for Nathanael to review. Once he has reviewed them, the byline can be changed to him.

## Lead form (options form)

Buyer, investment-property and home-value conversations now have dedicated paths at
`/buyers`, `/investors` and `/home-value` (also in Spanish). They use the existing
`options` form type with distinct `route_interest` labels, require response consent,
and do not require ownership or an address. They receive a neutral confirmation,
without seller follow-up questions. See the [search implementation and measurement
record](docs/SEARCH-IMPLEMENTATION-2026-11-06.md) for service boundaries, source
evidence, recovery behavior and the manual 30/60/90-day review plan.

Three steps, per the site playbook: **situation → address (street, city, ZIP) → contact + consent**. The lead is created at step 3. Timeline, occupancy, condition, and goals are asked afterward on `/thank-you` and attached to the same lead (`{ kind: 'details' }` → `/api/leads`). Transactional consent (required) and marketing consent (optional) are stored separately. Leads live in the site's own database on the server: `leads`, `partners`, `lead_events`, `ad_spend`, the `v_*` views and the operations tables, all created from `supabase/schema.sql` and `supabase/migrations/` when the site starts.

Analytics events (GTM/GA4, no personal data): `phone_click`, `cta_click`, `lead_form_view`, `lead_form_start`, `lead_form_step_complete`, `lead_form_submit`, `lead_form_error`, `lead_form_success`, `generate_lead`, `guide_view`, `situation_page_view`, `location_page_view`.

## Brand assets

`static/assets/` holds the logo cut from the brand sheet: `logo-horizontal-v2.png` (full color, transparent), `logo-header-reverse-v2.png` (ivory + gold for navy), `logo-symbol-gold.png`, app/favicon icons, and `og-default.jpg`. For the sharpest icons, replace them with exports from the original vector logo file when available.

## HQ panel (dashboard + CRM) — `/hq`

Private, password-protected team panel at **https://www.callharbison.com/hq**.

- **Dashboard:** leads waiting for first contact, follow-ups due, new today / 7 days, open pipeline, appointments, median time to first contact, gross profit (90 days), leads per week, pipeline by stage, brand, source, path of interest, and a live delivery/integration readiness card with a one-click test email alert (`Send test email alert`).
- **CRM (`/hq/leads`):** filter by view (open, new, follow-ups due, closed, spam, all), brand, or individual stage; punctuation-tolerant phone/text search; `+ New lead` manual intake; duplicate-aware `Import` (CSV/JSON with preview); `Export CSV`; editable contact/property/pipeline fields; outreach logs that automatically record first contact; and deep-linkable lead URLs (`/hq?lead=<id>`).
- **Partners & ROI (`/hq/partners`):** manage referral partner slugs (`callharbison.com/family?ref=<slug>`) and monthly ad spend / CPL / ROAS.
- **Website stats (`/hq/stats/call-harbison`):** first-party traffic, sources, devices, pages and the lead funnel, kept on the server. A Harbison Standard tab appears only when `CRM_INGEST_SECRET` connects the shared collector.
- **Setup:** set `HQ_PASSWORD` (long and unique) in `/etc/call-harbison.env` and restart the site. Changing the password signs everyone out.
- **Security:** one `/api/hq` handler; signed HttpOnly/Secure/SameSite=Strict session cookie (12 hours), signed with a key kept in the server's state folder; failed-login throttling; writes require the panel's own header; edits are whitelisted and validated; the database has no network port and answers only the site's own process; `/hq` is noindex and blocked in robots.txt.
- **Try it locally with sample data:** `npm run dev -- --mock`, open http://localhost:3000/hq, password `demo`.

## AI assistant connection (MCP) — `/api/mcp`

Read-only access for Nathanael's Grok assistant to leads, the pipeline and site statistics: six tools, none of which can change, send or delete anything. Off (404) until `MCP_TOKEN` (32+ characters) is set in `/etc/call-harbison.env`. Contact details stay out of replies unless `MCP_CONTACT_DETAILS=on`. Check a deployment with `MCP_TOKEN=… node scripts/mcp-check.mjs https://www.callharbison.com/api/mcp`. It has been tested against this repository's own client, not yet against Grok itself. See [docs/MCP.md](docs/MCP.md).

## Spanish version — `/es`

Every page is also built in Spanish under `/es` (home, how it works, situations, areas, guides, the family page, contact, the forms, the thank-you page and the legal pages). English stays the source of truth: the build reads each finished English page and swaps every visitor-facing text for its entry in `src/i18n/es/*.json` (keyed by the English text). Links, form values and structured data are handled automatically, and a header switch (English / Español) remembers the visitor's choice.

- **Edited English copy?** Run `node scripts/i18n.mjs extract --out todo.json` to list the texts that now need a Spanish entry, add them to a new file in `src/i18n/es/`, then `node scripts/i18n.mjs check`. `npm test` fails while any text is untranslated; until then the Spanish page simply shows that one text in English.
- **Form values stay English** (what HQ and the CRM read). Only the visible labels change.
- **Spanish leads** are recognised by the page they were submitted from (`/es/...`): the alert email subject gets `[ES]`, the text-message alert says `[SPANISH]`, the automatic acknowledgement text goes out in Spanish, and HQ shows "Spanish" beside the contact.
- **Have a native speaker review the Spanish**, especially the privacy, terms and consent wording. The legal pages carry a note that the English version governs.
## Seller operations draft

The feature-flagged `/hq/operations` workbench adds separate research review, evidence-based inquiry workflow and an internal notification outbox. Both feature flags default off. Read [the development, verification and rollout runbook](docs/SELLER-OPERATIONS.md) before activation. Use `npm run dev -- --mock` for synthetic local testing only.
