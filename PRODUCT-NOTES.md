# CAF Portal: product requirements, known gaps and improvement plan

Recorded: 2026-10-20

This is a planning record, not a list of completed features. Findings below came from a source/documentation review; they are not a full security audit. Implementation status must be checked again before work starts. This note does not authorise changes to production data or infrastructure.

## Product purpose

An ISP customer onboarding and Customer Application Form (CAF) portal. It manages companies and franchises, collects customer details and supporting documents, supports administrative review, and keeps records on infrastructure controlled by the operator. RADIUS provisioning is an intended downstream integration.

Existing foundations include role-based access, company/franchise scoping, CAF submission and review, customer search, document endpoints, local/S3 storage providers, and audit logging. Some features advertised in the README are incomplete; see the gap register below.

## Confirmed direction from the owner

| Area | Requirement / decision | Status |
| --- | --- | --- |
| Storage now | Continue using local disk for document storage and retrieval. | Current operating choice; do not switch storage as part of this planning work. |
| Storage later | Store and retrieve all documents using S3. | Planned; requires migration and validation of existing documents. |
| Identity/document verification | Integrate Surepass APIs for real-time Aadhaar, driving licence (DL), and other supported document validation. | Planned; exact APIs, authentication, response fields and supported evidence must be confirmed from the provider documentation/account. |
| Mobile verification | Verify customer mobile numbers. | Future requirement; OTP is a proposed method, not yet a final provider choice. |
| Email verification | Verify customer email addresses. | Future requirement; verification links or OTP are proposed methods. |
| CAF improvements | Make customer entry easier, clearer and more reliable for franchise staff. | Proposed design below. |
| Approved CAF download | Once a saved CAF is approved, allow authorised users to download a PDF for sharing with DoT, the relevant Indian ministry/IT authority, or another authorised recipient. | Planned. Exact recipient, format and sharing requirements need confirmation before implementation. |
| Supporting evidence | Include or accompany the approved CAF with uploaded documents and Aadhaar XML from Surepass or the respective provider, where that artifact is available and appropriate for the intended export. | Planned; do not assume every verification API returns Aadhaar XML. |

These requirements do not imply that a generated PDF, a provider response, or this application is certified or accepted by an authority. Recipient-specific templates and evidence requirements remain to be established.

## Known gaps and flaws to address

| Priority | Finding from the review | Impact / next action |
| --- | --- | --- |
| High | At initial review, no checked-in `prisma/migrations` files existed. | The login repair adds an initial migration for fresh databases. Existing databases whose application tables were created outside Prisma Migrate still need a reviewed baseline; never reset or reinitialise production to create one. |
| High | Storage settings pages and API exist locally but were untracked at review time. The owner subsequently confirmed that the deployed page returns 404. | The owner explicitly deferred this fix while prioritising Super Settings and SMTP. Review, test and commit the storage pages/API in a later task; do not switch providers or migrate documents as part of email work. |
| High | RADIUS adapter is a no-op returning success with `SKIPPED`. | A successful-looking sync does not prove subscriber creation. Represent disabled/unimplemented integration honestly; implement real adapters, idempotency, durable retries and visible errors. |
| High | Documents store a provider name/key, but reads resolve the current provider configuration. | A changed local path, S3 bucket or endpoint can break older documents. Persist a reference to an immutable/versioned storage location. |
| High | Upload checks use the supplied MIME type and per-file size. | Add content-based file validation, total request limits, malware scanning and server-side required-document checks. The UI currently asks for at least one attachment, but the API does not enforce that minimum. |
| Medium | Branding screen submits fields that the company update API does not save; the domain resolver appears unused. | Complete persistence, domain resolution and rendering, then test tenant boundaries and host handling. |
| Medium | Customer-page franchise dropdown is not applied to the page query. | Make the selected franchise affect the query; retain existing company/franchise access restrictions. |
| Medium | `DRAFT` exists in the schema, but no complete draft/correction workflow was found. | Implement server-backed drafts, editing rules and correction/resubmission. |
| Medium | Audit events are written, but no dedicated audit viewer was found. | Provide a permission-scoped history/search interface and suitable event retention. |
| Medium | Review decisions are not protected by an atomic state transition. | Prevent concurrent reviews from creating conflicting decisions or duplicate provisioning jobs. |

The Docker Prisma startup fix is completed separately in commit `b0a45d4`: locked Prisma 6.19.3, production runtime dependencies, OpenSSL, explicit migration failure handling and LF shell scripts. It does not complete the features in this note.

## Suggested CAF form design

### Organise entry into clear steps

