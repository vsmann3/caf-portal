// Run inside the isolated settings test app, never against production.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
assert.equal(process.env.CAF_ISOLATED_TEST, '1', 'This test requires an isolated fixture');
assert.match(process.env.DATABASE_URL || '', /caf-settings-test-[^/]+-db:5432\/smoke/);
const db = new PrismaClient();
const origin = 'http://127.0.0.1:3000';
async function call(route, method = 'GET', body, cookie) {
  const response = await fetch(origin + route, { method, redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(email, password) {
  const result = await call('/api/auth/login', 'POST', { email, password });
  assert.equal(result.status, 200, 'Fixture login'); assert(result.cookie); return result.cookie;
}
async function captured() { return (await fetch('http://mail:8025/messages')).json(); }
async function main() {
  const admin = await login(process.env.SEED_SUPER_ADMIN_EMAIL, process.env.SEED_SUPER_ADMIN_PASSWORD);
  assert.equal((await call('/api/settings/smtp')).status, 401);
  assert.equal((await call('/admin/super-settings', 'GET', undefined, admin)).status, 200);
  const initial = await call('/api/settings/smtp', 'GET', undefined, admin);
  assert.equal(initial.data.smtp.enabled, false); assert(!('password' in initial.data.smtp));
  const portal = { name: 'CAF SMTP Test', publicUrl: 'https://portal.example.test', supportEmail: 'support@example.test' };
  assert.equal((await call('/api/settings/portal', 'PUT', portal, admin)).status, 200);
  assert.equal((await call('/api/settings/portal', 'PUT', { ...portal, publicUrl: 'invalid' }, admin)).status, 400);
  assert.deepEqual((await call('/api/settings/smtp', 'GET', undefined, admin)).data, initial.data, 'Portal save must not touch SMTP');
  const smtp = { enabled: true, host: 'mail', port: 2525, security: 'plain', authentication: true,
    username: 'fixture-user', password: 'fixture-smtp-password', fromName: 'CAF Test', fromEmail: 'no-reply@example.test', replyTo: 'support@example.test' };
  const saved = await call('/api/settings/smtp', 'PUT', smtp, admin);
  assert.equal(saved.status, 200); assert.equal(saved.data.smtp.hasPassword, true);
  assert(!JSON.stringify(saved.data).includes(smtp.password)); assert(!('password' in saved.data.smtp));
  let stored = await db.systemSetting.findUnique({ where: { key: 'portal.smtp' } });
  assert(stored.value.password.startsWith('enc:')); assert.notEqual(stored.value.password, smtp.password);
  const encrypted = stored.value.password;
  assert.deepEqual((await call('/api/settings/portal', 'GET', undefined, admin)).data.portal, portal, 'SMTP save must not touch portal');
  assert.equal((await call('/api/settings/smtp', 'POST', { to: 'recipient@example.test' }, admin)).status, 200);
  assert.equal((await captured()).length, 1);
  assert.equal((await call('/api/settings/smtp', 'PUT', { ...smtp, password: '' }, admin)).status, 200);
  stored = await db.systemSetting.findUnique({ where: { key: 'portal.smtp' } });
  assert.equal(stored.value.password, encrypted, 'Blank password must retain encrypted secret');
  assert.equal((await call('/api/settings/smtp', 'PUT', { ...smtp, password: '', clearPassword: true }, admin)).status, 400);
  assert.equal((await call('/api/settings/smtp', 'POST', { to: 'not-an-email' }, admin)).status, 400);
  assert.equal((await call('/api/settings/smtp', 'PUT', { ...smtp, password: '', security: 'starttls' }, admin)).status, 200);
  const tlsFailure = await call('/api/settings/smtp', 'POST', { to: 'recipient@example.test' }, admin);
  assert.equal(tlsFailure.status, 502); assert(!JSON.stringify(tlsFailure.data).includes(smtp.password));
  await call('/api/settings/smtp', 'PUT', { ...smtp, password: '' }, admin);
  console.log('PASS: access guard, independent section saves, invalid-input handling, encrypted/masked secret, retained password and SMTP test.');

  const company = await db.company.findUnique({ where: { companyCode: 'INFOBB2548' } });
  const franchise = await db.franchise.findFirst({ where: { companyId: company.id } });
  const input = { name: 'Welcome Fixture', email: 'welcome@example.test', password: 'fixture-account-password',
    role: 'FRANCHISE_USER', companyId: company.id, franchiseId: franchise.id };
  const created = await call('/api/users', 'POST', input, admin);
  assert.equal(created.status, 201); assert.equal(created.data.email.status, 'sent');
  let mail = await captured(); assert.equal(mail.length, 2);
  assert.match(mail.at(-1), /https:\/\/portal\.example\.test\/login/);
  assert(!mail.at(-1).includes(input.password)); assert(!mail.at(-1).includes(smtp.password));
  assert.equal((await call('/api/users', 'POST', input, admin)).status, 409);
  assert.equal((await captured()).length, 2, 'Duplicate account must not send another welcome');
  const franchiseCookie = await login(input.email, input.password);
  for (const route of ['/api/settings/smtp', '/api/settings/portal']) {
    for (const method of ['GET', 'PUT', ...(route.endsWith('smtp') ? ['POST'] : [])]) {
      assert.equal((await call(route, method, method === 'GET' ? undefined : {}, franchiseCookie)).status, 403);
    }
  }
  const companyCookie = await login('admin@infolink.example', 'ChangeMe@123');
  for (const route of ['/api/settings/smtp', '/api/settings/portal']) {
    for (const method of ['GET', 'PUT', ...(route.endsWith('smtp') ? ['POST'] : [])]) {
      assert.equal((await call(route, method, method === 'GET' ? undefined : {}, companyCookie)).status, 403);
    }
  }
  assert.equal((await call('/admin/super-settings', 'GET', undefined, companyCookie)).status, 307);
  assert.equal((await call(`/api/users/${created.data.user.id}/welcome-email`, 'POST', undefined, companyCookie)).status, 200);
  const adminUser = await db.user.findUnique({ where: { email: process.env.SEED_SUPER_ADMIN_EMAIL } });
  assert.equal((await call(`/api/users/${adminUser.id}/welcome-email`, 'POST', undefined, companyCookie)).status, 404);
  const otherCompany = await db.company.create({ data: { name: 'Other Tenant', companyCode: 'OTHERTEST' } });
  const otherFranchise = await db.franchise.create({ data: { companyId: otherCompany.id, code: 'OT-F01', name: 'Other Counter' } });
  const other = await call('/api/users', 'POST', { ...input, email: 'other-tenant@example.test', companyId: otherCompany.id, franchiseId: otherFranchise.id }, admin);
  assert.equal(other.status, 201);
  assert.equal((await call(`/api/users/${other.data.user.id}/welcome-email`, 'POST', undefined, companyCookie)).status, 404);
  assert.equal((await call('/api/users', 'POST', { ...input, email: 'forbidden@example.test', companyId: otherCompany.id, franchiseId: otherFranchise.id }, companyCookie)).status, 403);
  const companyCreated = await call('/api/users', 'POST', { ...input, email: 'company-created@example.test' }, companyCookie);
  assert.equal(companyCreated.status, 201); assert.equal(companyCreated.data.email.status, 'sent');
  console.log('PASS: new-account welcome, correct login link, no emailed passwords, duplicate protection and role-scoped resend.');

  await call('/api/settings/smtp', 'PUT', { ...smtp, password: '', port: 1 }, admin);
  const failureInput = { ...input, email: 'smtp-failure@example.test' };
  const failed = await call('/api/users', 'POST', failureInput, admin);
  assert.equal(failed.status, 201); assert.equal(failed.data.email.status, 'failed');
  assert.equal(await db.user.count({ where: { email: failureInput.email } }), 1);
  assert.equal((await call(`/api/users/${failed.data.user.id}/welcome-email`, 'POST', undefined, admin)).status, 502);
  await call('/api/settings/smtp', 'PUT', { ...smtp, password: '' }, admin);
  assert.equal((await call(`/api/users/${failed.data.user.id}/welcome-email`, 'POST', undefined, admin)).status, 200);
  await call('/api/settings/smtp', 'PUT', { ...smtp, password: '', enabled: false }, admin);
  const disabled = await call('/api/users', 'POST', { ...input, email: 'disabled@example.test' }, admin);
  assert.equal(disabled.status, 201); assert.equal(disabled.data.email.status, 'disabled');
  assert.equal((await call(`/api/users/${disabled.data.user.id}/welcome-email`, 'POST', undefined, admin)).status, 409);
  assert.equal((await call('/api/settings/smtp', 'POST', { to: 'recipient@example.test' }, admin)).status, 200, 'Saved configuration can be tested while welcome delivery is disabled');
  const loginPage = await call('/login'); assert.match(loginPage.data, /CAF SMTP Test/);
  assert.match(loginPage.data, /support@example.test/);
  assert.deepEqual((await call('/api/settings/portal', 'GET', undefined, admin)).data.portal, portal);
  // Leave the fixture enabled for optional UI testing.
  await call('/api/settings/smtp', 'PUT', { ...smtp, password: '' }, admin);
  const page = await call('/admin/super-settings', 'GET', undefined, admin);
  assert.match(page.data, /General Portal Settings/); assert.match(page.data, /Email Settings \(SMTP\)/);
  assert(page.data.includes('Save Portal Settings'), 'Server-rendered portal save action missing');
  assert(page.data.includes('Save Email Settings'), 'Server-rendered email save action missing');
  assert(!page.data.includes(smtp.password), 'Server-rendered settings must not contain SMTP password');
  assert(!page.data.includes(encrypted), 'Server-rendered settings must not contain encrypted SMTP secret');
  console.log('PASS: SMTP failure preserves account, manual resend recovers, disabled delivery, and portal branding.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
