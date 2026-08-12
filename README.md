# Plaidware Hub

One control plane for every Plaidware product — onboarding, provisioning,
access & roles, monitoring, billing, and automations.

Next.js 16 · Better Auth · Drizzle/Postgres · pg-boss · Stripe · Resend ·
Railway + Cloudflare.

## Quick start

```bash
cp .env.example .env       # fill in values
createdb plaidware_hub
npm install
npm run db:migrate
npm run dev                # web on :3000
npm run worker             # background jobs (separate terminal)
```

See CLAUDE.md for architecture and deployment notes.