1. **Application context:** company/franchise, connection type, residential/commercial. Derive scope from the logged-in user and keep server-side checks authoritative.
2. **Customer:** name, date of birth, contact details and verification indicators.
3. **Identity:** document type, required identifiers, consent and explicit verification action.
4. **Addresses:** installation and billing address, with a "same as installation" option.
5. **Connection:** plan selected from a managed catalogue, bandwidth and account/service identifiers where applicable.
6. **Documents:** required checklist, upload/camera capture, previews, readable size limits and upload progress.
7. **Review and declaration:** summarise the completed form, highlight missing items, record consent/declaration and submit.

### Make daily work easier

- Save drafts to the server, show last-saved time and allow resuming later. Define automatic-save behaviour explicitly; avoid browser-local storage of identity documents.
- Keep entered data when validation or upload fails. Show errors beside fields and provide an error summary.
- Use conditional fields for residential/commercial and connection/document types rather than showing every possible input.
- Offer document replacement, rotation/crop and readable previews. Keep the original evidence separately from any display/compressed derivative.
- Provide duplicate warnings for relevant identifiers within the authorised tenant scope. A shared mobile number should be a warning requiring review, not an automatic rejection.
- Support mobile screens and keyboard navigation. Consider Hindi/regional-language labels after confirming the languages staff use.
- Let reviewers request specific corrections, assign applications and see the changes made during resubmission.
- Show timestamps and status separately for form completion, contact verification, identity checks, administrative approval and provisioning.
- Generate the CAF number and identifiers server-side. Do not trust hidden or disabled form fields for access control.

## Surepass / provider verification plan

### Integration approach

- Use a server-side provider adapter; never send API credentials to the browser or embed them in exported forms.
- Obtain the provider's current documentation and sandbox access before selecting endpoints or promising Aadhaar XML availability.
- Cover Aadhaar, DL and other agreed document types incrementally. Each type may require different inputs, consent and provider flows.
- Define "real-time" as an explicit verification request with a visible result/pending/error state. Avoid billable API requests on every keystroke.
- Separate transport success from a positive verification result. Timeouts, unsupported documents and provider outages must not become "verified".
- Record the provider, request/reference ID, document type, checked fields, result, timestamp and application version. Keep only necessary response data; protect any retained sensitive evidence.
- Show proposed provider-derived values for confirmation. Do not silently overwrite staff-entered details or assume every provider returns the same data.
- Invalidate or flag verification when the relevant identifier/details change. Preserve previous checks in history.
- Design rate limits, timeouts, controlled retries, duplicate-request protection and clear handling of chargeable requests.
- Keep verification separate from CAF approval. Define any authorised manual exception policy and record the reviewer and reason.

### Aadhaar XML and evidence

- Confirm whether the chosen provider flow returns the original XML artifact, an e-KYC response, a verification result, or another format. These are not interchangeable.
- Where original XML/evidence is supplied, preserve its original bytes, associated provider reference and integrity hash. Do not reconstruct an "original" XML file from JSON fields.
- Define how any provider/document signatures are verified and retain the verification outcome. Do not present an unvalidated artifact as authentic.
- Store provider artifacts through the same controlled document storage abstraction used for uploads; never place them in public web directories.
- Establish access, masking, retention and recipient-sharing rules before enabling exports of identity artifacts. Confirm the requirements applicable to the selected provider flow and intended recipients during implementation.

## Future mobile and email verification

- Track mobile and email verification independently from document verification and approval.
- For mobile OTP, define expiry, attempt limits, resend cooldown, provider selection and delivery failures.
- For email, choose an expiring single-use link or OTP and provide a resend/change-address flow.
- Store verification timestamps and reset verification when the contact value changes.
- Record consent for the selected communication channels and prevent enumeration/abuse.
- Treat contact verification as proof of control of that number/address at the time of the check; do not label it identity verification.

## Storage roadmap: local now, S3 later

1. Keep local storage as the active option for current operation.
2. Fix historical storage references before offering unrestricted location changes.
3. Use a document record with tenant/application ownership, category, original filename, detected MIME type, size, integrity hash, storage-location ID/key and creation/version metadata.
4. Use the same save/read interface for uploaded proofs, provider evidence, approved PDFs and export packages.
5. For S3, choose the service, bucket, region, access policy, encryption, lifecycle/versioning and backup approach. Keep objects private; serve through authorised endpoints or short-lived authorised links.
6. Migrate existing files with a resumable copy job, per-file checksum verification and a recorded result. Test downloads and restore/recovery before changing references.
7. Keep the original local files through an agreed rollback/retention period. Do not automatically delete local documents when selecting S3.

