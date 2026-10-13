# The Million Dollar Globe

The Million Dollar Homepage, but on a globe: 998,784 pixels at €1 each. Buyers pick a block of at least 10 pixels (max 100×100), paint every pixel or upload an image, and add a name and a link.

The grid is a cube-sphere: a cube with 408×408 cells per face, inflated into a ball. Cells are about 22 km across everywhere, and the biggest is under 1.5× the size of the smallest, so there are no tiny pixels at the poles. A block stays on one cube face.

**Stack:** Next.js · three.js · Supabase (Postgres) · Stripe Checkout

## Setup

1. **Supabase:** create a project. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql). If you ran an older version, run `drop table orders;` first.
2. **Stripe:** create an account (test mode is fine to start).
3. Copy the env file: `cp .env.example .env.local`, then fill in:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API. Keep the service key secret.
   - `STRIPE_SECRET_KEY`: Stripe → Developers → API keys.
   - `STRIPE_WEBHOOK_SECRET`: printed by `stripe listen` (see below), or in production by the dashboard webhook.
4. Run it locally:
   ```bash
   npm install
   npm run dev
   stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook   # second terminal
   ```
   Buy a block with test card `4242 4242 4242 4242`.

## Deploy (Vercel)

1. Import the repo into Vercel and set the same env vars. Set `SITE_URL` to your domain.
2. In Stripe → Webhooks, add `https://<domain>/api/stripe/webhook` with the events `checkout.session.completed` and `checkout.session.expired`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Fill in the placeholders in [`app/terms/page.tsx`](app/terms/page.tsx). Stripe needs a contact address and a refund policy on the site.

## How it works

- **No double-selling:** an exclusion constraint on `orders.rect` in Postgres rejects overlapping pending or paid blocks.
- **Holds while paying:** a block is held as `pending` for 35 minutes while the buyer pays. Checkout itself expires after 30 minutes. Cancelling or abandoning checkout frees the block.
- **Late payments:** if a payment arrives after its block was resold, it is refunded automatically.
- **Moderation:** `update orders set status = 'hidden' where id = '…';`

## Checks

```bash
npm run check   # grid math, cell sizes, pixel encoding
```
