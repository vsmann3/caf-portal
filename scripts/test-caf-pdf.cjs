// Disposable Docker fixture only; never use production accounts, documents or DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient, Prisma } = require("@prisma/client");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const sharp = require("sharp");
assert.equal(process.env.CAF_ISOLATED_TEST, "1");
assert.match(
  process.env.DATABASE_URL || "",
  /caf-settings-test-[^/]+-db:5432\/smoke/,
);
const db = new PrismaClient();
const base = "http://127.0.0.1:3000";
async function api(route, body, cookie) {
  const multipart = body instanceof FormData;
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
    redirect: "manual",
  });
  if (r.headers.get("content-type")?.includes("application/pdf"))
    return {
      status: r.status,
      headers: r.headers,
      bytes: Buffer.from(await r.arrayBuffer()),
    };
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
  };
}
async function login(email, password) {
  const r = await api("/api/auth/login", { email, password });
  assert.equal(r.status, 200);
  return r.cookie;
}
async function review(id, cookie) {
  const r = await fetch(base + `/api/applications/${id}/status`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "APPROVE" }),
  });
  assert.equal(r.status, 200, await r.text());
}
async function main() {
  const admin = await login(
    process.env.SEED_SUPER_ADMIN_EMAIL,
    process.env.SEED_SUPER_ADMIN_PASSWORD,
  );
  const own = await login(
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
  const companyAdmin = await login("admin@infolink.example", "ChangeMe@123");
  const franchises = await db.franchise.findMany();
  const f = franchises.find(
    (f) =>
      f.name !== "Second counter" &&
      f.companyId ===
        franchises.find((f) => f.name === "Second counter").companyId,
  );
  const allocated = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      api(
        "/api/caf-drafts",
        {
          payload: {
            franchiseId: franchises[i % franchises.length].id,
            customerName: "Concurrent customer " + i,
          },
        },
        admin,
      ),
    ),
  );
  for (const r of allocated)
    assert.equal(r.status, 201, JSON.stringify(r.data));
  const ids = allocated.map((r) => r.data.draft.customerId);
  assert(ids.every((id) => /^[1-9]\d{9}$/.test(id)));
  assert.equal(new Set(ids).size, 24);
  const draftResult = await api(
    "/api/caf-drafts",
    { payload: { franchiseId: f.id, customerName: "PDF customer" } },
    own,
  );
  assert.equal(draftResult.status, 201);
  const draft = draftResult.data.draft;
  assert.match(draft.customerId, /^[1-9]\d{9}$/);
  const edited = await api(
    "/api/caf-drafts",
    {
      id: draft.id,
      version: draft.version,
      payload: {
        franchiseId: f.id,
        customerName: "PDF customer updated",
        customerId: "9999999999",
      },
    },
    own,
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.data.draft.customerId, draft.customerId);
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const p = source.addPage([595, 842]);
    p.drawText("GST CERTIFICATE - PAGE " + i, {
      x: 50,
      y: 770,
      size: 23,
      font,
    });
    p.drawText("Reference GST-TEST-0001", { x: 50, y: 720, size: 14, font });
    p.drawRectangle({
      x: 50,
      y: 100,
      width: 490,
      height: 500,
      color: require("pdf-lib").rgb(0.92, 0.96, 0.99),
    });
  }
  const png = await sharp({
    create: { width: 1100, height: 700, channels: 3, background: "#e4edf6" },
  })
    .png()
    .toBuffer();
  const jpg = await sharp({
    create: { width: 500, height: 700, channels: 3, background: "#b7d9cc" },
  })
    .jpeg()
    .toBuffer();
  const webp = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#faf0d3" },
  })
    .webp()
    .toBuffer();
  const gst = await source.save();
  const input = {
    franchiseId: f.id,
    customerId: "9999999999",
    customerName: "राहुल शर्मा",
    fatherName: "Ramesh Sharma",
    mobile: "9876512345",
    email: "customer@example.test",
    addressLine1:
      "Apartment 403, Building C, Customer Application Evidence Estate, Long Street Name, Near the Main Community Centre",
    addressLine2:
      "Second landmark and a very long address continuation for layout testing. ".repeat(
        3,
      ),
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    billingAddressLine1:
      "Registered billing office, Business Park, Second Avenue",
    billingCity: "Mumbai",
    billingState: "Maharashtra",
    billingPincode: "400001",
    idProofType: "PAN",
    idNumber: "ABCDE1234F",
    connectionType: "NEW",
    customerType: "COMMERCIAL",
    businessName: "Example Broadband Customer Private Limited",
    gstNumber: "27ABCDE1234F1Z5",
    planName: "Business 300",
    bandwidth: "300 Mbps",
    remarks: "Long remarks for wrapping and pagination. ".repeat(20),
    declarationAccepted: true,
    draftId: draft.id,
    draftVersion: edited.data.draft.version,
  };
  const documents = [
    ["PASSPORT_PHOTO", "photo.jpg", "image/jpeg", jpg],
    ["ID_PROOF", "identity.png", "image/png", png],
    ["ADDRESS_PROOF", "address.webp", "image/webp", webp],
    ["GST_CERTIFICATE", "gst-certificate.pdf", "application/pdf", gst],
  ];
  function form(data, docs = documents) {
    const fd = new FormData();
    fd.append("data", JSON.stringify(data));
    for (const [category, name, mime, bytes] of docs) {
      fd.append("files", new Blob([bytes], { type: mime }), name);
      fd.append("docType", category);
    }
    return fd;
  }
  const created = await api("/api/applications", form(input), own);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const app = created.data.application;
  assert.equal(app.customerId, draft.customerId);
  assert.notEqual(app.customerId, input.customerId);
  assert.equal(await db.cafDraft.count({ where: { id: draft.id } }), 0);
  assert.equal((await api(`/api/applications/${app.id}/pdf`)).status, 401);
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, own)).status,
    409,
  );
  const before = await api(`/customers/${app.id}`, undefined, own);
  assert.equal(before.status, 200);
  assert(!before.data.includes("Download CAF + documents PDF"));
  await review(app.id, admin);
  const approved = await db.customerApplication.findUniqueOrThrow({
    where: { id: app.id },
    include: { documents: true },
  });
  assert.equal(approved.approvedSnapshot.customerId, app.customerId);
  assert(
    approved.approvedSnapshot.documents.every((d) =>
      /^[a-f0-9]{64}$/.test(d.sha256),
    ),
  );
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, second)).status,
    404,
  );
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, foreign)).status,
    404,
  );
  await db.customerApplication.update({
    where: { id: app.id },
    data: { customerName: "CHANGED LIVE DATA MUST NOT EXPORT" },
  });
  let exported = await api(`/api/applications/${app.id}/pdf`, undefined, own);
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.match(
    exported.headers.get("content-disposition"),
    new RegExp(app.customerId),
  );
  assert.equal(exported.headers.get("cache-control"), "private, no-store");
  assert.equal(exported.bytes.subarray(0, 5).toString(), "%PDF-");
  const parsed = await PDFDocument.load(exported.bytes);
  assert(parsed.getPageCount() >= 8);
  assert(parsed.getTitle().includes(app.customerId));
  fs.writeFileSync("/tmp/caf-export-sample.pdf", exported.bytes);
  fs.writeFileSync(
    "/tmp/caf-export-sample.json",
    JSON.stringify({
      id: app.id,
      customerId: app.customerId,
      pages: parsed.getPageCount(),
    }),
  );
  for (const cookie of [admin, companyAdmin])
    assert.equal(
      (await api(`/api/applications/${app.id}/pdf`, undefined, cookie)).status,
      200,
    );
  const ui = await api(`/customers/${app.id}`, undefined, own);
  assert(ui.data.includes("Download CAF + documents PDF"));
  assert(ui.data.includes(app.customerId));
  const doc = approved.documents.find((d) => d.documentType === "ID_PROOF");
  const root = path.resolve(process.env.LOCAL_STORAGE_PATH || "/app/storage");
  const file = path.resolve(root, doc.storageKey);
  assert(file.startsWith(root + path.sep));
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.from("changed-test-file"));
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, own)).status,
    422,
  );
  fs.writeFileSync(file, original);
  fs.renameSync(file, file + ".fixture");
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, own)).status,
    422,
  );
  fs.renameSync(file + ".fixture", file);
  await db.customerApplication.update({
    where: { id: app.id },
    data: {
      approvedSnapshot: {
        ...approved.approvedSnapshot,
        documents: approved.approvedSnapshot.documents.map((d) =>
          d.id === doc.id ? { ...d, sha256: null } : d,
        ),
      },
    },
  });
  fs.writeFileSync(file, Buffer.from("corrupt-test-image"));
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, own)).status,
    422,
  );
  fs.writeFileSync(file, original);
  await db.customerApplication.update({
    where: { id: app.id },
    data: { approvedSnapshot: approved.approvedSnapshot },
  });
  assert.equal(
    (await api(`/api/applications/${app.id}/pdf`, undefined, own)).status,
    200,
  );
  const legacy = await api(
    "/api/applications",
    form({
      ...input,
      draftId: undefined,
      draftVersion: undefined,
      customerName: "Legacy approved customer",
    }),
    own,
  );
  assert.equal(legacy.status, 201);
  await db.customerApplication.update({
    where: { id: legacy.data.application.id },
    data: { connectionAddress: "Historical additional address retained in export" },
  });
  await review(legacy.data.application.id, admin);
  await db.customerApplication.update({
    where: { id: legacy.data.application.id },
    data: { approvedSnapshot: Prisma.DbNull },
  });
  assert.equal(
    (
      await api(
        `/api/applications/${legacy.data.application.id}/pdf`,
        undefined,
        own,
      )
    ).status,
    200,
  );
  assert(
    (
      await db.customerApplication.findUniqueOrThrow({
        where: { id: legacy.data.application.id },
      })
    ).approvedSnapshot.legacySnapshot,
  );
  const union =
    await db.$queryRaw`SELECT "customerId",COUNT(*) FROM (SELECT "customerId" FROM "CustomerApplication" UNION ALL SELECT "customerId" FROM "CafDraft") ids GROUP BY "customerId" HAVING COUNT(*)>1`;
  assert.equal(union.length, 0);
  await assert.rejects(
    db.customerNumber.create({ data: { id: app.customerId } }),
    (e) => e.code === "P2002",
  );
  await assert.rejects(db.customerNumber.create({ data: { id: "123" } }));
  assert(
    await db.auditLog.count({
      where: { entityId: app.id, action: "caf.pdf.download" },
    }),
  );
  console.log(
    "PASS: global concurrent 10-digit IDs, draft transfer, client override rejection, approved-only scoped PDF, frozen snapshot, PNG/JPEG/WebP/multipage PDF evidence, integrity/missing/corrupt file failures, legacy approved exports and audit.",
  );
  console.log(
    "PDF fixture pages: " +
      parsed.getPageCount() +
      "; sample saved under /tmp for visual QA.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
