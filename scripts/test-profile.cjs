// Isolated SMTP capture fixture only. Never connect to production.
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
assert.equal(process.env.CAF_ISOLATED_TEST, "1");
assert.match(
  process.env.DATABASE_URL || "",
  /caf-settings-test-[^/]+-db:5432\/smoke/,
);
const db = new PrismaClient();
const base = "http://127.0.0.1:3000";
const oldPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
async function call(route, body, cookie) {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    redirect: "manual",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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
  };
}
async function login(email, password) {
  const r = await call("/api/auth/login", { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie;
}
async function codeFor(email) {
  const messages = await (await fetch("http://mail:8025/messages")).json();
  const mail = messages
    .filter(
      (m) => m.includes("To: " + email) && m.includes("verification code"),
    )
    .at(-1);
  assert(mail);
  const code = mail.match(/code is: (\d{6})/)[1];
  assert(!mail.includes(oldPassword));
  return code;
}
const post = (body, cookie) => call("/api/profile", body, cookie);
async function main() {
  assert.equal((await call("/api/profile")).status, 401);
  assert.equal(
    (await post({ action: "verify-email", code: "123456" })).status,
    401,
  );
  const admin = await login(process.env.SEED_SUPER_ADMIN_EMAIL, oldPassword);
  const seed = await db.user.findUniqueOrThrow({
    where: { email: process.env.SEED_SUPER_ADMIN_EMAIL },
  });
  const franchise = await db.franchise.findFirstOrThrow({
    where: { company: { companyCode: "INFOBB2548" } },
  });
  for (const role of ["SUPER_ADMIN", "COMPANY_ADMIN", "FRANCHISE_USER"]) {
    const email = `profile-${role.toLowerCase()}@example.test`;
    const user = await db.user.create({
      data: {
        email,
        name: "Profile " + role,
        role,
        passwordHash: seed.passwordHash,
        companyId: role === "SUPER_ADMIN" ? null : franchise.companyId,
        franchiseId: role === "FRANCHISE_USER" ? franchise.id : null,
      },
    });
    let cookie = await login(email, oldPassword);
    const otherSession = await login(email, oldPassword);
    const profile = await call("/api/profile", undefined, cookie);
    assert.equal(profile.status, 200);
    assert.equal(profile.data.user.emailVerifiedAt, null);
    assert(!("passwordHash" in profile.data.user));
    const page = await call("/profile", undefined, cookie);
    assert.equal(page.status, 200);
    assert.match(page.data, /Profile Settings/);
    assert.equal(
      (
        await post(
          {
            action: "send-email-code",
            email,
            currentPassword: oldPassword,
            userId: seed.id,
          },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          {
            action: "send-email-code",
            email,
            currentPassword: "wrong-password",
          },
          cookie,
        )
      ).status,
      400,
    );
    const sent = await post(
      { action: "send-email-code", email, currentPassword: oldPassword },
      cookie,
    );
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    let challenge = await db.staffEmailChallenge.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const code = await codeFor(email);
    assert.notEqual(challenge.tokenHash, code);
    assert.equal(challenge.tokenHash.length, 64);
    assert(!JSON.stringify(sent.data).includes(code));
    assert.equal(
      (
        await post(
          { action: "send-email-code", email, currentPassword: oldPassword },
          cookie,
        )
      ).status,
      429,
    );
    assert.equal(
      (
        await post(
          {
            action: "verify-email",
            code: code === "999999" ? "888888" : "999999",
          },
          cookie,
        )
      ).status,
      400,
    );
    const verified = await post({ action: "verify-email", code }, cookie);
    assert.equal(verified.status, 200);
    assert.equal(verified.data.signInRequired, false);
    assert(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailVerifiedAt,
    );
    assert.equal(
      (await post({ action: "verify-email", code }, cookie)).status,
      400,
    );
    const newEmail = `changed-${role.toLowerCase()}@example.test`;
    assert.equal(
      (
        await post(
          {
            action: "send-email-code",
            email: newEmail,
            currentPassword: oldPassword,
          },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).email,
      email,
      "Pending email must not replace login",
    );
    assert.equal(
      (await call("/api/profile", undefined, cookie)).data.pending.newEmail,
      newEmail,
    );
    const newCode = await codeFor(newEmail);
    assert.equal(
      (await post({ action: "verify-email", code: newCode }, cookie)).status,
      200,
    );
    assert.equal(
      (await call("/api/profile", undefined, otherSession)).status,
      401,
      "Old email-change session revoked",
    );
    assert.equal(
      (await call("/api/auth/login", { email, password: oldPassword })).status,
      401,
    );
    cookie = await login(newEmail, oldPassword);
    assert.equal(
      (
        await post(
          {
            action: "change-password",
            currentPassword: "incorrect",
            newPassword: "updated-profile-password-2026",
          },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          {
            action: "change-password",
            currentPassword: oldPassword,
            newPassword: "short",
          },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          {
            action: "change-password",
            currentPassword: oldPassword,
            newPassword: oldPassword,
          },
          cookie,
        )
      ).status,
      400,
    );
    const changed = await post(
      {
        action: "change-password",
        currentPassword: oldPassword,
        newPassword: "updated-profile-password-2026",
      },
      cookie,
    );
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal((await call("/api/profile", undefined, cookie)).status, 401);
    assert.equal(
      (
        await call("/api/auth/login", {
          email: newEmail,
          password: oldPassword,
        })
      ).status,
      401,
    );
    cookie = await login(newEmail, "updated-profile-password-2026");
    assert.equal((await call("/api/profile", undefined, cookie)).status, 200);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.role, role);
    assert.equal(after.companyId, user.companyId);
    assert.equal(after.franchiseId, user.franchiseId);
    const audit = await db.auditLog.findMany({
      where: { entityId: user.id, action: { startsWith: "profile." } },
    });
    const serial = JSON.stringify(audit);
    assert(!serial.includes(newCode));
    assert(!serial.includes("updated-profile-password-2026"));
    assert(!serial.includes(oldPassword));
  }
  console.log(
    "PASS: all staff roles, current-password authentication, current email verification, pending email, verified email change, replay protection, secret redaction and revoked password/email sessions.",
  );
  const email = "profile-guards@example.test";
  const user = await db.user.create({
    data: {
      email,
      name: "Profile guards",
      role: "FRANCHISE_USER",
      companyId: franchise.companyId,
      franchiseId: franchise.id,
      passwordHash: seed.passwordHash,
    },
  });
  const cookie = await login(email, oldPassword);
  const { SignJWT } = require("jose");
  const legacyToken = await new SignJWT({
    userId: user.id,
    email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
    franchiseId: user.franchiseId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const legacyCookie = "caf_session=" + legacyToken;
  assert.equal(
    (await call("/api/profile", undefined, legacyCookie)).status,
    200,
    "Legacy versionless sessions remain valid at version zero",
  );
  const settings = await db.systemSetting.findUniqueOrThrow({
    where: { key: "portal.smtp" },
  });
  await db.systemSetting.update({
    where: { key: "portal.smtp" },
    data: { value: { ...settings.value, enabled: false } },
  });
  assert.equal(
    (
      await post(
        { action: "send-email-code", email, currentPassword: oldPassword },
        cookie,
      )
    ).status,
    503,
  );
  await db.systemSetting.update({
    where: { key: "portal.smtp" },
    data: { value: { ...settings.value, port: 1 } },
  });
  assert.equal(
    (
      await post(
        { action: "send-email-code", email, currentPassword: oldPassword },
        cookie,
      )
    ).status,
    502,
  );
  assert.equal(
    await db.staffEmailChallenge.count({ where: { userId: user.id } }),
    0,
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
      .emailVerifiedAt,
    null,
  );
  await db.systemSetting.update({
    where: { key: "portal.smtp" },
    data: { value: settings.value },
  });
  assert.equal(
    (
      await post(
        {
          action: "send-email-code",
          email: seed.email,
          currentPassword: oldPassword,
        },
        cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        { action: "send-email-code", email, currentPassword: oldPassword },
        cookie,
      )
    ).status,
    200,
  );
  let code = await codeFor(email);
  await db.staffEmailChallenge.update({
    where: { userId: user.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(
    (await post({ action: "verify-email", code }, cookie)).status,
    400,
  );
  await db.staffEmailChallenge.update({
    where: { userId: user.id },
    data: { sentAt: new Date(Date.now() - 61000) },
  });
  assert.equal(
    (
      await post(
        { action: "send-email-code", email, currentPassword: oldPassword },
        cookie,
      )
    ).status,
    200,
  );
  code = await codeFor(email);
  const wrong = code === "999999" ? "888888" : "999999";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await post({ action: "verify-email", code: wrong }, cookie)).status,
      400,
    );
  assert.equal(
    (await post({ action: "verify-email", code }, cookie)).status,
    429,
  );
  await db.staffEmailChallenge.update({
    where: { userId: user.id },
    data: { sentAt: new Date(Date.now() - 61000) },
  });
  assert.equal(
    (
      await post(
        { action: "send-email-code", email, currentPassword: oldPassword },
        cookie,
      )
    ).status,
    200,
  );
  code = await codeFor(email);
  const confirmations = await Promise.all([
    post({ action: "verify-email", code }, cookie),
    post({ action: "verify-email", code }, cookie),
  ]);
  assert.equal(confirmations.filter((r) => r.status === 200).length, 1);
  await db.staffSecurityLimit.update({
    where: { userId: user.id },
    data: { count: 10 },
  });
  assert.equal(
    (
      await post(
        {
          action: "change-password",
          currentPassword: oldPassword,
          newPassword: "another-secure-password",
        },
        cookie,
      )
    ).status,
    429,
  );
  const update = await fetch(base + `/api/users/${user.id}`, {
    method: "PATCH",
    headers: { Cookie: admin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin-changed-profile@example.test" }),
  });
  assert.equal(update.status, 200);
  assert.equal((await call("/api/profile", undefined, cookie)).status, 401);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
      .emailVerifiedAt,
    null,
  );
  assert.equal(
    (await call("/api/profile", undefined, legacyCookie)).status,
    401,
  );
  console.log(
    "PASS: disabled/failed SMTP, duplicate email, expiry, cooldown, attempt limits, atomic code consumption, database rate limits, legacy-session compatibility and admin email reset invalidation.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
