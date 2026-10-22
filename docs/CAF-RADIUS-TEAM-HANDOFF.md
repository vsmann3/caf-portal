# CAF Portal + Netloom Radius: shared developer handoff

Updated: 2026-10-22. Read this first in BOTH Codex sessions.

Canonical copy: https://github.com/vsmann3/Netloom-Radius/blob/main/CAF-RADIUS-TEAM-HANDOFF.md

This file consolidates the owner's decisions so the owner does not have to repeat
the conversation. Business decisions below are confirmed except the explicitly
listed open question. API paths/schemas are design contracts to implement and test,
not evidence that integration endpoints are already live.

## 1. Goal and team boundaries

Build for our own three companies first: Infolink Broadband, NorthNet and VM Net.
Each company can have multiple franchises and operators. Later we may offer the
same software to other ISPs. Reuse established components and avoid duplicate apps.

| Owner | Repository | Responsibilities |
| --- | --- | --- |
| CAF developer | https://github.com/vsmann3/caf-portal | ALL company/franchise/operator/customer onboarding, customer master, eCAF forms, KYC/documents, review/revisions, customer self-service |
| Radius developer | https://github.com/vsmann3/Netloom-Radius | FreeRADIUS AAA, scoped service accounts, plans, username validation/reservations, network credentials, IP/PPPoE/hotspot configuration, NAS, sessions/accounting/Disconnect, operational billing/wallets/renewals/commissions |

CAF is the only onboarding application. Radius must not build a competing CAF form,
KYC workflow, document store or company/franchise/operator/customer master-entry UI.
Radius can expose entry points into CAF and its own service/permission management.

The two apps keep separate databases and service secrets. API integration only:
no cross-database SQL, no importing another app's tables, no copying staff login
passwords. Shared staff sign-in/SSO, if added, requires an explicit identity design.

## 2. The permanent 10-digit identity

- CAF issues the unique customer/account ID, a string matching `^[1-9][0-9]{9}$`.
- Keep that SAME ID for every operation over that customer's entire lifetime:
  corrections, new CAF revisions, renewals, billing, relocations, transfers and
  additional connections. Radius must never allocate a competing customer number.
- A customer may have multiple network connections. Each connection has its own
  internal Radius service UUID and username while retaining the same customer ID.
- Company/franchise public IDs (5+ digits in Radius) are organizational IDs and
  are NOT the 10-digit customer ID. Map CAF CUIDs to Radius tenant/franchise IDs.
- Never merge customers automatically by name/mobile/username. Existing Radius
  accounts without a CAF ID need explicit reviewed linking.
- CAF must support reuse of its customer master across later applications. Its
  reviewed schema currently makes customerId unique on each application/draft;
  that must not cause a fresh customer ID for each subsequent CAF or connection.

## 3. Journey A: start in CAF Portal

1. Staff or a customer enters through CAF. CAF owns self-service behavior/scoping.
2. Selecting the company fetches that company's available plans from Radius.
3. CAF records the customer, documents, selected plan and company/franchise context.
   CAF assigns the customer ID and the initial network username/password.
4. Radius validates/reserves the chosen username. CAF uses the plan UUID returned
   by Radius, not a guessed plan name or bandwidth string.
5. Saving a draft/submitting the form NEVER activates internet.
6. CAF approval triggers delivery of an approved provisioning request to Radius.
7. Radius validates the source, mappings, approved revision, plan, reservation and
   credentials; hashes the initial password; creates/activates the service once.
8. CAF shows the real Radius provisioning result. Queued/received is not active.

Initial activation requires CAF approval. The owner explicitly rejected adding a
separate payment/wallet authorization prerequisite to INITIAL activation. Valid
technical configuration is still necessary; missing/invalid inputs must show an
actionable failure, not false success. Plan validity/expiry rules belong to Radius.
This initial activation rule does not remove later expiry/suspension/billing rules.

## 4. Journey B: start in Radius

1. Add customer in Radius opens the SAME CAF form in a new tab.
2. Supply safe company/franchise prefill context and an allowlisted return link.
   Prefill data never grants authority; CAF verifies the signed-in actor's scope.
3. CAF creates/saves/reviews the customer exactly as in Journey A.
4. On approval, CAF provisions Radius, then the operator can return to Radius.

Do NOT create a customer independently in Radius and later duplicate it in CAF.
Do NOT copy the CAF component or its submission backend into Radius. Initial form
presentation is a new tab; embedding was not selected for the first implementation.

## 5. Ownership AFTER onboarding and two-way display

Radius can change its own operational information without CAF approval, under its
own actor permissions/audit. This includes username/password, plans/plan edits,
static IPs, network mode/settings, billing, renewals, wallets and commissions.

