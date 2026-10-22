# Isolated CAF / RADIUS working model

This implementation uses the existing CAF form, actual local CAF Node/Prisma app,
actual PostgreSQL and the teammate's actual RADIUS backend. Production is unchanged.
The default result is **STAGED: credentials accepted, subscriber SUSPENDED**.
There is no real internet activation, enabled NAS, payment gate or production
withdrawal/KYC policy decision in this model.

## Run and access

On this Windows laptop, the peer's portable PostgreSQL must already be running on
127.0.0.1:18130 and RADIUS on http://127.0.0.1:18120. Its protected ignored
`.tools/integration-demo/peer-status.json` supplies the private file paths. Never
paste or commit those files. CAF preparation reads only DATABASE_URL from the
private DB file, and applies CAF migrations to the explicitly named caf_demo_ DB.

```powershell
python -X utf8 scripts/prepare-local-caf-demo.py
.\scripts\start-local-caf-demo.ps1 -SkipPrepare
# Stop only the recorded CAF helper processes; preserve all data and peer services:
.\scripts\stop-local-caf-demo.ps1
```

Preparation copies tracked working source and dependencies into the owned sibling
`E:\OpenCode\caf-working-demo-app`. Windows dependencies use a physical copy:
cross-drive or nested node_modules junctions broke Next's development resolver.
Existing generated secrets and owner-changed passwords are retained. Restart CAF
after preparation when testing changed source. The launcher runs CAF and the
outbox worker as hidden local processes. `.tools/` is excluded from Git and Docker.

| Item | Local value |
| --- | --- |
| CAF | http://127.0.0.1:18110 |
| RADIUS | http://127.0.0.1:18120 |
| CAF logins | `E:\OpenCode\caf-portal\.tools\working-demo\access.txt` |
| RADIUS logins | `E:\Netloom\Netloom-Radius\.tools\integration-demo\access.txt` |
| Company / franchise | `netloom-demo-company` / `netloom-demo-franchise` |
| RADIUS company | `10002` |
| Synthetic uploads | `.tools/working-demo/owner-test-evidence/*.png` |
| Browser evidence | `.tools/working-demo/artifacts/` |

Credentials stay in the private local files above. Do not use real customer data.

## Owner acceptance checklist

1. Log into CAF as `demo-counter@caf.example.test` and RADIUS with its private
   demo login. In RADIUS company 10002, open Users and choose Add customer. The
   existing CAF form should open in a new tab with the correct scoped company.
2. Enter a synthetic residential customer, mobile and required billing/installation
   details. Select a published RADIUS plan, then reserve the suggested username.
   Price unavailable means unknown, not free. Upload the supplied synthetic PNGs
   for photo/ID/address. Submit. Submission alone must not create a network service.
3. In a separate browser profile/private window, log into CAF as
   `demo-company@caf.example.test`. Open the submitted application and approve it.
   The franchise submitter must have no Approve button.
4. Wait about 15 seconds. CAF should show **Staged - credentials accepted; service
   disabled**, its receipt and the same 10-digit Customer ID. Use Back to RADIUS
   demo, filter Account ID by this ID and confirm the username and SUSPENDED state.
   It must not claim active internet.
5. Download CAF + documents PDF from the approved application and inspect it.
6. Optionally add another connection through a new CAF, explicitly entering that
   approved Customer ID in the same company and franchise and reserving a different
   username. Both services must retain the same customer identity.

Report the page/step, Customer ID and expected versus actual result. Automated
passes are not owner acceptance; this milestone awaits Vikas's feedback.

## Runtime changes and compatibility

- New migration `20261022120000_radius_isolated_demo` introduces a lifetime
  CustomerNumber master, backfills historical scope/profile state and permits
  multiple applications/drafts per Customer ID. Global ID allocation never recycles.
  A unique serviceRequestId identifies each connection. Customer reuse is explicit,
  approved and scoped to the same company/franchise; no name/phone matching or
  cross-franchise transfer is implemented. Back up before any future deployment;
  this migration has only been validated on isolated data here.
- Company-scoped binding stores encrypted outbound bearer and hashed expiring read
  bearer. Demo runtime gates require explicit opt-in and an isolated database.
  HTTPS is required except explicitly permitted demo loopback or isolated fixture.
- Staff API `/api/radius-demo/{config,plans,intents,renew,status,retry}` validates
  actor scope, draft ownership, published plan UUID/version, username and reservation.
  New-tab company hints do not grant authority. Return links permit only the exact
  trusted bound company's RADIUS Users route; arbitrary redirects are rejected.
- Scoped bearer reads under `/api/integrations/radius/v1`: companies, franchises,
  nullable approved customer profile, paginated applications and exact immutable
  per-application approval revision. Signed live cursors expire with 410; these are
  not a durable change feed/bootstrap snapshot promise.
- Approval transaction writes the minimal immutable v1 approval and v2 outbox.
  Worker POST `/api/internal/radius-demo/run` requires a separate worker bearer.
  It resolves GET receipt before POST, validates every nested tenant/service binding,
  retains monotonic credential acceptance and stable replay keys, and never holds a
  DB transaction over HTTP. Canonical HMAC tolerates JSONB key ordering only.
- Initial network secret is generated server-side, encrypted, never returned to
  browser/PDF/audit, deleted after durable acceptance, and expires absolutely at 24h.
  Unknown outcomes reconcile; expired/changed bindings require deliberate recovery.
  No automatic v2 delivery replacement or withdrawal authorization is implemented.
- Default unexpected ACTIVE receipts are surfaced as violations. A separately
  guarded SQLite-peer synthetic-only opt-in exists for an explicitly agreed future
  demo, disabled in this prepared runtime; it never authorizes production activation.
- Existing SMTP/profile/CAF/PDF/safety behavior is covered by the Docker regression.
  No packages/lockfile changes or bulk development dependencies added to runner.

## Repeatable validation

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --test scripts/test-radius-demo-guards.cjs
node scripts/test-radius-demo-pair.cjs
node scripts/test-radius-demo-browser.cjs
```

The pair test uses actual peer HTTP endpoints and a read-only synthetic-service
observer to check credential fingerprints and service uniqueness after retries;
it never reads production. The Chrome test covers real new-tab entry, same CAF form,
plan/reservation/uploads/submission, reviewer approval, staged receipt, PDF, rejected
open redirect, actual RADIUS Account ID filtering and desktop/mobile layout.

On an isolated Docker host, `CAF_DEMO_TEST=1 sh scripts/test-super-settings.sh`
builds a production image and tests migrations/startup, SMTP, CAF, profile, PDF,
legacy safety and the synthetic lost-response protocol fixture. This fixture is
separate evidence from the actual paired local backend. See the implementation PR
for exact final pass results and commit. No production deployment is performed.
