# Change log

## 2026-10-22: RADIUS runtime safety (proposed; not deployed)

- Remove fake `SKIPPED` provisioning success. Approval now atomically records a blocked, zero-attempt local RADIUS diagnostic with only Customer ID, organization IDs and the approved CAF reference. Original CAF/PDF proof data stays intact.
- Make RADIUS tokens write-only, encrypt on save, preserve blank inputs, support explicit removal, redact legacy values and validate settings. Tell administrators that delivery/activation are unavailable.
- Add real API/database and Chrome safety tests. Docker production build, five isolated integration suites, six startup checks and 38 contract fixture tests passed; runtime Prisma/client remain 6.19.3. No dependency/migration/wire-schema or production changes. See `docs/integrations/radius/RUNTIME-SAFETY.md` for compatibility, payload and validation details.

## 2026-10-21: global Customer IDs and approved CAF PDF exports

- Assign every saved draft/submitted CAF an automatic, globally unique 10-digit Customer ID using a non-cycling PostgreSQL sequence and registry. Preserve IDs through draft submission and rejected-CAF correction; reject client overrides. Backfill existing CAFs/drafts and add IDs to existing approval snapshots without replacing reviewed data.
- Display/search Customer IDs on CAF/customer pages. Offer **Download CAF + documents PDF** only on approved CAFs, protected by existing staff company/franchise access rules.
- Build one PDF from the frozen approval snapshot, supporting image evidence and all pages of PDF attachments. Bundle licensed Noto Latin/Devanagari fonts into the production image. Explicitly label historical snapshots captured at first export and document copies that require originals for signature/form validation.
- Hash new uploads with SHA-256 and check integrity at export. Fail clearly on missing/changed/damaged/encrypted/unsupported evidence rather than delivering an incomplete file. Audit exports, prevent caching and limit concurrent export work and document size/page counts.
- Add concurrent-ID, draft transfer, approval/scoping, evidence-format, snapshot and failure-path integration checks; additive upgrade assertions and a real Chrome download check. Wait for the final PostgreSQL TCP listener in disposable harnesses to avoid catching its temporary initialization server.

Validation: production Docker image `caf-pdf:release` built successfully with TypeScript checks. All six local startup/dependency-preservation tests and Prisma schema validation passed. Disposable PostgreSQL upgrades backfilled existing CAF/draft IDs while preserving reviewed snapshot fields, staff credentials and historical document references. Real HTTP integration passed 24 concurrent draft allocations across companies, stable draft/correction IDs, client override rejection, database constraints, approved-only tenant-scoped exports, frozen snapshot data, JPEG/PNG/WebP and multipage PDF evidence, integrity/missing/corrupt-file failures, legacy snapshots and audit entries. Existing CAF, SMTP and staff profile suites passed. Chrome downloaded the combined PDF from the CAF button with the correct filename and found the record by Customer ID; desktop/mobile screenshots were inspected. All nine pages of the actual-container test PDF were rendered and reviewed, including Hindi text and both source PDF pages; text checks confirmed attachment names, frozen data and preservation of the legacy additional address. Offline runtime Prisma/client 6.19.3 checks, migration-failure exit, seeded login/dashboard and HTTP startup smoke passed. No production database, uploaded files or environment configuration was changed.

## 2026-10-21: staff Profile Settings

- Add Profile Settings for every existing staff role (Super Admin, Company Admin and Franchise User), including owners using those roles. Keep customer onboarding/contact verification separate.
- Allow current-email verification/reverification and new-email verification using the portal's enabled SMTP service. Keep the existing login email until confirmation; show delivery errors without changing it.
- Clarify the SMTP enable checkbox as portal email delivery for both welcome and staff verification messages; saved-configuration test messages remain available while delivery is disabled.
- Protect codes with HMAC storage, 10-minute expiry, five attempts, single-use consumption and a 60-second resend cooldown. Add database-backed profile request limits and current-password checks before sending or changing a password. Keep secrets out of API responses and profile audit entries.
- Require the current password and a confirmed new password of at least 12 characters. Revoke existing sessions after password or confirmed email changes; preserve versionless existing sessions until credentials change.
- Clear email verification after administrative email edits and revoke sessions after administrative credential edits. Restrict self-service actions to the authenticated account without accepting role/tenant/user-ID edits.
- Add an additive migration for staff verification, session versions and short-lived verification/rate-limit state. Existing staff emails/passwords are preserved and verification is not forced at login.

