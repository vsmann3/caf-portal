const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
function load(file, env, additional = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/radius-demo', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = { 'server-only': {}, '@/lib/db': { prisma: {} }, '@/lib/crypto': {}, '@/lib/guard': { ApiError: class extends Error {} }, ...additional };
  new Function('require', 'module', 'exports', 'process', source)(name => name in imports ? imports[name] : require(name), module, module.exports, { env });
  return module.exports;
}
const demo = { CAF_RADIUS_DEMO: '1', DATABASE_URL: 'postgresql://demo:fixture@127.0.0.1:18130/caf_demo_fixture', CAF_RADIUS_DEMO_ALLOW_HTTP: '1', AUTH_SECRET: 'fixture-only-test-signing-secret' };
const binding = { sourceId: 'caf-portal-demo', baseUrl: 'http://127.0.0.1:18120', radiusCompanyId: '10002', franchiseMappings: { 'demo-franchise': '10003' } };
test('demo is off by default and cannot target production database names', () => {
  assert.equal(load('common.ts', {}).demoEnabled(), false);
  assert.equal(load('common.ts', { ...demo, DATABASE_URL: 'postgresql://demo:fixture@localhost/caf_portal' }).demoEnabled(), false);
  assert.equal(load('common.ts', demo).demoEnabled(), true);
});
test('synthetic active acceptance requires its explicit opt-in', () => {
  assert.equal(load('common.ts', demo).acceptsSyntheticDemoActive(binding), false);
  assert.equal(load('common.ts', { ...demo, CAF_RADIUS_DEMO_ACCEPT_SYNTHETIC_ACTIVE: '1' }).acceptsSyntheticDemoActive(binding), true);
});
test('active opt-in never widens to remote bindings, wrong source, credentials, paths or ports', () => {
  const common = load('common.ts', { ...demo, CAF_RADIUS_DEMO_ACCEPT_SYNTHETIC_ACTIVE: '1' });
  for (const baseUrl of ['https://radius.example.test', 'http://127.0.0.1:18121', 'http://user:pass@127.0.0.1:18120', 'http://127.0.0.1:18120/other', 'http://127.0.0.1:18120?token=bad']) assert.equal(common.acceptsSyntheticDemoActive({ ...binding, baseUrl }), false);
  assert.equal(common.acceptsSyntheticDemoActive({ ...binding, sourceId: 'production' }), false);
  assert.equal(load('common.ts', { ...demo, CAF_RADIUS_DEMO_ACCEPT_SYNTHETIC_ACTIVE: '1', DATABASE_URL: 'postgresql://demo:fixture@remote/caf_demo_fixture' }).acceptsSyntheticDemoActive(binding), false);
});
test('guarded Docker smoke fixture permits staging, never synthetic activation', () => {
  const common = load('common.ts', { ...demo, CAF_ISOLATED_TEST: '1', CAF_RADIUS_DEMO_ACCEPT_SYNTHETIC_ACTIVE: '1', DATABASE_URL: 'postgresql://smoke:fixture@caf-settings-test-fixture-db:5432/smoke' });
  assert.equal(common.demoEnabled(), true); assert.equal(common.acceptsSyntheticDemoActive(binding), false);
});
test('canonical replay HMAC survives JSONB key order, but rejects changed values or array order', () => {
  const common = load('common.ts', demo);
  assert.equal(common.requestHmac({ z: 1, a: { y: 'नमस्ते', b: null } }), common.requestHmac({ a: { b: null, y: 'नमस्ते' }, z: 1 }));
  assert.notEqual(common.requestHmac({ a: 1 }), common.requestHmac({ a: 2 }));
  assert.notEqual(common.requestHmac([1, 2]), common.requestHmac([2, 1]));
});
const ids = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004'];
const job = { id: ids[0], eventId: ids[1], serviceId: null };
const intent = { id: ids[2], customerId: '1000000001', companyId: 'demo-company', franchiseId: 'demo-franchise' };
const receipt = { schema_version: '2.0', source_id: binding.sourceId, customer_id: intent.customerId, company_ref: { id: intent.companyId }, franchise_ref: { id: intent.franchiseId }, radius_company_id: '10002', radius_franchise_id: '10003', provisioning_request_id: job.id, event_id: job.eventId, service_request_id: intent.id, receipt_version: 1, receipt_status: 'blocked', credential_accepted: true, service_id: ids[3], service_status: 'pending_service_setup', error: null };
function verifier() { const common = load('common.ts', demo); return load('worker.ts', demo, { './common': common }).verifyDemoReceipt; }
test('receipt acceptance requires every nested tenant, operation and service binding', () => {
  const verify = verifier(); assert.equal(verify(receipt, job, intent, binding).credential_accepted, true);
  for (const [key, value] of [['source_id', 'foreign'], ['customer_id', '9999999999'], ['company_ref', { id: 'foreign' }], ['franchise_ref', { id: 'foreign' }], ['radius_company_id', '20000'], ['radius_franchise_id', '20001'], ['provisioning_request_id', ids[3]], ['event_id', ids[3]], ['service_request_id', ids[3]]]) assert.throws(() => verify({ ...receipt, [key]: value }, job, intent, binding));
});
test('accepted receipt needs service ID; an existing service binding never changes', () => {
  const verify = verifier();
  assert.throws(() => verify({ ...receipt, service_id: null }, job, intent, binding));
  assert.throws(() => verify(receipt, { ...job, serviceId: ids[0] }, intent, binding));
  assert.throws(() => verify({ ...receipt, service_status: 'active', credential_accepted: false }, job, intent, binding));
});
test('unexpected fields cannot leak documents/passwords into accepted receipt schema', () => {
  const verify = verifier(); assert.throws(() => verify({ ...receipt, initial_password: 'must-not-be-receipt-data' }, job, intent, binding));
});
