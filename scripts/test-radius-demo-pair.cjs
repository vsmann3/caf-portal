// Actual local CAF + RADIUS HTTP journey. Only explicitly isolated demo records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createDecipheriv, scryptSync } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '../.tools/working-demo');
const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
const env = JSON.parse(fs.readFileSync(state.env, 'utf8'));
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));
const peer = JSON.parse(fs.readFileSync(state.peerStatus, 'utf8').replace(/^\uFEFF/, ''));
const connection = JSON.parse(fs.readFileSync(peer.connection_file, 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(env.DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(url.hostname));
assert.match(url.pathname, /^\/caf_demo_[a-z0-9_]+$/);
assert.equal(env.CAF_RADIUS_DEMO, '1');
assert.equal(state.cafUrl, 'http://127.0.0.1:18110');
assert.equal(state.radiusUrl, 'http://127.0.0.1:18120');
process.env.DATABASE_URL = env.DATABASE_URL;
const db = new PrismaClient();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(route, method = 'GET', data, cookie, bearer, origin = state.cafUrl) {
  const multipart = data instanceof FormData;
  const response = await fetch(origin + route, {
    method, redirect: 'manual', signal: AbortSignal.timeout(90000),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(data && !multipart ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? multipart ? data : JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(email) {
  const r = await api('/api/auth/login', 'POST', { email, password: runtime.adminPassword });
  assert.equal(r.status, 200, 'Actual CAF demo login must work');
  return r.cookie;
}
function form(data) {
  const value = new FormData(); value.set('data', JSON.stringify(data));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
  for (const category of ['PASSPORT_PHOTO', 'ID_PROOF', 'ADDRESS_PROOF']) {
    value.append('files', new Blob([png], { type: 'image/png' }), category + '.png'); value.append('docType', category);
  }
  return value;
}
function decrypt(value) {
  const [, iv, tag, bytes] = value.split(':');
  const cipher = createDecipheriv('aes-256-gcm', scryptSync(env.AUTH_SECRET, 'caf-portal-storage', 32), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(bytes, 'hex')), cipher.final()]).toString();
}
function radiusSnapshot(serviceIds) {
  const script = String.raw`
import json,sys,sqlite3,hashlib
from pathlib import Path
c=json.load(sys.stdin)
p=Path(c['database']).resolve()
assert p.name=='radius-demo.sqlite3' and p.parent.name=='integration-demo'
db=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
rows=[]
for service in c['ids']:
 r=db.execute('SELECT s.username,s.status,s.expires_at,s.password_hash,r.customer_id FROM core_cafservicerequest r JOIN core_subscriber s ON s.id=r.subscriber_id WHERE r.service_request_id=?',(service.replace('-',''),)).fetchall()
 rows.append([{'username':x[0],'status':x[1],'expiry':x[2],'hash_fingerprint':hashlib.sha256(x[3].encode()).hexdigest(),'customer_id':x[4]} for x in r])
print(json.dumps(rows))
`;
  return JSON.parse(execFileSync('python', ['-X', 'utf8', '-c', script], { input: JSON.stringify({ database: path.join(path.dirname(peer.connection_file), 'radius-demo.sqlite3'), ids: serviceIds }), encoding: 'utf8' }));
}
async function main() {
  const counter = await login('demo-counter@caf.example.test');
  const reviewer = await login('demo-company@caf.example.test');
  const plans = await api(`/api/radius-demo/plans?franchiseId=${state.franchiseId}`, 'GET', undefined, counter);
  assert.equal(plans.status, 200); assert.equal(plans.body.items.length, 2);
  const plan = plans.body.items[0]; assert(!('price' in plan), 'Absent price must stay unavailable');
  const foreign = await api('/api/integrations/radius/v1/customers/9999999999', 'GET', undefined, undefined, runtime.readToken);
  assert.equal(foreign.status, 404);
  const suffix = String(Date.now()).slice(-9);
  const apps = [], serviceIds = [];
  for (const n of [1, 2]) {
    const data = { franchiseId: state.franchiseId, customerName: 'Joint demo customer', mobile: '9876543210', addressLine1: '10 Synthetic Demo Street', city: 'Delhi', state: 'Delhi', pincode: '110001', billingAddressLine1: '10 Synthetic Demo Street', billingCity: 'Delhi', billingState: 'Delhi', billingPincode: '110001', idProofType: 'PAN', idNumber: 'ABCDE1234F', connectionType: 'NEW', customerType: 'RESIDENTIAL', declarationAccepted: true };
    const draft = await api('/api/caf-drafts', 'POST', { payload: { ...data, declarationAccepted: false } }, counter);
    assert.equal(draft.status, 201);
    const reservation = await api('/api/radius-demo/intents', 'POST', { draftId: draft.body.draft.id, draftVersion: draft.body.draft.version, planId: plan.plan_id, planVersion: plan.version, username: `joint${suffix}_${n}`, ...(n === 2 ? { existingCustomerId: apps[0].customerId } : {}) }, counter);
    assert.equal(reservation.status, 200, 'Real RADIUS reservation must succeed');
    const intent = reservation.body.intent;
    const renewal = await api('/api/radius-demo/renew', 'POST', { intentId: intent.id }, counter);
    assert.equal(renewal.status, 200, 'Real pre-delivery renewal must succeed');
    const submitted = await api('/api/applications', 'POST', form({ ...data, draftId: reservation.body.draft.id, draftVersion: reservation.body.draft.version, radiusDemoIntentId: intent.id }), counter);
    assert.equal(submitted.status, 201, 'Existing CAF form submission endpoint must accept reserved draft');
    const app = submitted.body.application; apps.push(app); serviceIds.push(intent.id);
    assert.match(app.customerId, /^[1-9][0-9]{9}$/);
    if (n === 2) assert.equal(app.customerId, apps[0].customerId, 'Additional connection must retain Customer ID');
    assert.equal(await db.radiusDemoDelivery.count({ where: { applicationId: app.id } }), 0);
    assert.deepEqual(radiusSnapshot([intent.id]), [[]], 'No RADIUS subscriber before CAF approval');
    assert.equal((await api(`/api/applications/${app.id}/status`, 'PATCH', { action: 'APPROVE' }, counter)).status, 403);
    assert.equal((await api(`/api/applications/${app.id}/status`, 'PATCH', { action: 'APPROVE' }, reviewer)).status, 200);
    let job = await db.radiusDemoDelivery.findFirstOrThrow({ where: { applicationId: app.id } });
    const capturedCiphertext = job.secretEncrypted;
    for (let attempt = 0; attempt < 60 && job.state !== 'STAGED'; attempt++) {
      if (['RECOVERY_REQUIRED', 'UNEXPECTED_ACTIVE'].includes(job.state)) throw Error('Actual delivery requires review: ' + job.errorCode);
      await api('/api/internal/radius-demo/run', 'POST', undefined, undefined, runtime.workerToken);
      await delay(500); job = await db.radiusDemoDelivery.findUniqueOrThrow({ where: { id: job.id } });
    }
    assert.equal(job.state, 'STAGED', 'Actual RADIUS accepted receipt must stage a disabled service');
    assert.equal(job.credentialAccepted, true); assert.equal(job.secretEncrypted, null);
    const receiptPath = `/api/integrations/ecaf/v2/provisionings/${job.id}`;
    const receipt = await api(receiptPath, 'GET', undefined, undefined, connection.token, state.radiusUrl);
    assert.equal(receipt.status, 200); assert.equal(receipt.body.customer_id, app.customerId); assert.equal(receipt.body.credential_accepted, true);
    assert.equal(receipt.body.service_status, 'pending_service_setup'); assert.equal(receipt.body.service_request_id, intent.id);
    const before = radiusSnapshot([intent.id]); assert.equal(before[0].length, 1); assert.equal(before[0][0].status, 'suspended'); assert.equal(before[0][0].customer_id, app.customerId);
    if (capturedCiphertext) {
      const body = { schema_version: '2.0', provisioning_request_id: job.id, supersedes_request_id: null, approval: job.approvalEvent, service: { ...job.service, initial_password: decrypt(capturedCiphertext) } };
      const replay = await fetch(state.radiusUrl + '/api/integrations/ecaf/v2/provisionings', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.id }, body: JSON.stringify(body) });
      assert.equal(replay.status, 202); const repeated = await replay.json(); assert.deepEqual(repeated, receipt.body);
    }
    await api('/api/internal/radius-demo/run', 'POST', undefined, undefined, runtime.workerToken);
    assert.deepEqual(radiusSnapshot([intent.id]), before, 'Retries preserve credential hash, expiry and single service');
    const scoped = await api(`/api/integrations/radius/v1/customers/${app.customerId}/applications/${app.id}/approvals/1`, 'GET', undefined, undefined, runtime.readToken);
    assert.equal(scoped.status, 200); assert.equal(scoped.body.approval_event.event_id, job.eventId);
    console.log(`PASS: actual RADIUS reservation/renewal, CAF approval, staged receipt, same Customer ID and idempotent service ${n}`);
  }
  const master = await api(`/api/integrations/radius/v1/customers/${apps[0].customerId}`, 'GET', undefined, undefined, runtime.readToken);
  assert.equal(master.status, 200); assert.equal(master.body.customer_version, 2);
  assert.equal(radiusSnapshot(serviceIds).flat().length, 2);
  const result = { verified: true, mode: 'STAGED_NO_REAL_NETWORK', cafUrl: state.cafUrl, radiusUrl: state.radiusUrl, customerId: apps[0].customerId, applications: apps.map(a => a.id), serviceRequestIds: serviceIds, testedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'pair-result.json'), JSON.stringify(result, null, 2));
  console.log('PASS: real joint HTTP model; two independent connections retain one lifetime Customer ID; no production/live-network acceptance claimed');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => db.$disconnect());