## Approved CAF PDF and evidence export

### Requested outcome

After an application is saved, reviewed and approved, an authorised user can download a consistent, shareable CAF record with its supporting evidence. Approval is the gate for the final approved export. A draft preview, if introduced, should be clearly watermarked and distinguishable from the approved record.

### Recommended deliverables

| Deliverable | Suggested contents |
| --- | --- |
| Approved CAF PDF | Company/franchise identification and branding, CAF number, customer and connection details, agreed identity/contact verification summaries, declaration/consent references, approval/reviewer details, timestamps and document checklist. |
| Supporting-document PDF | Readable copies of eligible image/PDF attachments, subject to an agreed ordering and masking policy. Keep originals separately. |
| Complete evidence ZIP | CAF PDF, original permitted attachments, original provider XML/evidence where available, and a manifest listing file categories, sizes, integrity hashes and provider references. ZIP is a recommendation for preserving original file formats, not a confirmed recipient requirement. |

An original XML document cannot retain its machine-readable evidence properties merely by being printed into a PDF. Offer the original permitted artifact alongside the human-readable summary when required.

### Approval and export behaviour

- Freeze a versioned snapshot of the approved form and the exact document/verification versions reviewed. Generate the PDF from this snapshot, not mutable live customer data.
- Subsequent corrections create a new revision and require the agreed reapproval process. Keep previous approved versions available to authorised staff.
- Distinguish recorded approval details from a legally recognised digital signature. Select any signing mechanism only after recipient requirements are known.
- Enforce tenant/role access on generation and download. Log who exported which application/revision and when; record the stated recipient/purpose where appropriate.
- Define a standard masked export and, if required, a separately authorised detailed-evidence export. Avoid including credentials, unrelated records or unnecessary raw API responses.
- Use controlled generation jobs for large document sets, with progress, retry behaviour, expiry and cleanup policies for temporary export files.
- Test page layout, pagination, image readability, long addresses, special characters, missing/invalid attachments and large evidence sets.
- A verification QR/reference may be useful, but it must not expose personal details or make the evidence publicly accessible by default.

## Other retained improvement ideas

- Automated database and document backups, isolated restore tests and documented recovery steps.
- Health/readiness endpoints, migration failure alerts, disk/storage alerts and deployment rollback procedures.
- Automated tests for company/franchise isolation, document permissions, full CAF submission/review, exports and provider failures.
- Administrator MFA, password recovery, session management and stronger shared rate limiting when needed.
- Primary portal settings belong under Super Admin **Super Settings**, with separate accordions and a save button for each section. SMTP configuration, test delivery and new-account welcome emails are the first email requirements. Saving email settings must not overwrite other sections or their unsaved form inputs.
- Pending-review ageing, reviewer assignment, notifications, reminders and operational dashboards.
- Permission-scoped CSV exports and controlled bulk imports.
- A real RADIUS queue/worker with retries, idempotency and reconciliation after approval.
- Payments, identity-provider sign-in and a customer-facing status portal as later extensions, after the core onboarding flow is dependable.

## Suggested implementation order

1. **Reliability foundations:** migrations, tracked/deployed storage settings, honest RADIUS status, historical file references, filter/branding fixes, backups and core workflow/access tests.
2. **CAF usability:** drafts, field-level validation, required-document checklist, previews, correction/resubmission and approval versioning.
3. **PDF/export:** agree the recipient template, then implement approved snapshot, PDF, authorised evidence package and export audit trail.
4. **Provider verification:** Surepass sandbox integration, evidence handling and verification-state tests. This can be designed alongside PDF exports so the export format accommodates later verification evidence.
5. **Contact verification:** selected mobile/email providers and operational policies.
6. **S3 migration and automation:** verified document migration, recovery validation and real RADIUS provisioning.

This order is a recommendation. Business urgency may move Surepass earlier; its evidence model should be designed before finalising the approved CAF snapshot.

## Decisions needed before implementation

- Exact DoT/ministry/other recipient and any prescribed CAF template, attachment limits, language, signing and evidence requirements.
- Surepass account/API documentation, sandbox access, supported document flows, XML/artifact availability, pricing/rate limits and credentials supplied through a secure channel.
- Required document checklist and verification/approval rules for each application/customer type.
- Which fields may be edited after submission, who can request corrections, and who can approve exceptions.
- Whether final sharing requires one combined PDF, separate PDFs, original evidence ZIP, or several export options.
- Required customer declaration/consent wording, identity masking, retention and access/sharing policies, to be confirmed with the responsible owner/adviser.
- Mobile/email provider choices, expected traffic and handling of verification outages.
- S3 service choice and the migration/rollback acceptance criteria. Local storage remains the current choice until a migration is approved.