Radius publishes safe versioned service/billing summaries to CAF. CAF shows those
as READ ONLY. Enforce that restriction with backend field ownership/API scopes,
not merely disabled buttons. CAF cannot edit the Radius plan catalog, live network
configuration or financial records. Its initial plan choice is a provisioning
request, not ownership of those fields.

Passwords, password hashes and NAS secrets NEVER appear in these projections.
Show username, service state and safe credential-change metadata only.

## 6. ONLY basic customer/KYC changes require CAF approval

CAF owns the exact policy identifying basic/KYC fields requiring review (name/full
name and its other mandatory identity fields). Radius must use that policy rather
than invent a competing list.

When an authorized operator starts such an edit from Radius:

1. Radius submits a change request to CAF with customer ID, base approved revision,
   proposed field changes, reason, actor reference and company/franchise context.
2. CAF creates a pending revision and preserves the last approved snapshot.
3. The eCAF manager reviews the exact revision/diff and approves or rejects it.
4. CAF sends the decision/version back through API events/reconciliation.
5. Radius applies ONLY that approved revision and reports application success/failure.

Do not overwrite the approved CAF record via shared SQL. Do not apply a pending
identity edit as though it were approved. Reject stale/conflicting decisions.
Distinguish review status from application status in both UIs:
`pending_review -> approved -> applying -> applied`, or `rejected`/`application_failed`.

Username/password, plan/IP/network and billing/renewal changes do NOT require this
CAF approval. An earlier suggestion requiring review of credential changes was
explicitly superseded by the owner's clarification.

## 7. One unresolved owner decision -- do not invent it

For an EXISTING approved active customer, should internet continue using the last
approved information while a later KYC revision awaits review, or be suspended?

The Radius developer recommended continuing the last approved configuration, but
the owner has NOT confirmed that recommendation. Do not implement a new automatic
disconnect/re-enable policy for pending KYC revisions until confirmed. New account
activation still waits for initial CAF approval. Independent expiry/operational
suspension is not cleared by a pending request or replayed approval.

## 8. API inventory and implementation division

Detailed contract:
https://github.com/vsmann3/Netloom-Radius/blob/main/docs/integrations/ecaf-api-contract.md

| Implementer | Endpoint / capability | Purpose |
| --- | --- | --- |
| CAF | GET `/api/integrations/radius/v1/companies` | Authorized organization mapping inventory |
| CAF | GET `/api/integrations/radius/v1/companies/{caf_company_id}/franchises` | Franchise mapping inventory |
| CAF | GET `/api/integrations/radius/v1/customers/{customer_id}` | Minimal authoritative customer/review/version lookup |
| CAF | GET `/api/integrations/radius/v1/changes?cursor=...&limit=100` | Durable cursor-based reconciliation feed |
| Radius | GET `/api/integrations/ecaf/v1/companies/{radius_company_id}/plans` | Scoped plan catalog, rates and validity rules |
| Radius | POST `/api/integrations/ecaf/v1/username-reservations` | Reserve a CAF-chosen username for a stable service request |
| Radius | POST `/api/integrations/ecaf/v1/provisionings` | Approved initial service provisioning, including credential acceptance |
| Radius | POST `/api/integrations/ecaf/v1/events` | Credential-free approved-profile/lifecycle event inbox |
| Radius | GET `/api/integrations/ecaf/v1/events/{event_id}` | Durable receipt / application outcome |
| Radius | GET `/api/integrations/ecaf/v1/customers/{customer_id}/services` | Safe service-status lookup for CAF |

Additional interfaces required for the expanded ownership flow (agree exact schemas
before coding consumers):

- CAF organization/staff onboarding/change events -> Radius mappings/permissions.
- Radius -> CAF customer change-request submission and status lookup. Proposed
  POST `/api/integrations/radius/v1/customer-change-requests` and GET of that ID.
- CAF -> Radius versioned revision approval/rejection events.
- Radius -> CAF read-only service/billing projection. Proposed PUT
  `/api/integrations/radius/v1/service-projections/{radius_service_id}` with a Radius
  backend write credential; CAF staff/browser credentials receive read access only.
- CAF policy describing basic/KYC fields requiring revision review.

New event types must have agreed schemas. The existing generic JSON schema accepts
`customer.approved` only; do not send new entity/review types and assume they work.
Staff onboarding maps approved identities to explicit Radius roles; never infer
unlimited operational/financial access merely from a name or untrusted role string.

## 9. Shared payload files

These are in Netloom-Radius and can be read directly by the CAF Codex session:

