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
| High | No checked-in `prisma/migrations` files. | Establish versioned migrations and an installation/upgrade procedure. Handle existing databases deliberately; never reset or reinitialise production to create a baseline. |
| High | Storage settings pages and API exist locally but were untracked at review time. | Review, test and commit them before treating the settings UI as a deployed feature. |
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