Validation: production Docker build and TypeScript checks passed. The six local startup tests and isolated migration/HTTP startup smoke passed with locked Prisma 6.19.3 and all three migrations applied before Next.js. The upgrade test preserved an existing staff email/password hash and defaulted its session version to zero. Integration tests passed for all staff roles, current-password authentication, current/new email verification, pending email preservation, duplicate email, expiry, cooldown, attempt/rate limits, single-use/concurrent confirmation, SMTP failure/disabled handling, secret redaction, legacy tokens and self-service/admin session revocation. Existing CAF and SMTP suites passed. Chrome passed real SMTP verification/reverification, email change and login, password confirmation/change/relogin, and desktop/mobile layout; screenshots were inspected. A browser-discovered refresh timing issue was fixed so successful saves finish refreshing before edits are re-enabled. Production data, documents, SMTP settings and `.env` were not changed.

## 2026-10-21: eCAF form and submission workflow

- Replace the entry form with responsive, collapsible sections, conditional residential/business fields, document previews, validation summary and a separate review step. Make navigation collapsible on phones so the form has usable width.
- Require business name, GST number and GST certificate for business submissions; retain Surepass GST/identity verification as future work. Record a staff submission acknowledgement without claiming a customer signature.
- Save structured installation and billing addresses, with a same-address option. Bundle attributed Indian state/city dropdown data; perform PIN lookup server-side with ambiguity, timeout and manual-city handling.
- Generate company-scoped service usernames from first name plus the last five mobile digits, increasing digits on collisions and adding a suffix if all candidates are occupied. Use atomic company allocation and database constraints for case-insensitive uniqueness across franchises while allowing reuse by other companies.
- Add owner-scoped, versioned server drafts for partial field values. Files must be reattached when resuming; consume the saved draft atomically on submission to prevent repeat submissions.
- Allow rejected applications to be corrected and resubmitted with stable CAF number/username, incremented revision and previous-data/document-reference history. Preserve replaced original files. Prevent conflicting final reviews and record an approval snapshot for later PDF generation.
- Enforce required document categories, 4 MiB per new file, basic content signatures, 10 documents and a streamed 42 MiB request limit. Preserve access to existing larger documents. Apply the customer-list franchise filter.
- Add an additive migration and read-only legacy username preflight; conflicting existing usernames stop the migration without automatic renaming. Reorder Docker copies to cache the unchanged locked production dependency tree between application rebuilds and make the Next.js runtime cache writable by the application user.
- Add isolated migration/HTTP integration and desktop/mobile browser checks. Approved PDF downloads, customer signing, Surepass, contact verification, S3 migration, real RADIUS integration and the previously deferred Storage Settings 404 remain outside this release.

Validation: final production Docker image `caf-form:ready` built successfully, including TypeScript checks. All six local startup/lockfile tests passed. An isolated PostgreSQL upgrade test confirmed duplicate-username rejection with transaction rollback and preservation of historical usernames/document references. Real HTTP tests passed company/franchise isolation, concurrent username allocation, cross-company reuse, case/whitespace conflicts, GST requirements, 4 MiB boundaries, existing 5 MiB downloads, draft ownership/versioning/consumption, correction history, concurrent reviews and approval snapshots. Live PIN lookup returned HTTP 200. Existing SMTP tests passed. Headless Chrome passed actual login, conditional business fields, PIN success/ambiguity/outage, state/city controls, draft resume, image previews, desktop/mobile navigation, no horizontal form overflow, review and submission; desktop/mobile screenshots were inspected. The final image passed offline locked Prisma/client 6.19.3 checks, migration-failure exit and successful migration/seed/login/dashboard startup with HTTP 200. Runtime cache was writable and logs contained no cache-permission error after the fix. All database and file fixtures were isolated; production data, uploaded documents and `.env` were not changed.

## 2026-10-20: Super Settings and SMTP welcome emails

- Add a Super Admin-only Super Settings page with independently saved General Portal Settings, Email Settings (SMTP), and the existing RADIUS section. Preserve the legacy RADIUS link with a redirect. Leave the reported Storage Settings 404 deferred as requested.
- Store SMTP configuration under its own system setting, encrypt its password, return only a saved-password indicator, preserve blank password updates, and support TLS, required STARTTLS or an explicitly selected trusted relay.
- Add saved-configuration test emails. Automatically send welcome emails for accounts created through the Users API, with a portal login link and no plaintext account password. Keep account creation successful if SMTP fails, display delivery status, and allow an authorised manual resend with company/role scoping.
- Add independently saved portal name, public URL and support email. Use the name on the login/sidebar and the configured URL/support address in emails.
- Fix the user form's missing company ID; scope franchise choices to the selected company and company-admin role choices to franchise users.
- Add isolated SMTP capture and integration tests. No new database schema migration or production SMTP configuration is required until an operator enables email.

