import { safeDemoReturnUrl } from "@/lib/radius-demo/common";
import { applicationScope } from "@/lib/caf-access";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PageHeader, StatusBadge } from "@/components/ui";
import { ReviewActions } from "@/components/review-actions";
import { RadiusDemoStatus } from "@/components/radius-demo-status";
import { DownloadCafPdf } from "@/components/download-caf-pdf";

function Field({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const scopeWhere = applicationScope(session);

  const app = await prisma.customerApplication.findFirst({
    where: { id, ...scopeWhere },
    include: {
      documents: { orderBy: { uploadedAt: "asc" } },
      franchise: { select: { name: true, code: true, phone: true } },
      company: { select: { name: true, companyCode: true } },
      submittedBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
  });
  if (!app) notFound();
  const query = await searchParams;
  const returnTo = await safeDemoReturnUrl(app.companyId, query?.returnTo);

  const canReview =
    session.role === "SUPER_ADMIN" || session.role === "COMPANY_ADMIN";

  return (
    <div>
      <PageHeader
        title={app.customerName}
        subtitle={`${app.cafNumber} · ${app.company.name} · ${app.franchise.name}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={app.status} />
            {app.status === "APPROVED" && (
              <DownloadCafPdf id={app.id} customerId={app.customerId} />
            )}
            {app.status === "REJECTED" && (
              <Link href={`/customers/${app.id}/edit`} className="btn-primary">
                Correct and resubmit
              </Link>
            )}
            {returnTo && <Link href={returnTo} className="btn-secondary">Back to RADIUS demo</Link>}
            <Link href="/customers" className="btn-secondary">
              ← Back
            </Link>
          </div>
        }
      />

      <RadiusDemoStatus applicationId={app.id} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Applicant">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Customer ID" value={app.customerId} />
            <Field label="Full Name" value={app.customerName} />
            <Field label="Gender" value={app.gender} />
            <Field
              label="Date of Birth"
              value={app.dob ? app.dob.toLocaleDateString("en-IN") : null}
            />
            <Field label="Father / Spouse Name" value={app.fatherName} />
            <Field label="Mobile" value={app.mobile} />
            <Field label="Alternate Phone" value={app.altPhone} />
            <Field label="Email" value={app.email} />
          </dl>
        </Section>

        <Section title="Installation Address">
          <dl className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field
                label="Address"
                value={[app.addressLine1, app.addressLine2]
                  .filter(Boolean)
                  .join(", ")}
              />
            </div>
            <Field label="City" value={app.city} />
            <Field label="State" value={app.state} />
            <Field label="PIN Code" value={app.pincode} />
            <Field
              label="Franchise"
              value={`${app.franchise.name} (${app.franchise.code})`}
            />
          </dl>
        </Section>

        <Section title="Identity">
          <dl className="grid grid-cols-2 gap-4">
            <Field
              label="ID Proof Type"
              value={app.idProofType.replaceAll("_", " ")}
            />
            <Field label="ID Number" value={app.idNumber} />
          </dl>
        </Section>

        <Section title="Billing Address">
          <dl className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field
                label="Address"
                value={[app.billingAddressLine1, app.billingAddressLine2]
                  .filter(Boolean)
                  .join(", ")}
              />
            </div>
            <Field label="City" value={app.billingCity} />
            <Field label="State" value={app.billingState} />
            <Field label="PIN Code" value={app.billingPincode} />
          </dl>
        </Section>
        {app.customerType === "COMMERCIAL" && (
          <Section title="Business details">
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Registered name" value={app.businessName} />
              <Field label="GST number" value={app.gstNumber} />
            </dl>
            <p className="mt-3 text-sm text-slate-500">
              GST verification via Surepass is planned.
            </p>
          </Section>
        )}

        <Section title="Connection Details">
          <dl className="grid grid-cols-2 gap-4">
            <Field
              label="Connection Type"
              value={app.connectionType.replaceAll("_", " ")}
            />
            <Field label="Customer Type" value={app.customerType} />
            <Field label="Plan" value={app.planName} />
            <Field label="Bandwidth" value={app.bandwidth} />
            <Field label="Broadband Username" value={app.broadbandUsername} />
            <div className="col-span-2">
              <Field
                label="Legacy additional address"
                value={app.connectionAddress}
              />
            </div>
            <div className="col-span-2">
              <Field label="Remarks" value={app.remarks} />
            </div>
          </dl>
        </Section>
      </div>

      <div className="mt-5">
        <Section title={`Documents (${app.documents.length})`}>
          {app.documents.length === 0 ? (
            <p className="text-sm text-slate-500">No documents uploaded.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {app.documents.map((doc) => (
                <a
                  key={doc.id}
                  href={`/api/documents/${doc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-lg border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  {doc.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/documents/${doc.id}`}
                      alt={doc.originalName}
                      className="h-32 w-full rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-500">
                      PDF
                    </div>
                  )}
                  <p className="mt-2 truncate text-xs font-medium text-slate-700 group-hover:text-blue-700">
                    {doc.originalName}
                  </p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    {doc.documentType.replaceAll("_", " ")} ·{" "}
                    {(doc.sizeBytes / 1024).toFixed(0)} KB
                  </p>
                </a>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {canReview && (
          <ReviewActions applicationId={app.id} status={app.status} />
        )}
        <Section title="Audit Trail">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="CAF Revision" value={app.revision} />
            <Field
              label="Staff acknowledgement"
              value={app.declarationAcceptedAt?.toLocaleString("en-IN")}
            />
            <Field label="Submitted By" value={app.submittedBy?.name} />
            <Field
              label="Submitted At"
              value={app.createdAt.toLocaleString("en-IN")}
            />
            <Field label="Reviewed By" value={app.reviewedBy?.name} />
            <Field
              label="Reviewed At"
              value={
                app.reviewedAt ? app.reviewedAt.toLocaleString("en-IN") : null
              }
            />
            {app.rejectionReason && (
              <div className="col-span-2">
                <Field label="Rejection Reason" value={app.rejectionReason} />
              </div>
            )}
          </dl>
        </Section>
      </div>
    </div>
  );
}
