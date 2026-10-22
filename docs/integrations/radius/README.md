# CAF / RADIUS interface review

Status: **proposal for peer review; no runtime integration is enabled by this PR**.

Follow-up: [ROUND2-RESPONSE.md](ROUND2-RESPONSE.md) responds to RADIUS review
`c57ac35`. Its separated customer-profile/application proposal supersedes the
initial singular review/approved-snapshot shape below. Accepted directory shapes
and pinned canonical approval/provisioning schemas are unchanged.

CAF review of [handoff PR #5](https://github.com/vsmann3/caf-portal/pull/5),
[canonical handoff](https://github.com/vsmann3/Netloom-Radius/blob/1db3699e70de37e9d55efb3ff5f750b0f20348a3/CAF-RADIUS-TEAM-HANDOFF.md),
[API contract](https://github.com/vsmann3/Netloom-Radius/blob/1db3699e70de37e9d55efb3ff5f750b0f20348a3/docs/integrations/ecaf-api-contract.md)
and linked ownership notes completed against CAF `05dbe819ff52a5fb022965a1113bd94981b2f167`.
The RADIUS source revision is `1db3699e70de37e9d55efb3ff5f750b0f20348a3`.

## Confirmed boundaries

CAF owns all company/franchise/operator/customer onboarding, the customer master,
KYC/document evidence, reviews, revisions and customer self-service. RADIUS owns
AAA, services, reservations, network credentials, plans, NAS, sessions, billing,
renewals, wallets and commissions. Its operational projections are read-only in
CAF. Service credentials do not confer staff access or SSO.

The CAF-issued 10-digit Customer ID is a **lifetime customer identity**, shared
across additional connections and CAFs. This supersedes the per-CAF interpretation
in the earlier CAF release notes. New service request UUIDs identify connections;
they do not allocate new Customer IDs. No automatic linking by phone/name/username.

Initial activation waits for approved technical provisioning, without a new
payment/wallet prerequisite. Saving/submitting is never activation. Network and
billing operations do not require KYC approval. Existing suspension/expiry must
never be cleared by profile sync or a replay.

**Still unresolved:** existing-service behavior while a later KYC revision is
pending. This proposal neither suspends nor re-enables service for that reason.

## Current CAF gaps

| Existing source | Required CAF work |
| --- | --- |
| Unique `customerId` on each application/draft | Reusable customer master with one-to-many applications/drafts and explicit scoped existing-customer selection |
| No-op adapter reports `ok: true`, `SKIPPED` | Honest disabled/not-implemented result; never mark provisioning successful |
| Broad `RadiusSync` payload with proof/address fields | Minimal approved projection matching the shared schema; never send ID proof, documents or portal credentials |
| Approval committed before sync creation; inline delivery | Approval, immutable integration snapshot, version and outbox in one transaction; delivery in a worker |
| Global config with returned plaintext `apiKey` | Company-scoped connection selection, encrypted write-only secrets, redacted responses and revocation/rotation |
| Staff-cookie APIs only | Dedicated company/franchise/operation-scoped service authentication and versioned integration APIs |
| Free-text plan and local username checks | Scoped RADIUS plan UUID/validity lookup and stable-service-request username reservation |
| No receipt/reconciliation worker | Durable receipts, bounded retry/dead letter, cursor reconciliation and truthful service status |

These are reviewed findings, not fixes claimed by this documentation PR. Existing
production CAF/PDF features remain unchanged. Do not enable the existing adapter
as a substitute for the proposed integration.

## Interface proposals requiring peer agreement

The existing approval/provisioning schemas are copied **unchanged** under
`reference/`, with exact source URLs and SHA-256 hashes in `SOURCE.json`.
No new event type is accepted by those schemas. Any canonical contract change
must be proposed through a linked PR in `Netloom-Radius`; the RADIUS developer
owns acceptance and implementation there. No peer working-tree edits or silent
merges are authorized by this document.

The four CAF read endpoints are already named by the shared contract. This PR
proposes concrete response shapes for three of them in
`caf-read-api.proposed.schema.json`, with synthetic examples under `examples/`:

| Method/path | Proposed response definition | Proposed service operation |
| --- | --- | --- |
| GET `/api/integrations/radius/v1/companies` | `companyPage` | `companies:read` |
| GET `/api/integrations/radius/v1/companies/{caf_company_id}/franchises` | `franchisePage` | `franchises:read` |
| GET `/api/integrations/radius/v1/customers/{customer_id}` | `customerSnapshot` | `customers:read` |
| GET `/api/integrations/radius/v1/changes?cursor=...&limit=100` | Envelope/lifecycle details below; **not yet schema-complete** | `changes:read` |

These operation names and response schemas are **proposals**, not existing grants
or implemented endpoints. All operations additionally require explicit source,
company and franchise bindings. A URL/body company ID never expands a token grant.
Missing bindings block; there is no default company, name matching or staff-token
fallback. Staff/browser tokens cannot write RADIUS projections or read service secrets.

### Directory and customer responses

- Company/franchise pages return `items`, `next_cursor`, `has_more`; limit is an
  integer from 1 through 100. Items contain only organization references/display
  fields and activity state, not staff or customer data.
- A franchise response always identifies its owning CAF company. Keyset cursors
  bind the source, operation, filters and authorization scope. Directory pagination
  is not a change feed or a completeness guarantee during organization changes;
  organization lifecycle reconciliation needs its own agreed event schemas.
- Customer lookup accepts the lifetime 10-digit ID directly. `review` describes
  the current CAF review while `approved_snapshot` is the last immutable approved
  event or null. Pending profile values are never returned as approved values.
- `customer_version` is a separate customer-master integration counter, not the
  application revision. Zero means no integration change has yet been committed;
  actual approval events still require a positive version. A last approved event's
  version must not exceed the enclosing customer version. Zero/null visibility for
  an unapproved customer is proposed explicitly; agree whether a receiver should
  receive this minimal state or a scoped 404 before implementing clients.
- A pending-review snapshot does not grant activation or decide the existing
  service policy. A lookup response cannot be submitted wholesale to `/events`.
- The singular `review` example describes one customer-profile review, not the
  latest arbitrary connection application. Agree the representation of multiple
  concurrent connection CAFs versus the current identity revision before freezing
  this response. Also agree a draft reference/null application representation;
  a draft ID must not be presented as a submitted application ID.
- Errors use the contract's structured `error` plus `request_id` envelope. Scoped
  absent resources return 404; token operation denial returns 403.

### Reconciliation feed and lifecycle decisions needed first

Propose `{items, next_cursor, has_more}` with each item referencing a durable
change ID, lifetime Customer ID, integration version, exact application/revision,
and a typed minimal change payload. Preserve a stable high-water mark for empty
pages. Bind opaque cursors to source/grants; do not expose a different tenant's
events or raw internal sequence values. Commit a consumer cursor only after the
entire page is durably handled.

A simple sequence allocated before commit is insufficient: transaction A can get
sequence 10, B commit 11 first, and a consumer can advance past A. CAF must use
commit-ordered publication (for example a transaction-held publication allocator
lock) or an equivalent closed watermark that cannot skip late commits.

The contract requires withdrawals/reapproval as well as approvals. Its current
generic event schema accepts only `customer.approved`. Agree separate lifecycle
schemas and receiver outcomes before enabling this feed or unattended delivery.
Do not silently omit withdrawals, invent a new generic event type, or treat a
review-state change as an instruction to disconnect/reactivate. Also agree cursor
retention, expired-cursor status/recovery and resnapshot behavior before consumers.

### Other missing shared details

1. Plan response schema, validity units/start rule, currency/rate representation,
   plan version and inactive-plan handling. CAF must not guess expiry or convert a
   free-text plan name into a RADIUS UUID.
2. Reservation request/renewal/expiry/conflict schemas and binding to source,
   mapped company/franchise, Customer ID and stable `service_request_id`. Renewal
   must not silently assign another username or another service request UUID.
3. Provisioning receipt schema identifying `credential_accepted: true` as durable
   hash acceptance. Receipt/projection lookup must distinguish linked/applied from
   service active. Define safe retention/recovery after terminal failures; never
   purge credentials on a generic 202 or reset them on a matching retry.
4. Organization/staff event schemas and explicit operational-role mapping.
   Onboarding identity does not imply unrestricted RADIUS permissions or copied passwords.
5. KYC change-request, exact reviewable-field policy, diff/version, decision and
   application-outcome schemas; service/billing projection write schema/versioning.
   CAF defines its KYC policy; neither side should guess fields owned by the other.
6. Safe new-tab form-entry context and allowlisted return URL validation. Prefill
   never grants access; the signed-in CAF actor's company/franchise scope wins.

Proposed CAF KYC-policy work covers approved name, identity, business/GST and
mandatory contact/address fields. This is a policy-design starting point, not an
accepted external field list. Credentials, plan, IP/network, billing and renewal
fields are excluded because RADIUS owns them. Document handling stays in CAF.

## CAF implementation sequence and acceptance

1. Fix the adapter's fake success and secret exposure; replace broad payloads.
2. Add reusable customer master, stable connection request IDs and monotonic
   integration versions. Preserve every issued ID and existing approved PDF data;
   never merge historical records without reviewed linking. Company/franchise
   transfer is an explicit reviewed operation, not a routine sync reassignment.
3. Add scoped service authentication and agreed read responses. Test token rotation,
   source/tenant/franchise/operation denial and no pending data/document leakage.
4. Commit approval/snapshot/version/outbox together. Add leases, bounded retries,
   receipt polling, visible blocked/dead-letter states and durable reconciliation.
   Test rollback, worker crashes, matching/changed retries, version conflicts,
   commit-order races, partial pages and ambiguous network timeouts.
5. Integrate agreed RADIUS plan/reservation/provisioning APIs and form entry.
   Keep initial credentials encrypted only for bounded pending delivery, never in
   generic events/logs/audits. Purge only on durable credential acceptance.
6. Implement agreed KYC decisions and read-only service/billing projections;
   preserve review status separately from RADIUS application/operational state.

No integration is ready until a joint test demonstrates one lifetime Customer ID
in both systems, multiple services without renumbering, no activation before
approval, one-time provisioning despite retries, cross-tenant denial, safe
credentials, no ID-proof leakage and outage reconciliation. Live RADIUS acceptance
requires its actual endpoints and scoped credentials, supplied outside Git.

## Payloads and validation

- `reference/ecaf-event.example.json`: unchanged canonical approval example.
- `reference/ecaf-provisioning.example.json`: unchanged canonical initial-service
  example; its password is a public synthetic placeholder, never a live secret.
- `examples/additional-service.example.json`: same lifetime Customer ID, distinct
  application/event/service request/reservation/username, higher customer version.
- `examples/customer-pending-review.example.json`: last approved projection plus
  current pending-review reference, with no pending identity values.
- `examples/companies.example.json`, `franchises.example.json`, `error.example.json`:
  proposed directory/error responses.

Install test-only `jsonschema==4.25.1` and run:

```sh
python scripts/test-radius-contract.py
```

The suite uses Draft 2020-12 with UUID/date/email format checks, validates the
examples, tests invalid IDs/versions/missing organization references/extra secret fields, checks lifetime
identity across connections and verifies pinned file hashes. It resolves schemas
locally, without a live RADIUS server. These are **contract fixture tests**, not
proof of endpoint implementation, runtime authorization, retry safety or live
provisioning. No application code, database migration or dependency lock is changed.

To refresh the reference deliberately, edit the pinned revision in
`scripts/fetch-radius-contract-reference.py`, run it with authenticated `gh`,
review the diff, rerun compatibility tests and submit a PR for peer review.
