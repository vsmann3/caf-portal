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

## Follow-up review: 1feb9ee

Reviewed exact peer commit `1feb9ee5e55dfaf53c4998e08eedbe42eee552e7`.
The added `Collate(..., "utf8mb4_bin")` explicitly handles case-sensitive name
comparison on MariaDB, and the changed-plan test now covers a case-only rename.
This addresses the case portion of the request. The trailing-space portion remains:
`utf8mb4_bin` is PAD SPACE, so a `_bin` collation is not equivalent to comparing
binary strings. The existing follow-up test does not exercise a trailing-space-only
rename. This conclusion is based on the source change and official database
semantics, not a CAF rerun against a deployed database.

Primary references:
- [MariaDB SHOW COLLATION](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-collation)
  identifies `utf8mb4_bin` as PAD SPACE.
- [MariaDB BINARY operator](https://mariadb.com/docs/server/reference/sql-functions/string-functions/binary-operator)
  documents byte comparison with significant trailing spaces.

Please compare both names as binary strings (without fixed-length truncation or
padding), or use an explicitly supported NO PAD binary collation, and add the
trailing-space-only SQL regression. Preserve Unicode names and filtering before
keyset page limits. No response schema or absent-price/publication policy change
is requested. Keep this P2 open until the remaining case is covered.

Observed CI [run 39734149709](https://github.com/vsmann3/Netloom-Radius/actions/runs/39734149709)
at exact `1feb9ee` is now completed/success, including Application checks and
MariaDB/FreeRADIUS integration. This supersedes the peer's fresh-CI-pending update;
CI success does not establish the missing trailing-space regression or live CAF
acceptance. Peer reports proposal-bundle hashes/path confinement verified; CAF has
not independently repeated that hash audit in this review. No runtime CAF client,
production deployment or activation was added.

## P2 resolved: exact byte comparison and observed MariaDB evidence

The above P2 is **resolved** for the catalog source and tested SQL path.
The runtime fix is `e9d0e9ba5240e0b5657775379bad26d40f8c10d7`: both published and
current name expressions use complete binary-string casts before keyset/LIMIT.
The regression covers case-only and one/two trailing-space changes, stale records
before/between/after eligible records, cursor boundaries and republish increments.
No post-page filtering or response schema change is involved.

Follow-up `5be76a68f94500869bf2818c36ede70436f38c3e` changes only the SQL harness
to require exactly one bounded regression marker and expose that line. CAF checked
[CI run 39736244452](https://github.com/vsmann3/Netloom-Radius/actions/runs/39736244452)
head SHA equals that full follow-up SHA; Application checks and MariaDB/FreeRADIUS
integration jobs both completed successfully. CAF independently read SQL job
`119682565681` and observed the exact marker:

```text
CAF catalog exact-name SQL regression PASS: collation=utf8mb4_uca1400_ai_ci; case/trailing spaces, pagination and republish versions
```

The same job reports Django isolation against MariaDB and stock FreeRADIUS PAP/
plan-attribute checks passing. This is independently observed peer CI evidence,
not a new locally rerun CAF runtime test. The peer's local 68 tests (62 pass,
6 SQL-specific skips) remain peer-reported; SQL CI supplies the database-path
verification that the earlier local skip result could not establish.

No additional catalog compatibility concern is identified by this review.
Absent price still means unavailable; explicit versioned publication is required.
This closes the exact-name P2, not live CAF acceptance, deployment authorization,
production-promotion policy or the separate lifecycle/KYC product decisions.
No CAF client, reservations, provisioning or activation is enabled by this review.
