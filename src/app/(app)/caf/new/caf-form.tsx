"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RadiusDemoFields,
  type DemoPlan,
} from "@/components/radius-demo-fields";
import { PageHeader } from "@/components/ui";
import { CafAddressFields, type CafAddress } from "@/components/caf-address";
import { DOCUMENT_OPTIONS, MAX_DOCUMENT_BYTES } from "@/lib/caf-fields";
import { createApplicationSchema } from "@/lib/validators";

export interface FranchiseOption {
  id: string;
  name: string;
  code: string;
  companyName: string;
}
type Values = Record<string, string | boolean>;
type SavedDocument = { id: string; documentType: string; originalName: string };
type Draft = {
  customerId: string;
  id: string;
  version: number;
  payload: Values;
  updatedAt: string;
};
function address(v: Values, billing = false): CafAddress {
  return {
    line1: String(v[billing ? "billingAddressLine1" : "addressLine1"] ?? ""),
    line2: String(v[billing ? "billingAddressLine2" : "addressLine2"] ?? ""),
    city: String(v[billing ? "billingCity" : "city"] ?? ""),
    state: String(v[billing ? "billingState" : "state"] ?? ""),
    pincode: String(v[billing ? "billingPincode" : "pincode"] ?? ""),
  };
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="card p-5">
      <summary className="cursor-pointer font-semibold text-slate-900">
        {title}
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}
function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const object = URL.createObjectURL(file);
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [file]);
  return (
    <div className="mt-2">
      {file.type.startsWith("image/") && url && (
        <img
          src={url}
          alt={file.name}
          className="mb-2 h-28 max-w-full rounded object-contain"
        />
      )}
      <a
        className="text-sm text-blue-700 underline"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        Preview {file.name}
      </a>
    </div>
  );
}
export function CafForm({
  franchises,
  lockedFranchiseId,
  initial,
  initialDocuments = [],
  applicationId,
  revision,
  returnTo,
}: {
  franchises: FranchiseOption[];
  lockedFranchiseId: string | null;
  initial?: Values;
  initialDocuments?: SavedDocument[];
  applicationId?: string;
  revision?: number;
  returnTo?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    franchiseId: lockedFranchiseId ?? franchises[0]?.id ?? "",
    customerType: "RESIDENTIAL",
    connectionType: "NEW",
    idProofType: "AADHAAR",
    billingSame: true,
    ...initial,
    declarationAccepted: false,
  });
  const [docs, setDocs] = useState<{ category: string; file: File | null }[]>(
    ["PASSPORT_PHOTO", "ID_PROOF", "ADDRESS_PROOF"].map((category) => ({
      category,
      file: null,
    })),
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(
    null,
  );
  const [savedAt, setSavedAt] = useState("");
  const [customerId, setCustomerId] = useState(
    String(initial?.customerId ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );
  const [reviewing, setReviewing] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameMessage, setUsernameMessage] = useState("");
  const dirty = useRef(false);
  function patch(fields: Values) {
    dirty.current = true;
    setReviewing(false);
    setValues((v) => ({ ...v, ...fields }));
  }
  function refreshDrafts() {
    fetch("/api/caf-drafts")
      .then((r) => r.json())
      .then((d) => setDrafts(d.drafts ?? []))
      .catch(() => {});
  }
  useEffect(() => {
    if (!applicationId) refreshDrafts();
  }, [applicationId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (values.radiusDemoIntentId && values.broadbandUsername) {
      setUsername(String(values.broadbandUsername));
      setUsernameMessage("RADIUS reservation retained");
      return;
    }
    if (applicationId && initial?.broadbandUsername) {
      setUsername(String(initial.broadbandUsername));
      setUsernameMessage("Existing username retained");
      return;
    }
    setUsername("");
    setUsernameMessage("");
    if (
      !values.customerName ||
      !/^[6-9]\d{9}$/.test(String(values.mobile ?? ""))
    )
      return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setUsernameMessage("Checking company username availability…");
      try {
        const r = await fetch("/api/applications/username", {
          method: "POST",
          signal: abort.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            franchiseId: values.franchiseId,
            name: values.customerName,
            mobile: values.mobile,
          }),
        });
        const d = await r.json();
        if (!abort.signal.aborted) {
          setUsername(d.username ?? "");
          setUsernameMessage(d.message ?? d.error ?? "Confirmed on submission");
        }
      } catch {
        if (!abort.signal.aborted)
          setUsernameMessage(
            "Availability check unavailable; username assigned on submission.",
          );
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    values.customerName,
    values.mobile,
    values.franchiseId,
    applicationId,
    initial,
    values.radiusDemoIntentId,
    values.broadbandUsername,
  ]);
  function setAddress(v: CafAddress, billing: boolean) {
    patch(
      billing
        ? {
            billingAddressLine1: v.line1,
            billingAddressLine2: v.line2,
            billingCity: v.city,
            billingState: v.state,
            billingPincode: v.pincode,
          }
        : {
            addressLine1: v.line1,
            addressLine2: v.line2,
            city: v.city,
            state: v.state,
            pincode: v.pincode,
          },
    );
  }
  function payload() {
    const billing = address(values, !values.billingSame);
    return {
      ...values,
      businessName:
        values.customerType === "COMMERCIAL"
          ? String(values.businessName ?? "")
          : "",
      gstNumber:
        values.customerType === "COMMERCIAL"
          ? String(values.gstNumber ?? "")
          : "",
      gender: values.gender || null,
      dob: values.dob || null,
      billingAddressLine1: billing.line1,
      billingAddressLine2: billing.line2,
      billingCity: billing.city,
      billingState: billing.state,
      billingPincode: billing.pincode,
      ...(draft ? { draftId: draft.id, draftVersion: draft.version } : {}),
      ...(applicationId ? { applicationId, revision } : {}),
    };
  }
  function check() {
    const result = createApplicationSchema.safeParse(payload());
    const fields: Record<string, string[] | undefined> = result.success
      ? {}
      : result.error.flatten().fieldErrors;
    const categories = new Set([
      ...initialDocuments.map((d) => d.documentType),
      ...docs.filter((d) => d.file).map((d) => d.category),
    ]);
    if (
      [
        "PASSPORT_PHOTO",
        "ID_PROOF",
        "ADDRESS_PROOF",
        ...(values.customerType === "COMMERCIAL" ? ["GST_CERTIFICATE"] : []),
      ].some((t) => !categories.has(t))
    )
      fields.documents = [
        "Attach customer photo, identity proof, address proof and (for businesses) GST certificate.",
      ];
    setErrors(fields);
    setNotice(
      Object.keys(fields).length ? "Please correct the listed fields." : "",
    );
    return !Object.keys(fields).length;
  }
  async function saveDraft() {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/caf-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          payload: { ...values, declarationAccepted: false },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Draft save failed");
      setDraft({ id: d.draft.id, version: d.draft.version });
      setCustomerId(d.draft.customerId);
      setSavedAt(new Date(d.draft.updatedAt).toLocaleString());
      dirty.current = docs.some((d) => d.file);
      setNotice(
        "Draft fields saved. Selected files are not saved in drafts; attach them before submission.",
      );
      refreshDrafts();
      return d.draft as Draft;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Draft save failed");
    } finally {
      setBusy(false);
    }
  }
  async function reserveRadius(plan: DemoPlan, name: string, existing: string) {
    const saved = await saveDraft();
    if (!saved) return;
    setBusy(true);
    try {
      const r = await fetch("/api/radius-demo/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: saved.id,
          draftVersion: saved.version,
          planId: plan.plan_id,
          planVersion: plan.version,
          username: name,
          ...(existing ? { existingCustomerId: existing } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error(
          d.error ?? "Reservation outcome unknown; retry the same selection",
        );
      setDraft({ id: d.draft.id, version: d.draft.version });
      setCustomerId(d.intent.customerId);
      setValues((v) => ({
        ...v,
        radiusDemoIntentId: d.intent.id,
        broadbandUsername: d.intent.username,
        planName: plan.name,
        bandwidth: String(plan.download_kbps),
      }));
      setUsername(d.intent.username);
      setNotice(
        "RADIUS username reserved. Submit this CAF before the reservation expires. Approval will stage a disabled service.",
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Reservation could not be confirmed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function renewRadius() {
    setBusy(true);
    try {
      const r = await fetch("/api/radius-demo/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: values.radiusDemoIntentId }),
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error(d.error ?? "Renewal outcome unknown; retry renewal");
      setNotice(
        "Reservation renewed. Submit before " +
          new Date(d.intent.reservationExpiresAt).toLocaleString(),
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Renewal could not be confirmed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!check()) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("data", JSON.stringify(payload()));
      for (const d of docs)
        if (d.file) {
          form.append("files", d.file);
          form.append("docType", d.category);
        }
      const r = await fetch("/api/applications", {
        method: "POST",
        body: form,
      });
      const d = await r.json();
      if (!r.ok) {
        setErrors(d.fields ?? {});
        throw new Error(d.error ?? "CAF submission failed");
      }
      dirty.current = false;
      router.push(`/customers/${d.application.id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
      router.refresh();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Network error. Your fields and selected files remain available.",
      );
    } finally {
      setBusy(false);
    }
  }
  const input = (
    key: string,
    label: string,
    type = "text",
    maxLength = 150,
  ) => (
    <div>
      <label className="field-label" htmlFor={key}>
        {label}
      </label>
      <input
        id={key}
        disabled={!!values.radiusDemoIntentId && ["planName", "bandwidth"].includes(key)}
        type={type}
        maxLength={maxLength}
        className="field-input"
        value={String(values[key] ?? "")}
        onChange={(e) => patch({ [key]: e.target.value })}
        aria-invalid={!!errors[key]}
      />
      {errors[key] && (
        <p className="mt-1 text-sm text-red-700">{errors[key]?.[0]}</p>
      )}
    </div>
  );
  const select = (key: string, label: string, options: string[][]) => (
    <div>
      <label className="field-label" htmlFor={key}>
        {label}
      </label>
      <select
        id={key}
        className="field-input"
        value={String(values[key] ?? "")}
        onChange={(e) => patch({ [key]: e.target.value })}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={
          applicationId ? "Correct and resubmit CAF" : "New eCAF application"
        }
        subtitle="Save your progress, attach evidence and review before submitting for approval."
      />
      <p className="mb-5 text-sm text-slate-600">
        Customer ID:{" "}
        <strong className="font-mono">
          {customerId || "Assigned automatically on first save"}
        </strong>
      </p>
      {!applicationId && drafts.length > 0 && (
        <div className="card mb-5 p-5">
          <label className="field-label" htmlFor="resume">
            Resume your saved draft
          </label>
          <select
            id="resume"
            className="field-input"
            value={draft?.id ?? ""}
            onChange={(e) => {
              const d = drafts.find((d) => d.id === e.target.value);
              if (
                !d ||
                (dirty.current &&
                  !window.confirm(
                    "Replace unsaved entries with this saved draft?",
                  ))
              )
                return;
              setValues({ ...d.payload, declarationAccepted: false });
              setDraft({ id: d.id, version: d.version });
              setCustomerId(d.customerId);
              setDocs([]);
              setSavedAt(new Date(d.updatedAt).toLocaleString());
              setErrors({});
              setReviewing(false);
              dirty.current = false;
            }}
          >
            <option value="">Select draft</option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.payload.customerName || "Unnamed customer")} —{" "}
                {new Date(d.updatedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </div>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (check()) setReviewing(true);
        }}
        className="space-y-5"
      >
        <fieldset disabled={busy} className="space-y-5">
          <Section title="Application">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="franchiseId">
                  Filing franchise *
                </label>
                <select
                  id="franchiseId"
                  disabled={
                    !!lockedFranchiseId ||
                    !!applicationId ||
                    !!values.radiusDemoIntentId
                  }
                  className="field-input"
                  value={String(values.franchiseId)}
                  onChange={(e) => patch({ franchiseId: e.target.value })}
                >
                  {franchises.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.companyName ? `${f.companyName} / ` : ""}
                      {f.name} ({f.code})
                    </option>
                  ))}
                </select>
              </div>
              {select("customerType", "Customer type *", [
                ["RESIDENTIAL", "Residential"],
                ["COMMERCIAL", "Business"],
              ])}
              {select("connectionType", "Application type *", [
                ["NEW", "New connection"],
                ["RELOCATION", "Relocation"],
                ["CHANGE_OF_PLAN", "Change of plan"],
                ["TRANSFER", "Transfer"],
              ])}
            </div>
          </Section>
          <Section title="Customer details">
            <div className="grid gap-4 md:grid-cols-2">
              {input(
                "customerName",
                "Customer / authorised signatory full name *",
              )}
              {input("fatherName", "Father / spouse name")}
              {input("mobile", "Mobile number *", "tel", 10)}
              {input("email", "Email address", "email", 200)}
              {input("altPhone", "Alternate phone", "tel", 20)}
              {input("dob", "Date of birth", "date")}
              {select("gender", "Gender", [
                ["", "Select"],
                ["MALE", "Male"],
                ["FEMALE", "Female"],
                ["OTHER", "Other"],
              ])}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Mobile and email verification are planned. Entering details does
              not mark them verified.
            </p>
          </Section>
          {values.customerType === "COMMERCIAL" && (
            <Section title="Business details">
              <div className="grid gap-4 md:grid-cols-2">
                {input("businessName", "Registered business name *")}
                {input("gstNumber", "GST number *", "text", 15)}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Attach GST certificate below. Surepass GST verification is
                planned.
              </p>
            </Section>
          )}
          <Section title="Addresses">
            <CafAddressFields
              label="Installation address"
              value={address(values)}
              onChange={(v) => setAddress(v, false)}
            />
            <label className="my-5 flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!values.billingSame}
                onChange={(e) => patch({ billingSame: e.target.checked })}
              />
              Billing address is the same as installation
            </label>
            {values.billingSame ? (
              <p className="text-sm text-slate-600">
                Installation details will also be saved as the required billing
                address.
              </p>
            ) : (
              <CafAddressFields
                label="Billing address"
                value={address(values, true)}
                onChange={(v) => setAddress(v, true)}
              />
            )}
            <p className="mt-4 text-xs text-slate-500">
              Address reference data:{" "}
              <a
                className="underline"
                href="https://github.com/dr5hn/countries-states-cities-database"
                target="_blank"
                rel="noreferrer"
              >
                CSC Database contributors (ODbL)
              </a>
              . Missing cities can be entered manually.
            </p>
          </Section>
          <Section title="Service details">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="service-username">
                  Service username *
                </label>
                <input
                  id="service-username"
                  readOnly
                  className="field-input bg-slate-50"
                  value={username}
                  placeholder="Generated from name and mobile"
                />
                <p className="mt-1 text-sm text-slate-500" role="status">
                  {usernameMessage ||
                    "Enter name and mobile. Unique across this company's franchises."}
                </p>
              </div>
              {input("planName", "Plan name", "text", 100)}
              {input("bandwidth", "Bandwidth", "text", 50)}
            </div>
          </Section>
          {!applicationId && (
            <RadiusDemoFields
              franchiseId={String(values.franchiseId)}
              username={username}
              reserved={!!values.radiusDemoIntentId}
              onReserve={reserveRadius}
              onRenew={renewRadius}
            />
          )}
          <Section title="Identity and supporting documents">
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              {select("idProofType", "Identity document type *", [
                ["AADHAAR", "Aadhaar"],
                ["PAN", "PAN"],
                ["VOTER_ID", "Voter ID"],
                ["PASSPORT", "Passport"],
                ["DRIVING_LICENSE", "Driving licence"],
                ["OTHER", "Other"],
              ])}
              {input("idNumber", "Identity document number *", "text", 40)}
            </div>
            <p className="mb-4 text-sm text-slate-600">
              Required: customer photo, identity proof, address proof
              {values.customerType === "COMMERCIAL" ? ", GST certificate" : ""}.
              JPG, PNG, WEBP or PDF; maximum 4 MB per file, 10 files per CAF.
            </p>
            {initialDocuments.length > 0 && (
              <div className="mb-4 rounded bg-slate-50 p-3">
                <p className="text-sm font-medium">
                  Existing evidence retained unless you upload the same category
                  again:
                </p>
                {initialDocuments.map((d) => (
                  <a
                    key={d.id}
                    className="block text-sm text-blue-700 underline"
                    href={`/api/documents/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.documentType.replaceAll("_", " ")}: {d.originalName}
                  </a>
                ))}
              </div>
            )}
            <div className="space-y-4">
              {docs.map((doc, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      aria-label={`Document ${index + 1} category`}
                      className="field-input max-w-xs"
                      value={doc.category}
                      onChange={(e) => {
                        dirty.current = true;
                        setReviewing(false);
                        setDocs((rows) =>
                          rows.map((r, i) =>
                            i === index
                              ? { ...r, category: e.target.value }
                              : r,
                          ),
                        );
                      }}
                    >
                      {DOCUMENT_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Document ${index + 1} file`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="max-w-full text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (file && file.size > MAX_DOCUMENT_BYTES) {
                          setNotice(`${file.name}: maximum 4 MB per file.`);
                          e.target.value = "";
                          return;
                        }
                        dirty.current = true;
                        setReviewing(false);
                        setDocs((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, file } : r,
                          ),
                        );
                      }}
                    />
                    <button
                      type="button"
                      className="text-sm text-red-700"
                      onClick={() => {
                        dirty.current = true;
                        setReviewing(false);
                        setDocs((rows) => rows.filter((_, i) => i !== index));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {doc.file && <Preview file={doc.file} />}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary mt-4"
              disabled={docs.length >= 10}
              onClick={() =>
                setDocs((rows) => [
                  ...rows,
                  {
                    category:
                      values.customerType === "COMMERCIAL" &&
                      !rows.some((r) => r.category === "GST_CERTIFICATE")
                        ? "GST_CERTIFICATE"
                        : "OTHER",
                    file: null,
                  },
                ])
              }
            >
              + Add document
            </button>
          </Section>
          <Section title="Declaration and review">
            {input("remarks", "Remarks", "text", 1000)}
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={values.declarationAccepted === true}
                onChange={(e) =>
                  patch({ declarationAccepted: e.target.checked })
                }
              />
              <span>
                I confirm that I have checked the entered details and attached
                evidence and am submitting this CAF for administrative review.
              </span>
            </label>
            <p className="mt-2 text-xs text-slate-500">
              Staff acknowledgement only. Customer signing workflow is planned
              separately.
            </p>
          </Section>
        </fieldset>
        {notice && (
          <div
            role="status"
            className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900"
          >
            {notice}
          </div>
        )}
        {Object.keys(errors).length > 0 && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          >
            <p className="font-medium">Please check:</p>
            <ul className="mt-2 list-disc pl-5">
              {Object.entries(errors).map(([key, messages]) => (
                <li key={key}>
                  {key}: {messages?.join("; ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {reviewing && (
          <section className="card border-blue-200 p-5">
            <h2 className="font-semibold">Review before submitting</h2>
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              {Object.entries(payload())
                .filter(
                  ([k, v]) =>
                    typeof v === "string" &&
                    v &&
                    !["draftId", "applicationId", "franchiseId"].includes(k),
                )
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-medium text-slate-500">
                      {k.replace(/([A-Z])/g, " $1")}
                    </dt>
                    <dd className="break-words">{String(v)}</dd>
                  </div>
                ))}
              <div>
                <dt className="font-medium text-slate-500">
                  Username suggestion
                </dt>
                <dd>{username || "Assigned on submission"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">New documents</dt>
                <dd>
                  {docs
                    .filter((d) => d.file)
                    .map((d) => d.file?.name)
                    .join(", ")}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn-primary mt-5"
              disabled={busy}
              onClick={submit}
            >
              {busy
                ? "Submitting…"
                : applicationId
                  ? "Resubmit for approval"
                  : "Submit for approval"}
            </button>
          </section>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {!applicationId && (
            <button
              type="button"
              disabled={busy || !values.franchiseId}
              className="btn-secondary"
              onClick={saveDraft}
            >
              {busy ? "Please wait…" : "Save draft"}
            </button>
          )}
          <button type="submit" disabled={busy} className="btn-primary">
            Review application
          </button>
          <Link href="/customers" className="btn-secondary">
            Back to CAFs
          </Link>
          {savedAt && (
            <span className="text-xs text-slate-500">
              Draft saved: {savedAt}
            </span>
          )}
        </div>
        {!applicationId && (
          <p className="text-xs text-slate-500">
            Drafts save form fields to the server, not selected files. Attach
            documents before submission.
          </p>
        )}
      </form>
    </div>
  );
}
