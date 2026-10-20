"use client";
import { useEffect, useRef, useState } from "react";
export interface CafAddress {
  line1: string;
  line2: string;
  state: string;
  city: string;
  pincode: string;
}
type Location = {
  state: string;
  city: string;
  locality: string;
  district: string;
};
export function CafAddressFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CafAddress;
  onChange: (value: CafAddress) => void;
}) {
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState(false);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const id = label.toLowerCase().replace(/\W/g, "");
  function patch(fields: Partial<CafAddress>) {
    onChange({ ...value, ...fields });
  }
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/addresses", { signal: abort.signal })
      .then((r) => r.json())
      .then((d) => setStates(d.states ?? []))
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setCities([]);
    if (!value.state) return;
    const abort = new AbortController();
    fetch(`/api/addresses?state=${encodeURIComponent(value.state)}`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((d) => setCities(d.cities ?? []))
      .catch(() => {});
    return () => abort.abort();
  }, [value.state]);
  useEffect(() => {
    setLocations([]);
    setMessage("");
    if (!/^[1-9]\d{5}$/.test(value.pincode)) return;
    const abort = new AbortController();
    const pin = value.pincode;
    const timer = setTimeout(async () => {
      setMessage("Looking up PIN…");
      try {
        const r = await fetch(`/api/addresses?pin=${pin}`, {
          signal: abort.signal,
        });
        const data = await r.json();
        if (abort.signal.aborted || current.current.value.pincode !== pin)
          return;
        if (!r.ok) {
          setMessage(data.error ?? "Select state and city manually.");
          return;
        }
        const options: Location[] = data.locations;
        setLocations(options);
        const stateNames = [...new Set(options.map((o) => o.state))];
        const cityNames = [
          ...new Set(options.map((o) => o.city).filter(Boolean)),
        ];
        const exact =
          options.every((o) => !!o.city) &&
          cityNames.length === 1 &&
          stateNames.length === 1;
        const next = { ...current.current.value };
        if (stateNames.length === 1) {
          if (next.state !== stateNames[0]) next.city = "";
          next.state = stateNames[0];
        }
        if (exact) {
          next.city = cityNames[0];
          setManual(false);
        }
        current.current.onChange(next);
        setMessage(
          exact
            ? "State and city filled from PIN. Please confirm."
            : "Confirm the postal locality and select the city. District and city can differ.",
        );
      } catch {
        if (!abort.signal.aborted)
          setMessage("PIN lookup unavailable. Select state and city manually.");
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [value.pincode]);
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 font-medium">{label}</legend>
      {(
        [
          ["line1", "House / building / street *"],
          ["line2", "Area / landmark"],
        ] as const
      ).map(([key, text]) => (
        <div key={key}>
          <label className="field-label" htmlFor={`${id}-${key}`}>
            {text}
          </label>
          <input
            id={`${id}-${key}`}
            className="field-input"
            value={value[key]}
            maxLength={300}
            onChange={(e) => patch({ [key]: e.target.value })}
          />
        </div>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor={`${id}-pin`}>
            PIN code *
          </label>
          <input
            id={`${id}-pin`}
            className="field-input"
            inputMode="numeric"
            maxLength={6}
            value={value.pincode}
            onChange={(e) =>
              patch({ pincode: e.target.value.replace(/\D/g, "") })
            }
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${id}-state`}>
            State / Union Territory *
          </label>
          <select
            id={`${id}-state`}
            className="field-input"
            value={value.state}
            onChange={(e) => {
              setManual(false);
              patch({ state: e.target.value, city: "" });
            }}
          >
            <option value="">Select state first</option>
            {[
              ...new Set([...states, ...(value.state ? [value.state] : [])]),
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`${id}-city`}>
            City / town *
          </label>
          <select
            id={`${id}-city`}
            disabled={!value.state}
            className="field-input"
            value={manual ? "__other" : value.city}
            onChange={(e) => {
              if (e.target.value === "__other") {
                setManual(true);
                patch({ city: "" });
              } else patch({ city: e.target.value });
            }}
          >
            <option value="">Select city</option>
            {[...new Set([...cities, ...(value.city ? [value.city] : [])])].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
            <option value="__other">City missing? Enter manually</option>
          </select>
        </div>
        {manual && (
          <div>
            <label className="field-label" htmlFor={`${id}-manual`}>
              City / town name *
            </label>
            <input
              id={`${id}-manual`}
              className="field-input"
              maxLength={100}
              value={value.city}
              onChange={(e) => patch({ city: e.target.value })}
            />
          </div>
        )}
      </div>
      {message && (
        <p className="text-sm text-slate-600" role="status">
          {message}
        </p>
      )}
      {locations.length > 1 && (
        <div>
          <label className="field-label" htmlFor={`${id}-locality`}>
            Postal locality (reference)
          </label>
          <select
            id={`${id}-locality`}
            className="field-input"
            defaultValue=""
            onChange={(e) => {
              const l = locations[Number(e.target.value)];
              if (l) {
                patch({ state: l.state, city: l.city || value.city });
                setMessage(
                  l.city
                    ? "City selected; confirm your address."
                    : `Locality: ${l.locality}; district: ${l.district}. Select the actual city above.`,
                );
              }
            }}
          >
            <option value="">Select postal locality</option>
            {locations.map((l, i) => (
              <option key={i} value={i}>
                {l.locality} — {l.district}
              </option>
            ))}
          </select>
        </div>
      )}
    </fieldset>
  );
}
