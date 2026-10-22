# CAF response to RADIUS review c57ac35

Status: concrete interface proposals for joint review, **no runtime consumers**.
Responds to [RADIUS review c57ac35](https://github.com/vsmann3/Netloom-Radius/blob/c57ac35/docs/integrations/caf-pr6-radius-review.md).
Existing pinned v1 approval/provisioning schemas remain byte-for-byte unchanged.
The customer shape proposed here supersedes the initial singular `review` /
connection-event `approved_snapshot` proposal; the accepted directory shapes and
operation scopes remain unchanged.

## Agreement and customer/application separation

Accepted: nullable `identity_review`, nullable `approved_profile`, and separate
paginated applications. Draft references are labelled as drafts, not applications.
Minimal authorized unapproved lookup is version zero with no approved profile or
pending profile values; unknown/out-of-scope customer is scoped 404.

Proposed CAF reads (all require explicit source/company/franchise grants):

| Method/path | Proposed schema definition | Operation |
| --- | --- | --- |
| GET `/api/integrations/radius/v1/customers/{customer_id}` | `customerMaster` | `customers:read` |
| GET `/api/integrations/radius/v1/customers/{customer_id}/applications?cursor=...&limit=100` | `applicationPage` | `customers:read` |
| GET `/api/integrations/radius/v1/customers/{customer_id}/applications/{application_id}/approvals/{revision}` | `exactApproval` | `customers:read` |
| POST `/api/integrations/radius/v1/snapshots` | `bootstrapStart` response; empty request body initially | `changes:read` plus `customers:read` |
| GET `/api/integrations/radius/v1/snapshots/{snapshot_id}?cursor=...&limit=100` | `bootstrapPage` | same grants and snapshot scope |

Exact approval lookup returns the immutable approval event plus its current
APPROVED/WITHDRAWN/SUPERSEDED state, exact revision, stable service request UUID,
state version and current service approval version. It does not guess from the
latest application or a customer's last review. Missing/ambiguous evidence blocks
new activation and triggers reconciliation. Current CAF model changes are still
required before these endpoints exist.

Runtime validation must enforce nested customer/company/franchise equality,
approved profile/event version <= the enclosing customer version, and exact
application/revision/event identity. An APPROVED record must match the current
per-service approval version. JSON Schema alone cannot express these comparisons;
the executable contract tests include negative fixtures for them. A real handler
must perform equivalent checks under its authorization and transaction boundary.

## Connection A delivered after newer B

Accepted: customer/profile ordering and per-service approval ordering are separate.
`customer_version` orders customer-master changes. `approval_version` advances on
approval/withdrawal/supersession for the stable service request; it is compared
only within that service request's scope. `service_approval_version` is that
service request's authoritative current counter, read consistently with state.

If B carries customer version 3 and valid A carries version 1, RADIUS may preserve
profile version 3 while provisioning A exactly once using A's still-current scoped
approval. It must not overwrite the customer profile with A's older fields, and
must not discard A solely for its lower customer version. Each connection can
have approval version 1 independently. A withdrawn/superseded A is never restored
by its delayed original request. An equal state version with a different exact
approval or payload is a conflict, not a matching retry.

For equal customer/profile versions, compare the canonical identity projection
and organizational IDs, not the entire connection-specific event. Different CAF
references/event IDs for separate connections must not create a false profile
conflict. Different identity values under the same profile version remain 409.
This refines the earlier generic same-customer/version conflict rule; it requires
joint contract agreement even though the pinned JSON structures are unchanged.
Contact omission/null normalization must also be agreed before declaring profiles
equivalent; transport replay fingerprints still cover the complete request.

Fixtures include both delivery orders, independently valid A/B, and withdrawn A.
They define protocol expectations; the tests are not RADIUS implementation tests.

**Remaining concurrency agreement:** an exact GET is point-in-time evidence. It
cannot atomically fence a later CAF withdrawal against a separate RADIUS DB commit.
Before live activation we must agree the activation authorization linearization /
fencing protocol (or an explicitly accepted bounded race and reconciliation).
Do not claim that a GET/ETag alone eliminates that race. Until agreed, unattended
activation remains blocked; this does not decide later pending-KYC service policy.

## Plan and reservation agreement

Accepted for initial fixed-duration plans:

- Positive integer `duration_seconds`, `starts_at: activation`; first successful
  activation transaction fixes the UTC anchor. Matching retries never extend it.
- Calendar plans require a separate schema/timezone policy; no implicit 30-day
  conversion and no fabricated validity for existing rate-only plans.
- Rates are positive integer kbps. Optional price uses ISO currency, integer minor
  units and explicit exponent. Currency/exponent compatibility requires a runtime
  currency table; a three-letter schema pattern is insufficient. No payment gate.
- Reservation pins plan UUID/version plus full source/company/franchise/customer/
  service-request/username binding. A changed/inactive plan blocks with actionable
  conflict; do not silently switch plan or username.
- Matching live POST returns the reservation. Renewal has its own immutable
  idempotency key/operation, retains all binding fields, and rechecks availability
  atomically if reclaiming an expired name. Never steal an occupied username.

Proposed RADIUS `planPage` / `reservation` response schemas are included for peer
review. Reservation renewal request/path and exact role of token-scoped source in
the body still need canonical agreement; no consumer is implemented. Proposed
renew path: POST `/api/integrations/ecaf/v1/username-reservations/{reservation_id}/renew`
with an empty body and a fresh operation-scoped Idempotency-Key. Changed binding
requires a new reservation request and reviewed plan/username selection.

409 codes accepted: `username_unavailable`, `reservation_expired`,
`reservation_binding_conflict`, `plan_changed`; never endless retry for permanent
validation failures.

## Dedicated provisioning receipts and reservation replacement

Accepted for canonical v1: GET `/api/integrations/ecaf/v1/provisionings/{event_id}`
is distinct from generic event receipts. POST and lookup expose the same durable
receipt. `credential_accepted` becomes true only when hash, receipt and service
request reference commit together, remains true after technical setup failure,
and is returned on matching retry/lost-response lookup. It is not service active.
CAF purges recoverable credentials on that signal; RADIUS retries setup from its
stored hash, never asks for/resetting the original password. Before acceptance,
encrypted CAF retention remains bounded with explicit recovery after expiry.

Propose a positive monotonic `receipt_version` for durable receipt transitions so
clients can ignore out-of-order older observations without downgrading a previously
observed acceptance. Validate source/customer/bindings/operation IDs before using
the signal; receipt acceptance and service-active status remain separate.

Concrete alternative for replacement: **new versioned provisioning delivery
envelope**, not a newly fabricated `customer.approved` event merely to renew a
reservation. Proposed POST `/api/integrations/ecaf/v2/provisionings`:

```
{schema_version: "2.0", provisioning_request_id: UUID,
 supersedes_request_id: UUID|null, approval: <unchanged v1 approval>,
 service: <unchanged v1 service>}
```

Idempotency-Key is the delivery `provisioning_request_id`; uniqueness is
`(source, provisionings-v2, provisioning_request_id)`. Receipt lookup is GET
`/api/integrations/ecaf/v2/provisionings/{provisioning_request_id}`. Keep v1's
event-ID key rule unchanged; explicit v2 negotiation is required before use.
The v2 receipt also includes the approval `event_id`; the two IDs are distinct.

Replacement is allowed only under a service-request lock, before ANY successful
credential acceptance, when the identified predecessor has a durable
`reservation_expired` failure and `credential_accepted: false`. Unknown/timed-out
predecessors require receipt reconciliation first. Preserve the same approval
event, exact application/revision, service request, username, plan UUID and initial
password; only the reservation and delivery envelope IDs may change. The new
reservation must also pin the same reviewed plan version. Changed plan/username
or approval needs a separate explicit initial-provisioning amendment contract,
not this reservation-only replacement. After acceptance, use RADIUS-owned
operational APIs/permissions; this proposal introduces no CAF KYC review for
RADIUS-owned credential, plan, network or billing changes.

Compare secret-bearing immutable fields using a server-keyed canonical HMAC,
not logs or an unkeyed password digest. Atomically supersede the predecessor and
accept at most one credential hash/service per `(source, service_request_id)`.
A concurrently accepted predecessor rejects replacement; accepted/unknown is
never treated as false. Matching retries return their receipt and never reset a
password. Old-key changed payload remains 409. Proposed codes:
`replacement_not_allowed`, `replacement_binding_conflict`, `receipt_reconciliation_required`.
No versioned consumer will be added until the peer accepts this alternative (or
publishes a different exact replacement envelope).

## Feed expiry and bootstrap

Accepted: 410 `cursor_expired` with the existing structured error envelope.
Do not add a timestamp recovery scan. Bootstrap creates a consistent materialized
scoped snapshot of customer-master and current exact connection-approval states
plus a commit-safe continuation cursor. An empty final page still returns that
cursor. Snapshot/page cursors bind source, operations, grants, filters and snapshot;
revocation is rechecked on every page. Scope cannot be widened by request data.

Pages are immutable for the snapshot lifetime. Consumer stages EVERY page and
commits its replacement projection plus continuation checkpoint only after a
complete snapshot, then replays later durable changes. Never checkpoint the
continuation after only one page or mix page sets. Expired/inconsistent snapshots
must restart bootstrap; no silent partial resumption. Customer/app absence is
interpreted only against a complete authorized scope, not a partial page.

Snapshot materialization and publication watermark must describe the same commit
boundary. A normal pre-commit sequence remains insufficient. Retention must cover
snapshot construction/reading and catch-up; exact snapshot TTL, feed retention,
resource limits and organization/staff lifecycle recovery remain to agree before
live use. Proposed bootstrap schemas cover customer/application records only;
they do not claim complete organization/staff lifecycle reconciliation.

## Validation and next action

See `round2.proposed.schema.json`, `examples/round2/` and
`scripts/test-radius-round2-contract.py`. Existing nine baseline contract tests
remain independently runnable. New tests validate these proposals, nested
bindings/versions, both A/B orders, withdrawals, immutable replacement rules and
monotonic receipt acceptance, including setup failure after acceptance.

These are offline schema/protocol fixtures. No API, authentication, transactional
worker, credential handling or distributed-race protection is implemented or
validated by this documentation PR. CAF fake-success/secret/minimal-payload fixes
can proceed independently in a runtime PR. Pending later KYC service continuation
policy remains explicitly unresolved. No production changes.
