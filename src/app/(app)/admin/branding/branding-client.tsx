"use client";

import { useEffect, useState } from "react";

interface CompanyRow {
  id: string;
  name: string;
  companyCode: string;
  domain?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  loginSubtitle?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  customCss?: string | null;
}

export function BrandingClient() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const c = companies.find((x) => x.id === sel);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((j) => {
        setCompanies(j.companies ?? []);
        if (j.companies?.[0]) setSel(j.companies[0].id);
      });
  }, []);

  async function save() {
    if (!c) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/companies/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: c.domain || null,
        logoUrl: c.logoUrl || null,
        faviconUrl: c.faviconUrl || null,
        primaryColor: c.primaryColor || null,
        secondaryColor: c.secondaryColor || null,
        accentColor: c.accentColor || null,
        loginSubtitle: c.loginSubtitle || null,
        supportEmail: c.supportEmail || null,
        supportPhone: c.supportPhone || null,
        customCss: c.customCss || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setErr(json.error ?? "Failed");
    else {
      setMsg("Saved");
      fetch("/api/companies")
        .then((r) => r.json())
        .then((j) => setCompanies(j.companies ?? []));
    }
    setBusy(false);
  }

  function upd(p: Partial<CompanyRow>) {
    setCompanies((prev) => prev.map((x) => (x.id === sel ? { ...x, ...p } : x)));
  }

  if (!c) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="card h-fit p-5">
        <label className="field-label">Company</label>
        <select className="field-input" value={sel} onChange={(e) => setSel(e.target.value)}>
          {companies.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.companyCode})
            </option>
          ))}
        </select>
      </div>
      <div className="card space-y-4 p-6 lg:col-span-2">
        <h3 className="text-base font-semibold text-slate-900">Custom Domain</h3>
        <div>
          <label className="field-label">Domain (exact)</label>
          <input
            className="field-input"
            placeholder="my.infolinkbroadband.com or my.northnet.in"
            value={c.domain ?? ""}
            onChange={(e) => upd({ domain: e.target.value.toLowerCase() })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Point this domain to your app server (reverse proxy / load balancer). SSL required in production.
          </p>
        </div>
        <h3 className="text-base font-semibold text-slate-900">Branding</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label">Logo URL</label>
            <input className="field-input" value={c.logoUrl ?? ""} onChange={(e) => upd({ logoUrl: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Favicon URL</label>
            <input className="field-input" value={c.faviconUrl ?? ""} onChange={(e) => upd({ faviconUrl: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Primary Color</label>
            <input className="field-input" placeholder="#1e40af" value={c.primaryColor ?? ""} onChange={(e) => upd({ primaryColor: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Secondary Color</label>
            <input className="field-input" placeholder="#0f766e" value={c.secondaryColor ?? ""} onChange={(e) => upd({ secondaryColor: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Login Subtitle</label>
            <input className="field-input" value={c.loginSubtitle ?? ""} onChange={(e) => upd({ loginSubtitle: e.target.value })} placeholder="Customer Application Portal" />
          </div>
          <div>
            <label className="field-label">Support Email</label>
            <input className="field-input" value={c.supportEmail ?? ""} onChange={(e) => upd({ supportEmail: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Support Phone</label>
            <input className="field-input" value={c.supportPhone ?? ""} onChange={(e) => upd({ supportPhone: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="field-label">Custom CSS (advanced)</label>
          <textarea className="field-input font-mono text-xs" rows={6} value={c.customCss ?? ""} onChange={(e) => upd({ customCss: e.target.value })} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {msg && <p className="text-sm text-green-600">{msg}</p>}
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Saving…" : "Save Branding"}
        </button>
      </div>
    </div>
  );
}
