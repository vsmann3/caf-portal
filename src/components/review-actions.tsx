"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewActions({
  applicationId,
  status,
}: {
  applicationId: string;
  status: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = status === "APPROVED" || status === "REJECTED";

  async function act(action: "APPROVE" | "REJECT" | "UNDER_REVIEW") {
    if (action === "REJECT" && !reason.trim()) {
      setError("Please enter a rejection reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectionReason: reason || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Action failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <div className="card p-5">
      <h3 className="text-base font-semibold text-slate-900">Review</h3>
      <p className="mt-1 text-sm text-slate-500">
        Approve or reject this application. Rejection requires a reason which is
        recorded with the application.
      </p>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <textarea
        className="field-input mt-3"
        rows={2}
        placeholder="Rejection reason (required for rejection)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => act("UNDER_REVIEW")} disabled={busy} className="btn-secondary">
          Mark Under Review
        </button>
        <button onClick={() => act("APPROVE")} disabled={busy} className="btn-primary">
          Approve
        </button>
        <button onClick={() => act("REJECT")} disabled={busy} className="btn-danger">
          Reject
        </button>
      </div>
    </div>
  );
}
