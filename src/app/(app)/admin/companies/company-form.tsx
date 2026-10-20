"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CompanyValues {
  id?: string;
  name: string;
  companyCode: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

export function CompanyForm({ initial }: { initial?: CompanyValues }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<CompanyValues>(
    initial ?? { name: "", companyCode: "", contactEmail: "", contactPhone: "", address: "" },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof CompanyValues>(key: K, v: CompanyValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(isEdit ? `/api/companies/${initial!.id}` : "/api/companies", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          companyCode: values.companyCode || undefined,
          contactEmail: values.contactEmail,
          contactPhone: values.contactPhone,
          address: values.address,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to save company");
        return;
      }
      router.push("/admin/companies");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card max-w-2xl space-y-4 p-6">
      <div>
        <label className="field-label" htmlFor="name">Company Name *</label>
        <input
          id="name"
          className="field-input"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. Infolink Broadband"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="companyCode">Company Code</label>
        <input
          id="companyCode"
          className="field-input max-w-xs uppercase"
          maxLength={12}
          placeholder="Leave blank to auto-generate (e.g. INFOBB2548)"
          value={values.companyCode}
          onChange={(e) => set("companyCode", e.target.value.toUpperCase())}
        />
        <p className="mt-1 text-xs text-slate-500">
          4–12 letters/digits. Uniquely identifies this company on the platform.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="contactEmail">Contact Email</label>
          <input
            id="contactEmail"
            type="email"
            className="field-input"
            value={values.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="contactPhone">Contact Phone</label>
          <input
            id="contactPhone"
            className="field-input"
            value={values.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="address">Address</label>
        <textarea
          id="address"
          rows={2}
          className="field-input"
          value={values.address}
          onChange={(e) => set("address", e.target.value)}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Company"}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-secondary" disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
