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
}

export function UsersClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [franchises, setFranchises] = useState<FranchiseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create-form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"COMPANY_ADMIN" | "FRANCHISE_USER">("FRANCHISE_USER");
  const [franchiseId, setFranchiseId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, franchisesRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/franchises"),
      ]);
      const usersJson = await usersRes.json().catch(() => ({ users: [] }));
      const franchisesJson = await franchisesRes.json().catch(() => ({ franchises: [] }));
      if (usersRes.ok) setUsers(usersJson.users ?? []);
      if (franchisesRes.ok) setFranchises(franchisesJson.franchises ?? []);
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
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
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
      await load();
    } finally {
      setBusy(false);
    }
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
            <option value="COMPANY_ADMIN">Company Admin</option>
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
              {franchises.map((f) => (
                <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Create User"}
        </button>
      </form>
    </div>
  );
}
