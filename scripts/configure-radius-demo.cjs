// Isolated-demo administrative tool. Read JSON from stdin; never print credentials.
const fs = require("node:fs");
const {
  randomBytes,
  scryptSync,
  createCipheriv,
  createHash,
} = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
async function main() {
  const url = new URL(process.env.DATABASE_URL || "invalid:");
  const fixture =
    process.env.CAF_ISOLATED_TEST === "1" &&
    url.pathname === "/smoke" &&
    /^caf-settings-test-.*-db$/.test(url.hostname);
  if (
    process.env.CAF_RADIUS_DEMO !== "1" ||
    (!/^\/caf_demo_[a-z0-9_]+$/.test(url.pathname) && !fixture)
  )
    throw new Error("Isolated demo database and explicit opt-in required");
  const raw = fs.readFileSync(0, "utf8");
  if (raw.length > 20000) throw new Error("Configuration too large");
  const c = JSON.parse(raw);
  if (
    !c ||
    typeof c !== "object" ||
    !c.companyId ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(c.sourceId) ||
    !/^[1-9][0-9]{4,}$/.test(c.radiusCompanyId)
  )
    throw new Error("Invalid binding");
  if (
    ![c.radiusToken, c.cafReadToken].every(
      (v) => typeof v === "string" && /^[A-Za-z0-9_.-]{32,256}$/.test(v),
    )
  )
    throw new Error("Dedicated high-entropy service tokens required");
  const origin = new URL(c.baseUrl);
  const internal =
    process.env.CAF_RADIUS_DEMO_ALLOW_HTTP === "1" &&
    origin.protocol === "http:" &&
    /^(radius-demo|127\.0\.0\.1|localhost)$/.test(origin.hostname);
  if (
    (!internal && origin.protocol !== "https:") ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("A trusted demo HTTPS origin is required");
  const company = await db.company.findFirst({
    where: { id: c.companyId, isActive: true },
  });
  if (!company) throw new Error("Active test company not found");
  const maps = c.franchiseMappings;
  if (
    !maps ||
    typeof maps !== "object" ||
    Array.isArray(maps) ||
    !Object.keys(maps).length
  )
    throw new Error("Explicit franchise mappings required");
  for (const [id, remote] of Object.entries(maps)) {
    if (
      !/^[1-9][0-9]{4,}$/.test(remote) ||
      !(await db.franchise.findFirst({
        where: { id, companyId: company.id, isActive: true },
      }))
    )
      throw new Error("Invalid franchise binding");
  }
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET required");
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      scryptSync(process.env.AUTH_SECRET, "caf-portal-storage", 32),
      iv,
    );
  const encrypted = Buffer.concat([
    cipher.update(c.radiusToken, "utf8"),
    cipher.final(),
  ]);
  const data = {
    sourceId: c.sourceId,
    baseUrl: origin.origin,
    radiusCompanyId: c.radiusCompanyId,
    tokenEncrypted: `enc:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`,
    inboundTokenDigest: createHash("sha256")
      .update(c.cafReadToken)
      .digest("hex"),
    inboundExpiresAt: new Date(Date.now() + 30 * 86400000),
    franchiseMappings: maps,
    active: true,
  };
  await db.$transaction(async (tx) => {
    await tx.radiusDemoBinding.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        actorEmail: "isolated-demo-setup",
        action: "radius.demo.configure",
        entity: "Company",
        entityId: company.id,
        meta: { sourceId: c.sourceId, isolated: true },
      },
    });
  });
  console.log(
    JSON.stringify({
      configured: true,
      companyId: company.id,
      sourceId: c.sourceId,
      mode: "ISOLATED_STAGE_ONLY",
    }),
  );
}
main()
  .catch(() => {
    console.error(
      "Demo configuration failed; verify protected input and isolated database",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
