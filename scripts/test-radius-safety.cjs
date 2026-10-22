// Disposable Docker fixture only. No production DB, documents or credentials.
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { scryptSync, createDecipheriv } = require("node:crypto");
assert.equal(process.env.CAF_ISOLATED_TEST, "1");
assert.match(
  process.env.DATABASE_URL || "",
  /caf-settings-test-[^/]+-db:5432\/smoke/,
);
const db = new PrismaClient();
const route = "/api/settings/radius";
const key = "radius.config";
async function api(path, method = "GET", data, cookie) {
  const r = await fetch("http://127.0.0.1:3000" + path, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: r.status,
    body,
    headers: r.headers,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(email, password) {
  const r = await api("/api/auth/login", "POST", { email, password });
  assert.equal(r.status, 200);
  return r.cookie;
}
async function stored() {
  return (await db.systemSetting.findUniqueOrThrow({ where: { key } })).value;
}
function decrypt(value) {
  const [prefix, iv, tag, data] = value.split(":");
  assert.equal(prefix, "enc");
  const d = createDecipheriv(
    "aes-256-gcm",
    scryptSync(process.env.AUTH_SECRET, "caf-portal-storage", 32),
    Buffer.from(iv, "hex"),
  );
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    d.update(Buffer.from(data, "hex")),
    d.final(),
  ]).toString();
}
function redacted(result, secrets) {
  const text = JSON.stringify(result.body);
  for (const value of secrets)
    assert(!text.includes(value), "Secret appeared in HTTP response");
  assert(!("apiKey" in result.body.radius));
  assert(!("apiKeyEncrypted" in result.body.radius));
  assert.equal(result.headers.get("cache-control"), "no-store");
}
async function main() {
  const admin = await login(
    process.env.SEED_SUPER_ADMIN_EMAIL,
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const companyAdmin = await login("admin@infolink.example", "ChangeMe@123");
  const counter = await login(
    "counter1@example.test",
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  for (const [cookie, status] of [
    [undefined, 401],
    [companyAdmin, 403],
    [counter, 403],
  ]) {
    for (const method of ["GET", "PUT"])
      assert.equal(
        (await api(route, method, method === "PUT" ? {} : undefined, cookie))
          .status,
        status,
      );
  }
  const legacy = "canary-legacy-radius-token";
  await db.systemSetting.upsert({
    where: { key },
    create: {
      key,
      value: {
        enabled: true,
        provider: "custom",
        apiKey: legacy,
        unexpected: "private-legacy-field",
      },
    },
    update: {
      value: {
        enabled: true,
        provider: "custom",
        apiKey: legacy,
        unexpected: "private-legacy-field",
      },
    },
  });
  const initial = await api(route, "GET", undefined, admin);
  redacted(initial, [legacy, "private-legacy-field"]);
  assert.equal(initial.body.radius.apiKeyConfigured, true);
  assert.equal(
    (await stored()).apiKey,
    legacy,
    "GET must not mutate legacy data",
  );
  assert.equal(
    (
      await api(
        route,
        "PUT",
        { apiKey: "", baseUrl: "https://radius.example.test/api" },
        admin,
      )
    ).status,
    200,
  );
  let encrypted = (await stored()).apiKeyEncrypted;
  assert.equal(decrypt(encrypted), legacy);
  assert(!JSON.stringify(await stored()).includes(legacy));
  assert.equal((await stored()).unexpected, undefined);
  const next = "canary-replacement-radius-token";
  const saved = await api(route, "PUT", { apiKey: next, enabled: true }, admin);
  assert.equal(saved.status, 200);
  redacted(saved, [next, legacy]);
  assert.equal(saved.body.radius.runtimeStatus, "NOT_IMPLEMENTED");
  encrypted = (await stored()).apiKeyEncrypted;
  assert.equal(decrypt(encrypted), next);
  redacted(await api(route, "GET", undefined, admin), [next, encrypted]);
  await Promise.all([
    api(route, "PUT", { provider: "jazznetwork", apiKey: "" }, admin),
    api(route, "PUT", { authHeader: "X-API-Key" }, admin),
  ]).then((results) => results.forEach((r) => assert.equal(r.status, 200)));
  assert.equal((await stored()).provider, "jazznetwork");
  assert.equal((await stored()).authHeader, "X-API-Key");
  assert.equal((await stored()).apiKeyEncrypted, encrypted);
  for (const input of [
    [],
    { enabled: "true" },
    { provider: "unknown" },
    { apiKey: next, clearApiKey: true },
    { apiKey: encrypted },
    { arbitrary: next },
    { timeoutMs: 0 },
    { authHeader: "Authorization\r\nX-Evil" },
    { baseUrl: "https://user:password@example.test" },
    { baseUrl: "https://example.test?token=secret" },
    { baseUrl: "http://example.test" },
  ]) {
    assert.equal((await api(route, "PUT", input, admin)).status, 400);
    assert.equal((await stored()).apiKeyEncrypted, encrypted);
  }
  console.log(
    "PASS: RADIUS role guards, redacted no-store responses, encrypted legacy migration/replacement, blank preservation, concurrent updates and strict validation",
  );

  const template = await db.customerApplication.findFirstOrThrow({
    where: { status: "APPROVED" },
  });
  async function application() {
    const customer = await db.customerNumber.create({ data: {} });
    const data = {
      ...template,
      id: undefined,
      customerId: customer.id,
      cafNumber: "RADIUS-" + customer.id,
      broadbandUsername: "radius" + customer.id,
      status: "SUBMITTED",
      approvedSnapshot: undefined,
      reviewedAt: null,
      reviewedById: null,
      rejectionReason: null,
      revision: 1,
      customerName: "Private profile canary",
      idNumber: "PROOF-CANARY-123",
      mobile: "9876543210",
      email: "private@example.test",
      addressLine1: "Private Address Canary",
    };
    return db.customerApplication.create({ data });
  }
  async function review(app, cookie = admin) {
    return api(
      `/api/applications/${app.id}/status`,
      "PATCH",
      { action: "APPROVE" },
      cookie,
    );
  }
  const owner = await db.company.findUniqueOrThrow({
    where: { companyCode: "INFOBB2548" },
  });
  const other = await db.company.findUniqueOrThrow({
    where: { companyCode: "OTHERCAF" },
  });
  const otherFranchise = await db.franchise.findFirstOrThrow({
    where: { companyId: other.id },
  });
  const seed = await db.user.findUniqueOrThrow({
    where: { email: process.env.SEED_SUPER_ADMIN_EMAIL },
  });
  await db.user.create({
    data: {
      name: "Unbound company admin",
      email: "unbound-radius-admin@example.test",
      passwordHash: seed.passwordHash,
      role: "COMPANY_ADMIN",
    },
  });
  const unbound = await login(
    "unbound-radius-admin@example.test",
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const foreign = await application();
  await db.customerApplication.update({
    where: { id: foreign.id },
    data: { companyId: other.id, franchiseId: otherFranchise.id },
  });
  assert.equal((await review(foreign, companyAdmin)).status, 404);
  assert.equal((await review(foreign, unbound)).status, 404);
  assert.equal(
    (
      await db.customerApplication.findUniqueOrThrow({
        where: { id: foreign.id },
      })
    ).status,
    "SUBMITTED",
  );
  const own = await application();
  const ownFranchise = await db.franchise.findFirstOrThrow({
    where: { companyId: owner.id },
  });
  await db.customerApplication.update({
    where: { id: own.id },
    data: { companyId: owner.id, franchiseId: ownFranchise.id },
  });
  assert.equal((await review(own, companyAdmin)).status, 200);
  for (const enabled of [false, true]) {
    assert.equal((await api(route, "PUT", { enabled }, admin)).status, 200);
    const app = await application();
    assert.equal((await review(app, counter)).status, 403);
    const results = await Promise.all([review(app), review(app)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const rows = await db.radiusSync.findMany({
      where: { applicationId: app.id },
    });
    assert.equal(rows.length, 1);
    const sync = rows[0];
    assert.equal(sync.status, "FAILED");
    assert.equal(sync.attempts, 0);
    assert.equal(sync.lastAttemptAt, null);
    assert.equal(sync.completedAt, null);
    assert.deepEqual(sync.responsePayload, {
      code: enabled ? "RADIUS_NOT_IMPLEMENTED" : "RADIUS_DISABLED",
      attempted: false,
    });
    assert.deepEqual(sync.requestPayload, {
      format: "caf-radius-local-reference-v1",
      customer_id: app.customerId,
      company_id: app.companyId,
      franchise_id: app.franchiseId,
      caf: {
        application_id: app.id,
        number: app.cafNumber,
        revision: 1,
        status: "APPROVED",
      },
    });
    const approved = await db.customerApplication.findUniqueOrThrow({
      where: { id: app.id },
    });
    assert.equal(
      approved.approvedSnapshot.idNumber,
      app.idNumber,
      "CAF approval snapshot must retain KYC data",
    );
  }
  // Force an insert failure only in this disposable DB to prove approval rollback.
  const rollback = await application();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION radius_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture sync insert failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER radius_fixture_fail BEFORE INSERT ON "RadiusSync" FOR EACH ROW EXECUTE FUNCTION radius_fixture_fail()`,
  );
  try {
    assert.equal((await review(rollback)).status, 500);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER radius_fixture_fail ON "RadiusSync"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION radius_fixture_fail()`);
  }
  const unchanged = await db.customerApplication.findUniqueOrThrow({
    where: { id: rollback.id },
  });
  assert.equal(unchanged.status, "SUBMITTED");
  assert.equal(unchanged.approvedSnapshot, null);
  assert.equal(
    await db.radiusSync.count({ where: { applicationId: rollback.id } }),
    0,
  );
  assert.equal(
    await db.auditLog.count({ where: { action: "radius.sync.success" } }),
    0,
  );
  const audits = JSON.stringify(
    await db.auditLog.findMany({ where: { action: "settings.radius.update" } }),
  );
  assert(!audits.includes(legacy));
  assert(!audits.includes(next));
  assert(!audits.includes(encrypted));
  assert.equal(
    (await api(route, "PUT", { clearApiKey: true }, admin)).body.radius
      .apiKeyConfigured,
    false,
  );
  assert.equal((await stored()).apiKeyEncrypted, undefined);
  console.log(
    "PASS: disabled/enabled both block delivery, exact minimal references, one record under concurrent approval, intact CAF KYC snapshot, rollback on sync failure, no fake-success audit, secret-free audit and explicit token removal",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
