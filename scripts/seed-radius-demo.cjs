// Synthetic company/accounts only. Never seeds production.
const { PrismaClient } = require('@prisma/client');
const { compareSync } = require('bcryptjs');
const { randomBytes, scryptSync } = require('node:crypto');
function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}
const db = new PrismaClient();
(async () => {
  const u = new URL(process.env.DATABASE_URL || 'invalid:');
  if (process.env.CAF_RADIUS_DEMO !== '1' || !/^\/caf_demo_[a-z0-9_]+$/.test(u.pathname) || !['127.0.0.1', 'localhost'].includes(u.hostname)) throw Error('Loopback isolated demo required');
  if (!process.env.CAF_DEMO_ADMIN_PASSWORD) throw Error('Protected demo account password required');
  const company = await db.company.upsert({ where: { id: 'netloom-demo-company' }, update: {}, create: { id: 'netloom-demo-company', companyCode: 'DEMONETLOOM', name: 'Netloom - ISOLATED DEMO' } });
  const franchise = await db.franchise.upsert({ where: { id: 'netloom-demo-franchise' }, update: {}, create: { id: 'netloom-demo-franchise', companyId: company.id, code: 'DEMO-F01', name: 'Isolated demo counter' } });
  if (franchise.companyId !== company.id) throw Error('Demo mapping conflict');
  for (const [email, role] of [['demo-admin@caf.example.test', 'SUPER_ADMIN'], ['demo-company@caf.example.test', 'COMPANY_ADMIN'], ['demo-counter@caf.example.test', 'FRANCHISE_USER']]) {
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name: 'Isolated ' + role, role, passwordHash: hashPassword(process.env.CAF_DEMO_ADMIN_PASSWORD), ...(role !== 'SUPER_ADMIN' ? { companyId: company.id } : {}), ...(role === 'FRANCHISE_USER' ? { franchiseId: franchise.id } : {}) } });
    // Repair only this prototype's incompatible seed hashes, after verifying
    // the exact generated password. Preserve any owner-changed account password.
    if (user.passwordHash.startsWith('$2') && compareSync(process.env.CAF_DEMO_ADMIN_PASSWORD, user.passwordHash)) {
      await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(process.env.CAF_DEMO_ADMIN_PASSWORD), sessionVersion: { increment: 1 } } });
    }
  }
  console.log(JSON.stringify({ seeded: true, companyId: company.id, franchiseId: franchise.id }));
})().catch(() => { console.error('Isolated seed failed; verify test DB/mapping'); process.exitCode = 1; }).finally(() => db.$disconnect());
