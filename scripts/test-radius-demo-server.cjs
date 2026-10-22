// Synthetic HTTP protocol fixture only. This is NOT the real Radius runtime.
const http = require("node:http");
const { randomUUID, createHash } = require("node:crypto");
const token = "nlcaf_fixture_012345678901234567890123456789";
const cafToken = "caf_read_fixture_012345678901234567890123456789";
const reservations = new Map(),
  receipts = new Map(),
  hashes = new Map();
let loseNext = false,
  wrongReceipt = false,
  postCount = 0;
const plans = [1, 2].map((n) => ({
  plan_id: `40000000-0000-4000-8000-00000000000${n}`,
  radius_company_id: "10001",
  name: `Demo ${n * 100} Mbps`,
  version: 1,
  active: true,
  download_kbps: n * 100000,
  upload_kbps: n * 100000,
  validity: { duration_seconds: 2592000, starts_at: "activation" },
}));
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
http
  .createServer(async (req, res) => {
    function send(status, data) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    }
    const fail = (code, status = 409) =>
      send(status, {
        error: {
          code,
          message: "Synthetic fixture rejection",
          retryable: false,
        },
        request_id: randomUUID(),
      });
    if (req.headers.authorization !== `Bearer ${token}`)
      return fail("invalid_token", 401);
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 20000) return fail("oversized", 413);
    }
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return fail("invalid_json", 400);
    }
    const url = new URL(req.url, "http://radius-demo:8080");
    if (url.pathname === "/fixture") {
      if (req.method === "POST") {
        loseNext = body.loseNext ?? loseNext;
        wrongReceipt = body.wrongReceipt ?? wrongReceipt;
      }
      return send(200, {
        postCount,
        receipts: [...receipts.values()],
        planIds: plans.map((p) => p.plan_id),
      });
    }
    if (
      req.method === "GET" &&
      url.pathname === "/api/integrations/ecaf/v1/companies/10001/plans"
    )
      return send(200, { items: plans, next_cursor: null, has_more: false });
    if (
      req.method === "POST" &&
      url.pathname === "/api/integrations/ecaf/v1/username-reservations"
    ) {
      const key = req.headers["idempotency-key"];
      if (key !== body.service_request_id)
        return fail("reservation_binding_conflict");
      if (reservations.has(key))
        return hash(body) === reservations.get(key).hash
          ? send(200, reservations.get(key).receipt)
          : fail("reservation_binding_conflict");
      if (
        !plans.some(
          (p) => p.plan_id === body.plan_id && p.version === body.plan_version,
        )
      )
        return fail("plan_changed");
      if (body.username === "taken") return fail("username_unavailable");
      const receipt = {
        source_id: "caf-demo",
        customer_id: body.customer_id,
        company_ref: body.company_ref,
        franchise_ref: body.franchise_ref,
        radius_company_id: "10001",
        radius_franchise_id: "20001",
        reservation_id: randomUUID(),
        service_request_id: body.service_request_id,
        username: body.username,
        plan_id: body.plan_id,
        plan_version: body.plan_version,
        expires_at: new Date(Date.now() + 900000).toISOString(),
      };
      reservations.set(key, { hash: hash(body), receipt });
      return send(201, receipt);
    }
    if (
      req.method === "POST" &&
      /^\/api\/integrations\/ecaf\/v1\/username-reservations\/[^/]+\/renew$/.test(
        url.pathname,
      )
    ) {
      const id = url.pathname.split("/").at(-2),
        found = [...reservations.values()].find(
          (x) => x.receipt.reservation_id === id,
        );
      if (!found) return fail("reservation_not_found", 404);
      found.receipt.expires_at = new Date(Date.now() + 900000).toISOString();
      return send(200, found.receipt);
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/integrations/ecaf/v2/provisionings/")
    ) {
      const key = url.pathname.split("/").at(-1),
        receipt = receipts.get(key);
      return receipt
        ? send(200, {
            ...receipt,
            ...(wrongReceipt ? { customer_id: "9999999999" } : {}),
          })
        : fail("not_found", 404);
    }
    if (
      req.method === "POST" &&
      url.pathname === "/api/integrations/ecaf/v2/provisionings"
    ) {
      postCount++;
      const key = req.headers["idempotency-key"];
      if (
        key !== body.provisioning_request_id ||
        body.schema_version !== "2.0" ||
        body.supersedes_request_id !== null
      )
        return fail("binding_conflict");
      if (receipts.has(key))
        return hash(body) === hashes.get(key)
          ? send(200, receipts.get(key))
          : fail("idempotency_conflict");
      const a = body.approval,
        s = body.service,
        reservation = reservations.get(s.service_request_id)?.receipt;
      if (
        !reservation ||
        reservation.reservation_id !== s.reservation_id ||
        reservation.customer_id !== a.customer_id ||
        reservation.username !== s.username ||
        reservation.plan_id !== s.plan_id
      )
        return fail("reservation_binding_conflict");
      // Exercise actual scoped CAF exact-approval read before accepting a hash.
      const response = await fetch(
        `http://caf-demo-app:3000/api/integrations/radius/v1/customers/${a.customer_id}/applications/${a.caf.application_id}/approvals/${a.caf.revision}`,
        { headers: { Authorization: `Bearer ${cafToken}` } },
      );
      const approval = await response.json();
      if (
        response.status !== 200 ||
        approval.approval_status !== "APPROVED" ||
        hash(approval.approval_event) !== hash(a) ||
        approval.service_request_id !== s.service_request_id
      )
        return fail("approval_required");
      const r = {
        schema_version: "2.0",
        source_id: "caf-demo",
        customer_id: a.customer_id,
        company_ref: a.company_ref,
        franchise_ref: a.franchise_ref,
        radius_company_id: "10001",
        radius_franchise_id: "20001",
        provisioning_request_id: key,
        event_id: a.event_id,
        service_request_id: s.service_request_id,
        receipt_version: 1,
        receipt_status: "accepted",
        credential_accepted: true,
        service_id: randomUUID(),
        service_status: "pending_service_setup",
        error: null,
      };
      hashes.set(key, hash(body));
      receipts.set(key, r);
      if (loseNext) {
        loseNext = false;
        return fail("temporarily_unavailable", 503);
      }
      return send(201, r);
    }
    return fail("not_found", 404);
  })
  .listen(8080, "0.0.0.0");
