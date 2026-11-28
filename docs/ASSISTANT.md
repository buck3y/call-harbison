# "Ask a question": the assistant for visitors

Written 2026-11-27. Off unless the build and the server both have `ASSISTANT=on`.

## The one decision

**The language model chooses; it never writes.** A visitor's question goes to the model with a short list of answers
that are already on this website. The model replies with the numbers of the answers that fit, or with one word saying
none does. The server checks those numbers and sends the visitor the website's own text. Nothing the model writes is
shown to anyone.

So being talked round is harmless: the worst a visitor can do is make the assistant show a different approved answer.
Every sentence a visitor can see has been written, translated and checked by the copy tests. The endpoint is useless
as a free model for anyone else, because no generated text ever comes out of it. There is no mode where the model's
words reach a visitor, and there must not be one.

The assistant also works with no model at all: a keyword search over the same answers picks one when it is clearly
ahead, and otherwise hands the question to Nathanael.

## Switch it on

To look at it on your own computer: `ASSISTANT=on npm run dev`, then open http://localhost:3000/ask or scroll to the
end of the questions on the home page.

On the server, in `/etc/call-harbison.env`:

1. **Search only (nothing leaves the server).** Add `ASSISTANT=on` and deploy (`sudo call-harbison-deploy`): the pages
   are rebuilt with the "Ask a question" block. The site's own search picks the answer.
2. **With a language model picking the answer.** Make an account with the provider (see the list below; Cloudflare
   Workers AI is the recommended one) and an API token there, then add:

   ```
   ASSISTANT_PROVIDER_NAME=Cloudflare
   ASSISTANT_API_URL=https://api.cloudflare.com/client/v4/accounts/<your account id>/ai/v1/chat/completions
   ASSISTANT_API_KEY=<the token>
   ASSISTANT_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8-fast
   ```

   Deploy again, because the provider's name goes on the privacy page. Until the pages name that provider, the server
   refuses to send any question out.
3. **Check.** `journalctl -u call-harbison -n 30` shows one line at start: `[assistant] on: search only`, or
   `[assistant] on: the search picks candidates and the model at … chooses among them`, or why the model stays off.
   Then ask a few questions on `/ask`; each shows in the log as `[assistant] answered 1 model 310ms` (`local` means the
   search answered, not the model).

To switch it off, remove `ASSISTANT=on` and deploy. The site is then exactly what it was without this feature.

## How it works

