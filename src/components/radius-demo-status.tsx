"use client";
import { useEffect, useState } from "react";
export function RadiusDemoStatus({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/radius-demo/status?applicationId=${encodeURIComponent(applicationId)}`,
          { cache: "no-store" },
        );
        if (r.status === 404) return;
        const d = await r.json();
        if (!r.ok) throw new Error("Unable to confirm delivery status");
        if (alive) {
          setData(d);
          setError("");
        }
      } catch {
        if (alive)
          setError("Delivery status could not be confirmed. Reload to retry.");
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [applicationId]);
  if (!data?.enabled) return null;
  return (
    <section
      className="card my-5 space-y-2 border border-amber-300 p-5"
      data-testid="radius-demo-status"
    >
      <h3 className="font-semibold">Isolated RADIUS delivery</h3>
      <p className="text-sm">
        Customer ID: {String(data.customerId)} - Username:{" "}
        {String(data.username)}
      </p>
      <p className="font-semibold">
        {data.state === "DEMO_ACTIVE" ? "Synthetic demo active - no real internet service" : data.state === "STAGED" ? "Staged - credentials accepted; service disabled" : String(data.state)}
      </p>
      <p className="text-sm">
        Receipt version: {String(data.receiptVersion)} - Credentials accepted:{" "}
        {data.credentialAccepted ? "Yes" : "Not confirmed"}
      </p>
      {data.deliveryId ? (
        <p className="break-all text-xs">
          Delivery: {String(data.deliveryId)} - Service:{" "}
          {String(data.serviceId ?? "not assigned")}
        </p>
      ) : (
        <p className="text-sm">
          Awaiting CAF approval. No credentials have been sent.
        </p>
      )}
      <p className="text-xs">
        CAF has not requested activation.{" "}
        {data.state === "DEMO_ACTIVE" ? "Synthetic demo only: no real internet or NAS access." : data.networkActive === true ? "Unexpected active remote receipt - stop and investigate." : "This demo does not authorize real network traffic."}
      </p>
      {!data.credentialAccepted && data.attempts === 0 && (
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const r = await fetch("/api/radius-demo/renew", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId: data.serviceRequestId }),
            });
            if (!r.ok)
              setError(
                "Could not renew reservation; delivery may already have started. Reconcile before retrying.",
              );
            else setError("");
          }}
        >
          Renew reservation before delivery
        </button>
      )}
      {data.errorCode && data.errorCode !== "activation_authorization_required" ? (
        <p role="alert" className="text-sm text-red-700">
          Review required: {String(data.errorCode)}
        </p>
      ) : null}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
