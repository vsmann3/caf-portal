# CAF response to RADIUS 4a103dc: durable authorization and recovery

Status: technical agreement/proposals, **not a production activation policy**.
[RADIUS response](https://github.com/vsmann3/Netloom-Radius/blob/4a103dc/docs/integrations/caf-round2-radius-response.md).
Accepted earlier schemas remain proposals until adopted through canonical review.
No runtime API, database worker, activation or production behavior changes here.

## Technical model accepted, product behavior still gated

CAF accepts the durable authorization command as the proposed logical authority
point. RADIUS first durably stages a disabled service and credential acceptance;
CAF then locks its per-service approval/authority row and commits one immutable
decision, audit and outbox entry in the same transaction. No HTTP occurs while
that normal database transaction is held open.

Proposed CAF interfaces:

| Method/path | Operation | Request / response definitions |
| --- | --- | --- |
| POST `/api/integrations/radius/v1/activation-authorizations` | `activation-authorizations:write` | `authorizationRequest` / `authorizationDecision` |
| GET `/api/integrations/radius/v1/activation-authorizations/{activation_attempt_id}` | `activation-authorizations:read` | `authorizationDecision` |

The authenticated source and its grants are authoritative, not request-supplied
source/company fields. All company/franchise/customer/service/application and
operation bindings must be checked against durable mappings. Idempotency-Key is
the stable `activation_attempt_id`, scoped to `(source, activation-authorization,
activation_attempt_id)`. Persist it on RADIUS before calling CAF. A changed request
under the same key is 409; matching retries return the identical decision, not a
fresh evaluation. An ambiguous timeout is unknown until GET reconciliation.

Request includes the exact approval ID/application/revision/approval version,
stable service request UUID, staged RADIUS service UUID and an operation-qualified
provisioning receipt reference. CAF requires locally verified durable credential
acceptance for that receipt; a body boolean is insufficient. Older profile
versions on an independently valid connection are not a reason to drop it.

CAF validates current approval under the same lock used for approval withdrawal.
It writes a monotonic per-service `authority_sequence` for every decision or
withdrawal action. This is separate from customer/profile version and approval
state version. A repeated grant request for an already authorized exact approval
epoch is rejected unless it matches the persisted attempt; it cannot create an
unbounded series of grants or replace the RADIUS service binding. A denied attempt
is immutable; correction requires an explicit new attempt after reconciliation.

Decision carries the exact request, decision ID, authorized/denied outcome, safe
reason and CAF commit time/authority sequence. RADIUS validates every nested ID
and binding against its staged request and applies an authorized decision at most
once under its local service lock. Service activation/expiry anchor is written on
the first successful local activation only. A setup failure leaves the service
disabled, preserves accepted credentials, and never resets expiry on a retry.

### Ordering fixtures and required owner decision

1. Withdrawal commits before CAF authorization: deny the stale/withdrawn approval;
   the staged RADIUS service stays disabled.
2. CAF authorization commits first: this immutable grant remains a historical
   decision. Later withdrawal receives a greater authority sequence and is a
   separate lifecycle action. Do not rewrite a matching grant retry to denied.
3. RADIUS already knows the later withdrawal before local enable: do not enable
   with the older grant. Keep it disabled and reconcile the exact current state.
4. Withdrawal commits later but is not yet known to RADIUS: the logical-point
   model alone can allow local enable after that withdrawal commit. No wall-clock
   bound is promised during a partition. This case requires an owner decision.
5. CAF unavailable/decision missing/timeout unresolved: leave staged service
   disabled. Never infer a grant from an approval GET, credential acceptance, TTL
   or a successful queue request.
6. Withdrawal followed by explicit reapproval must use the new exact approval
   state/epoch; a delayed original request cannot revive the withdrawn approval.

**Unattended activation remains disabled** until the owner explicitly accepts
the logical-authorization-point behavior and defines handling of later withdrawals,
or requires the stricter alternative below. This is a different product question
from whether an already active service continues during a pending later KYC review;
that pending-KYC question remains separately unresolved.

Strict alternative: if the requirement is no local activation after *any* CAF
withdrawal commit, this protocol is insufficient. The systems need a durable
prepare/commit/recovery agreement (including how withdrawal waits on an in-doubt
activation), or a changed authority boundary. The owner would need to accept its
availability/recovery consequences. Do not claim a GET/ETag, expiring authorization
token, bounded race or a database transaction held over HTTP provides that guarantee.

The proposed withdrawal marker schema describes ordering evidence only; it does
not instruct disconnect, suspend, re-enable or refund. It must not be sent to the
existing generic v1 `/events` inbox, which accepts `customer.approved` only.
Lifecycle transport/schema registration needs explicit peer agreement.

## Replacement, replay and key invariants accepted

- One durable service row/lock for `(source, service_request_id)` across v1 and v2
  operations. Credential acceptance in either namespace blocks any second initial
  credential write and all expired-reservation replacement in the other.
- A v2 replacement may supersede only the current v2 chain leaf, after durable
  `reservation_expired` and false credential acceptance, with no accepted successor.
  Reject forks, cycles, self-supersession and binding changes under that lock.
  Superseding the predecessor and accepting its successor commit atomically.
- `supersedes_request_id` resolves only within the source's v2 delivery namespace.
  Do not reinterpret it as a v1 event ID. Cross-version replacement would require
  an explicit operation-qualified parent proposal; cross-version service locking
  and acceptance uniqueness apply even when that migration is unsupported.
- Use separate keyed fingerprints: full-request replay HMAC (operation-qualified
  whole validated JCS body), and immutable-binding HMAC (full approval, authenticated
  source/mapping IDs, immutable service fields/password and pinned reservation plan
  version). Exclude delivery/supersession/reservation IDs only from the latter.
  Compare plan version explicitly because v1 service body omits it. Profile
  equivalence normalization must never alter transport replay fingerprints.
- Store fingerprint key ID/version and retain verification keys for the supported
  replacement/replay window. No unkeyed password digest, plaintext logging or
  unverifiable replacement after key retirement. A retired/unavailable verification
  key fails closed and requires deliberate recovery; it never permits new work.
- Retain durable uniqueness/accepted-credential/service/authorization tombstones
  for the lifetime of the integration service relationship after receipt archival.
  Old delivery IDs never become fresh. Archived/unverifiable replay returns an
  actionable archived/reconciliation error or retained safe receipt, not another
  service or password reset. Rotation/erasure must preserve this uniqueness.

Runtime transaction tests must exercise cross-v1/v2 acceptance races, concurrent
replacement, chain forks/cycles, key rotation and replay after archival. Offline
contract models cannot establish those guarantees.

## Exact profile equivalence accepted

For customer-profile conflict comparison only, absent `mobile`/`email` normalize
to explicit null. Other validated strings compare exactly; no case folding,
whitespace trimming or phone rewriting during comparison. Compare organizational
IDs, not mutable labels/codes. Different connection metadata is not a profile
conflict. Full transport replay remains the whole validated canonical request;
omitted versus null contact values are still different replay payloads.

## Engineering retention proposals

CAF accepts configurable pilot defaults: username reservation hold 15 minutes,
materialized snapshot lifetime 24 hours, feed retention 30 days. These are not
billing/plan rules, authorization TTLs or partition-race bounds. Return actual
server expiry. Enforce snapshot construction + reading + catch-up coverage inside
the retained watermark and reject/restart when coverage cannot be guaranteed.
A 410 never authorizes deleting live local service state from a partial scope.

CAF credential proposal: **24-hour absolute encrypted-ciphertext window from
first credential capture/generation**, including time awaiting review if captured
early. Saves, retries, reservation renewals and delivery-ID replacement never
extend it. Generate just-in-time where the approved onboarding flow permits it;
do not silently change a credential already bound to an attempted request.

Purge immediately on a durably verified `credential_accepted: true`, definitive
pre-acceptance cancellation, or the absolute deadline, whichever occurs first.
After deadline without confirmed acceptance, mark `credential_recovery_required`,
retain only safe request/receipt references and reconcile acceptance first. Do
not fabricate a new password or assume an unknown outcome means not accepted.
If RADIUS accepted the hash, its stored credential remains usable for technical
retries without CAF ciphertext. Otherwise a deliberate initial-credential recovery
contract is required before a fresh secret is captured; this PR does not introduce
an automatic reset or bypass immutable replacement rules. Ask the peer to confirm
this recovery window and future explicit recovery protocol before enabling delivery.

Receipt retention, encryption keys, fingerprint keys, tombstones, feed history and
reservation holds are separate lifetimes. A short ciphertext lifetime must not
delete replay identity or accepted-credential state. No unbounded encrypted secret
retention is implied by lifetime tombstones.

## Schemas and validation

`activation-authorization.proposed.schema.json` defines strict request/decision and
ordering-marker proposals, without credentials or customer-profile/document data.
`examples/authorization/` contains synthetic ordering/recovery fixtures.
`scripts/test-radius-authorization-contract.py` is an offline reference-model
suite. Existing canonical v1 schemas are unchanged. All checks are proposal/fixture
validation, not live authentication, database locking, HMAC implementation,
distributed commit or product-policy acceptance.

The accepted round-two shapes and this authorization proposal will also be offered
as a linked documentation-only PR to the canonical RADIUS repository. Neither
developer's application working tree or production environment is changed by it.
