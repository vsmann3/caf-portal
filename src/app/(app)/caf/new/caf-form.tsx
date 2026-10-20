"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";

export interface FranchiseOption {
  id: string;
  name: string;
  code: string;
  companyName: string;
}

const DOC_TYPES = [
  { value: "PASSPORT_PHOTO", label: "Passport Photo" },
  { value: "ID_PROOF", label: "ID Proof (Aadhaar/PAN/Voter…)" },
  { value: "ADDRESS_PROOF", label: "Address Proof" },
  { value: "SIGNED_CAF", label: "Signed CAF / Declaration" },
  { value: "BANK_PROOF", label: "Bank / Payment Proof" },
  { value: "BUSINESS_PROOF", label: "Business Proof (commercial)" },
  { value: "OTHER", label: "Other" },
];

const ID_TYPES = [
  { value: "AADHAAR", label: "Aadhaar Card" },
  { value: "PAN", label: "PAN Card" },
  { value: "VOTER_ID", label: "Voter ID" },
  { value: "PASSPORT", label: "Passport" },
  { value: "DRIVING_LICENSE", label: "Driving License" },
  { value: "OTHER", label: "Other" },
];

const CONNECTION_TYPES = [
  { value: "NEW", label: "New Connection" },
  { value: "RELOCATION", label: "Relocation" },
  { value: "CHANGE_OF_PLAN", label: "Change of Plan" },
  { value: "TRANSFER", label: "Transfer" },
];

interface DocRow {
  docType: string;
  file: File | null;
}

const EMPTY_DOC_ROW: DocRow = { docType: "", file: null };

