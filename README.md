# CAF Portal

Multi-tenant Customer Application Form (CAF) portal for ISPs. Customer data and documents stay on **your own servers** instead of a third-party RADIUS provider.

## Features

- **Multi-tenant** — Create companies (e.g. `Infolink Broadband`) each with a unique **Company Code** (e.g. `INFOBB2548`). Companies can create multiple **franchises**.
- **Role-based access** — `SUPER_ADMIN` (ISP owner), `COMPANY_ADMIN` (company-level), `FRANCHISE_USER` (franchise-level).
- **Scoped CAF entry** — Company admins can file CAFs for any franchise in their company. **Franchise users can only file for their own franchise**. All listings are filtered by scope.
- **Document uploads** — Attach ID proofs, photos, address proofs, etc. Stored with per-file tracking. Served through authenticated endpoints only.
- **Pluggable storage (Super Admin only)** — Switch between **Local Disk** and **S3-compatible** (AWS S3, MinIO, DigitalOcean Spaces, Wasabi). Documents uploaded under the old provider remain readable after switching. Secrets are encrypted at rest.
- **Review workflow** — `SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED` with reasons and audit trail.
- **Audit logging** — Key actions (logins, company/franchise/user creation, CAF submissions/reviews, storage changes) are recorded.
- **Future-ready** — Clean seams to plug Identity Providers (e.g. Aadhaar e-KYC) and payment gateways later.

## Tech Stack

- **Next.js 15** (App Router, TypeScript) — full-stack, scalable
- **PostgreSQL 16 + Prisma** — shared-schema multi-tenancy
- **Tailwind CSS v4**
- **JWT sessions (httpOnly cookies)**

## Deployment (On-Prem Linux Server)

### 1) Prepare

```bash
cp .env.example .env
```

Edit `.env` — set at minimum:
- `POSTGRES_PASSWORD`
- `AUTH_SECRET` (generate with `openssl rand -hex 32`)

### 2) Start with Docker Compose

```bash
docker compose up -d --build
```

On first run with `RUN_SEED=1` in `.env`/environment, the entrypoint runs migrations and seeds demo accounts:

| Role | Email | Password | Notes |
|---|---|---|---|
| Super Admin | `superadmin@example.com` | `ChangeMe@123` | Manage companies & storage settings |
| Company Admin (Infolink) | `admin@infolink.example` | `ChangeMe@123` | Demo data |
| Franchise User (Main Counter) | `franchise@infolink.example` | `ChangeMe@123` | Demo data |

**Change all default passwords immediately.**

### 3) Access

Open [http://localhost:3000](http://localhost:3000) (or your server IP).

## Local Development (without Docker)

```bash
npm install
cp .env.example .env
# Update DATABASE_URL to point to your local Postgres
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

## Storage Configuration

1. Log in as **Super Admin**
2. Go to **Admin → Storage Settings**
3. Choose **Local Disk** (default) and set a base path, or **S3-compatible** with bucket/endpoint/keys
4. Use **Test Connection** to verify
5. **Save Settings**

New CAF documents go to the active provider. Existing documents remain accessible because each document stores its upload-time provider snapshot.

## Security Notes

- Documents are served via `/api/documents/[id]` with strict role + tenancy checks. Never expose the `storage/` directory directly.
- Storage provider credentials are encrypted with AES-256-GCM using `AUTH_SECRET` before being saved to the database.
- Passwords are hashed with scrypt.
- Tenant boundaries are enforced on both UI routes and API endpoints.
- Franchise users cannot access other franchises’ CAFs or documents.

## Directory Structure (high level)

```
caf-portal/
├── prisma/           # Schema, migrations, seed
├── src/app/          # Next.js App Router (pages + API routes)
├── src/components/   # UI components
├── src/lib/          # Auth, guard, storage, utilities
├── Dockerfile
└── docker-compose.yml
```

## Extending

- **Aadhaar/KYC, payment gateways** — Add providers under `src/lib/integrations/` and wire them into the CAF review/provisioning flow.
- **OIDC/LDAP** — Replace `src/lib/session.ts` / login route with your IdP.
- **Reports/exports** — Add CSV/PDF exports scoped by tenant.
- **Bulk migrations** — Copy objects between providers by iterating documents and using the stored keys.
