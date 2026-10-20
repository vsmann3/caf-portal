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

`SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` are used to create the initial database account when `RUN_SEED=1`; they are not a separate login mechanism. Changing these variables does not reset an existing account password. After initial creation, set `RUN_SEED=0`. The Docker image includes compiled seed code, and a requested seed failure stops startup rather than being ignored.

The initial migration creates the application tables on a fresh database. An existing installation whose tables were created outside Prisma Migrate needs a reviewed migration baseline before deploying this initial migration; do not reset the database or blindly mark migrations applied.

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

## Super Settings and Email

Super Admins can open **Super Settings** to manage **General Portal Settings**, **Email Settings (SMTP)** and the existing **RADIUS Integration**. Each accordion has its own save action; saving one section does not save or discard edits in another. The old `/admin/radius` address redirects to the RADIUS section.

1. Save the portal name, public portal URL and support email under General Portal Settings. The name appears on the login page/sidebar; welcome emails use the saved URL and support address. `APP_URL` is the fallback before a URL is saved.
2. Enter your SMTP host/port, security mode, authentication credentials, sender and optional reply-to address. Use implicit TLS for the server's TLS port (usually 465), or STARTTLS for its submission port (usually 587). Unencrypted mode is available for a trusted relay.
3. Save Email Settings, then use **Send Test Email** with your chosen recipient. The test uses saved settings and can be sent while automatic welcome emails are disabled. SMTP acceptance is not a guarantee of inbox delivery.
4. Enable welcome emails and save Email Settings. Accounts created through the Users page/API receive a welcome message with their email, role and login link. The administrator shares the initial password separately; passwords are not emailed.

SMTP passwords are encrypted in `SystemSetting`, never returned to the browser, and kept when the password input is left blank. Authentication can be disabled for a trusted relay; doing so removes the saved password. The saved secret depends on `AUTH_SECRET`; changing that secret requires re-entering SMTP credentials.

If delivery fails, the account remains created and the Users page shows a warning. Fix SMTP settings and use **Send welcome email** on that user to retry. Company admins can resend only to active franchise users in their own company. Bootstrap/demo seeding does not send emails. Automatic background email retries are not included in this release.

The known Storage Settings 404 remains deferred; this email/settings work does not change storage or migrate documents.

For development validation, `bash scripts/test-super-settings.sh` builds and tests against a disposable PostgreSQL database and a local SMTP capture server. It does not use production `.env` settings or deliver messages externally. Set `CAF_TEST_IMAGE=<image>` to test an already-built image.

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

See [Product notes and improvement plan](PRODUCT-NOTES.md) for known gaps, CAF form suggestions, Surepass verification plans, future mobile/email verification, the local-to-S3 storage roadmap, and approved CAF PDF/evidence export requirements.

- **Aadhaar/KYC, payment gateways** — Add providers under `src/lib/integrations/` and wire them into the CAF review/provisioning flow.
- **OIDC/LDAP** — Replace `src/lib/session.ts` / login route with your IdP.
- **Reports/exports** — Add CSV/PDF exports scoped by tenant.
- **Bulk migrations** — Copy objects between providers by iterating documents and using the stored keys.
