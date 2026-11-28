# Connecting an AI assistant (MCP)

## What it is

A private connection that lets Nathanael's Grok assistant look things up in the Call Harbison back end: who is
waiting for a call, what is in the pipeline, how the website is doing. It uses MCP (Model Context Protocol), the
standard way AI assistants reach outside tools.

The assistant can only **read**. It cannot change a lead, send a text or an e-mail, delete anything or visit a web
page. That is built in: the code behind it can only ask the database questions, never give it orders.

It is off until you switch it on.

## Switch it on

1. Make a token (a long random password for the assistant) on the server:

   ```bash
   openssl rand -hex 32
   ```

2. Add it to the settings file, `sudo nano /etc/call-harbison.env`:

   ```
   MCP_TOKEN=paste-the-64-characters-here
   ```

3. Restart the site: `sudo systemctl restart call-harbison`.

The address to give the assistant is `https://www.callharbison.com/api/mcp`, with the token.

## Wiring it into Grok

xAI's API takes a "remote MCP tool" (https://docs.x.ai/docs/guides/tools/remote-mcp-tools). With the xAI Python SDK:

```python
import os
from xai_sdk import Client
from xai_sdk.chat import user
from xai_sdk.tools import mcp

client = Client(api_key=os.getenv("XAI_API_KEY"))
chat = client.chat.create(
    model="grok-4.7",
    tools=[
        mcp(
            server_url="https://www.callharbison.com/api/mcp",
            server_label="call_harbison",
            server_description="Call Harbison leads, pipeline and website statistics (read-only)",
            authorization=os.getenv("CALL_HARBISON_MCP_TOKEN"),
        ),
    ],
)
chat.append(user("Who is waiting for a first call?"))
# Read the reply the way xAI's guide shows (it streams with chat.stream()).
```

As a raw tool object (xAI's REST API, `POST https://api.x.ai/v1/responses`, in `tools`):

```json
{
  "type": "mcp",
  "server_url": "https://www.callharbison.com/api/mcp",
  "server_label": "call_harbison",
  "server_description": "Call Harbison leads, pipeline and website statistics (read-only)",
  "authorization": "the token"
}
```

`authorization` is the token on its own; the server accepts it with or without `Bearer ` in front. To offer only some
tools, add `allowed_tools` (`allowed_tool_names` in the Python SDK), for example `["crm_overview", "list_leads"]`.
The server speaks both the current MCP revision (2026-07-28) and the older ones (2025-11-25 back to 2024-11-05), over
plain HTTP POST with JSON replies.

## The six tools

- `crm_overview`: today's dashboard numbers, the leads waiting for a first call and the next appointments.
- `list_leads`: leads by view (open, new, follow-ups due, closed, all), stage, path, website or date, newest first.
- `get_lead`: one lead in full, with its newest 30 activity entries.
- `pipeline_report`: how the leads of the last 7 to 365 days moved through the pipeline, won deals, speed to first contact.
- `site_analytics`: website visits, pages, referrers, form starts, leads sent, call and text clicks.
- `system_status`: is the back end working (database, backups, alerts, statistics).

Spam and leads in the trash never appear. Times are given in UTC with a ready-made length ("waiting 2 h 15 min").

## Sellers' personal information

Everything the assistant reads goes to xAI, a company outside the business. So by default it sees **no** names, phone
numbers, e-mail addresses, street addresses, notes or activity text: only ZIP codes, dates, stages, paths and a link
that opens each lead in the admin panel, behind the HQ password. If you add `MCP_CONTACT_DETAILS=on` to the settings
file and restart, the assistant can see and search sellers' names, phone numbers, e-mail, addresses, notes and lost
reasons, and they are sent to xAI each time it looks at a lead. That is your decision about sellers' information;
check that the privacy page covers it before you switch it on.

Text in a lead (the situation, notes, activity) can be typed by anyone who fills in the website form. The assistant
is told that it is data to report, never instructions to follow, and the text is cleaned and shortened before it is
sent.

## Check that it works

From the server (Node reads the token from the settings file, so it never lands in your shell history):

```bash
sudo node --env-file=/etc/call-harbison.env /srv/call-harbison/current/scripts/mcp-check.mjs https://www.callharbison.com/api/mcp
```

or from any computer with Node and a copy of the site: `MCP_TOKEN=… node scripts/mcp-check.mjs https://www.callharbison.com/api/mcp`.

It signs in, lists the tools, asks for the system status and today's overview, and says what came back in plain
words, ending with `All checks passed.` It prints counts only, never a name or the token. If something is wrong it
says what, for example that the token was refused.

Each call shows in the log as one line, such as `[mcp] tools/call crm_overview ok 12ms`
(`journalctl -u call-harbison | grep mcp`). A wrong token shows as `[security] mcp sign-in failed from <address>`;
after 10 failures in 15 minutes, further wrong tokens from that address are turned away for 15 minutes without being
logged. The right token always works, so nobody can lock the assistant out by sending wrong ones. All callers
together get 120 calls a minute.

This has been tested against this repository's own client (the check above and the automated tests), not yet
against Grok itself.

## Switch it off, or change the token

- Off: delete the `MCP_TOKEN=` line from `/etc/call-harbison.env` and restart. The address then answers "Not found",
  like any address that does not exist.
- New token: make one with `openssl rand -hex 32`, replace the old one in the settings file, restart, and give the
  new one to the assistant. The old token stops working at once.

## For developers

`api/mcp.js` (HTTP checks: on/off, POST only, Origin, rate limits, token), `lib/mcp/protocol.js` (JSON-RPC and both
protocol eras), `lib/mcp/tools.js` (the tools), `lib/mcp/crm-read.js` (the only database access: GET on `leads` and
`lead_events`, named columns). Optional `MCP_ALLOWED_ORIGINS` (comma-separated) admits browser origins other than
`SITE_URL`'s; servers send no `Origin` and are always admitted. Tests: `test/mcp-protocol.test.js`, `test/mcp-tools.test.js`.
