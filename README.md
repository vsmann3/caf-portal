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
## CAF form redesign (2026-10-21)

New CAFs support residential and business customers. Business applications require
a registered business name, GST number and GST certificate. Both installation
and billing addresses are required; the billing address may be copied from the
installation address. States and dependent city lists are bundled locally. PIN
lookup uses a server-side postal service with a manual correction/failure path.
Address data attribution and update instructions are in `src/data/README.md`.

Service usernames are assigned from the first name plus the last five mobile
digits, increasing to six, seven and up to ten digits on collision, then a suffix
if needed. They are unique across all franchises of a company, while different
companies may reuse them. Availability is advisory until submission. Database
constraints and company-scoped allocation handle concurrent submissions. Existing
usernames are retained during corrections; external RADIUS availability is not
checked or promised by this feature.

Use **Save draft** to save partial field values on the server; resume from **New
CAF**. Drafts are private to their owner and tenancy. Selected files are not saved
in drafts and must be reattached before submission. Concurrent draft edits show a
conflict rather than overwriting another tab's changes. Review the summary before
submitting. Photo, identity proof and address proof are required, plus the GST
certificate for businesses. Uploads are limited to 4 MiB per file (labelled 4 MB),
10 documents and a 42 MiB total multipart request. Existing larger documents remain
readable. Basic file signature checks supplement MIME/size checks; these are not
malware scanning or document authenticity verification.

Rejected CAF detail pages offer **Correct and resubmit**. The CAF number and
username are retained, the revision increases, and prior fields/document references
are recorded in the audit log. Uploading a category again replaces that category
in the active CAF; its previous original files remain stored. Approved applications
cannot be edited through this flow. Approval records an immutable snapshot of the
reviewed details/document references for the later PDF implementation. Previously
approved records are not retroactively snapshotted. The acknowledgement is by the
submitting staff member, not a customer signature. Customer signing, approved PDF
downloads, Surepass identity/GST, contact verification, S3 and real RADIUS API
provisioning remain roadmap work in `PRODUCT-NOTES.md`.

## Upgrade and test

The additive migration preserves existing records and document references. Before
rebuilding an existing deployment, check for duplicate legacy usernames within a
company. On the Linux VM:

```sh
git pull --ff-only origin main
cat scripts/check-caf-usernames.sql | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U cafapp -d caf_portal
```

On PowerShell, replace `cat scripts/check-caf-usernames.sql` with
`Get-Content scripts/check-caf-usernames.sql`. An empty result is expected. If
duplicates appear, review them before deployment; the migration stops rather than
renaming existing accounts. A failed migration is rolled back at the SQL level,
but Prisma may record it as failed: after resolving the actual conflict through a
reviewed process, an operator must mark this migration rolled back with Prisma
Migrate Resolve before retrying. Never reset the database to resolve it.

After a clean preflight:

```sh
docker compose up -d --build --no-deps app
docker compose logs --tail=80 app
```

Keep `RUN_SEED=0` for normal operation. No `.env` replacement, database reset or
volume removal is needed. The entrypoint applies the additive migration before
starting the server. Existing CAFs may lack the newly required values; these are
required on new submissions/corrections, not invented for historical records.

Validation scripts (disposable fixtures only):

```sh
node --test scripts/test-production-startup.cjs
sh scripts/test-caf-upgrade.sh
CAF_TEST_IMAGE=<built-image> sh scripts/test-docker-startup.sh
CAF_TEST_IMAGE=<built-image> sh scripts/test-super-settings.sh
```

The settings integration harness also runs `test-caf.cjs`, covering real HTTP
submissions, scoping, usernames, business requirements, upload limits, drafts and
review/correction. `test-caf-browser.cjs` accepts a temporary Playwright module
path, an SSH-forwarded isolated URL and an artifact directory, and uses installed
Chrome for desktop/mobile form checks. Its fixture credentials are test-only.

## Staff Profile Settings

Every staff account (Super Admin, Company Admin/owner and Franchise User/owner)
can open **Profile Settings** from navigation. This is staff account management;
it does not add customer login or customer email verification.

- **Verify/reverify email:** enter the current email and current password, request
  a code, then confirm the six-digit code sent through the portal's SMTP service.
- **Change email:** enter a new email and current password. The existing login
  email remains active until the new mailbox's code is confirmed. Confirmation
  verifies the new email and signs out existing sessions; sign in with the new
  email and existing password afterward. A duplicate email cannot be claimed.
- **Change password:** enter the current password and confirm a new password of
  at least 12 characters (maximum 128). Password changes sign out existing
  sessions, including the current session. Passwords are never emailed.

SMTP must be configured and enabled in **Super Settings** to verify email.
Disabled or failed delivery leaves the login email unchanged; password changes
remain available without SMTP. Codes expire after 10 minutes, allow five attempts,
are single-use and have a 60-second resend cooldown. Sensitive profile requests
are limited to 10 per account per 10 minutes using database-backed counters.
Only an HMAC of the code is stored; codes/passwords are not returned by the
profile API or placed in profile audit entries.

The additive `20261021200000_staff_profiles` migration leaves existing staff email
addresses and password hashes unchanged. Existing accounts initially show
"Email not yet verified" and are not forced out of the portal. Versionless
sessions from earlier releases remain valid until a credential change revokes
them. Admin changes to a staff email clear its verification timestamp, and admin
email/password changes also revoke existing sessions. Roles/company/franchise
assignments cannot be edited through self-service Profile Settings.

Deploy with the usual `git pull --ff-only origin main` and
`docker compose up -d --build --no-deps app`; startup applies the migration. Keep
`RUN_SEED=0`. No environment replacement, database reset or document migration is
required. The integration harness also runs `scripts/test-profile.cjs` with
disposable PostgreSQL/SMTP fixtures. `test-profile-browser.cjs` takes a temporary
Playwright module path, isolated app and SMTP-capture localhost URLs, and a
screenshot directory to exercise real verification and password flows in Chrome.
