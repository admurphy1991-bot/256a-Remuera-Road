# Site Visitor Management — Canopy Construction

Multi-device visitor sign in/out system, with hazard board acknowledgement,
hazard ID reporting, and near miss / observation reporting.

This is an independent copy of the app originally built for Sansom
Construction Systems — it has its own codebase, and should be deployed with
its **own separate database and hosting**, not shared with any other
company's deployment.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string (must be a dedicated database for this deployment) |
| `PORT` | No | Defaults to 3000 |
| `SITE_NAME` | No | Shown in the app header, browser title, and email subject lines. Defaults to "Canopy Construction Site" |
| `ALERT_RECIPIENTS` | For email alerts | Comma-separated list of email addresses to receive Near Miss / Observation alerts, e.g. `alice@canopy.co.nz,bob@canopy.co.nz` |
| `SMTP_HOST` | For email alerts | SMTP server host |
| `SMTP_PORT` | No | Defaults to 587 |
| `SMTP_SECURE` | No | Set to `true` for port 465 (implicit TLS) |
| `SMTP_USER` | For email alerts | SMTP auth username |
| `SMTP_PASS` | For email alerts | SMTP auth password / API key |
| `SMTP_FROM` | No | Defaults to `SMTP_USER` |
| `MAKE_WEBHOOK_URL` | For webhook alerts | Make.com (or any) webhook URL |

Without `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` and `ALERT_RECIPIENTS` all set,
the app logs a warning on startup and reports are still saved — they just
aren't emailed.

Independently, if `MAKE_WEBHOOK_URL` is set, every new report is also POSTed
as raw JSON to that URL (fields: `id`, `type`, `description`, `location`,
`reportedBy`, `company`, `contact`, `reportedTime`). The two notification
paths don't depend on each other — use one, the other, or both.

## Before going live

- **Change the CSV/hazard board download password.** It's currently
  `ChangeMe123`, hardcoded near the top of the `<script>` block in
  `public/index.html` (`let CSV_PASSWORD = ...`). This is a client-side
  check only — anyone who views page source can see it — so treat it as a
  basic deterrent, not real security.
- **Replace the placeholder logo** at `public/logo.svg` with Canopy
  Construction's actual logo (same filename, or update the two `<img>` tags
  in `public/index.html` that reference it).
- **Set `SITE_NAME`** so the header, browser tab, CSV filenames, and email
  subject lines show the correct site/address rather than the default.
- **Provision a dedicated Postgres database** for this deployment. Do not
  point `DATABASE_URL` at another company's or another site's database —
  visitor sign-ins and hazard data would mix together in the same tables.

### Setting up a Make.com webhook

1. In Make.com, create a new scenario starting with a **Webhooks → Custom
   webhook** trigger, and copy the generated URL.
2. Set `MAKE_WEBHOOK_URL` to that URL as an environment variable on the host.
3. Redeploy. Submit a test near miss / observation on the site — Make.com's
   scenario editor will show the payload it received, which you can then use
   to build whatever routing you want (email, Slack, SMS, a spreadsheet row,
   etc.) with Make's own modules.

### Setting up email alerts with SendGrid (recommended)

Microsoft 365 has increasingly restricted basic SMTP auth, so SendGrid's free
tier (100 emails/day) is the simplest reliable option:

1. Sign up at https://signup.sendgrid.com/ (free tier is enough).
2. Under **Settings → Sender Authentication**, verify a single sender email
   address you control — SendGrid requires this before it will relay mail
   from that address.
3. Under **Settings → API Keys**, create a key with "Mail Send" permission.
4. Set these environment variables on the host (Railway, Render, etc.):
   - `SMTP_HOST=smtp.sendgrid.net`
   - `SMTP_PORT=587`
   - `SMTP_USER=apikey` (this is literally the string `apikey`, not your key)
   - `SMTP_PASS=<the API key from step 3>`
   - `SMTP_FROM=<the verified sender address from step 2>`
   - `ALERT_RECIPIENTS=<comma-separated list of who should get alerts>`
5. Redeploy. Submitting a near miss / observation should now email everyone
   in `ALERT_RECIPIENTS`.
