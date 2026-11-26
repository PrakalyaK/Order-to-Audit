# Vercel Deployment Guide — Order-to-Audit ERP

This full-stack application (React 19 Vite + Express Node.js + PostgreSQL) is fully configured for zero-config deployment on [Vercel](https://vercel.com).

---

## 1. Prerequisites: Cloud PostgreSQL Database

Vercel functions are serverless and require a cloud-hosted PostgreSQL database. You can use any free managed PostgreSQL service:

- **[Neon](https://neon.tech)** (Recommended — 0.5 GB free, instant setup)
- **[Supabase](https://supabase.com)** (Free tier PostgreSQL)
- **[Vercel Postgres](https://vercel.com/storage/postgres)** (Native Vercel integration)
- **[Railway](https://railway.app)** or **[Render](https://render.com)**

Copy your PostgreSQL connection string (`DATABASE_URL`), which looks like:
```text
postgresql://user:password@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

---

## 2. Deploy to Vercel (Step-by-Step)

### Option A: Via Vercel Web Dashboard (Recommended)

1. Push this repository to your **GitHub / GitLab / Bitbucket** account.
2. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **"Add New..." &rarr; "Project"**.
3. Import your `Order-to-Audit` repository.
4. Leave **Framework Preset** as **Other** (or Vite).
5. In **Root Directory**, keep it as `./` (the project root).
6. Under **Environment Variables**, add the following:

| Key | Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/dbname?sslmode=require` | Your cloud PostgreSQL connection string |
| `JWT_SECRET` | `order-to-audit-jwt-super-secret-key-2026` | Cryptographic secret key (32+ chars) |
| `NODE_ENV` | `production` | Production environment |
| `ENABLE_DEMO_LOGIN` | `true` | Enables 1-click persona logins on login page |

7. Click **"Deploy"**.

---

### Option B: Via Vercel CLI

```bash
# 1. Install Vercel CLI (if not installed)
npm install -g vercel

# 2. Login and link project
vercel

# 3. Add environment variables
vercel env add DATABASE_URL
vercel env add JWT_SECRET

# 4. Deploy to production
vercel --prod
```

---

## 3. How the Architecture Works on Vercel

```
                         [User / Browser]
                                |
               +----------------+----------------+
               |                                 |
        /assets/*, /products/*,                 /api/v1/*,
        SPA pages (/*)                          /health
               |                                 |
        [Vercel Edge CDN]               [Vercel Serverless Function]
        frontend/dist/                  api/index.js (Express app)
                                                 |
                                        [Cloud PostgreSQL]
                                        (Neon / Supabase / RDS)
```

- **Frontend Assets**: Vite builds into `frontend/dist/`. Vercel automatically hosts HTML, JS, CSS, and `/products/` images on its global Edge CDN.
- **Backend API**: All `/api/(.*)` requests route via `vercel.json` rewrites directly to `api/index.js` (running the Express app).
- **Auto-Migration Engine**: On the very first API request, `runAutoMigrations()` automatically verifies if tables exist in your cloud database. If not, it executes all 13 SQL migrations and seeds benchmark data automatically!
- **SPA Routing**: Client-side navigation (`/master/boms`, `/sales/orders`, `/production`, etc.) rewrites to `/index.html` to eliminate 404s on page refresh.

---

## 4. Default Seeded Logins (Demo Personas)

| Role | Username | Password | Purpose |
|---|---|---|---|
| **Managing Director** | `owner_main` | `Password@123` | Executive oversight & financial approval |
| **Factory Admin** | `admin_factory` | `Password@123` | Order approval, dispatch, fulfilment |
| **Floor Supervisor** | `supervisor_floor` | `Password@123` | BOM recipes & production batch runs |
| **Salesman A (TN)** | `salesman_a` | `Password@123` | Mobile field orders (Retailer A) |
| **Salesman B (KA)** | `salesman_b` | `Password@123` | Mobile field orders (Distributor B) |
| **Statutory Auditor** | `auditor_ext` | `Password@123` | GST registers & immutable ledger audit |
