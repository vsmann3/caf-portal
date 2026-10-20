"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Portal = { name: string; publicUrl: string; supportEmail: string };
type Smtp = { enabled: boolean; host: string; port: number; security: "tls" | "starttls" | "plain";
  authentication: boolean; username: string; hasPassword: boolean; fromName: string; fromEmail: string; replyTo: string };

function Feedback({ error, notice }: { error: string; notice: string }) {
  return <div aria-live="polite">{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}</div>;
}

function GeneralSettings({ initial }: { initial: Portal }) {
  const router = useRouter();
  const [portal, setPortal] = useState<Portal | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/settings/portal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(portal) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to save portal settings");
      setPortal(json.portal); setNotice("Portal settings saved. Other sections were not changed.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save portal settings"); }
    finally { setBusy(false); }
  }
  return <details className="card" open>
    <summary className="cursor-pointer p-5 text-base font-semibold text-slate-900">General Portal Settings</summary>
    <form onSubmit={save} className="space-y-4 border-t border-slate-100 p-5">
      <Feedback error={error} notice={notice} />
      {!portal ? <p className="text-sm text-slate-500">{error ? "Settings unavailable." : "Loading settings…"}</p> : <>
        <div><label className="field-label" htmlFor="portal-name">Portal name *</label>
          <input id="portal-name" className="field-input" required maxLength={100} value={portal.name} onChange={e => setPortal({ ...portal, name: e.target.value })} /></div>
        <div><label className="field-label" htmlFor="portal-url">Public portal URL *</label>
          <input id="portal-url" className="field-input" type="url" required value={portal.publicUrl} onChange={e => setPortal({ ...portal, publicUrl: e.target.value })} />
          <p className="mt-1 text-xs text-slate-500">Use the address users open in their browser. Welcome emails link to this portal.</p></div>
        <div><label className="field-label" htmlFor="portal-support">Support email</label>
          <input id="portal-support" className="field-input" type="email" value={portal.supportEmail} onChange={e => setPortal({ ...portal, supportEmail: e.target.value })} /></div>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save Portal Settings"}</button>
      </>}
    </form>
  </details>;
}

function EmailSettings({ initial }: { initial: Smtp }) {
  const [smtp, setSmtp] = useState<Smtp | null>(initial);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!smtp) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { hasPassword: _, ...fields } = smtp;
      const response = await fetch("/api/settings/smtp", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, password, clearPassword }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || "Unable to save SMTP settings");
      setSmtp(json.smtp); setPassword(""); setClearPassword(false); setNotice("Email settings saved. Other sections were not changed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save SMTP settings"); }
    finally { setBusy(false); }
  }
  async function test(event: React.FormEvent) {
    event.preventDefault(); setTesting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/settings/smtp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: recipient }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || "Test email failed"); setNotice(json.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Test email failed"); }
    finally { setTesting(false); }
  }
  return <details className="card" open>
    <summary className="cursor-pointer p-5 text-base font-semibold text-slate-900">Email Settings (SMTP)</summary>
    <div className="space-y-5 border-t border-slate-100 p-5">
      <Feedback error={error} notice={notice} />
      {!smtp ? <p className="text-sm text-slate-500">{error ? "Settings unavailable." : "Loading settings…"}</p> : <>
        <form onSubmit={save} className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smtp.enabled} onChange={e => setSmtp({ ...smtp, enabled: e.target.checked })} />Enable portal emails (account welcome and staff verification)</label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="field-label" htmlFor="smtp-host">SMTP host</label><input id="smtp-host" className="field-input" required={smtp.enabled} value={smtp.host} onChange={e => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" /></div>
            <div><label className="field-label" htmlFor="smtp-port">Port</label><input id="smtp-port" className="field-input" type="number" required min={1} max={65535} value={smtp.port} onChange={e => setSmtp({ ...smtp, port: Number(e.target.value) })} /></div>
            <div><label className="field-label" htmlFor="smtp-security">Connection security</label><select id="smtp-security" className="field-input" value={smtp.security} onChange={e => setSmtp({ ...smtp, security: e.target.value as Smtp["security"] })}>
              <option value="starttls">STARTTLS (usually port 587)</option><option value="tls">TLS (usually port 465)</option><option value="plain">Unencrypted trusted relay</option></select></div>
            <div className="flex items-center"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smtp.authentication} onChange={e => setSmtp({ ...smtp, authentication: e.target.checked })} />SMTP authentication</label></div>
            {smtp.authentication && <>
              <div><label className="field-label" htmlFor="smtp-user">SMTP username</label><input id="smtp-user" className="field-input" autoComplete="off" required={smtp.enabled} value={smtp.username} onChange={e => setSmtp({ ...smtp, username: e.target.value })} /></div>
              <div><label className="field-label" htmlFor="smtp-password">SMTP password</label><input id="smtp-password" className="field-input" type="password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setClearPassword(false); }} placeholder={smtp.hasPassword ? "Saved password — leave blank to keep" : "Enter SMTP password"} />
                {smtp.hasPassword && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={clearPassword} onChange={e => { setClearPassword(e.target.checked); setPassword(""); }} />Remove saved password</label>}</div>
            </>}
            <div><label className="field-label" htmlFor="smtp-name">Sender name</label><input id="smtp-name" className="field-input" value={smtp.fromName} onChange={e => setSmtp({ ...smtp, fromName: e.target.value })} /></div>
            <div><label className="field-label" htmlFor="smtp-from">Sender email</label><input id="smtp-from" className="field-input" type="email" required={smtp.enabled} value={smtp.fromEmail} onChange={e => setSmtp({ ...smtp, fromEmail: e.target.value })} /></div>
            <div><label className="field-label" htmlFor="smtp-reply">Reply-to email</label><input id="smtp-reply" className="field-input" type="email" value={smtp.replyTo} onChange={e => setSmtp({ ...smtp, replyTo: e.target.value })} /></div>
          </div>
          {smtp.security === "plain" && <p className="text-sm text-amber-700">This mode sends mail without encryption. Use it only with your trusted relay.</p>}
          <p className="text-xs text-slate-500">Welcome emails contain account details and a sign-in link. Initial passwords are shared separately by the administrator.</p>
          <button className="btn-primary" disabled={busy || testing}>{busy ? "Saving…" : "Save Email Settings"}</button>
        </form>
        <form onSubmit={test} className="space-y-3 border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-600">Send a test using the saved email settings, including while portal emails are disabled. Save your changes first.</p>
          <label className="field-label" htmlFor="smtp-test">Test recipient</label>
          <input id="smtp-test" className="field-input" type="email" required value={recipient} onChange={e => setRecipient(e.target.value)} />
          <button className="btn-secondary" disabled={busy || testing}>{testing ? "Sending…" : "Send Test Email"}</button>
        </form>
      </>}
    </div>
  </details>;
}

export function SuperSettingsClient({ portal, smtp }: { portal: Portal; smtp: Smtp }) {
  return <><GeneralSettings initial={portal} /><EmailSettings initial={smtp} /></>;
}
