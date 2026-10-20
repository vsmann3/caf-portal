# Change log

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

The repository currently has no checked-in `prisma/migrations` files. The successful startup test reported no pending migrations; it does not prove initialization of the application schema. Seeding was disabled for the test. Existing deployments, databases, volumes, uploaded documents and `.env` files were not modified.

Reproduce with `bash scripts/test-docker-startup.sh`; use `CAF_TEST_IMAGE=<image>` to run the checks against an already-built image.

## 2026-10-20

- Scope the Git and Docker storage exclusions to `/storage/` so storage source files remain included.
- Exclude `*.bak` backup files from Git and the Docker build context.
- Create `public` in the Docker builder stage so the runner can copy it even when the source directory is absent.
- Add the four storage implementation modules: `index.ts`, `local.ts`, `s3.ts`, and `types.ts` under `src/lib/storage/`.

Validation: Git whitespace checks passed. A clean Docker build could not run because the Docker command is unavailable in this environment.