export function CafForm({
  franchises,
  lockedFranchiseId,
}: {
  franchises: FranchiseOption[];
  lockedFranchiseId: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [docs, setDocs] = useState<DocRow[]>([
    { docType: "PASSPORT_PHOTO", file: null },
    { docType: "ID_PROOF", file: null },
    { docType: "ADDRESS_PROOF", file: null },
    { ...EMPTY_DOC_ROW },
  ]);

  const defaultFranchise = useMemo(() => {
    if (lockedFranchiseId) return lockedFranchiseId;
    return franchises[0]?.id ?? "";
  }, [franchises, lockedFranchiseId]);

  const [franchiseId, setFranchiseId] = useState(defaultFranchise);
  const lockedFranchise = franchises.find((f) => f.id === lockedFranchiseId);

  function setDocRow(index: number, patch: Partial<DocRow>) {
    setDocs((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formEl = e.currentTarget;
    const fd = new FormData(formEl);

    const files = docs.filter((d) => d.file);
    if (files.length === 0) {
      setError("Please attach at least one document (photo or ID proof).");
      return;
    }

    const payload = {
      franchiseId,
      customerName: fd.get("customerName"),
      gender: fd.get("gender") || null,
      dob: fd.get("dob") || null,
      fatherName: fd.get("fatherName"),
      mobile: fd.get("mobile"),
      email: fd.get("email"),
      altPhone: fd.get("altPhone"),
      addressLine1: fd.get("addressLine1"),
      addressLine2: fd.get("addressLine2"),
      city: fd.get("city"),
      state: fd.get("state"),
      pincode: fd.get("pincode"),
      idProofType: fd.get("idProofType"),
      idNumber: fd.get("idNumber"),
      connectionType: fd.get("connectionType"),
      customerType: fd.get("customerType"),
      planName: fd.get("planName"),
      bandwidth: fd.get("bandwidth"),
      connectionAddress: fd.get("connectionAddress"),
      broadbandUsername: fd.get("broadbandUsername"),
      remarks: fd.get("remarks"),
    };

    const body = new FormData();
    body.append("data", JSON.stringify(payload));
    for (const d of files) {
      body.append("files", d.file!);
      body.append("docType", d.docType || "OTHER");
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/applications", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to submit CAF");
        return;
      }
      router.push(`/customers/${json.application.id}`);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="New Customer Application (CAF)"
        subtitle="Fill in customer details and upload supporting documents."
      />

      <form onSubmit={onSubmit} className="space-y-5">
        {/* Franchise */}
        <section className="card p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Franchise</h3>
          {lockedFranchise ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium">{lockedFranchise.name}</span>{" "}
              <span className="text-slate-500">({lockedFranchise.code})</span>
              <p className="mt-0.5 text-xs text-slate-500">
                You are filing for your own franchise only.
              </p>
            </div>
          ) : (
            <div>
              <label className="field-label" htmlFor="franchiseId">Filing for franchise</label>
              <select
                id="franchiseId"
                className="field-input max-w-md"
                value={franchiseId}
                onChange={(e) => setFranchiseId(e.target.value)}
                required
              >
                {franchises.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.companyName ? `${f.companyName} — ` : ""}{f.name} ({f.code})
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* Applicant */}
        <section className="card p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Applicant Details</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="customerName">Full Name *</label>
              <input id="customerName" name="customerName" required minLength={2} maxLength={150} className="field-input" placeholder="e.g. Rahul Sharma" />
            </div>
            <div>
              <label className="field-label" htmlFor="gender">Gender</label>
              <select id="gender" name="gender" className="field-input" defaultValue="">
                <option value="">Select…</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="dob">Date of Birth</label>
              <input id="dob" name="dob" type="date" className="field-input" />
            </div>
            <div>
              <label className="field-label" htmlFor="fatherName">Father / Spouse Name</label>
              <input id="fatherName" name="fatherName" maxLength={150} className="field-input" />
            </div>
            <div>
              <label className="field-label" htmlFor="mobile">Mobile Number *</label>
              <input id="mobile" name="mobile" required inputMode="numeric" pattern="[6-9][0-9]{9}" title="10-digit Indian mobile number" className="field-input" placeholder="98XXXXXXXX" />
            </div>
            <div>
              <label className="field-label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" maxLength={200} className="field-input" />
            </div>
            <div>
              <label className="field-label" htmlFor="altPhone">Alternate Phone</label>
              <input id="altPhone" name="altPhone" maxLength={20} className="field-input" />
            </div>
          </div>
        </section>

        {/* Address */}
        <section className="card p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Installation Address</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="field-label" htmlFor="addressLine1">Address Line 1 *</label>
              <input id="addressLine1" name="addressLine1" required minLength={3} maxLength={300} className="field-input" placeholder="House / Flat No., Street, Landmark" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="field-label" htmlFor="addressLine2">Address Line 2</label>
              <input id="addressLine2" name="addressLine2" maxLength={300} className="field-input" />
            </div>
            <div>
              <label className="field-label" htmlFor="city">City *</label>
              <input id="city" name="city" required maxLength={100} className="field-input" />
            </div>
            <div>
              <label className="field-label" htmlFor="state">State *</label>
              <input id="state" name="state" required maxLength={100} className="field-input" />
            </div>
            <div>
              <label className="field-label" htmlFor="pincode">PIN Code *</label>
              <input id="pincode" name="pincode" required inputMode="numeric" pattern="[0-9]{6}" title="6-digit PIN code" className="field-input" />
            </div>
          </div>
        </section>

        {/* Identity */}
        <section className="card p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Identity Proof</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="idProofType">ID Proof Type *</label>
              <select id="idProofType" name="idProofType" required className="field-input" defaultValue="AADHAAR">
                {ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="idNumber">ID Number *</label>
              <input id="idNumber" name="idNumber" required maxLength={40} className="field-input" placeholder="As printed on the ID" />
            </div>
          </div>
        </section>

        {/* Connection */}
        <section className="card p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Connection Details</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="connectionType">Connection Type *</label>
              <select id="connectionType" name="connectionType" required className="field-input" defaultValue="NEW">
                {CONNECTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="customerType">Customer Type</label>
              <select id="customerType" name="customerType" className="field-input" defaultValue="RESIDENTIAL">
                <option value="RESIDENTIAL">Residential</option>
                <option value="COMMERCIAL">Commercial / Business</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="planName">Plan Name</label>
              <input id="planName" name="planName" maxLength={100} className="field-input" placeholder="e.g. Home Plus 100" />
            </div>
            <div>
              <label className="field-label" htmlFor="bandwidth">Bandwidth</label>
              <input id="bandwidth" name="bandwidth" maxLength={50} className="field-input" placeholder="e.g. 100 Mbps" />
            </div>
            <div>
              <label className="field-label" htmlFor="broadbandUsername">Broadband Username</label>
              <input id="broadbandUsername" name="broadbandUsername" maxLength={100} className="field-input" placeholder="If already provisioned in RADIUS" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="field-label" htmlFor="connectionAddress">Installation Address (if different)</label>
              <input id="connectionAddress" name="connectionAddress" maxLength={500} className="field-input" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="field-label" htmlFor="remarks">Remarks</label>
              <textarea id="remarks" name="remarks" rows={2} maxLength={1000} className="field-input" />
            </div>
          </div>
        </section>

        {/* Documents */}
        <section className="card p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Documents</h3>
          <p className="mb-3 text-sm text-slate-500">
            JPG, PNG, WEBP or PDF · max 8 MB per file.
          </p>
          <div className="space-y-3">
            {docs.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3">
                <select
                  className="field-input w-64"
                  value={row.docType}
                  onChange={(e) => setDocRow(i, { docType: e.target.value })}
                  required
                >
                  <option value="">Document type…</option>
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="block w-full max-w-md text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  onChange={(e) => setDocRow(i, { file: e.target.files?.[0] ?? null })}
                />
                {row.file && (
                  <span className="text-xs text-green-700">✓ {row.file.name}</span>
                )}
                {docs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDocs((prev) => [...prev, { ...EMPTY_DOC_ROW }])}
            className="btn-secondary mt-4"
          >
            + Add another document
          </button>
        </section>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Submitting…" : "Submit CAF"}
          </button>
          <button type="button" onClick={() => router.back()} className="btn-secondary" disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
