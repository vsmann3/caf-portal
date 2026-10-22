"use client";
import { useEffect, useState } from "react";
export type DemoPlan = {
  plan_id: string;
  version: number;
  name: string;
  download_kbps: number;
  upload_kbps: number;
  validity: { duration_seconds: number };
  price?: {
    currency: string;
    amount_minor: number;
    minor_unit_exponent: number;
  };
};
export function RadiusDemoFields({
  franchiseId,
  username,
  reserved,
  onReserve,
  onRenew,
}: {
  franchiseId: string;
  username: string;
  reserved: boolean;
  onRenew: () => Promise<void>;
  onReserve: (
    plan: DemoPlan,
    username: string,
    existingCustomerId: string,
  ) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(false),
    [plans, setPlans] = useState<DemoPlan[]>([]),
    [selected, setSelected] = useState("");
  const [name, setName] = useState(username),
    [existing, setExisting] = useState(""),
    [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!reserved) setName(username);
  }, [username, reserved]);
  useEffect(() => {
    const abort = new AbortController();
    setEnabled(false);
    setPlans([]);
    setSelected("");
    setError("");
    (async () => {
      const config = await fetch(
        `/api/radius-demo/config?franchiseId=${encodeURIComponent(franchiseId)}`,
        { signal: abort.signal },
      ).then((r) => r.json());
      if (!config.enabled) return;
      setEnabled(true);
      const r = await fetch(
        `/api/radius-demo/plans?franchiseId=${encodeURIComponent(franchiseId)}`,
        { signal: abort.signal },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Unable to load plans");
      setPlans(data.items);
      setCursor(data.next_cursor);
    })().catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [franchiseId]);
  async function more() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/radius-demo/plans?franchiseId=${encodeURIComponent(franchiseId)}&cursor=${encodeURIComponent(cursor!)}`,
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Reload plans to restart listing");
      setPlans((old) => [
        ...old,
        ...d.items.filter(
          (p: DemoPlan) => !old.some((x) => x.plan_id === p.plan_id),
        ),
      ]);
      setCursor(d.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load plans");
    } finally {
      setLoading(false);
    }
  }
  if (!enabled) return null;
  const plan = plans.find((p) => p.plan_id === selected);
  return (
    <div
      className="mt-4 space-y-3 rounded border border-amber-300 bg-amber-50 p-4"
      data-testid="radius-demo-form"
    >
      <h4 className="font-semibold">
        Isolated RADIUS demo - stages a disabled service
      </h4>
      <p className="text-sm">
        Use test customers only. Approval will deliver credentials and show a
        durable receipt; network activation is unavailable.
      </p>
      <label className="block text-sm">
        Published RADIUS plan
        <select
          aria-label="Published RADIUS plan"
          className="field-input"
          value={selected}
          disabled={reserved}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select published plan</option>
          {plans.map((p) => (
            <option key={p.plan_id} value={p.plan_id}>
              {p.name} - v{p.version}
            </option>
          ))}
        </select>
      </label>
      {plan && (
        <p className="text-sm">
          {plan.download_kbps} / {plan.upload_kbps} kbps -{" "}
          {plan.validity.duration_seconds} elapsed seconds from activation -{" "}
          {plan.price
            ? `${plan.price.currency} ${(plan.price.amount_minor / 10 ** plan.price.minor_unit_exponent).toFixed(plan.price.minor_unit_exponent)}`
            : "Price unavailable"}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          onClick={more}
          disabled={loading}
          className="btn-secondary"
        >
          Load more published plans
        </button>
      )}
      <label className="block text-sm">
        Reserved service username
        <input
          aria-label="Reserved service username"
          className="field-input"
          value={name}
          disabled={reserved}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Existing approved Customer ID (optional)
        <input
          aria-label="Existing approved Customer ID"
          className="field-input"
          value={existing}
          disabled={reserved}
          maxLength={10}
          onChange={(e) => setExisting(e.target.value)}
        />
      </label>
      <p className="text-xs">
        For another connection, enter the exact approved 10-digit ID from this
        company. No automatic matching by name or mobile.
      </p>
      <button
        type="button"
        className="btn-secondary"
        disabled={reserved || !plan || !name || loading}
        onClick={async () => {
          setLoading(true);
          try {
            await onReserve(plan!, name, existing);
          } finally {
            setLoading(false);
          }
        }}
      >
        {reserved
          ? "Username and plan reserved"
          : loading
            ? "Reserving..."
            : "Save draft and reserve RADIUS username"}
      </button>
      {reserved && (
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              await onRenew();
            } finally {
              setLoading(false);
            }
          }}
        >
          Renew reserved username before submission
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
