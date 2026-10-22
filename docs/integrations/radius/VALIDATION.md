# Contract review validation — 2026-10-22

Reviewed CAF source: `05dbe819ff52a5fb022965a1113bd94981b2f167`.
Pinned RADIUS contract: `1db3699e70de37e9d55efb3ff5f750b0f20348a3`.
Handoff: CAF PR #5, head `0a5d7ced0f06030593289c9fe221bb90276c77ec`.

Command: `python scripts/test-radius-contract.py`, using test-only
`jsonschema==4.25.1` installed outside the application dependency tree.

Result: **9 tests passed**:

1. Canonical approval/provisioning examples validate against unchanged upstream schemas.
2. All schemas pass Draft 2020-12 meta-validation; copied references match pinned SHA-256 hashes.
3. A second service fixture retains the lifetime Customer ID with distinct application, event, service request, reservation and username references.
4. Invalid numeric/short/long/zero-prefixed IDs, invalid versions, UUIDs, UTC timestamps, unagreed event types and non-approved CAF states are rejected.
5. Approval envelopes reject additional ID-proof, DOB, document, credential and unagreed address fields at both root/profile levels.
6. Provisioning requires the selected plan UUID, reservation, request UUID, username and initial password. Its schema's character limit is explicitly distinguished from the additional server-side 128-UTF-8-byte policy requirement.
7. Proposed directory, pending-review customer and structured-error examples validate; identity/binding/version relationships in the fixture are checked separately.
8. An unapproved snapshot contains no profile; pending identity values and secret/document additions are rejected.
9. Directory schemas reject over-100-item pages, missing organization references, secret fields and `has_more: true` without a cursor.

No production API, token scope, database migration, outbox worker, RADIUS service,
retry/receipt behavior or automatic activation was implemented/tested by this PR.
The examples are synthetic. No Docker rebuild is needed for this documentation
and test-only change. Existing application code and dependency locks are unchanged.
Runtime and joint acceptance tests remain required for the implementation PRs.

## Round-two response to RADIUS c57ac35

Command: `python scripts/test-radius-round2-contract.py` with the same test-only
dependency. **16 additional tests passed**, alongside all nine baseline tests.

Coverage: proposed schema/17 positive payload fixtures; 13 structurally valid
negative mutation fixtures for cross-field customer/company/franchise/version/
exact-approval checks; correctly labelled draft references; no pending identity
values/credentials; both A/B delivery orders preserving profile version 3 while
retaining valid older A; withdrawn A state; fixed-duration validity and integer
minor-unit prices; required reservation bindings; reservation-only v2 replacement
with unchanged approval/service/password; accepted/unknown/changed-predecessor
rejection; monotonic credential acceptance despite setup failure; operation-specific
receipt IDs; stable snapshot boundary and continuation on empty bootstrap pages.
Additional cases reject partial/mixed snapshot checkpoints and changed replacement
scope/plan-version/approval; equal profile versions allow different connections
with identical identity data while rejecting conflicting identity values.

These semantic helpers are executable protocol expectations over synthetic data,
not production authorization, transaction locks, HMAC implementation, RADIUS
delivery code or activation-race protection. The exact-GET versus concurrent
withdrawal/activation fencing issue and remaining interface agreements are recorded
in `ROUND2-RESPONSE.md`. Existing pinned canonical schema hashes are unchanged.

## Authorization response to RADIUS 4a103dc

Command: `python scripts/test-radius-authorization-contract.py`.
**13 additional offline tests passed; all 38 tests (9 + 16 + 13) pass.**

Coverage: authorization request/decision/withdrawal/retention schema fixtures;
directory definitions unchanged from the accepted proposal; default activation
policy gate; withdrawal-before-authorization denial; immutable grant retries and
known later withdrawal; explicit counterexample for an unknown later withdrawal;
idempotency/conflicting attempt checks; nested receipt/attempt/scope consistency;
no credentials/documents in authorization; absent/null contact normalization with
distinct whole-request replay material; current-leaf/fork/cycle/self/namespace/key/
plan checks; synthetic cross-v1/v2 acceptance tombstone after receipt archival;
absolute credential deadline and immediate acceptance purge expectations.

These are single-process synthetic protocol models, not database concurrency,
source-token authentication, cryptographic JCS/HMAC/key rotation, ciphertext
erasure, distributed commit/fencing or production authorization tests. The model
deliberately exposes the unresolved product case rather than claiming a guarantee.
No normal database transaction is held over HTTP and no runtime integration was
implemented. Owner instructed both developers to report and wait after completing
this coordination task; further implementation needs a new go-ahead.
