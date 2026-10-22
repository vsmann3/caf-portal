# RADIUS runtime safety patch

This patch is separate from [interface proposal PR #6](https://github.com/vsmann3/caf-portal/pull/6).
It adds no transport, provisioning worker, activation authorization or production deployment.
The runtime PR is stacked on the documentation branch so its diff contains only the
safety changes and this coordination update; merge the documentation dependency first
or rebase the runtime changes onto main after that review.

## Changed behavior

- Removed the no-op adapter that returned `ok: true` and `remoteId: "SKIPPED"`.
  A requested integration remains unavailable. New approval records use the existing
  `FAILED` enum with `responsePayload.code = RADIUS_DISABLED` or
  `RADIUS_NOT_IMPLEMENTED`, `attempted: false`, `attempts: 0`, and null attempt/completion
  times. These records are blocked diagnostics, not a retry queue. No HTTP delivery occurs.
- Approval, frozen CAF snapshot and its minimal RADIUS diagnostic commit in one database
  transaction. A diagnostic insert failure rolls back approval. Concurrent approval
  requests still use status/revision comparison; one wins. Review scope now uses the
  shared defensive tenant guard, including missing company bindings.
- New diagnostics use the explicit local format below, constructed from the committed
  approved CAF fields. They exclude name, mobile, email, addresses, proof numbers,
  documents, signed PDF data, passwords, plan details and usernames. Original CAF data
  and approval/PDF snapshots retain their existing information.
- `/api/settings/radius` GET/PUT never return plaintext or encrypted tokens. Responses
  use `Cache-Control: no-store`, `apiKeyConfigured` and `runtimeStatus: NOT_IMPLEMENTED`.
  Inputs are strictly allowlisted. URLs require HTTPS with no credentials, query or
  fragment. Header names and timeout ranges are validated.
- Nonempty `apiKey` writes AES-256-GCM ciphertext using the existing AUTH_SECRET-derived
  encryption helper, stored in `apiKeyEncrypted`. Blank/omitted `apiKey` preserves the
  current token; `clearApiKey: true` removes it. Clear plus nonempty replacement is
  rejected. Ciphertext cannot be submitted as a token. Partial settings writes serialize
  on one PostgreSQL transaction advisory lock to preserve concurrent secret/config edits.
- Legacy plaintext is hidden immediately on GET and encrypted on the next explicit
  settings save, including a blank-token save. GET does not rewrite the database.
  Unknown legacy settings are never echoed and are removed on an explicit save.
- UI uses a blank write-only token input, configured indicator and explicit removal.
  Load/save failures are visible; saving is disabled until settings load. It states
  delivery/activation are unavailable even when delivery was requested.

## Local payload example (not an API contract)

```json
{
  "format": "caf-radius-local-reference-v1",
  "customer_id": "1000000001",
  "company_id": "example-company-id",
  "franchise_id": "example-franchise-id",
  "caf": {
    "application_id": "example-application-id",
    "number": "EXAMPLE-CAF-000001",
    "revision": 1,
    "status": "APPROVED"
  }
}
```

There is deliberately no synthetic `customer_version`, approval-event UUID, service
request or activation authorization. The shared wire schemas require a reusable
customer master, authoritative versions and service-specific approval infrastructure;
CAF revision alone cannot supply them. This local payload MUST NOT be sent as a
canonical approval event or used to trigger provisioning.

## Compatibility and limits

No dependency, lockfile, database schema/migration or shared wire schema changes.
The settings API no longer supports round-tripping its whole GET response or arbitrary
JSON fields; callers must send the documented writable fields. Tokens are write-only.
Refresh existing admin pages after upgrading to load the updated client.

Existing global settings remain configuration metadata, not scoped integration
credentials for real delivery. A future transport must require separately reviewed
scoped configuration/opt-in; it must not auto-enable from this legacy flag. Historical sync payloads/statuses and existing stored
plaintext are not bulk-rewritten; an old `SKIPPED` success is not evidence of remote
provisioning. Historical sensitive payload cleanup and lifetime customer-master
migration need their own reviewed plans. Keep AUTH_SECRET stable for existing
ciphertext; rotation needs a separate migration plan.

Activation/withdrawal ordering and active-service behavior during later pending KYC
remain owner decisions. No unattended activation or automatic retry/replay of old
records is enabled. No network service, billing behavior, customer PDF or document
storage policy changes are introduced.

## Validation

`scripts/test-radius-safety.cjs` runs only in the disposable Docker fixture with an
explicit test flag and isolated database-name guard. It exercises actual API/DB role
checks, no-store redaction, legacy migration, encryption round-trip, replacement,
blank preservation, concurrent partial edits, invalid settings, token removal,
disabled/requested-delivery approvals, exact minimal payloads, concurrent review,
unchanged CAF proof snapshot, safe audit metadata and transaction rollback on an
injected sync insert failure. No real RADIUS service is called.

Validated on 2026-10-22:

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `node --test scripts/test-production-startup.cjs`: 6/6 passed, locked Prisma
  remains 6.19.3, existing dependency versions unchanged.
- Original, round-two and authorization contract fixture suites: 9 + 16 + 13 = 38
  passed. These are offline protocol models, not runtime integration acceptance.
- Docker production build `caf-radius-safety:review-final`: passed Next.js build,
  lint/type checks and image creation on the test VM. Image manifest digest
  `sha256:12cb21dfeb0947fb7864f8dbab081fa50ad510b12090cdad1b6f84d71b83fcc3`.
- `CAF_TEST_IMAGE=caf-radius-safety:review-final CAF_KEEP_TEST=1 sh scripts/test-super-settings.sh`:
  all five real API/PostgreSQL integration suites passed: SMTP/settings, CAF,
  staff profile, Customer ID/PDF and RADIUS safety. The application reached login
  HTTP 200; existing CAF/detail rendered HTTP 200. RADIUS-specific tests also passed
  valid own-company review and denial of foreign/unbound company admins.
- Inside the running test image, `node node_modules/prisma/build/index.js --version`
  reports Prisma CLI and client 6.19.3. No `npx` download is involved.
- `node scripts/test-radius-safety-browser.cjs <playwright-module> <isolated-url> <artifacts>`:
  real Chrome passed load/save, blank token after save/reload, configured indicator,
  response redaction, explicit removal, network-failure recovery and no page errors.
  Desktop/mobile screenshots were inspected; the 390px viewport has no horizontal
  page overflow. Artifacts: local Windows Temp `caf-radius-safety-browser`.
- `git diff --check` and Node syntax checks: passed.

The first transferred harness stopped on CRLF shell line endings before running
any fixture; the transfer was corrected to LF and the complete final harness above
passed. No application failure was hidden by that packaging correction.

All containers, PostgreSQL data, SMTP capture and documents used here were disposable
fixtures under `/home/caf-test/caf-radius-safety.owbdNB`, with the isolated
`caf-settings-test-1792650728-850618` resource prefix. No production container,
volume, uploaded document, database or `.env` was changed. No real RADIUS endpoint,
activation or distributed authorization protocol was exercised.
