// Real CAF HTTP/PostgreSQL tests against a synthetic Radius protocol fixture.
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { execFileSync } = require("node:child_process");
assert.equal(process.env.CAF_ISOLATED_TEST, "1");
assert.equal(process.env.CAF_RADIUS_DEMO, "1");
assert.match(
  process.env.DATABASE_URL,
  /caf-settings-test-[^/]+-db:5432\/smoke/,
);
const db = new PrismaClient();
const radiusToken = "nlcaf_fixture_012345678901234567890123456789";
const readToken = "caf_read_fixture_012345678901234567890123456789";
const workerToken = "fixture-worker-012345678901234567890123456789";
async function api(path, method = "GET", body, cookie, bearer) {
  const r = await fetch("http://127.0.0.1:3000" + path, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: r.status,
    data,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    headers: r.headers,
  };
}
async function login(email, password) {
  const r = await api("/api/auth/login", "POST", { email, password });
  assert.equal(r.status, 200);
  return r.cookie;
}
async function fixture(body) {
  return (
    await fetch("http://radius-demo:8080/fixture", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${radiusToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  ).json();
}
async function worker() {
  const r = await api(
    "/api/internal/radius-demo/run",
    "POST",
    undefined,
    undefined,
    workerToken,
  );
  assert.equal(r.status, 200);
  return r.data;
}
function multipart(data) {
  const f = new FormData();
  f.set("data", JSON.stringify(data));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=",
    "base64",
  );
  for (const t of ["PASSPORT_PHOTO", "ID_PROOF", "ADDRESS_PROOF"]) {
    f.append("files", new Blob([png], { type: "image/png" }), t + ".png");
    f.append("docType", t);
  }
  return f;
}
async function main() {
  const admin = await login(
    process.env.SEED_SUPER_ADMIN_EMAIL,
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const staff = await login(
    "counter1@example.test",
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const company = await db.company.findUniqueOrThrow({
    where: { companyCode: "INFOBB2548" },
  });
  const counterRecord = await db.user.findUniqueOrThrow({ where: { email: "counter1@example.test" } });
  const franchise = await db.franchise.findUniqueOrThrow({ where: { id: counterRecord.franchiseId } });
  const cfg = {
    companyId: company.id,
    sourceId: "caf-demo",
    baseUrl: "http://radius-demo:8080",
    radiusCompanyId: "10001",
    radiusToken,
    cafReadToken: readToken,
    franchiseMappings: { [franchise.id]: "20001" },
  };
  assert.throws(() =>
    execFileSync("node", ["scripts/configure-radius-demo.cjs"], {
      input: JSON.stringify(cfg),
      env: { ...process.env, CAF_RADIUS_DEMO: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  const output = execFileSync("node", ["scripts/configure-radius-demo.cjs"], {
    input: JSON.stringify(cfg),
    encoding: "utf8",
  });
  assert(!output.includes(radiusToken));
  assert(!output.includes(readToken));
  const binding = await db.radiusDemoBinding.findUniqueOrThrow({
    where: { companyId: company.id },
  });
  assert(binding.tokenEncrypted.startsWith("enc:"));
  assert(!JSON.stringify(binding).includes(radiusToken));
  assert(!JSON.stringify(binding).includes(readToken));
  const config = await api(
    `/api/radius-demo/config?franchiseId=${franchise.id}`,
    "GET",
    undefined,
    staff,
  );
  assert.equal(config.data.enabled, true);
  const plans = await api(
    `/api/radius-demo/plans?franchiseId=${franchise.id}`,
    "GET",
    undefined,
    staff,
  );
  assert.equal(plans.status, 200);
  assert.equal(plans.data.items.length, 2);
  assert(!("price" in plans.data.items[0]));
  const plan = plans.data.items[0];
  assert.equal(
    (await api("/api/internal/radius-demo/run", "POST")).status,
    404,
  );
  assert.equal(
    (
      await api(
        "/api/integrations/radius/v1/companies",
        "GET",
        undefined,
        admin,
      )
    ).status,
    401,
  );
  let directory = await api(
    "/api/integrations/radius/v1/companies",
    "GET",
    undefined,
    undefined,
    readToken,
  );
  assert.equal(directory.status, 200);
  assert.equal(directory.data.items.length, 1);
  assert.equal(directory.data.items[0].id, company.id);
  assert.equal(
    (
      await api(
        "/api/integrations/radius/v1/companies/foreign/franchises",
        "GET",
        undefined,
        undefined,
        readToken,
      )
    ).status,
    404,
  );
  const other = await db.franchise.findFirstOrThrow({
    where: { company: { companyCode: "OTHERCAF" } },
  });
  assert.equal(
    (
      await api(
        `/api/radius-demo/plans?franchiseId=${other.id}`,
        "GET",
        undefined,
        staff,
      )
    ).status,
    404,
  );
  const input = {
    franchiseId: franchise.id,
    customerName: "Demo Fixture",
    mobile: "9876543210",
    addressLine1: "12 Demo Street",
    city: "Delhi",
    state: "Delhi",
    pincode: "110001",
    billingAddressLine1: "12 Demo Street",
    billingCity: "Delhi",
    billingState: "Delhi",
    billingPincode: "110001",
    idProofType: "PAN",
    idNumber: "ABCDE1234F",
    connectionType: "NEW",
    customerType: "RESIDENTIAL",
    declarationAccepted: true,
  };
  async function create(username, existingCustomerId) {
    const saved = await api(
      "/api/caf-drafts",
      "POST",
      { payload: { ...input, declarationAccepted: false } },
      staff,
    );
    assert.equal(saved.status, 201);
    const reserveBody = {
      draftId: saved.data.draft.id,
      draftVersion: saved.data.draft.version,
      planId: plan.plan_id,
      planVersion: plan.version,
      username,
      ...(existingCustomerId ? { existingCustomerId } : {}),
    };
    const reserved = await api(
      "/api/radius-demo/intents",
      "POST",
      reserveBody,
      staff,
    );
    assert.equal(reserved.status, 200, JSON.stringify(reserved.data));
    assert.equal(
      reserved.data.intent.customerId,
      existingCustomerId ?? saved.data.draft.customerId,
    );
    const renewal = await api(
      "/api/radius-demo/renew",
      "POST",
      { intentId: reserved.data.intent.id },
      staff,
    );
    assert.equal(renewal.status, 200, JSON.stringify(renewal.data));
    assert.equal(renewal.data.intent.id, reserved.data.intent.id);
    const repeated = await api(
      "/api/radius-demo/intents",
      "POST",
      reserveBody,
      staff,
    );
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.intent.id, reserved.data.intent.id);
    assert.equal(
      (
        await api(
          "/api/radius-demo/intents",
          "POST",
          { ...reserveBody, username: username + "changed" },
          staff,
        )
      ).status,
      409,
    );
    const d = repeated.data.draft;
    const result = await api(
      "/api/applications",
      "POST",
      multipart({
        ...input,
        draftId: d.id,
        draftVersion: d.version,
        radiusDemoIntentId: reserved.data.intent.id,
      }),
      staff,
    );
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const app = result.data.application;
    assert.equal(app.customerId, reserved.data.intent.customerId);
    assert.equal(app.broadbandUsername, username);
    assert.equal(
      await db.radiusDemoDelivery.count({ where: { applicationId: app.id } }),
      0,
    );
    await worker();
    assert.equal(
      (await fixture()).receipts.some((receipt) => receipt.service_request_id === reserved.data.intent.id),
      false,
      "No provisioning of this service before its approval",
    );
    return app;
  }
  const first = await create("demofixture54321");
  assert.equal(
    (
      await api(
        `/api/applications/${first.id}/status`,
        "PATCH",
        { action: "APPROVE" },
        staff,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        `/api/applications/${first.id}/status`,
        "PATCH",
        { action: "APPROVE" },
        admin,
      )
    ).status,
    200,
  );
  let job = await db.radiusDemoDelivery.findFirstOrThrow({
    where: { applicationId: first.id },
  });
  assert(job.secretEncrypted.startsWith("enc:"));
  assert.equal(job.credentialAccepted, false);
  assert(!JSON.stringify(job.approvalEvent).includes(input.idNumber));
  assert(!JSON.stringify(job.approvalEvent).includes(input.addressLine1));
  const approvalPath = `/api/integrations/radius/v1/customers/${first.customerId}/applications/${first.id}/approvals/1`;
  let approval = await api(
    approvalPath,
    "GET",
    undefined,
    undefined,
    readToken,
  );
  assert.equal(approval.status, 200);
  assert.equal(approval.data.approval_event.customer_id, first.customerId);
  const foreignPath = approvalPath.replace(first.customerId, "9999999999");
  assert.equal(
    (await api(foreignPath, "GET", undefined, undefined, readToken)).status,
    404,
  );
  await fixture({ loseNext: true });
  await worker();
  job = await db.radiusDemoDelivery.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(job.state, "RECONCILING");
  assert(job.secretEncrypted);
  const count = (await fixture()).postCount;
  await db.radiusDemoDelivery.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await worker();
  job = await db.radiusDemoDelivery.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(job.state, "STAGED");
  assert.equal(job.credentialAccepted, true);
  assert.equal(job.secretEncrypted, null);
  assert.equal(job.receiptVersion, 1);
  assert.equal(
    (await fixture()).postCount,
    count,
    "GET reconciliation must not reset password/repost",
  );
  const status = await api(
    `/api/radius-demo/status?applicationId=${first.id}`,
    "GET",
    undefined,
    staff,
  );
  assert.equal(status.data.state, "STAGED");
  assert.equal(status.data.networkActive, false);
  assert(!JSON.stringify(status.data).includes("secretEncrypted"));
  assert(!JSON.stringify(status.data).includes(radiusToken));
  assert.equal(
    (await api("/api/radius-demo/retry", "POST", { deliveryId: job.id }, admin))
      .status,
    409,
  );
  const second = await create("demoanother65432", first.customerId);
  assert.equal(
    (
      await api(
        `/api/applications/${second.id}/status`,
        "PATCH",
        { action: "APPROVE" },
        admin,
      )
    ).status,
    200,
  );
  await worker();
  const secondJob = await db.radiusDemoDelivery.findFirstOrThrow({
    where: { applicationId: second.id },
  });
  assert.equal(secondJob.state, "STAGED");
  assert.notEqual(secondJob.intentId, job.intentId);
  assert.equal(
    secondJob.approvalEvent.customer_version,
    job.approvalEvent.customer_version + 1,
  );
  assert.equal(
    (await api(approvalPath, "GET", undefined, undefined, readToken)).data
      .approval_event.event_id,
    job.eventId,
    "New connection must not invalidate older exact approval",
  );
  const master = await api(
    `/api/integrations/radius/v1/customers/${first.customerId}`,
    "GET",
    undefined,
    undefined,
    readToken,
  );
  assert.equal(
    master.data.customer_version,
    secondJob.approvalEvent.customer_version,
  );
  assert.equal(master.data.approved_profile.profile.name, input.customerName);
  const appsPath = `/api/integrations/radius/v1/customers/${first.customerId}/applications`;
  const page = await api(
    appsPath + "?limit=1",
    "GET",
    undefined,
    undefined,
    readToken,
  );
  assert.equal(page.data.has_more, true);
  const last = await api(
    appsPath + "?limit=1&cursor=" + encodeURIComponent(page.data.next_cursor),
    "GET",
    undefined,
    undefined,
    readToken,
  );
  assert.equal(last.data.has_more, false);
  assert.notEqual(
    page.data.items[0].application_id,
    last.data.items[0].application_id,
  );
  assert.equal(
    (
      await api(
        appsPath + "?cursor=" + encodeURIComponent(page.data.next_cursor + "x"),
        "GET",
        undefined,
        undefined,
        readToken,
      )
    ).status,
    400,
  );
  // Delayed older connection delivery remains eligible despite newer master profile.
  const third = await create("demodelayed76543", first.customerId);
  await api(
    `/api/applications/${third.id}/status`,
    "PATCH",
    { action: "APPROVE" },
    admin,
  );
  const delayed = await db.radiusDemoDelivery.findFirstOrThrow({
    where: { applicationId: third.id },
  });
  // Defer A before create() invokes the general worker while submitting B.
  await db.radiusDemoDelivery.update({
    where: { id: delayed.id },
    data: { nextAttemptAt: new Date(Date.now() + 60000) },
  });
  const fourth = await create("demonewer87654", first.customerId);
  await api(
    `/api/applications/${fourth.id}/status`,
    "PATCH",
    { action: "APPROVE" },
    admin,
  );
  await worker();
  const newer = await db.radiusDemoDelivery.findFirstOrThrow({ where: { applicationId: fourth.id } });
  assert.equal(newer.state, "STAGED", "Newer connection must be accepted first");
  assert.equal((await db.radiusDemoDelivery.findUniqueOrThrow({ where: { id: delayed.id } })).credentialAccepted, false);
  assert(newer.approvalEvent.customer_version > delayed.approvalEvent.customer_version);
  await db.radiusDemoDelivery.update({
    where: { id: delayed.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await worker();
  assert.equal(
    (
      await db.radiusDemoDelivery.findUniqueOrThrow({
        where: { id: delayed.id },
      })
    ).state,
    "STAGED",
  );
  // Secret expiry is purged even when there are no eligible jobs.
  await db.radiusDemoDelivery.update({
    where: { id: delayed.id },
    data: {
      secretEncrypted: "enc:expired-fixture",
      secretExpiresAt: new Date(0),
      credentialAccepted: false,
      state: "RECOVERY_REQUIRED",
    },
  });
  await worker();
  assert.equal(
    (
      await db.radiusDemoDelivery.findUniqueOrThrow({
        where: { id: delayed.id },
      })
    ).secretEncrypted,
    null,
  );
  // Revocation and expiry are rechecked on each scoped read.
  await db.radiusDemoBinding.update({
    where: { companyId: company.id },
    data: { active: false },
  });
  assert.equal(
    (await api(approvalPath, "GET", undefined, undefined, readToken)).status,
    401,
  );
  await db.radiusDemoBinding.update({
    where: { companyId: company.id },
    data: { active: true, inboundExpiresAt: new Date(0) },
  });
  assert.equal(
    (await api(approvalPath, "GET", undefined, undefined, readToken)).status,
    401,
  );
  await db.radiusDemoBinding.update({
    where: { companyId: company.id },
    data: { inboundExpiresAt: new Date(Date.now() + 86400000) },
  });
  const text = JSON.stringify(
    await db.auditLog.findMany({
      where: { action: { startsWith: "radius.demo" } },
    }),
  );
  assert(!text.includes(radiusToken));
  assert(!text.includes(readToken));
  require("node:fs").writeFileSync(
    "/tmp/caf-radius-demo-browser-fixture.json",
    JSON.stringify({
      companyId: company.id,
      franchiseId: franchise.id,
      applicationId: first.id,
      customerId: first.customerId,
      planId: plan.plan_id,
      username: input.customerName,
    }),
  );
  console.log(
    "PASS: actual CAF form submission, published plans, scoped reservation and exact-approval callback, approval-only delivery, lost-response GET recovery without password reset, durable staged receipt and ciphertext purge, lifetime ID across four connections, per-service ordering, signed pagination, token revocation/expiry and absolute credential deadline (synthetic Radius protocol fixture; not live Radius acceptance)",
  );
}
main()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