## CAF reference review — 2026-10-21

Reviewed local reference images `references/caf-form-1.png` through `caf-form-4.png` against the existing CAF form. These screenshots are inspiration, not an approved field specification.

**Owner direction:** eCAF collection, verification, review and export are the core product. This is not intended to become a RADIUS administration portal. Selected fields may later be sent to an external RADIUS server through its API. Discuss the design with the owner before implementing it. Retain deferred ideas for future updates rather than treating them as permanently rejected.

### Proposed design, awaiting owner review

- Use responsive sections for application context, customer/contact details, identity verification, addresses, service details, documents, and declaration/review. Prefer two columns on desktop and one on mobile; avoid the reference's horizontal scrolling and dense four-column layout. Allow sections to collapse while keeping completion/errors visible.
- Provide explicit Save Draft, resume, review summary and Submit for Approval actions. A draft save is not approval; freeze the approved revision used for exports.
- Keep customer full name, parent/spouse details, date of birth, contact details, customer type and scoped company/franchise context. Generate the CAF number; provide a separate optional legacy/external reference.
- Clarify address semantics: identity/permanent address, installation address and billing address only where needed, with clearly directed copy options. The current form labels both its main address and an additional address as installation address, which is ambiguous.
- Make document categories and required evidence explicit, including front/back where applicable, photo, identity/address proof and declaration evidence. Provide previews, replacement and validation. Agree business-customer documents and signing/declaration method before implementation.
- Prepare separate verification states for Surepass identity checks, mobile and email. An uploaded file, a successful API call, a welcome email and an approved CAF do not by themselves mean the customer is verified. Do not display a working Aadhaar OTP action until the provider flow exists.
- Keep a small optional service section: plan/bandwidth, service/account username or external subscriber ID, and connection type. Decide which values must be captured now and which will come from the external system. Never include service passwords in CAF PDFs or evidence exports.
- Approved PDF should use a dedicated print layout rather than a screenshot of the entry screen. Preserve original attachments/provider artifacts separately; retain the existing approved snapshot and evidence-export plan above.

### Retained backlog, not part of the proposed first CAF redesign

| Reference feature / idea | Proposed disposition | Revisit when |
| --- | --- | --- |
| RADIUS API field mapping, provisioning, retries and sync status | Future integration; CAF completion must remain usable without it. Distinguish approval from provisioning. | External API contract and desired sync trigger are agreed. |
| IP mode/static IP, MAC, node/POP, switch/port, protocol, circuit ID, cable length | Defer network inventory/operations fields; retain only an agreed CAF-relevant subset if needed. | A specific downstream API or operational requirement needs them. |
| Billing modes, package/subpackage catalogues, installation charges and deposits | Defer full billing management; an agreed plan/charge snapshot may be useful on the CAF. | Owner confirms commercial information required on the form. |
| Payments, discounts, additional charges, purchase orders and expiry | Retain for future integrations; do not build accounting workflows as part of CAF entry. | Finance-system responsibilities and business CAF requirements are defined. |
| Branch, building/area catalogues and GPS coordinates | Optional later; avoid adding mandatory fields without a demonstrated need. | Franchise workflow or installation evidence requires them. |
| Aadhaar OTP, mobile OTP and email verification | Retained planned capabilities, separate from the initial layout work. | Provider access, flows and exception policies are agreed. |

### Questions for the design review

1. Should the first release support residential and business CAFs, or residential first?
2. Which service fields are required now: username/external ID, plan, bandwidth, installation fee or deposit?
3. What customer declaration/signature evidence is required: uploaded signed form, captured signature, or a later signing provider?
4. Should billing address be collected now in addition to identity/permanent and installation addresses?

No application behaviour or schema was changed during this reference review. Decisions above remain proposals unless explicitly identified as owner direction.

## Owner decisions following reference review — 2026-10-21

These decisions supersede the corresponding open questions above. This entry records requirements; implementation and validation are still pending.

