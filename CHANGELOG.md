# Change log

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
