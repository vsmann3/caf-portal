# Isolated working-model validation, 2026-10-22

CAF branch: `feat/radius-isolated-demo`, stacked on runtime safety PR #7.
Peer RADIUS runtime: `e2a35c1`; its CI run 39755317184 passed application,
MariaDB/FreeRADIUS SQL/PAP and concurrent acceptance checks. CAF did not deploy or
independently rerun that CI. Shared endpoints and v2 schemas remain unchanged.

## Actual paired applications

CAF http://127.0.0.1:18110, RADIUS http://127.0.0.1:18120 and PostgreSQL16.15 on
127.0.0.1:18130 were exercised together using synthetic isolated companies/data.
The actual peer backend was used, not a replacement fixture server.

`node scripts/test-radius-demo-pair.cjs`: PASS, most recent result at
2026-10-22T12:09:19Z. Customer ID **1000000008** retained across applications
`cmvjhzuxl0034lfn8gjfd7zh0` and `cmvji00kj003hlfn8dypvjpbg`, independent service UUIDs
`df556369-1b9a-40bb-be40-b22ee16a2ec3` and
`0e0289da-15b3-4970-ba77-efbd3d7030a2`.

Verified real published plans, stable reservation and renewal, no pre-approval
subscriber, role-scoped approval, exact per-application approval reads, durable
accepted STAGED receipt, ciphertext purge, two services sharing one lifetime ID,
and matching retry preserving service uniqueness and credential fingerprints.
Read-only observation was restricted to the isolated synthetic services.

`node scripts/test-radius-demo-browser.cjs`: PASS, most recent result at
2026-10-22T12:10:27Z. Customer ID **1000000010**, application
`cmvji0oho003vlfn81ztpc5l1`, username `browser2670980839`.

Real system Chrome covered RADIUS login/new-tab Add customer, existing CAF form,
actual plans/reservation, synthetic image uploads and submission, separate company
reviewer approval, franchise absence of approval permission, STAGED receipt,
combined CAF/documents PDF download, rejected untrusted return URL, trusted return,
and actual RADIUS Account ID filter finding one matching SUSPENDED subscriber.
Desktop/mobile overflow and browser error checks passed; screenshots were inspected.

Private result JSON, screenshots and PDF remain under ignored
`.tools/working-demo/`; no credentials or document contents are committed.
The initial corrupt test PNG was replaced with a valid generated synthetic PNG;
the existing PDF exporter correctly rejected the corrupt file and needed no change.

CAF hidden start/stop scripts were exercised. Restart preserved data and the
accepted STAGED receipt; login, status and authenticated worker returned HTTP200.
Worker and CAF remain running for owner testing. No real activation or internet
access was exercised or claimed.

## Local checks

- TypeScript `tsc --noEmit --incremental false`: PASS.
- Runtime guard tests: **8/8 PASS**, including production DB rejection, strict
  synthetic-active opt-in, canonical replay HMAC and nested receipt binding checks.
- Locked startup/dependency tests: **6/6 PASS**, Prisma CLI/client **6.19.3**.
- Offline compatibility tests: **38/38 PASS** (9 + 16 + 13). These validate contract
  fixtures/models, not implementation of production authorization/withdrawal.
- Git whitespace and generated-secret exclusion checks: PASS. Private runtime,
  database and peer credentials were compared without printing their values.

## Production-image isolated regression

`docker build --progress=plain -t caf-radius-demo:final .`: PASS, including Next
production compilation, TypeScript checks, generated Prisma and multi-stage runner.
Image ID: `sha256:71a516b8bca137157bc733bcca11bfc978f3676186bcc512a813788e842c9a5b`.
Actual container Prisma CLI and client both report **6.19.3**.

`CAF_TEST_IMAGE=caf-radius-demo:final CAF_DEMO_TEST=1 CAF_KEEP_TEST=1 sh
scripts/test-super-settings.sh`: PASS on a disposable PostgreSQL/SMTP/protocol
fixture. All six suites passed: SMTP/settings, CAF, staff profiles, Customer ID/PDF,
legacy RADIUS safety and the new isolated delivery protocol. The latter verifies
lost-response GET reconciliation without repost/password reset, secret purge,
four connections under one ID, newer B delivered before older A, signed pagination,
token expiry/revocation and the absolute credential deadline.

One test-only ordering assertion initially counted unrelated approved deliveries
against the current unapproved service. It was corrected to check that exact
service, explicitly defer older A, and assert B accepted before A. The complete
suite then passed. No runtime change was required for this correction.

Owned VM fixture `caf-settings-test-1792671513-941651`, HTTP port32793, was retained
for review; its app/DB/mail/network are disposable isolated resources, separate
from production. VM logs are `final-build.log` and `final-integration-v2.log` under
`/home/caf-test/caf-radius-demo.1S7GpA`. The intentional rollback fault injection
logs a fixture sync-insert error; the rollback and subsequent suites pass.

## Boundaries and next owner action

The RADIUS developer independently reported a second real paired HTTP pass against
CAF implementation `b9ad5b060633873226f907104876a873278ea014` and the existing
18120/18130 backend/database: no subscriber before approval, counter approval403,
company reviewer approval200, automatic accepted STAGED receipt, exactly one
SUSPENDED subscriber with matching Customer ID/username/plan, unchanged credential
hash/expiry after another worker scan, and successful scoped customer read.
Peer evidence is the ignored RADIUS `.tools/integration-demo/joint-http-result.json`
and consolidated `peer-status.json`. This paragraph attributes the independent
execution to the peer; it is additional evidence, not owner acceptance.

The default receipt is accepted but blocked pending activation authorization;
RADIUS subscriber stays SUSPENDED. Production policy, deployment and owner
acceptance are not implied by these tests. Follow [WORKING-MODEL.md](WORKING-MODEL.md)
to test the existing form journey and return expected versus actual behavior.
Await owner feedback before calling the milestone accepted.

## Owner checkpoint outcome

Vikas reported that he tried the local model and approved pushing the tested CAF
changes to GitHub `main`. This accepts the demonstrated isolated STAGED journey
and authorizes the repository merge. It does not establish production integration
readiness or resolve withdrawal/later-KYC policy. No production deployment or
integration enablement is performed by this merge; demo-only gates remain intact.
