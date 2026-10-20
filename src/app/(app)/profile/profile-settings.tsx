"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";
type Profile = {
  user: {
    name: string;
    email: string;
    role: string;
    emailVerifiedAt: string | null;
  };
  pending: { newEmail: string; expiresAt: string; sentAt: string } | null;
  emailEnabled: boolean;
};
export function ProfileSettings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  async function load() {
    const r = await fetch("/api/profile", { cache: "no-store" });
    if (!r.ok)
      throw new Error("Unable to load your profile. Sign in again or retry.");
    const data = await r.json();
    setProfile(data);
    setEmail(data.pending?.newEmail ?? data.user.email);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function act(body: Record<string, string>) {
    setError("");
    setMessage("");
    if (body.action === "change-password" && newPassword !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Update failed");
      setCode("");
      setEmailPassword("");
      setPassword("");
      setNewPassword("");
      setConfirm("");
      if (data.signInRequired) setSignedOut(true);
      else await load();
      setMessage(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Profile Settings"
        subtitle="Manage your staff account email and password."
      />
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-green-50 p-4 text-sm text-green-800"
        >
          {message}
        </p>
      )}
      {signedOut ? (
        <a href="/login" className="btn-primary">
          Sign in again
        </a>
      ) : (
        profile && (
          <fieldset disabled={busy} className="space-y-5">
            <section className="card p-5">
              <h2 className="font-semibold">Your account</h2>
              <p className="mt-3">{profile.user.name}</p>
              <p className="text-sm text-slate-500">
                {profile.user.role.replaceAll("_", " ")}
              </p>
              <p className="mt-2 break-all">{profile.user.email}</p>
              <p className="mt-1 text-sm text-slate-600">
                {profile.user.emailVerifiedAt
                  ? `Email verified: ${new Date(profile.user.emailVerifiedAt).toLocaleString()}`
                  : "Email not yet verified"}
              </p>
            </section>
            <details open className="card p-5">
              <summary className="cursor-pointer font-semibold">
                Email address and verification
              </summary>
              <p className="mt-4 text-sm text-slate-600">
                Verify your current email or enter a new one. Your existing
                login email remains active until the code is confirmed. Changing
                it signs out existing sessions.
              </p>
              {!profile.emailEnabled && (
                <p className="mt-3 text-sm text-amber-800">
                  Email delivery is disabled. Ask the Super Admin to enable SMTP
                  in Super Settings.
                </p>
              )}
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  act({
                    action: "send-email-code",
                    email,
                    currentPassword: emailPassword,
                  });
                }}
              >
                <div>
                  <label className="field-label" htmlFor="profile-email">
                    Email to verify
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    autoComplete="email"
                    className="field-input"
                    maxLength={254}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="email-password">
                    Current password
                  </label>
                  <input
                    id="email-password"
                    type="password"
                    autoComplete="current-password"
                    className="field-input"
                    required
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                  />
                </div>
                <button
                  className="btn-primary"
                  disabled={busy || !profile.emailEnabled}
                >
                  Send verification code
                </button>
              </form>
              {profile.pending && (
                <form
                  className="mt-5 space-y-4 border-t border-slate-200 pt-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act({ action: "verify-email", code });
                  }}
                >
                  <p className="break-words text-sm">
                    Code sent to <strong>{profile.pending.newEmail}</strong>.
                    Expires{" "}
                    {new Date(profile.pending.expiresAt).toLocaleTimeString()}.
                    Requesting another code replaces the old one; wait at least
                    60 seconds between requests.
                  </p>
                  <div>
                    <label className="field-label" htmlFor="email-code">
                      Six-digit verification code
                    </label>
                    <input
                      id="email-code"
                      className="field-input"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </div>
                  <button className="btn-primary" disabled={busy}>
                    Verify email
                  </button>
                </form>
              )}
            </details>
            <details open className="card p-5">
              <summary className="cursor-pointer font-semibold">
                Change password
              </summary>
              <p className="mt-4 text-sm text-slate-600">
                Use at least 12 characters. After saving, sign in again with the
                new password; other sessions will also be signed out.
              </p>
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  act({
                    action: "change-password",
                    currentPassword: password,
                    newPassword,
                  });
                }}
              >
                <div>
                  <label className="field-label" htmlFor="current-password">
                    Current password
                  </label>
                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    className="field-input"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="new-password">
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    className="field-input"
                    minLength={12}
                    maxLength={128}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="confirm-password">
                    Confirm new password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    className="field-input"
                    minLength={12}
                    maxLength={128}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <button className="btn-primary" disabled={busy}>
                  Save password
                </button>
              </form>
            </details>
          </fieldset>
        )
      )}
    </div>
  );
}
