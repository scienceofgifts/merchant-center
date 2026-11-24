# Science of Gifts Merchant Feed Optimizer — Cloudflare Deployment Guide

This application deploys as a **single Cloudflare Worker with Static Assets and Cloudflare D1** (`wrangler.jsonc` + `worker.ts` + `./dist`).

---

## 1. Architecture Summary

- **Frontend:** React + Vite built into `./dist`, served by Cloudflare Workers Static Assets (`env.ASSETS`) with SPA fallback routing (`"not_found_handling": "single-page-application"`).
- **Backend API:** Root-level `worker.ts` intercepts all `/api/*` requests first (`"run_worker_first": ["/api/*"]`) on the same origin.
- **Database:** Cloudflare D1 (`env.DB`) stores relational tables for `products`, `product_variants`, `product_identity_mappings`, `website_sync_mappings`, `catalog_settings`, and `catalog_backups`.
- **Google AI Studio Preview:** `vite.config.ts` and `server.ts` mount `server/viteWorkerMiddleware.ts`, which invokes `worker.ts` locally against an isolated SQLite D1 development database (`data/dev-d1.sqlite`).

---

## 2. Required Cloudflare Bindings & Secrets

| Type | Name | Required | Purpose |
| :--- | :--- | :--- | :--- |
| **D1 Binding** | `DB` | **Yes** | Permanent server-side relational storage for catalog products, variants, mappings, settings, and backups. |
| **Assets Binding** | `ASSETS` | **Yes** | Configured automatically via `assets.binding = "ASSETS"` in `wrangler.jsonc` to serve `./dist`. |
| **Worker Secret** | `GEMINI_API_KEY` | **Yes** (for AI features) | Server-side Gemini API key (`env.GEMINI_API_KEY`). Not required for CSV import, matching, Website Feed Sync, or deduplication. |
| **Worker Secret** | `CF_ACCESS_TEAM_DOMAIN` | Recommended | Your Cloudflare Zero Trust team domain (e.g., `scienceofgifts.cloudflareaccess.com`) for in-Worker JWT signature verification. |
| **Worker Secret** | `CF_ACCESS_AUD` | Recommended | Your Cloudflare Access Application Audience (AUD) tag for in-Worker JWT verification. |
| **Worker Secret** | `ADMIN_API_TOKEN` | Optional | Optional shared secret bearer token (`Authorization: Bearer <token>`) for CLI/script access or fallback authentication. |

---

## 3. Step-by-Step Deployment Instructions

### Step 1: Authenticate Wrangler with Cloudflare
```bash
npx wrangler login
```

### Step 2: Create the Production Cloudflare D1 Database
Run the following command once to provision your D1 database:
```bash
npm run cf:d1:create
# Equivalent to: npx wrangler d1 create science-of-gifts-merchant-feed-db
```
Copy the `database_id` UUID output by Wrangler and paste it into `wrangler.jsonc` in place of `<YOUR_D1_DATABASE_ID>`:
```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "science-of-gifts-merchant-feed-db",
      "database_id": "YOUR-ACTUAL-D1-UUID-HERE",
      "migrations_dir": "migrations"
    }
  ],
```

### Step 3: Apply the D1 Database Schema Migration
Apply `migrations/0001_initial_schema.sql` to your remote production D1 database:
```bash
npm run cf:d1:migrate:remote
# Equivalent to: npx wrangler d1 migrations apply science-of-gifts-merchant-feed-db --remote
```
*(To test migrations against a local Wrangler D1 instance first, run `npm run cf:d1:migrate:local`.)*

### Step 4: Configure the Server-Side Gemini API Key Secret
Store your Gemini API key securely as a Cloudflare Worker secret (never commit it to `wrangler.jsonc` or frontend files):
```bash
npx wrangler secret put GEMINI_API_KEY
```

### Step 5: Protect the Application with Cloudflare Access (Private Catalog Authentication)
Because this is a private catalog management tool:
1. In the **Cloudflare Dashboard**, navigate to **Zero Trust > Access > Applications > Add an application > Self-hosted**.
2. Set the Application Domain to your Worker domain or custom route (e.g., `feed-optimizer.scienceofgifts.com`).
3. Create an Access Policy allowing only your authorized email(s) (e.g., `scienceofgifts@gmail.com`).
4. Copy the **Application Audience (AUD) Tag** from the Cloudflare Access application overview and configure in-Worker JWT verification:
   ```bash
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
   npx wrangler secret put CF_ACCESS_AUD
   ```

### Step 6: Build and Deploy the Single Worker with Static Assets
```bash
npm run cf:deploy
# Equivalent to: vite build && wrangler deploy
```

---

## 4. Post-Deployment Verification Checklist

- [ ] **1. Health & D1 Binding Check:** Visit `/api/health` on your deployed Worker URL and confirm `"storageBackend": "cloudflare-d1"` and `"environment": "production"`.
- [ ] **2. Authentication Gate:** Open the deployed URL in an incognito browser window and verify Cloudflare Access prompts for login before loading the app or `/api/products`.
- [ ] **3. Initial CSV Import:** Upload `science_of_gifts_merchant_feed_fixed.csv` via **Import CSV** and confirm all 161 parent designs (642 variants) import cleanly into D1.
- [ ] **4. Idempotent Repeat CSV Import:** Re-import the exact same CSV and verify **0 new products added** and **0 duplicate variants created**.
- [ ] **5. Fourthwall Website Feed Sync:** Open **Website Feed Sync**, fetch `https://shop.scienceofgifts.com/.well-known/merchant-center/rss.xml`, verify existing designs match deterministically, and apply any new products.
- [ ] **6. Idempotent Repeat Website Sync:** Run Website Feed Sync a second time immediately and confirm **0 new products** and **0 new variants** are added.
- [ ] **7. Reload Persistence:** Refresh the browser and confirm all catalog products, variant counts, and sync metadata load from Cloudflare D1.
- [ ] **8. Optimized Field Preservation:** Edit a product title or custom label, save, re-run Website Feed Sync in default Add-Only mode, and confirm your custom title, description, and labels remain untouched.
- [ ] **9. Merchant Center Export:** Click **Export CSV** (`/api/export-csv`) and verify the downloaded CSV contains all expanded variant rows with valid Merchant Center attributes.
