import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getPortalSettings } from "@/lib/portal-settings";

export const smtpSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253).refine(value => !/[\s/@]/.test(value), "Enter an SMTP hostname or IP address"),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls", "plain"]),
  authentication: z.boolean(),
  username: z.string().trim().max(320),
  password: z.string().max(4096).optional(),
  clearPassword: z.boolean().optional(),
  fromName: z.string().trim().max(100).refine(value => !/[\r\n]/.test(value), "Invalid sender name"),
  fromEmail: z.string().trim().email().or(z.literal("")),
  replyTo: z.string().trim().email().or(z.literal("")),
}).strict();

type SmtpSettings = Omit<z.infer<typeof smtpSettingsSchema>, "clearPassword"> & { password: string };
const key = "portal.smtp";
const defaults: SmtpSettings = { enabled: false, host: "", port: 587, security: "starttls",
  authentication: true, username: "", password: "", fromName: "CAF Portal", fromEmail: "", replyTo: "" };

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? { ...defaults, ...(row.value as unknown as SmtpSettings) } : { ...defaults };
}

export function smtpSettingsView(settings: SmtpSettings) {
  const { password, ...view } = settings;
  return { ...view, hasPassword: Boolean(password) };
}

function requireConfiguration(settings: SmtpSettings) {
  if (!settings.host || !settings.fromEmail) throw new Error("SMTP host and sender email are required");
  if (settings.authentication && (!settings.username || !settings.password)) {
    throw new Error("SMTP username and password are required when authentication is enabled");
  }
}

export async function saveSmtpSettings(input: z.infer<typeof smtpSettingsSchema>) {
  const existing = await getSmtpSettings();
  const { clearPassword, password, ...fields } = input;
  const settings: SmtpSettings = { ...fields, password: !input.authentication || clearPassword ? "" :
    password ? encryptSecret(password) : existing.password };
  if (settings.enabled) requireConfiguration(settings);
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: settings }, update: { value: settings } });
  return smtpSettingsView(settings);
}

async function send(settings: SmtpSettings, to: string, subject: string, text: string) {
  requireConfiguration(settings);
  const transport = nodemailer.createTransport({
    host: settings.host, port: settings.port, secure: settings.security === "tls",
    requireTLS: settings.security === "starttls", ignoreTLS: settings.security === "plain",
    auth: settings.authentication ? { user: settings.username, pass: decryptSecret(settings.password) } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: { name: settings.fromName, address: settings.fromEmail }, to,
      replyTo: settings.replyTo || undefined, subject, text,
    });
    if (!result.accepted.length || result.rejected.length) throw new Error("Recipient rejected");
  } finally { transport.close(); }
}

export async function sendTestEmail(to: string) {
  const [settings, portal] = await Promise.all([getSmtpSettings(), getPortalSettings()]);
  await send(settings, to, `${portal.name}: SMTP test`, `This is a test email from ${portal.name}.\n\nYour saved SMTP settings accepted this message for delivery.`);
}

export async function sendStaffVerificationEmail(to: string, code: string) {
  const [settings, portal] = await Promise.all([getSmtpSettings(), getPortalSettings()]);
  if (!settings.enabled) throw new Error("Email delivery is disabled");
  await send(settings, to, `${portal.name}: verify your staff email`, [
    `Your ${portal.name} staff email verification code is: ${code}`,
    "", "This code expires in 10 minutes and can be used only once.",
    "Enter it in Profile Settings while signed in. Your login email stays unchanged until verification succeeds.",
    "If you did not request this code, ignore this message. Do not share the code or your password.",
  ].join("\n"));
}

export type WelcomeEmailResult = { status: "sent" | "disabled" | "failed"; message: string };

export async function sendWelcomeEmail(user: { name: string; email: string; role: string; company?: { name: string } | null }): Promise<WelcomeEmailResult> {
  try {
    const settings = await getSmtpSettings();
    if (!settings.enabled) return { status: "disabled", message: "Welcome email was not sent because email is disabled." };
    const portal = await getPortalSettings();
    const login = new URL("/login", portal.publicUrl).toString();
    await send(settings, user.email, `Welcome to ${portal.name}`, [
      `Hello ${user.name},`, "", `Your ${portal.name} account has been created.`,
      `Email: ${user.email}`, `Role: ${user.role.replaceAll("_", " ")}`,
      ...(user.company ? [`Company: ${user.company.name}`] : []), "", `Sign in: ${login}`,
      "Please obtain your initial password from the administrator who created your account.",
      ...(portal.supportEmail ? ["", `Need help? Contact ${portal.supportEmail}.`] : []),
    ].join("\n"));
    return { status: "sent", message: "Welcome email accepted by the SMTP server." };
  } catch {
    // Never return SMTP errors: they can contain credentials or internal hostnames.
    return { status: "failed", message: "Account exists, but welcome email could not be sent. Check SMTP settings and retry the welcome email." };
  }
}
