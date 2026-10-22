# CAF Portal repository instructions

## Scope and existing work

- Own application changes in `E:\OpenCode\caf-portal` only. Preserve unrelated
  tracked/untracked work. Do not edit the RADIUS developer's working tree.
- Read `SESSION-HANDOFF.md` when present to resume local work. For CAF/RADIUS work,
  also read `docs/integrations/radius/README.md` and
  `docs/integrations/radius/PEER-COORDINATION.md`.
- No production deployment, database reset, volume/upload deletion or `.env`
  replacement is authorized by the coordination task. Validate changes with
  isolated fixtures and report actual limitations.

## CAF / RADIUS ownership

- CAF owns company/franchise/operator/customer onboarding, customer master,
  KYC/documents, reviews/revisions and customer self-service.
- RADIUS owns AAA, services, plans, reservations, credentials, NAS, sessions,
  network configuration and operational billing/renewals/wallets/commissions.
- Keep the same CAF-issued permanent 10-digit Customer ID across the customer's
  lifetime and multiple connections. Never auto-merge by name/phone/username.
- Initial service activation requires CAF approval and valid technical provisioning.
  Do not add an initial wallet/payment prerequisite. Pending later KYC revision
  continuation/suspension policy remains unresolved; do not invent it or clear
  independent service suspension/expiry.
- Use separate databases and scoped backend APIs. Never share staff passwords,
  document/proof data, NAS secrets or network passwords in generic projections.

## Direct peer coordination

Vikas explicitly authorized direct coordination with the existing RADIUS developer
session. Use the contact and command in `PEER-COORDINATION.md`; this authorization
does not permit editing the peer repository or deploying either application.

- Notify the peer after API/schema changes, meaningful milestones and blockers.
  Include the branch/PR, exact commit SHA, affected endpoints/payload fixtures,
  validation performed and remaining limitations or requested decisions.
- Propose shared interface changes through PRs and record agreement before adding
  incompatible consumers. Preserve pinned canonical schemas until agreed updates.
- Do not silently merge peer PRs or claim peer APIs are live from documentation.
- Avoid acknowledgement loops: do not reply to a pure acknowledgement; send only
  substantive decisions, new evidence, milestones, blockers or needed questions.
- Queue success confirms delivery to the queue, not peer review or agreement.
  Record send failures and pending decisions honestly.

## Owner checkpoint — 2026-10-22

After the current authorization/schema coordination task, both developers must
report completed work, commit/test evidence, open decisions and proposed next
steps to the owner, then wait for further instructions/go-ahead. Do not start
another implementation or coordination iteration merely because the peer proposes
one. A later explicit owner task or go-ahead supersedes this checkpoint.


## Owner resumption ? 2026-10-22

Owner Vikas explicitly resumed both developers after the preceding checkpoint.
CAF is authorized to implement the independent fake-success, secret-handling and
minimal-payload safety fixes in a separate runtime PR, with isolated validation
and no production deployment. See `RUNTIME-SAFETY.md` in the integration docs.
The earlier wait no longer blocks this work. Report exact commits, compatibility
impacts, validation and proposed next steps to the owner and peer on completion.
Activation/withdrawal and later pending-KYC user-visible policies remain unresolved;
do not enable unattended activation or silently choose either policy.


## Owner authorization: isolated working integration model

Vikas explicitly authorized completing the actual CAF form/client, scoped customer/
approval APIs and durable approval worker for an isolated end-to-end CAF/RADIUS demo.
This supersedes the earlier wait for that scope. Use isolated demo databases,
companies and documents only; do not deploy to production or enable real traffic.
Demo staging/receipt acceptance is distinct from activation. Any later demo-only
activation needs explicit isolated semantics; withdrawal and later-KYC policies
remain unresolved. Preserve existing work and coordinate concrete endpoints,
fixtures, exact commits and tests with the existing RADIUS developer, who owns its
runtime repository. Do not stop this authorized implementation at documentation.

After each developed milestone, complete automated checks, then ask Vikas to test
with the exact environment/URL, safe steps and expected results. Await his feedback
before calling it owner accepted. Do not mistake CI success for deployed readiness.