- [Approval schema](https://github.com/vsmann3/Netloom-Radius/blob/main/docs/integrations/ecaf-event.schema.json)
- [Approval example](https://github.com/vsmann3/Netloom-Radius/blob/main/docs/integrations/ecaf-event.example.json)
- [Provisioning schema](https://github.com/vsmann3/Netloom-Radius/blob/main/docs/integrations/ecaf-provisioning.schema.json)
- [Provisioning example](https://github.com/vsmann3/Netloom-Radius/blob/main/docs/integrations/ecaf-provisioning.example.json)
- [Revision ownership notes](https://github.com/vsmann3/Netloom-Radius/blob/main/docs/integrations/ownership-revisions-proposal.md)

The initial network password crosses ONLY the dedicated provisioning endpoint over
authenticated HTTPS. CAF retains it encrypted only while delivery is pending and
purges the recoverable value after Radius durably acknowledges credential acceptance.
Radius hashes it before durable storage. Never log or return plaintext credentials.
Generic events, profile lookups and network projections are credential-free.

Use scoped service credentials in both directions, reviewed company/franchise
bindings, idempotency, stable service_request_id, monotonic revisions/versions,
transactional outbox/inbox, durable receipts, bounded retries and reconciliation.
Matching retries cannot create a second service, renew twice or reset a password.
No synchronous CAF call during FreeRADIUS authentication packets.

## 10. Current implementation reality

CAF source reviewed at `05dbe819ff52a5fb022965a1113bd94981b2f167`:

- Customer ID sequence and CAF/company/franchise/staff/document/review structures exist.
- Current RADIUS adapter is a no-op returning `SKIPPED` success: replace this with
  honest unimplemented/disabled status until real delivery works.
- Current adapter payload omits customerId/version and includes unnecessary ID-proof
  fields: replace it with the shared minimal contract, not a raw model dump.
- Approval/outbox atomicity, a real retry worker and service-auth APIs need work.
- Integration config currently returns its object (including saved apiKey): make
  new secrets write-only/redacted and select connections by authorized company.

Radius currently has the tenant-aware Django/FreeRADIUS/MariaDB foundation, scoped
management, company numbering and directory/filter code. Initial public login and
Tabler dashboard were deployed. Later directory/numbering VM rollout is not yet
confirmed. Integration APIs, franchise runtime, accounting ingestion, Disconnect
dispatch, hotspot/static-IP management and full financial workflows are NOT all
implemented/accepted. Do not equate design scope with shipped features.

## 11. Working together without conflicting edits

1. Each Codex session reads its own repository instructions AND this handoff.
2. Each developer owns application changes only in its assigned repository.
3. Use GitHub branches/PRs for cross-repository documentation/contract proposals.
   Do not overwrite the other developer's working tree or merge their work silently.
4. If an endpoint/schema changes, submit the contract change first, identify the
   peer impact, and record agreement before changing a consumer incompatibly.
5. Share concrete commit SHAs, endpoint payload fixtures and test results, not
   “done” messages without compatibility evidence.
6. Never mark the peer API ready without a tested implementation and credentials/
   scopes configured outside Git. Do not enable fake-success adapters.
7. A shared handoff does not connect two running Codex sessions automatically.
   Coordinate through this file, contract PRs and the owner's relay when necessary.

### Initial ownership checklist

- CAF developer: reusable customer master/ID lifetime, existing form entry,
  company-scoped Radius plan/reservation integration, approved provisioning worker,
  organization/staff events, KYC revisions/decisions, read-only network display.
- Radius developer: scoped integration authentication/mappings, plan validity API,
  username reservation, customer link + provisioning/receipt processing, customer-ID
  directory support, service operations/projections and revision decision consumer.
- Both: fixtures, retries/conflicts/out-of-order events, rejection/approval behavior,
  tenant/franchise isolation, credential handling and reconciliation after outages.

### Minimum joint acceptance

One CAF customer appears in both systems with the SAME 10-digit ID. New service is
not active before approval and activates after approved technical provisioning.
Entry from Radius uses CAF's actual form. Company plans are fetched from Radius.
Retries do not duplicate/reset anything. Radius operations appear read-only in CAF.
Only CAF-designated basic/KYC changes require revision approval; operational changes
do not. Rejected/stale revisions do not replace approved data. Cross-company/
franchise access fails. No secrets or identity-document data leak into projections.

## 12. Message to paste into the CAF Codex session

> Read CAF-RADIUS-TEAM-HANDOFF.md from vsmann3/Netloom-Radius main (or the copy in
> this documentation PR), then read the linked API contract and JSON schemas.
> These record our owner's confirmed decisions. You own CAF Portal only; the
> other developer owns Radius. Implement the CAF side without duplicating AAA
> or changing the shared customer ID. Propose interface changes through a PR and
> report the endpoint list, payload fixtures, commit SHA and tests for peer review.
> Keep the pending-KYC existing-internet policy unresolved until the owner confirms it.
