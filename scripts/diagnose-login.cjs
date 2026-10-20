// Read-only diagnosis. Never print credentials, password hashes or database URLs.
const { PrismaClient } = require('@prisma/client');
const { scryptSync, timingSafeEqual } = require('node:crypto');
const prisma = new PrismaClient({ log: [] });
async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin@example.com';
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  console.log(JSON.stringify({
    seedRequested: process.env.RUN_SEED === '1',
    seedEmailConfigured: Boolean(process.env.SEED_SUPER_ADMIN_EMAIL),
    seedPasswordConfigured: Boolean(password),
    authSecretConfigured: Boolean(process.env.AUTH_SECRET),
  }));
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log(JSON.stringify({ publicTables: tables.map(row => row.tablename) }));
  const enums = await prisma.$queryRaw`SELECT t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY t.typname`;
  console.log(JSON.stringify({ publicEnums: enums.map(row => row.typname) }));
  const count = await prisma.user.count();
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  let passwordMatchesEnvironment = null;
  if (user && password) {
    const [format, salt, hash] = user.passwordHash.split(':');
    if (format === 'scrypt' && salt && hash) {
      const expected = Buffer.from(hash, 'hex');
      const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
      passwordMatchesEnvironment = timingSafeEqual(actual, expected);
    } else passwordMatchesEnvironment = false;
  }
  console.log(JSON.stringify({ userCount: count, configuredAdminExists: Boolean(user),
    configuredAdminActive: user?.isActive ?? null, configuredAdminRole: user?.role ?? null,
    passwordMatchesEnvironment }));
}
main().catch(error => {
  console.log(JSON.stringify({ databaseCheckFailed: true, code: error.code || error.name,
    missingTable: error.code === 'P2021', missingColumn: error.code === 'P2022' }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
