"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { Role } from "@prisma/client";

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"] },
  { href: "/caf/new", label: "New CAF", roles: ["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"] },
  { href: "/customers", label: "Customers", roles: ["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"] },
  { href: "/admin/franchises", label: "Franchises", roles: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
  { href: "/admin/users", label: "Users", roles: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
  { href: "/admin/companies", label: "Companies", roles: ["SUPER_ADMIN"] },
  { href: "/admin/branding", label: "Branding", roles: ["SUPER_ADMIN"] },
  { href: "/admin/storage", label: "Storage Settings", roles: ["SUPER_ADMIN"] },
  { href: "/admin/super-settings", label: "Super Settings", roles: ["SUPER_ADMIN"] },
];

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  COMPANY_ADMIN: "Company Admin",
  FRANCHISE_USER: "Franchise User",
};

export function Sidebar({
  role,
  userName,
  companyName,
  franchiseName,
  portalName = "CAF Portal",
}: {
  role: Role;
  userName: string;
  companyName?: string | null;
  franchiseName?: string | null;
  portalName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const items = NAV.filter((n) => n.roles.includes(role));

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-5">
        <p className="text-lg font-bold text-blue-700">{portalName}</p>
        {companyName && (
          <p className="mt-1 truncate text-sm font-medium text-slate-700">{companyName}</p>
        )}
        {franchiseName && (
          <p className="truncate text-xs text-slate-500">{franchiseName}</p>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-5 py-4">
        <p className="truncate text-sm font-medium text-slate-800">{userName}</p>
        <p className="text-xs text-slate-500">{ROLE_LABEL[role]}</p>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="mt-3 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