- **Customer types:** support both residential and business CAFs in the first redesign. Business CAFs require a GST number and GST certificate file. Future Surepass GST verification is retained in the roadmap; format validation/upload alone must not be labelled GST verified.
- **Required service username:** generate a proposed username from the customer's first name plus the last five digits of the mobile number. On collision, try the last six digits, then seven, and progressively up to the full number. Normalise names consistently and define a fallback for names with no usable characters. If every candidate collides, propose a short additional suffix. Check availability while creating, but enforce uniqueness atomically on the server as well; a browser availability check alone cannot prevent concurrent collisions. Agree whether uniqueness is portal-wide or per company and, later, against the external RADIUS account namespace. Keep a generated username stable when a customer's name/mobile changes unless an explicit rename workflow is agreed. Do not expose customer details through username availability responses.
- **Signing:** declaration/signature capture method remains undecided. Retain uploaded signed CAF, on-screen signature and provider-backed signing as future options; do not silently select one for implementation.
- **Addresses:** billing and installation addresses are both mandatory. Offer "billing address same as installation" to avoid duplicate entry while retaining both address values in the submitted/approved snapshot. Keep identity/provider-returned address distinct where collected.
- **State and city selection:** show state first, then load cities for the selected state. Changing state must clear any incompatible city. Use a maintained Indian address dataset or server-side lookup source, and allow an authorised correction path for missing/new localities rather than blocking legitimate addresses.
- **PIN lookup:** entering a valid PIN should look up and populate state and city where the result is unambiguous. If several localities/cities are returned, ask the user to select the appropriate result; do not silently choose the first post office or treat a postal district as an exact city. Preserve typed address lines and show lookup failures clearly. Confirm the lookup source before implementation; PIN lookup does not verify a customer's residence.
- **Upload limit:** maximum **4 MB per file** for documents and proofs, including the business GST certificate. Proposed precise implementation limit: 4 × 1024 × 1024 bytes (4 MiB), with consistent UI wording and server-side enforcement. Replace the current 8 MB limit throughout the upload path. Existing stored documents larger than the new limit must remain readable; do not delete or rewrite them. Enforce total request limits separately.

### Remaining implementation choices for review

- Username uniqueness scope is confirmed as company-specific (see clarification below). Decide whether staff may override a generated suggestion. Do not assume local availability proves availability on a future external server.
- State/city/PIN dataset or lookup provider, including update process, ambiguous results and outage handling.
- Whether identity/permanent address is required in addition to the confirmed mandatory billing and installation addresses.
- Required declaration wording and interim submission evidence while the signing method remains undecided.

### Confirmed username namespace clarification — 2026-10-21

The same service username may exist in different companies. Within one company, it must be unique across all counters/franchises, not merely within each franchise. This supersedes the earlier suggested portal-wide default and resolves the uniqueness-scope question.

Generate and check candidates within the application's authorised company scope. Enforce the invariant atomically using company ID plus normalised service username; concurrent submissions from different franchises of the same company must not create duplicates. Resolve conflicts by trying the next candidate rather than trusting a previous availability response. A future RADIUS integration must map this company-scoped namespace explicitly if the external server uses a different namespace.

## Implementation update — 2026-10-21

The first CAF redesign is implemented for testing. This supersedes the earlier
"implementation pending" statements for the following items only:

- Residential/business entry, business name, GST number and GST certificate requirements.
- Company-scoped generated usernames with availability preview, server allocation and database uniqueness across franchises. Staff overrides are not enabled; correction retains the assigned username.
- Required installation/billing addresses and copy option, bundled state/city lists and server-side postal PIN lookup. The selected sources, attribution and refresh instructions are in `src/data/README.md`; missing cities can be entered manually.
- Collapsible responsive sections, document previews, required evidence, server/browser 4 MB limits and a review summary.
- Private server drafts for partial field values, with version conflict protection. Draft attachments remain a follow-up: selected files are not persisted until submission, and the UI explicitly explains this.
- Rejected-CAF correction/resubmission, stable identifiers, revision/history recording, original-file retention and atomic final review. New approvals retain a snapshot for the later export implementation; previously approved CAFs are not retrospectively snapshotted.
- Interim acknowledgement by the submitting staff member. This is not customer consent/signature evidence and does not resolve the future signing decision.

**Still retained for future updates:** customer signing and approved PDF/evidence
downloads; Surepass identity/GST verification; mobile/email verification; S3
migration; real RADIUS API mapping/provisioning; the deferred Storage Settings
404; reviewer assignment and a dedicated history viewer; separate identity/permanent
address requirements; draft attachments, autosave and draft deletion/retention;
the billing/network/payment ideas retained above. A subscriber/account model may
later link relocation/plan-change CAFs to an existing service account rather than
allocating another username. Agree that lifecycle before implementing external
RADIUS synchronisation.

The rollout uses an additive migration and checks legacy company-level username
conflicts without renaming accounts. Deployment/preflight instructions are in
`README.md`; exact changes and validation are recorded in `CHANGELOG.md`.
