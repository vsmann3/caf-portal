import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, jsonError, ApiError } from "@/lib/guard";
import { clearSessionCookie } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { sendStaffVerificationEmail, getSmtpSettings } from "@/lib/email";
import { audit } from "@/lib/audit";

const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("send-email-code"),
      email: z.string().trim().toLowerCase().email().max(254),
      currentPassword: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal("verify-email"),
      code: z.string().regex(/^\d{6}$/, "Enter the six-digit code"),
    })
    .strict(),
  z
    .object({
      action: z.literal("change-password"),
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(12, "Use at least 12 characters").max(128),
    })
    .strict(),
]);
function digest(id: string, code: string) {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET required");
  return createHmac("sha256", process.env.AUTH_SECRET)
    .update(`${id}:${code}`)
    .digest("hex");
}
async function limit(userId: string) {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "StaffSecurityLimit" ("userId", "count", "resetAt")
    VALUES (${userId}, 1, NOW() + INTERVAL '10 minutes')
    ON CONFLICT ("userId") DO UPDATE SET
      "count" = CASE WHEN "StaffSecurityLimit"."resetAt" <= NOW() THEN 1 ELSE "StaffSecurityLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "StaffSecurityLimit"."resetAt" <= NOW() THEN NOW() + INTERVAL '10 minutes' ELSE "StaffSecurityLimit"."resetAt" END
    RETURNING "count"`;
  return rows[0].count > 10;
}
export async function GET() {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const [user, pending, smtp] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true, email: true, role: true, emailVerifiedAt: true },
    }),
    prisma.staffEmailChallenge.findFirst({
      where: {
        userId: auth.userId,
        sessionVersion: auth.sessionVersion ?? 0,
        delivered: true,
        expiresAt: { gt: new Date() },
      },
      select: { newEmail: true, expiresAt: true, sentAt: true },
    }),
    getSmtpSettings(),
  ]);
  return NextResponse.json(
    { user, pending, emailEnabled: smtp.enabled },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: NextRequest) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const raw = await request.text();
  if (raw.length > 4096) return jsonError(413, "Request too large");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "Invalid request");
  }
  const parsed = input.safeParse(body);
  if (!parsed.success)
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  const data = parsed.data;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.userId },
  });
  try {
    if (data.action === "verify-email") {
      const challenge = await prisma.staffEmailChallenge.findUnique({
        where: { userId: user.id },
      });
      if (
        !challenge ||
        !challenge.delivered ||
        challenge.expiresAt <= new Date() ||
        challenge.sessionVersion !== user.sessionVersion
      )
        return jsonError(
          400,
          "Verification expired or unavailable. Request a new code.",
        );
      const attempt = await prisma.staffEmailChallenge.updateMany({
        where: {
          id: challenge.id,
          attempts: { lt: 5 },
          delivered: true,
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      });
      if (!attempt.count)
        return jsonError(
          429,
          "Verification attempts exhausted. Request a new code.",
        );
      if (
        !timingSafeEqual(
          Buffer.from(digest(challenge.id, data.code), "hex"),
          Buffer.from(challenge.tokenHash, "hex"),
        )
      )
        return jsonError(400, "Incorrect verification code");
      const changedEmail = challenge.newEmail !== user.email;
      await prisma.$transaction(async (tx) => {
        const consumed = await tx.staffEmailChallenge.deleteMany({
          where: {
            id: challenge.id,
            delivered: true,
            expiresAt: { gt: new Date() },
            attempts: { lte: 5 },
          },
        });
        if (!consumed.count)
          throw new ApiError(
            409,
            "Verification changed or was already used. Request a new code.",
          );
        const updated = await tx.user.updateMany({
          where: {
            id: user.id,
            sessionVersion: challenge.sessionVersion,
            isActive: true,
          },
          data: {
            email: challenge.newEmail,
            emailVerifiedAt: new Date(),
            ...(changedEmail ? { sessionVersion: { increment: 1 } } : {}),
          },
        });
        if (!updated.count)
          throw new ApiError(
            409,
            "Account changed. Sign in again and request a new code.",
          );
      });
      await audit(
        auth,
        changedEmail ? "profile.email.changed" : "profile.email.verified",
        "User",
        user.id,
      );
      if (changedEmail) await clearSessionCookie();
      return NextResponse.json({
        ok: true,
        signInRequired: changedEmail,
        message: changedEmail
          ? "Email verified and updated. Sign in with your new email."
          : "Your email has been verified.",
      });
    }
    if (await limit(user.id))
      return jsonError(
        429,
        "Too many security requests. Try again in 10 minutes.",
      );
    if (!verifyPassword(data.currentPassword, user.passwordHash))
      return jsonError(400, "Current password is incorrect");
    if (data.action === "change-password") {
      if (verifyPassword(data.newPassword, user.passwordHash))
        return jsonError(400, "Choose a different new password");
      await prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: {
            id: user.id,
            passwordHash: user.passwordHash,
            sessionVersion: user.sessionVersion,
            isActive: true,
          },
          data: {
            passwordHash: hashPassword(data.newPassword),
            sessionVersion: { increment: 1 },
          },
        });
        if (!updated.count)
          throw new ApiError(
            409,
            "Account changed. Sign in again before changing your password.",
          );
        await tx.staffEmailChallenge.deleteMany({ where: { userId: user.id } });
      });
      await audit(auth, "profile.password.changed", "User", user.id);
      await clearSessionCookie();
      return NextResponse.json({
        ok: true,
        signInRequired: true,
        message:
          "Password updated. Sign in again; existing sessions have been signed out.",
      });
    }
    if (!(await getSmtpSettings()).enabled)
      return jsonError(
        503,
        "Email delivery is disabled. Ask the Super Admin to configure SMTP in Super Settings.",
      );
    if (
      await prisma.user.findFirst({
        where: {
          id: { not: user.id },
          email: { equals: data.email, mode: "insensitive" },
        },
        select: { id: true },
      })
    )
      return jsonError(409, "Email is already in use");
    const code = String(randomInt(100000, 1000000));
    const id = randomBytes(24).toString("hex");
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      if (
        !current.isActive ||
        current.sessionVersion !== user.sessionVersion ||
        current.passwordHash !== user.passwordHash
      )
        throw new ApiError(409, "Account changed. Sign in again.");
      const previous = await tx.staffEmailChallenge.findUnique({
        where: { userId: user.id },
      });
      if (previous && previous.sentAt.getTime() > Date.now() - 60000)
        throw new ApiError(
          429,
          "Wait 60 seconds before requesting another code.",
        );
      const fields = {
        id,
        newEmail: data.email,
        tokenHash: digest(id, code),
        sessionVersion: user.sessionVersion,
        attempts: 0,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60000),
        delivered: false,
      };
      await tx.staffEmailChallenge.upsert({
        where: { userId: user.id },
        create: { ...fields, userId: user.id },
        update: fields,
      });
    });
    try {
      await sendStaffVerificationEmail(data.email, code);
    } catch {
      await prisma.staffEmailChallenge.deleteMany({ where: { id } });
      return jsonError(
        502,
        "Verification email could not be sent. Your login email is unchanged. Ask the Super Admin to check SMTP, then retry.",
      );
    }
    const sent = await prisma.staffEmailChallenge.updateMany({
      where: { id },
      data: { delivered: true },
    });
    if (!sent.count)
      return jsonError(409, "Verification was replaced. Request a new code.");
    await audit(auth, "profile.email.code_sent", "User", user.id);
    return NextResponse.json({
      ok: true,
      message: "Verification code sent. It expires in 10 minutes.",
    });
  } catch (error) {
    if (error instanceof ApiError)
      return jsonError(error.status, error.message);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return jsonError(
        409,
        "Email is already in use. Your login email was not changed.",
      );
    console.error("Profile security operation failed");
    return jsonError(500, "Could not update your profile. Please retry.");
  }
}