Validation: production Docker build and TypeScript checks passed. The final image passed isolated SMTP-capture tests covering independent section saves, encryption/redaction and password preservation, test delivery, required STARTTLS failure, welcome messages without account passwords, company/franchise permissions, cross-tenant resend denial, duplicate creation, failed-delivery account preservation, recovery by resend, disabled delivery and server-rendered forms without secrets. The existing offline Prisma, migration failure, schema/seed, authenticated login/dashboard and HTTP smoke checks also passed against that image; all six local startup tests passed. Interactive browser review was unavailable because no browser was connected. No live settings, accounts or email recipients have been modified by this feature work.

## 2026-10-20: initialise schema and seed accounts

- Diagnose login failure as Prisma `P2021`: the inspected deployment had only `_prisma_migrations`, with no application tables. Seed credentials in the environment do not create a user unless initial seeding succeeds.
- Add the initial PostgreSQL schema migration generated from the existing Prisma schema with the locked Prisma 6.19.3 CLI. The SQL creates tables, enums, indexes and constraints; it contains no data deletion or table drops. Existing-schema installations require a reviewed migration baseline rather than a reset.
- Compile the existing seed program and its password helper into the Docker image. Invoke it directly with Node when `RUN_SEED=1`; remove the `npx tsx` download fallback and stop startup on seed failure.
- Normalise the initial super-admin email and remove passwords from seed log messages. Preserve the existing rule that reseeding does not replace an existing account's password.
- Document seed credential behaviour, add a credential-safe read-only diagnostic, and extend startup tests to cover seed failure/success and authenticated login/dashboard access.

Validation: a clean Docker build passed. Against a disposable PostgreSQL 16 database, Prisma 6.19.3 applied the initial migration, compiled account seeding completed, configured-admin login returned HTTP 200 with a session cookie, and the authenticated dashboard returned HTTP 200. Offline CLI, migration-failure exit, `/login` HTTP 200 and `/` HTTP 307 checks also passed. All six local startup tests passed, including seed success and seed failure. The live database has only been queried; no application schema or accounts have been created there by this work.

## 2026-10-20: production migration startup

- Make `prisma` a production dependency and regenerate lockfile metadata. The locked CLI remains `6.19.3`; existing package versions, download URLs and integrity hashes are unchanged.
- Keep the multi-stage Docker build and add a production dependency stage using `npm ci --omit=dev --omit=peer`. Copy its dependency tree into the runner so the CLI and its transitive dependencies are available. Discard the redundant traced `node_modules` rather than merging additional traced packages. npm retains locked TypeScript as an optional production peer of Prisma and its client; unrelated development tools such as Tailwind and `tsx` are absent.
- Install OpenSSL in the shared Alpine base used for generation, migrations and the server.
- Invoke the installed Prisma CLI directly for generation and migration deployment. Migration startup never calls `npx` or downloads a replacement CLI.
- Log the installed CLI version; fail explicitly for a missing CLI or unsuccessful migrations; start Next.js only after migrations succeed.
- Enforce LF line endings for shell scripts so Linux can execute their shebangs.
- Add `scripts/test-production-startup.cjs` for lockfile and shell startup checks and `scripts/test-docker-startup.sh` for an isolated image/container smoke test.

Validation on an isolated Linux Docker host:

- Clean Docker build passed, including Prisma generation, Next.js compilation and type checking.
- The runner reported Prisma CLI and client `6.19.3`, matching the lockfile. The CLI and Alpine/OpenSSL engines ran with networking disabled; Tailwind and `tsx` were absent. Locked TypeScript `5.9.3` remains as Prisma's optional production peer.
- An unreachable test database produced Prisma `P1001`, exit status `1`, and the explicit startup failure message; Next.js did not start.
- Against a disposable PostgreSQL 16 database, migration checks succeeded before Next.js started. `/login` returned HTTP `200`; `/` returned HTTP `307`.
- All four local lockfile/startup tests, shell syntax checks and Git whitespace checks passed.

At the time of that validation, the repository had no checked-in `prisma/migrations` files. That startup test reported no pending migrations and did not prove initialization of the application schema. Seeding was disabled for that test. The subsequent login repair above adds the migration and authenticated first-login coverage. Existing deployments, databases, volumes, uploaded documents and `.env` files were not modified by that startup test.

Reproduce with `bash scripts/test-docker-startup.sh`; use `CAF_TEST_IMAGE=<image>` to run the checks against an already-built image.

## 2026-10-20

- Scope the Git and Docker storage exclusions to `/storage/` so storage source files remain included.
- Exclude `*.bak` backup files from Git and the Docker build context.
- Create `public` in the Docker builder stage so the runner can copy it even when the source directory is absent.
- Add the four storage implementation modules: `index.ts`, `local.ts`, `s3.ts`, and `types.ts` under `src/lib/storage/`.

Validation: Git whitespace checks passed. A clean Docker build could not run because the Docker command is unavailable in this environment.
