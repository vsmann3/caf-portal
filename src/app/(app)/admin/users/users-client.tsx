"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "COMPANY_ADMIN" | "FRANCHISE_USER";
  isActive: boolean;
  company?: { id: string; name: string; companyCode: string } | null;
  franchise?: { id: string; name: string; code: string } | null;
}

interface FranchiseRow {
  id: string;
  name: string;
  code: string;
  companyId: string;
}

export function UsersClient({ isSuper }: { isSuper: boolean }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [franchises, setFranchises] = useState<FranchiseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "warning">("success");
  const [resending, setResending] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [companyId, setCompanyId] = useState("");

  // create-form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"COMPANY_ADMIN" | "FRANCHISE_USER">("FRANCHISE_USER");
  const [franchiseId, setFranchiseId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, franchisesRes, companiesRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/franchises"),
        fetch("/api/companies"),
      ]);
      const usersJson = await usersRes.json().catch(() => ({ users: [] }));
      const franchisesJson = await franchisesRes.json().catch(() => ({ franchises: [] }));
      if (usersRes.ok) setUsers(usersJson.users ?? []);
      if (franchisesRes.ok) setFranchises(franchisesJson.franchises ?? []);
      if (companiesRes.ok) {
        const json = await companiesRes.json();
        const items = (json.companies ?? []).filter((company: { isActive: boolean }) => company.isActive);
        setCompanies(items);
        setCompanyId(previous => previous || items[0]?.id || "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          companyId,
          franchiseId: role === "FRANCHISE_USER" ? franchiseId : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to create user");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      setFranchiseId("");
      setNotice(`Account created. ${json.email?.message ?? ""}`);
      setNoticeKind(json.email?.status === "failed" ? "warning" : "success");
      await load();
    } catch {
      setError("Could not confirm account creation. Refresh the list before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function resendWelcome(user: UserRow) {
    setResending(user.id); setError(null); setNotice("");
    try {
      const response = await fetch(`/api/users/${user.id}/welcome-email`, { method: "POST" });
      const json = await response.json();
      if (!response.ok) { setError(json.error || json.email?.message || "Unable to send welcome email"); return; }
      setNotice(json.email.message);
      setNoticeKind("success");
    } catch { setError("Unable to send welcome email. Please try again."); }
    finally { setResending(""); }
  }

  async function toggleActive(user: UserRow) {
    const action = user.isActive ? "deactivate" : "reactivate";
    if (!confirm(`${action[0].toUpperCase()}${action.slice(1)} user "${user.name}"?`)) return;
    const res = await fetch(`/api/users/${user.id}`, {
      method: user.isActive ? "DELETE" : "PATCH",
      headers: user.isActive ? undefined : { "Content-Type": "application/json" },
      body: user.isActive ? undefined : JSON.stringify({ isActive: true }),
    });
    if (res.ok) await load();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {notice && <p role="status" className={`rounded-lg p-3 text-sm lg:col-span-3 ${noticeKind === "warning" ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-700"}`}>{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 lg:col-span-3">{error}</p>}
      <div className="lg:col-span-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading users…</p>
        ) : users.length === 0 ? (
          <EmptyState message="No users found." />
        ) : (
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Email</th>
                  <th className="table-th">Role</th>
                  <th className="table-th">Franchise</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="table-td font-medium text-slate-900">{u.name}</td>
                    <td className="table-td text-slate-500">{u.email}</td>
                    <td className="table-td">
                      <Badge color={u.role === "SUPER_ADMIN" ? "red" : u.role === "COMPANY_ADMIN" ? "blue" : "slate"}>
                        {u.role.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className="table-td">{u.franchise?.name ?? "—"}</td>
                    <td className="table-td">
                      {u.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}
                    </td>
                    <td className="table-td">
                      {u.role !== "SUPER_ADMIN" && (
                        <button
                          onClick={() => toggleActive(u)}
                          className={`font-medium hover:underline ${u.isActive ? "text-red-600" : "text-green-600"}`}
                        >
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                      {u.isActive && (isSuper || u.role === "FRANCHISE_USER") && <button type="button" disabled={Boolean(resending)} onClick={() => resendWelcome(u)} className="ml-3 text-blue-600 hover:underline disabled:opacity-50">{resending === u.id ? "Sending…" : "Send welcome email"}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={createUser} className="card h-fit space-y-4 p-5">
        <h3 className="text-base font-semibold text-slate-900">Add User</h3>
        <div><label className="field-label" htmlFor="u-company">Company *</label>
          <select id="u-company" className="field-input" required value={companyId} disabled={!isSuper} onChange={e => { setCompanyId(e.target.value); setFranchiseId(""); }}>
            <option value="">Select company…</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select></div>
        <div>
          <label className="field-label" htmlFor="u-name">Name *</label>
          <input id="u-name" className="field-input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="u-email">Email *</label>
          <input id="u-email" type="email" className="field-input" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="u-password">Password *</label>
          <input id="u-password" type="password" className="field-input" required minLength={8} placeholder="Min 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="u-role">Role *</label>
          <select id="u-role" className="field-input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="FRANCHISE_USER">Franchise User</option>
            {isSuper && <option value="COMPANY_ADMIN">Company Admin</option>}
          </select>
        </div>
        {role === "FRANCHISE_USER" && (
          <div>
            <label className="field-label" htmlFor="u-franchise">Franchise *</label>
            <select
              id="u-franchise"
              className="field-input"
              required
              value={franchiseId}
              onChange={(e) => setFranchiseId(e.target.value)}
            >
              <option value="">Select franchise…</option>
              {franchises.filter(f => f.companyId === companyId).map((f) => (
                <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
              ))}
            </select>
          </div>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Create User"}
        </button>
      </form>
    </div>
  );
}
