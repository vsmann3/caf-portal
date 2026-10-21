"use client";
import { useState } from "react";
export function DownloadCafPdf({
  id,
  customerId,
}: {
  id: string;
  customerId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/applications/${id}/pdf`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "PDF download failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `CAF-${customerId}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="btn-primary" disabled={busy} onClick={download}>
        {busy ? "Preparing PDF…" : "Download CAF + documents PDF"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-sm text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
