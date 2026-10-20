"use client";

import { useEffect, useState } from "react";

export function RadiusClient() {
  const [cfg, setCfg] = useState<any>({ enabled: false, provider: "custom" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/radius")
      .then((r) => r.json())
      .then((j) => setCfg(j.radius ?? { enabled: false, provider: "custom" }));
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch("/api/settings/radius", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setErr(json.error ?? "Failed");
    else {
      setMsg("Saved. Approved CAFs will create a RADIUS sync record on approval.");
      setCfg(json.radius);
    }
    setBusy(false);
  }

  return (
    <div className="card max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">RADIUS Sync</h3>
          <p className="text-sm text-slate-500">Enabled only on approval (event-based).</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">Provider</label>
          <select
            className="field-input"
            value={cfg.provider}
            onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}
          >
            <option value="iconwave">IconWaveTech</option>
            <option value="jazznetwork">JazzNetwork</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="field-label">Base URL</label>
          <input className="field-input" value={cfg.baseUrl ?? ""} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder="https://radius.example.com/api" />
        </div>
        <div>
          <label className="field-label">API Key / Token</label>
          <input type="password" className="field-input" value={cfg.apiKey ?? ""} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Auth Header</label>
          <input className="field-input" value={cfg.authHeader ?? ""} onChange={(e) => setCfg({ ...cfg, authHeader: e.target.value })} placeholder="Authorization" />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Payload includes CAF number, company/franchise codes, customer details, installation/billing address, plan, connection type, ID proof/type/number. Real HTTP calls will be added once you share API docs.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
