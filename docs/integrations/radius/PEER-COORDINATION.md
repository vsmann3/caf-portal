# Direct CAF / RADIUS developer coordination

Established 2026-10-22 by explicit owner authorization, relayed by the RADIUS
developer. This file is coordination metadata; it does not enable production APIs.

## Contacts

| Developer | Existing Codex thread | Owned workspace |
| --- | --- | --- |
| CAF | `01a15a10-e320-7c73-b9ec-2cdfe65198ae` | `E:\OpenCode\caf-portal` |
| RADIUS | `01a16125-7ac9-7fe3-9630-259f6426786f` | `E:\Netloom\Netloom-Radius` |

The CAF identity was checked against local thread metadata matching this workspace
and conversation. If a future session has a new identity, send a substantive contact
update and amend this file rather than impersonating a previous session.

Send from CAF using the installed CLI:

```powershell
codex queue --thread 01a16125-7ac9-7fe3-9630-259f6426786f --message $peerMessage
```

Set `$peerMessage` to a plain-text status/decision before invoking the command.
Never put service credentials, personal customer data or document contents into a
peer message. The receiving developer can use the same command with the CAF thread
ID above. Do not launch a replacement peer agent merely to deliver an update.

## Notification protocol

Send on API/schema changes, implementation milestones or blockers. Include:

- Change type and owned repository/branch/PR.
- Exact commit SHA and canonical contract revision.
- Affected endpoints, schemas and synthetic payload paths/examples.
- Actual validation command/result and limits (fixture-only versus live tests).
- Compatibility impact, requested decision or concrete blocker.

A pure acknowledgement needs no reply. Avoid polling/acknowledgement loops and
repeating unchanged status. A successful queue command proves the message was
queued; it does not prove peer agreement or completion. Use GitHub PRs for durable
interface proposals/review and record agreed decisions there as well.

## Initial exchange and current status

- Read-only review completed of the peer's local
  `E:\Netloom\Netloom-Radius\CAF-RADIUS-TEAM-HANDOFF.md` and draft
  [CAF PR #5](https://github.com/vsmann3/caf-portal/pull/5), head `0a5d7ced0f06030593289c9fe221bb90276c77ec`.
- Canonical contract reviewed at RADIUS
  `1db3699e70de37e9d55efb3ff5f750b0f20348a3`; CAF runtime baseline
  `05dbe819ff52a5fb022965a1113bd94981b2f167`.
- CAF proposal [PR #6](https://github.com/vsmann3/caf-portal/pull/6), initial commit
  `b21c55daae8ccfb249aac3ebc1e190029c6aa795`, contains proposed read APIs, unchanged
  pinned approval/provisioning schemas, synthetic examples and validation notes.
  Nine offline contract-fixture tests passed. Runtime integration remains pending.
- Initial status/identity/plan message queued successfully to the RADIUS thread:
  message ID `01a161e6-fb4a-7e31-a4da-55947c7a5571`. No acknowledgement reply requested.

CAF plan: fix fake success/secret exposure/broad payloads; build reusable lifetime
customer master, scoped APIs and atomic approval/version/snapshot/outbox; add
worker/receipt reconciliation; integrate agreed plan/reservation/provisioning and
new-tab form entry; implement agreed KYC decisions and read-only projections.

Peer review is pending for response semantics with multiple applications,
lifecycle/withdrawal/feed schemas and commit-safe cursors, plan validity,
reservation renewal/conflicts, durable credential acceptance and revision/projection
interfaces. These are design dependencies, not claims that the peer is blocked or
that production endpoints exist. The owner decision on existing service during
later pending KYC review remains unresolved.

No production changes are requested. Each developer preserves existing work and
edits only its own application repository. No cross-database access or silent merges.

## Owner checkpoint

On 2026-10-22 the owner instructed both developers to finish the current coordination
task, report what changed/validation/open decisions/proposed next steps, and wait
for further instructions or go-ahead. This was queued to RADIUS in message
`01a161f8-b566-7a52-8e48-276f6cedd1d8`. Do not automatically begin independent
safety fixes, foundation work or a new contract iteration after the report.


## Owner resumption ? 2026-10-22

Owner Vikas explicitly resumed both developers after the preceding checkpoint.
CAF is authorized to implement the independent fake-success, secret-handling and
minimal-payload safety fixes in a separate runtime PR, with isolated validation
and no production deployment. See `RUNTIME-SAFETY.md` in the integration docs.
The earlier wait no longer blocks this work. Report exact commits, compatibility
impacts, validation and proposed next steps to the owner and peer on completion.
Activation/withdrawal and later pending-KYC user-visible policies remain unresolved;
do not enable unattended activation or silently choose either policy.
