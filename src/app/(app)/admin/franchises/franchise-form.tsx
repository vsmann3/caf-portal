"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CompanyOption {
  id: string;
  name: string;
  companyCode: string;
}

interface FranchiseValues {
  id?: string;
  companyId: string;
  name: string;
  code: string;
  ownerName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
}

export function FranchiseForm({
  companies,
  lockedCompanyId,
  initial,
}: {
  /** Present only for super admin (company picker). */
  companies?: CompanyOption[];
  /** Set for company admin — company cannot be changed. */
  lockedCompanyId?: string;
  initial?: FranchiseValues;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<FranchiseValues>(
    initial ?? {
      companyId: lockedCompanyId ?? companies?.[0]?.id ?? "",
      name: "",
      code: "",
      ownerName: "",
      email: "",
      phone: "",
      address: "",
      city: "",
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FranchiseValues>(key: K, v: FranchiseValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(isEdit ? `/api/franchises/${initial!.id}` : "/api/franchises", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: values.companyId || undefined,
          name: values.name,
          code: values.code || undefined,
          ownerName: values.ownerName,
          email: values.email,
          phone: values.phone,
          address: values.address,
          city: values.city,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to save franchise");
        return;
      }
      router.push("/admin/franchises");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card max-w-2xl space-y-4 p-6">
      {companies && !lockedCompanyId && (
        <div>
          <label className="field-label" htmlFor="companyId">Company *</label>
          <select
            id="companyId"
            className="field-input max-w-md"
            required
            value={values.companyId}
            onChange={(e) => set("companyId", e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.companyCode})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="name">Franchise Name *</label>
          <input
            id="name"
            className="field-input"
            required
            minLength={2}
            maxLength={120}
            placeholder="e.g. Andheri West Counter"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="code">Franchise Code</label>
          <input
            id="code"
            className="field-input"
            maxLength={40}
            placeholder="Auto-generated if blank"
            value={values.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="ownerName">Owner Name</label>
          <input
            id="ownerName"
            className="field-input"
            maxLength={120}
            value={values.ownerName}
            onChange={(e) => set("ownerName", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="field-input"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">Phone</label>
          <input
            id="phone"
            className="field-input"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="city">City</label>
          <input
            id="city"
            className="field-input"
            maxLength={100}
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
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
          {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Franchise"}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-secondary" disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