1. **At build time** (`lib/assistant/collect.js`, called from `build.mjs`) the approved answers are collected from the
   finished English and Spanish pages: every FAQ entry (kept once, on the first page that has it) and each page's short
   answer (`answer-box`, with the page's heading as its question). Left out: `/hq`, `/thank-you`, the legal pages, the
   printed handout, the 404 page, `/ask`, and anything in the first person. The fixed replies of
   `src/content-assistant.mjs` are added (greeting, the hand-off, off topic, how to reach Nathanael, what this assistant
   is, not available, too many questions). Everything goes to `dist/.assistant/answers.json`, together with the provider
   name the privacy page was built with. `server.mjs` never serves a path part that starts with a dot. The file holds
   only public website text.
2. **A question arrives** at `POST /api/assistant` as `{ message, history, lang }`. `history` is at most the visitor's
   last 6 questions and, for each, the ids that were shown. The server rebuilds what was shown from the ids; it never
   accepts assistant text from the browser.
3. **The search** (`lib/assistant/search.js`, `text.js`): BM25 over the answers of that language, with accent folding,
   a small stop-word list, a light stemmer for each language, a short synonym table and typo matching. The best 12 are
   the candidates.
4. **The model, if configured** (`lib/assistant/model.js`), gets the instructions, the candidates (number, question,
   first 300 characters of the answer) and the conversation, personal details removed. Its reply must be exactly
   `{"pick":[…],"kind":"answered|greeting|personal|off_topic|none"}`: at most two distinct whole numbers from the list,
   at least one when the kind is `answered`. Anything else in the reply is thrown away; a reply that does not pass
   counts as no reply. `personal` and `none` give the hand-off; `greeting` and `off_topic` their fixed replies.
5. **Without a usable model reply** (none configured, the privacy page names no provider or another one, over the daily
   ceiling, more than 8 seconds, a 429 or 5xx, a redirect, a network error after one retry, an invalid reply): a
   greeting gets the greeting, a question about what the visitor's own property is worth gets the hand-off, and
   otherwise the top search result is used when it is clearly ahead (`CONFIDENT` in `lib/assistant/service.js`),
   or the question goes to Nathanael.
6. **The reply** is `{ ok, answers: [{ id, question, text, url }], handoff }` and nothing else. The page shows each
   answer's text, then "From:" and its question as a link to the page it is on, and, on a hand-off, call, text and
   "Send the address" links.

## What is kept, what leaves, who may call

- **Kept:** nothing. No question, answer or conversation is stored or logged on the server. The one log line per
  question is its outcome, the number of answers, the path and the time: `[assistant] answered 1 model 310ms`. The rate
  limits keep a count per address (reduced as in `lib/request-ip.js`) in memory for up to a day. The browser keeps the
  conversation in `sessionStorage` until the tab closes or the visitor chooses Clear.
- **Leaves:** only toward `ASSISTANT_API_URL`, and only the instructions, the candidates (public website text) and the
  visitor's questions with anything that looks like a phone number, email address, street address, card or nine-digit
  number, other long number, or anything after "my name is" (or "me llamo", "mi nombre es") replaced by a marker, cut at
  500 characters. No header from the browser, no address, no cookie, no identifier. The key only in `Authorization`
  (none at all when the key is empty). `redirect: 'error'`, an 8-second budget, at most one retry on a network error,
  and a pause after a 429 (its `Retry-After`, up to 10 minutes; 60 seconds without one) or a 5xx (30 seconds).
- **A question leaves the server only when the privacy page names where it goes.** The build writes the provider name
  it was built with next to the answers; if the server's `ASSISTANT_PROVIDER_NAME` is missing or different, the model
  stays off and the server says so in one log line.
- **Who may call it:** `POST`, `Content-Type: application/json` only (a form or `text/plain` body, which another site's
  page could send without script, is refused with 415), not from another website (`Sec-Fetch-Site: cross-site`, or an
  `Origin` whose host is not the request's `Host`: 403). Per address 6 questions a minute and 60 a day (429 with a
  fixed sentence and the phone number); callers without an address share one bucket. The model at most
  `ASSISTANT_DAILY_MAX` times a day for the whole site; past that the search answers, which is not an error. The
  visitor never gets a 5xx.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| `ASSISTANT=on` | build and server | Shows the assistant at all: the block after each FAQ list, `/ask`, the footer link, the script, the privacy paragraph. Anything else: the site is exactly as without this feature. |
| `ASSISTANT_PROVIDER_NAME` | build and server | The company the privacy page names as receiving questions (for example `Cloudflare`). Empty: the privacy page says questions go nowhere, and the server never sends one. Must be the same at build and at run time. A name not listed in `src/i18n/es/assistant.json` needs an entry there (`"Name": "Name"`), as the analytics tool names have. |
| `ASSISTANT_API_URL` | server only | The chat-completions address. https only (plain http only to this machine), no user name or password in it. |
| `ASSISTANT_API_KEY` | server only | Sent as `Authorization: Bearer …`. Empty sends no `Authorization` header. |
| `ASSISTANT_MODEL` | server only | The model name the service expects. |
| `ASSISTANT_DAILY_MAX` | server only | Model calls a day for the whole site (UTC days). Default 500; 0 keeps the model off. |

The three server-only settings never reach a page. With `ASSISTANT=on` and no model settings, the assistant runs on
the search alone and the privacy page says questions are answered on this server.

## Model services with a free tier (checked 2026-11-27)

Read on each provider's own documentation pages on 2026-11-27, through a fetching tool that returns the page's text (the
quotes below are as it returned them). Free tiers change often; check again before relying on any of this.

**Cloudflare Workers AI** (recommended)
- Address: `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions`, with an API token as
  `Authorization: Bearer` (developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/).
- Example model: `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (the compatibility page's own example is
  `@cf/meta/llama-3.1-8b-instruct`).
- Limits: "10,000 Neurons per day" free on both the Workers Free and Workers Paid plans; on the Free plan, past that,
  "further operations will fail with an error" (…/workers-ai/platform/pricing/, dateModified 2026-11-18). The pricing
  table lists `@cf/meta/llama-3.1-8b-instruct-fp8-fast` at 4,119 Neurons per million input tokens and 34,868 per million
  output tokens. A question here sends about 1,000 to 1,800 tokens (measured: 4,100 to 6,400 characters) and gets about
  20 back, so roughly 8 Neurons a question, or about 1,200 questions a day for free. The default ceiling of 500 stays
  well inside. (`@cf/meta/llama-3.1-8b-instruct` costs 25,608 / 75,147 Neurons per million: about 200 questions a day;
  set `ASSISTANT_DAILY_MAX=200` for it.)
- What it does with the text: "No training: Cloudflare does not use Customer Content processed by Workers AI to train AI
  models", and "Cloudflare does not retain inputs or outputs after they are no longer needed to process the request and
  deliver the response", unless a storing feature such as AI Gateway logging is turned on (…/workers-ai/platform/data-usage/).
- Not checked: whether this endpoint accepts `response_format`. The client works either way: if a service answers 400
  to it, the next requests go without it.

**OpenRouter**
- Address: `https://openrouter.ai/api/v1/chat/completions`, key as `Authorization: Bearer`; `response_format`
  `{ type: 'json_object' }` is listed, with support varying by model (openrouter.ai/docs/api-reference/overview).
- Example model: any id ending in `:free`, or the router `openrouter/free`, which "automatically selects a free model"
  (openrouter.ai/docs/faq). The pages read did not name a specific `:free` model.
- Limits: free models 20 requests a minute; 50 a day with less than 10 credits bought, 1,000 a day with at least 10
  (openrouter.ai/docs/api-reference/limits).
- What it does with the text: prompts "are not logged by default for API use"; each underlying provider has its own
  retention terms, and with the training opt-out set in the account, "OpenRouter will not route to providers that
  train" (openrouter.ai/docs/features/privacy-and-logging, …/docs/faq). Which company actually receives a question
  depends on routing, which makes the privacy page harder to word truthfully.

**Google Gemini API** (not for this site on the free tier)
- Address: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, key as `Authorization: Bearer`
  (aistudio.google.com/docs/openai; ai.google.dev now redirects there). The page's examples use model names such as
  `gemini-3.8-flash`; check AI Studio for current ones.
- Limits: the rate-limit page lists free-tier figures for only one model and says the others "can be viewed in Google AI
  Studio" (aistudio.google.com/docs/rate-limits). Not confirmed here.
- What it does with the text, on the free ("Unpaid") tier: Google "uses the content you submit to the Services and any
  generated responses to provide, improve, and develop" its products, "human reviewers may read, annotate, and process
  your API input and output", and "Do not submit sensitive, confidential, or personal information to the Unpaid
  Services" (aistudio.google.com/docs/terms, effective March 23, 2026). The paid tier does not use prompts to improve
  products.

Also looked at, and not listed above: **Groq**'s documentation answered "Access denied" to this network, so nothing
about it was read from its own pages. **Cerebras** says there is no permanently free tier, only a trial credit
(inference-docs.cerebras.ai/support/rate-limits). **Mistral**'s free mode "may use your data (input and output) to
train" its models unless the account opts out (help.mistral.ai).

**Recommendation: Cloudflare Workers AI.** The visitors are people with an inherited house, a foreclosure notice,
tenants, a divorce. Even with personal details removed, their questions describe hard situations. Cloudflare's own
page says it neither trains on nor keeps what it is sent, the free allocation covers about twice the default daily
ceiling, and one named company receives the questions, so the privacy page can say exactly where they go. Set
`ASSISTANT_PROVIDER_NAME=Cloudflare`. Do not use a free tier whose terms allow training or human review of the text.

**The model path has been tested here against a stand-in, never against a real service.** No model service was called
while building this. Before turning a model on, send a few questions through it on a staging copy and read the log
lines: `answered … model` means its replies pass the check; a run of `… local` means they do not, and the search is
doing the work.

## How well the search alone does

`test/assistant-search.test.js` holds 73 questions typed the way sellers type them (48 English, 25 Spanish; typos, no
punctuation, long stories), each with the answer or hand-off it should get. Every third question was held out while
the method was tuned. Measured 2026-11-27, search alone, no model:

- tuning set: 45 of 49 (92%)
- held-out set: 16 of 24 (67%)

Of the held-out misses, 6 were hand-offs where the site has an answer (the safe failure) and 2 were a wrong answer. The
most common cause is two pages giving nearly the same answer (a FAQ entry and a guide), which the "clearly ahead" rule
reads as a tie and hands to Nathanael. The test fails if either score drops below a floor just under these numbers.

## Wiring (for whoever edits these files)

- `build.mjs` calls `finishAssistantBuild({ out, pages, env })` from `lib/assistant/collect.js` after the static files are
  copied and the pages rendered; it writes the answers (when on), removes the copied `assistant.js` (when off) or
  fingerprints it (when on), and returns the file name used in place of `src="/assistant.js"`. It also passes the
  stylesheet through `assistantStyles(css, env)`, which drops the assistant's marked section of `static/styles.css`
  when the assistant is off. With both, a build with the assistant off is byte-for-byte the build without this
  feature: pages, stylesheet and fingerprints.
- `server.mjs` routes `/api/assistant` to `api/assistant.js`, and may log `assistantStatus()` at start.
- On Vercel, a serverless function cannot read `dist/.assistant/answers.json` without extra configuration; this was built
  for the server (`server.mjs`), where it reads the file from `dist/` and reloads it after a rebuild.

## For the owner and an attorney

- The privacy paragraph (`askPrivacy` in `src/content-assistant.mjs`, both wordings) is legal text: an attorney should
  read it, and the provider's data terms, before the assistant is turned on with a model.
- California's bot-disclosure law (SB 1001) expects a bot to say it is one. The label says "(automated answers)", the
  line under the field says a program takes the answers from this website, and `/ask` says the same. Whether that is
  enough is for an attorney.
- The fixed replies are new copy in Nathanael's site's voice (`fixedReplies`): the owner should read them.
