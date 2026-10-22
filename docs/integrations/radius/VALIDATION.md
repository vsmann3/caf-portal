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
