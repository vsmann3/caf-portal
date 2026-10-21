// Run only inside the temporary Docker integration fixture.
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
assert.equal(process.env.CAF_ISOLATED_TEST, "1");
assert.match(
  process.env.DATABASE_URL || "",
  /caf-settings-test-[^/]+-db:5432\/smoke/,
);
const db = new PrismaClient();
const base = "http://127.0.0.1:3000";
async function api(path, method = "GET", data, cookie) {
  const multipart = data instanceof FormData;
  const r = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(!multipart && data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? (multipart ? data : JSON.stringify(data)) : undefined,
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
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(email, password) {
  const r = await api("/api/auth/login", "POST", { email, password });
  assert.equal(r.status, 200);
  return r.cookie;
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=",
  "base64",
);
function multipart(
  data,
  categories = ["PASSPORT_PHOTO", "ID_PROOF", "ADDRESS_PROOF"],
  bytes = png,
) {
  const f = new FormData();
  f.append("data", JSON.stringify(data));
  for (const c of categories) {
    f.append("files", new Blob([bytes], { type: "image/png" }), c + ".png");
    f.append("docType", c);
  }
  return f;
}
async function main() {
  const admin = await login(
    process.env.SEED_SUPER_ADMIN_EMAIL,
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const company = await db.company.findUniqueOrThrow({
    where: { companyCode: "INFOBB2548" },
  });
  const f1 = await db.franchise.findFirstOrThrow({
    where: { companyId: company.id },
  });
  const f2 = await db.franchise.create({
    data: { companyId: company.id, name: "Second counter", code: "COUNTER2" },
  });
  const other = await db.company.create({
    data: { name: "Other company", companyCode: "OTHERCAF" },
  });
  const f3 = await db.franchise.create({
    data: { companyId: other.id, name: "Other counter", code: "OTHER1" },
  });
  const seedUser = await db.user.findUniqueOrThrow({
    where: { email: process.env.SEED_SUPER_ADMIN_EMAIL },
  });
  for (const [email, franchise] of [
    ["counter1@example.test", f1],
    ["counter2@example.test", f2],
    ["othercounter@example.test", f3],
  ])
    await db.user.create({
      data: {
        email,
        name: email,
        passwordHash: seedUser.passwordHash,
        role: "FRANCHISE_USER",
        companyId: franchise.companyId,
        franchiseId: franchise.id,
      },
    });
  const user = await login(
    "counter1@example.test",
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const second = await login(
    "counter2@example.test",
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const foreign = await login(
    "othercounter@example.test",
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const data = {
    franchiseId: f1.id,
    customerName: "Rahul Sharma",
    mobile: "9876543210",
    addressLine1: "12 Test Street",
    city: "Delhi",
    state: "Delhi",
    pincode: "110001",
    billingAddressLine1: "20 Billing Street",
    billingCity: "Mumbai",
    billingState: "Maharashtra",
    billingPincode: "400001",
    idProofType: "PAN",
    idNumber: "ABCDE1234F",
    connectionType: "NEW",
    customerType: "RESIDENTIAL",
    declarationAccepted: true,
  };
  assert.equal((await api("/api/addresses")).status, 401);
  let states = await api("/api/addresses", "GET", undefined, user);
  assert.equal(states.status, 200);
  assert.equal(states.body.states.length, 36);
  let cities = await api(
    "/api/addresses?state=Maharashtra",
    "GET",
    undefined,
    user,
  );
  assert(cities.body.cities.includes("Mumbai"));
  assert.equal(
    (await api("/api/addresses?pin=bad", "GET", undefined, user)).status,
    400,
  );
  const livePin = await api(
    "/api/addresses?pin=110001",
    "GET",
    undefined,
    user,
  );
  assert([200, 502].includes(livePin.status));
  if (livePin.status === 200)
    assert(livePin.body.locations.some((l) => l.state === "Delhi"));
  console.log(
    `Live postal lookup: HTTP ${livePin.status}${livePin.status === 502 ? " (manual fallback available)" : ""}`,
  );
  assert.equal(
    (
      await api(
        "/api/applications/username",
        "POST",
        { franchiseId: f3.id, name: data.customerName, mobile: data.mobile },
        user,
      )
    ).status,
    404,
  );
  let suggestion = await api(
    "/api/applications/username",
    "POST",
    { franchiseId: f1.id, name: data.customerName, mobile: data.mobile },
    user,
  );
  assert.equal(suggestion.body.username, "rahul43210");
  assert.equal(
    (await api("/api/applications", "POST", multipart(data, []), user)).status,
    400,
  );
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart({ ...data, billingCity: "" }),
        user,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart({ ...data, declarationAccepted: false }),
        user,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart({ ...data, franchiseId: f3.id }),
        user,
      )
    ).status,
    404,
  );
  const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1);
  png.copy(tooLarge);
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart(data, ["ID_PROOF"], tooLarge),
        user,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart(data, ["ID_PROOF"], Buffer.from("not a PNG")),
        user,
      )
    ).status,
    400,
  );
  let result = await api("/api/applications", "POST", multipart(data), user);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const first = result.body.application;
  assert.equal(first.broadbandUsername, "rahul43210");
  assert.equal(first.billingCity, "Mumbai");
  const doc = await db.document.findFirstOrThrow({
    where: { applicationId: first.id },
  });
  assert.equal(
    (await api("/api/documents/" + doc.id, "GET", undefined, user)).status,
    200,
  );
  assert.equal(
    (await api("/api/documents/" + doc.id, "GET", undefined, second)).status,
    403,
  );
  const concurrent = await Promise.all([
    api(
      "/api/applications",
      "POST",
      multipart({ ...data, franchiseId: f2.id }),
      second,
    ),
    api(
      "/api/applications",
      "POST",
      multipart({ ...data, franchiseId: f2.id }),
      second,
    ),
  ]);
  for (const r of concurrent)
    assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(
    concurrent.map((r) => r.body.application.broadbandUsername).sort(),
    ["rahul543210", "rahul6543210"].sort(),
  );
  result = await api(
    "/api/applications",
    "POST",
    multipart({ ...data, franchiseId: f3.id }),
    foreign,
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.application.broadbandUsername, "rahul43210");
  console.log(
    "PASS: company-scoped username preview/allocation, cross-franchise concurrency, cross-company reuse, tenant access, billing fields, required evidence, content and 4 MB limits.",
  );
  const legacyInput = { ...data, customerName: "Legacy Tester" };
  const legacy = await api(
    "/api/applications",
    "POST",
    multipart(legacyInput),
    user,
  );
  assert.equal(legacy.status, 201);
  await db.customerApplication.update({
    where: { id: legacy.body.application.id },
    data: { broadbandUsername: " LEGACY43210 " },
  });
  const legacySuggestion = await api(
    "/api/applications/username",
    "POST",
    { franchiseId: f1.id, name: legacyInput.customerName, mobile: data.mobile },
    user,
  );
  assert.equal(legacySuggestion.body.username, "legacy543210");
  const nextLegacy = await api(
    "/api/applications",
    "POST",
    multipart(legacyInput),
    user,
  );
  assert.equal(nextLegacy.status, 201);
  assert.equal(nextLegacy.body.application.broadbandUsername, "legacy543210");
  await assert.rejects(
    db.customerApplication.update({
      where: { id: nextLegacy.body.application.id },
      data: { broadbandUsername: "legacy43210" },
    }),
    (e) => e.code === "P2002",
  );
  const fs = require("node:fs");
  const path = require("node:path");
  const oldBytes = Buffer.alloc(5 * 1024 * 1024);
  png.copy(oldBytes);
  const storage = process.env.LOCAL_STORAGE_PATH || "/app/storage";
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(path.join(storage, "legacy-large.png"), oldBytes);
  const oldDoc = await db.document.create({
    data: {
      applicationId: legacy.body.application.id,
      documentType: "OTHER",
      originalName: "legacy-large.png",
      mimeType: "image/png",
      sizeBytes: oldBytes.length,
      storageProvider: "local",
      storageKey: "legacy-large.png",
    },
  });
  const oldDownload = await fetch(base + "/api/documents/" + oldDoc.id, {
    headers: { Cookie: user },
  });
  assert.equal(oldDownload.status, 200);
  assert.equal((await oldDownload.arrayBuffer()).byteLength, oldBytes.length);
  console.log(
    "PASS: normalised legacy username collisions, database uniqueness constraint and existing 5 MB document download.",
  );
  const business = {
    ...data,
    customerType: "COMMERCIAL",
    businessName: "CAF Test Business",
    gstNumber: "27ABCDE1234F1Z5",
  };
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart({ ...business, gstNumber: "" }),
        user,
      )
    ).status,
    400,
  );
  assert.equal(
    (await api("/api/applications", "POST", multipart(business), user)).status,
    400,
  );
  const boundary = Buffer.alloc(4 * 1024 * 1024);
  png.copy(boundary);
  result = await api(
    "/api/applications",
    "POST",
    multipart(
      business,
      ["PASSPORT_PHOTO", "ID_PROOF", "ADDRESS_PROOF", "GST_CERTIFICATE"],
      boundary,
    ),
    user,
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.application.gstNumber, business.gstNumber);
  console.log(
    "PASS: business name/GST/certificate requirements, 4 MB inclusive boundary.",
  );
  let draftResult = await api(
    "/api/caf-drafts",
    "POST",
    { payload: { franchiseId: f1.id, customerName: "Partial customer" } },
    user,
  );
  assert.equal(draftResult.status, 201);
  let draft = draftResult.body.draft;
  assert.equal(
    (
      await api(
        "/api/caf-drafts",
        "POST",
        {
          id: draft.id,
          version: draft.version,
          payload: { franchiseId: f2.id, customerName: "Intruder" },
        },
        second,
      )
    ).status,
    409,
  );
  let saved = await api(
    "/api/caf-drafts",
    "POST",
    {
      id: draft.id,
      version: draft.version,
      payload: { franchiseId: f1.id, customerName: "Edited customer" },
    },
    user,
  );
  assert.equal(saved.status, 200);
  assert.equal(
    (
      await api(
        "/api/caf-drafts",
        "POST",
        {
          id: draft.id,
          version: draft.version,
          payload: { franchiseId: f1.id, customerName: "Stale tab" },
        },
        user,
      )
    ).status,
    409,
  );
  draft = saved.body.draft;
  assert(
    (await api("/api/caf-drafts", "GET", undefined, user)).body.drafts.some(
      (d) => d.id === draft.id,
    ),
  );
  assert(
    !(await api("/api/caf-drafts", "GET", undefined, foreign)).body.drafts.some(
      (d) => d.id === draft.id,
    ),
  );
  result = await api(
    "/api/applications",
    "POST",
    multipart({ ...data, draftId: draft.id, draftVersion: draft.version }),
    user,
  );
  assert.equal(result.status, 201);
  assert.equal(await db.cafDraft.count({ where: { id: draft.id } }), 0);
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart({ ...data, draftId: draft.id, draftVersion: draft.version }),
        user,
      )
    ).status,
    409,
  );
  console.log(
    "PASS: partial server drafts, owner isolation, optimistic version conflict, transactional draft consumption and duplicate submit prevention.",
  );
  assert.equal(
    (
      await api(
        `/api/applications/${first.id}/status`,
        "PATCH",
        { action: "APPROVE" },
        user,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        `/api/applications/${first.id}/status`,
        "PATCH",
        { action: "REJECT", rejectionReason: "Please correct address" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(`/customers/${first.id}/edit`, "GET", undefined, user)).status,
    200,
  );
  result = await api(
    "/api/applications",
    "POST",
    multipart(
      {
        ...data,
        applicationId: first.id,
        revision: 1,
        customerName: "Rahul Corrected",
      },
      [],
    ),
    user,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.application.revision, 2);
  assert.equal(result.body.application.customerId, first.customerId);
  assert.equal(
    result.body.application.broadbandUsername,
    first.broadbandUsername,
  );
  assert.equal(
    await db.document.count({ where: { applicationId: first.id } }),
    3,
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: first.id, action: "caf.correction.previous" },
    }),
    1,
  );
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart({ ...data, applicationId: first.id, revision: 1 }, []),
        user,
      )
    ).status,
    409,
  );
  const reviews = await Promise.all([
    api(
      `/api/applications/${first.id}/status`,
      "PATCH",
      { action: "APPROVE" },
      admin,
    ),
    api(
      `/api/applications/${first.id}/status`,
      "PATCH",
      { action: "REJECT", rejectionReason: "Concurrent review" },
      admin,
    ),
  ]);
  assert.equal(reviews.filter((r) => r.status === 200).length, 1);
  let approved = await db.customerApplication.findUniqueOrThrow({
    where: { id: first.id },
  });
  if (approved.status === "REJECTED") {
    await api(
      "/api/applications",
      "POST",
      multipart({ ...data, applicationId: first.id, revision: 2 }, []),
      user,
    );
    await api(
      `/api/applications/${first.id}/status`,
      "PATCH",
      { action: "APPROVE" },
      admin,
    );
  }
  approved = await db.customerApplication.findUniqueOrThrow({
    where: { id: first.id },
  });
  assert.equal(approved.status, "APPROVED");
  assert(approved.approvedSnapshot);
  assert.equal(approved.approvedSnapshot.documents.length, 3);
  assert.equal(
    (
      await api(
        "/api/applications",
        "POST",
        multipart(
          { ...data, applicationId: first.id, revision: approved.revision },
          [],
        ),
        user,
      )
    ).status,
    409,
  );
  const html = await api("/caf/new", "GET", undefined, user);
  assert.equal(html.status, 200);
  assert.match(html.body, /New eCAF application/);
  assert.match(html.body, /Save draft/);
  assert.match(html.body, /maximum 4 MB/);
  assert.equal(
    (await api("/customers/" + first.id, "GET", undefined, user)).status,
    200,
  );
  console.log(
    "PASS: rejection/correction/resubmission, stable username, retained evidence/history, concurrent review protection, immutable approval snapshot and rendered CAF/detail HTTP 200.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
