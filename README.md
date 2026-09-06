# Site Visitor Management — 256a Remuera Road

Multi-device visitor sign in/out system, with hazard board acknowledgement,
hazard ID reporting, and near miss / observation reporting.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `PORT` | No | Defaults to 3000 |
| `SMTP_HOST` | For email alerts | SMTP server host |
| `SMTP_PORT` | No | Defaults to 587 |
| `SMTP_SECURE` | No | Set to `true` for port 465 (implicit TLS) |
| `SMTP_USER` | For email alerts | SMTP auth username |
| `SMTP_PASS` | For email alerts | SMTP auth password / API key |
| `SMTP_FROM` | No | Defaults to `SMTP_USER` |

Near miss / observation reports are always emailed to `joshs@sansom.co.nz` and
`shaun@sansom.co.nz` (hardcoded in `server.js`) whenever SMTP is configured.
Without `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` set, the app logs a warning on
startup and reports are still saved — they just aren't emailed.

### Setting up email alerts with SendGrid (recommended)

Microsoft 365 has increasingly restricted basic SMTP auth, so SendGrid's free
tier (100 emails/day) is the simplest reliable option:

1. Sign up at https://signup.sendgrid.com/ (free tier is enough).
2. Under **Settings → Sender Authentication**, verify a single sender email
   address (e.g. an address at `sansom.co.nz` you control) — SendGrid requires
   this before it will relay mail from that address.
3. Under **Settings → API Keys**, create a key with "Mail Send" permission.
4. Set these environment variables on the host (Railway, Render, etc.):
   - `SMTP_HOST=smtp.sendgrid.net`
   - `SMTP_PORT=587`
   - `SMTP_USER=apikey` (this is literally the string `apikey`, not your key)
   - `SMTP_PASS=<the API key from step 3>`
   - `SMTP_FROM=<the verified sender address from step 2>`
5. Redeploy. Submitting a near miss / observation should now email both
   recipients.
