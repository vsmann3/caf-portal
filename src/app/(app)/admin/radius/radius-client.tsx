"use client";

import { useEffect, useState } from "react";
import type { RadiusSettingsView, RadiusConfig } from "@/lib/radius/types";

export function RadiusClient() {
  const [cfg, setCfg] = useState<RadiusSettingsView>({
    enabled: false,
    provider: "custom",
    apiKeyConfigured: false,
    runtimeStatus: "NOT_IMPLEMENTED",
  });
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/radius")
      .then(async (r) => {
        if (!r.ok) throw new Error("Unable to load RADIUS settings");
        return r.json();
      })
      .then((j) => {
        setCfg(j.radius);
        setLoaded(true);
      })
      .catch(() =>
        setErr("Unable to load RADIUS settings. Reload to try again."),
      );
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/radius", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled,
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          authHeader: cfg.authHeader,
          usernameField: cfg.usernameField,
          timeoutMs: cfg.timeoutMs,
          apiKey,
          clearApiKey,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setErr(json.error ?? "Unable to save RADIUS settings");
      else {
        setMsg(
          "Saved. RADIUS delivery is not implemented; no service will be provisioned.",
        );
        setCfg(json.radius);
        setApiKey("");
        setClearApiKey(false);
      }
    } catch {
      setErr(
        "Unable to save RADIUS settings. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            RADIUS Sync
          </h3>
          <p className="text-sm text-slate-500">
            Configuration only. Delivery and activation are unavailable.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          Delivery requested (not available)
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">Provider</label>
          <select
            className="field-input"
            value={cfg.provider}
            onChange={(e) =>
              setCfg({
                ...cfg,
                provider: e.target.value as RadiusConfig["provider"],
              })
            }
          >
            <option value="iconwave">IconWaveTech</option>
            <option value="jazznetwork">JazzNetwork</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="field-label">Base URL</label>
          <input
            className="field-input"
            value={cfg.baseUrl ?? ""}
            onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            placeholder="https://radius.example.com/api"
          />
        </div>
        <div>
          <label className="field-label">API Key / Token</label>
          <input
            type="password"
            className="field-input"
            autoComplete="new-password"
            value={apiKey}
            disabled={clearApiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              cfg.apiKeyConfigured
                ? "Configured; leave blank to keep"
                : "Not configured"
            }
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearApiKey}
            onChange={(e) => {
              setClearApiKey(e.target.checked);
              setApiKey("");
            }}
          />
          Remove stored token
        </label>
        <div>
          <label className="field-label">Auth Header</label>
          <input
            className="field-input"
            value={cfg.authHeader ?? ""}
            onChange={(e) => setCfg({ ...cfg, authHeader: e.target.value })}
            placeholder="Authorization"
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Approvals store only a local Customer ID, organization IDs and CAF
        reference. No documents, proof numbers, passwords or customer contact
        details are copied into new RADIUS records. Saving these settings does
        not connect to RADIUS.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      <button onClick={save} disabled={busy || !loaded} className="btn-primary">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
