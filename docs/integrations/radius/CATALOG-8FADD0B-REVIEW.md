# CAF review of RADIUS catalog milestone 8fadd0b

Reviewed exact source commit
`8fadd0bdad73b65ebaacdb1e56ad6cd83f5bf441`:
`core/caf_catalog.py`, its tests/models, setup/publication commands, settings,
URL routing, migration 0009 and `docs/integrations/caf-catalog-implementation.md`.
This is a source/contract review, not live CAF endpoint acceptance. CAF has not
implemented a catalog client or enabled a production integration.

## Compatible interface and intended CAF client behavior

The response projection matches `round2.proposed.schema.json` `$defs/planPage`:
UUID plan ID, positive safe-integer version, company reference, active flag,
positive integer kbps and explicit positive activation-anchored duration. RADIUS's
5+ digit public company string is a compatible narrower organization reference.
CAF must explicitly map its company CUID to that public number, never substitute
its own ID, a tenant UUID, display code or inferred company name.

Price omission is compatible and means unavailable. The future UI must not display
zero/free or invent currency, taxes or calendar-month validity. Selection must pin
UUID/version; a listing is no reservation or provisioning guarantee. Revalidate in
future reservation/provisioning operations rather than trusting cached catalog data.

Company-scoped bearer service authentication, explicit `plans:read`, default-disabled
catalog, HTTPS/trusted peer policy, token rotation/revocation, no-store responses,
60-request/minute token quota, safe structured errors and UUID keyset pagination
fit the planned backend client. CAF must use separately configured scoped credentials;
the existing global RADIUS settings in safety PR #7 are not a transport connection.
No browser should receive the bearer token or choose its binding/scope.

Catalog cursors are explicitly live directory cursors, not snapshot/feed checkpoints.
Accept the documented 15-minute, binding/token/company-scoped cursor and 400
`invalid_cursor` on expiry/rotation for this catalog. CAF can discard accumulated
pages and restart once, with bounded attempts, rather than treating them as a
consistent snapshot. This does not change the previously proposed **410** expiry
contract for the separate authoritative CAF feed/bootstrap APIs. Do not retry
401/403/404 indefinitely; honor 429 Retry-After and bound retryable 503 backoff.
`integration_disabled` is non-retryable configuration state, not endpoint readiness.

## Implementation issue to resolve before catalog acceptance

**P2: exact published-name equivalence needs MariaDB coverage / an explicit comparison.**
`core/caf_catalog.py` filters publications with `name=F("plan__name")`. That SQL
predicate does not specify byte-exact equality. On a case-insensitive or PAD SPACE
collation it may still match a changed live plan name (case-only or trailing-space
change), returning the old name/version despite the documented invalidation rule.
The numeric rate predicates do not resolve the name comparison.

This is a source-derived compatibility concern; CAF has not reproduced it against
the deployment's exact column collation. Please add MariaDB tests that publish
`300 Mbps`, change only case and then trailing space, and require disappearance
until a versioned republish; also test a name containing non-ASCII characters if
supported. Inspect/assert actual column collation. Use an exact comparison whose
semantics survive that collation (or an authoritative publication invalidation
mechanism), with correct keyset pagination after filtering. Do not truncate a SQL
page first and then drop mismatches without finding the next eligible page.

Add direct name-change coverage as well as the existing rate-change coverage. This
request changes implementation/verification, not the agreed response schema.

## Validation evidence and limits

- Compared the actual source response construction and its exact expected-item
  test with CAF `$defs/planPage` and the round-two accepted semantics.
- GitHub [Checks run 39733891165](https://github.com/vsmann3/Netloom-Radius/actions/runs/39733891165)
  at this exact SHA is now **completed/success**, superseding the earlier pending
  status. Both Application checks and MariaDB/FreeRADIUS integration jobs passed.
- Read the integration workflow/script and SQL/PAP job log: it runs `manage.py test
  core` against MariaDB and reports Django isolation PASS, real PAP/plan attributes,
  tenant/policy/NAS rejection, read-only/DDL denial, suspension and outage checks.
  This is observed peer CI evidence, not a locally rerun CAF acceptance test; it
  does not cover the missing case/trailing-space name regression above.
- CAF has not rerun the peer's 67-test suite locally or called a live catalog API.
  No claim of deployed endpoint readiness, reservations or activation is made.

## CAF implementation report and remaining decisions

CAF safety commit `e16ffaa863c8ad729d926253c9e7d5a717599131`,
[PR #7](https://github.com/vsmann3/caf-portal/pull/7), removes fake success, protects
write-only encrypted settings secrets and atomically stores minimal blocked local
references on approval. See `RUNTIME-SAFETY.md` on that branch/commit for payload,
compatibility and full evidence. It passed Docker build, five isolated API/DB
suites, Chrome desktop/mobile, TypeScript, six startup checks and 38 offline
contract tests. No dependency/migration/shared wire-schema or production changes.
New local references are **not** canonical approval events and must not be consumed.

Record peer technical acceptance of the absolute 24-hour credential-ciphertext
window and source-v2-only supersession. These remain protocol foundations, not
implemented credential capture/delivery. Unknown/expired acceptance needs deliberate
reconciliation/recovery; retries never extend the deadline or reset passwords.

Post-authorization withdrawal behavior and later pending-KYC active-service policy
remain owner decisions. CAF proposes reusable lifetime customer master and scoped
approval/version/outbox foundations next, pending a new owner instruction. This
review does not implement that scope or enable unattended activation.
