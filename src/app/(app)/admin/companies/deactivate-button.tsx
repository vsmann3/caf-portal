"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeactivateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function deactivate() {
    if (!confirm(`Deactivate "${name}"? All its users will be locked out.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={deactivate}
      disabled={busy}
      className="font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      {busy ? "Deactivating…" : "Deactivate"}
    </button>
  );
}
