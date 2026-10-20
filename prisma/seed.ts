import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

/**
 * Seed runs safely on every start-up (idempotent): existing records are
 * updated/left alone, missing demo records are created.
 */
async function main() {
  const superEmail =
    (process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@example.com").trim().toLowerCase();
  const superPassword =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe@123";

  // ---- Super admin ----
  const superAdmin = await prisma.user.upsert({
    where: { email: superEmail },
    update: { role: "SUPER_ADMIN", isActive: true },
    create: {
      email: superEmail,
      name: "Super Admin",
      passwordHash: hashPassword(superPassword),
      role: "SUPER_ADMIN",
    },
  });

  // ---- Demo company (Infolink Broadband) ----
  const company = await prisma.company.upsert({
    where: { companyCode: "INFOBB2548" },
    update: {},
    create: {
      name: "Infolink Broadband",
      companyCode: "INFOBB2548",
      contactEmail: "info@infolink.example",
      contactPhone: "+91 9800000000",
    },
  });

  // ---- Demo franchise ----
  let franchise = await prisma.franchise.findFirst({
    where: { companyId: company.id, code: "INFOBB2548-F01" },
  });
  if (!franchise) {
    franchise = await prisma.franchise.create({
      data: {
        companyId: company.id,
        code: "INFOBB2548-F01",
        name: "Main Counter",
        city: "Mumbai",
      },
    });
  }

  // ---- Company admin ----
  await prisma.user.upsert({
    where: { email: "admin@infolink.example" },
    update: { isActive: true },
    create: {
      email: "admin@infolink.example",
      name: "Infolink Admin",
      passwordHash: hashPassword("ChangeMe@123"),
      role: "COMPANY_ADMIN",
      companyId: company.id,
    },
  });

  // ---- Franchise user ----
  await prisma.user.upsert({
    where: { email: "franchise@infolink.example" },
    update: { isActive: true },
    create: {
      email: "franchise@infolink.example",
      name: "Counter Staff",
      passwordHash: hashPassword("ChangeMe@123"),
      role: "FRANCHISE_USER",
      companyId: company.id,
      franchiseId: franchise.id,
    },
  });

  console.log("Seed complete.");
  console.log(`  Super admin:    ${superEmail}`);
  console.log(`  Company admin:  admin@infolink.example`);
  console.log(`  Franchise user: franchise@infolink.example`);
  console.log(`  Super admin id: ${superAdmin.id}`);
  console.log("  ⚠ Change all default passwords immediately after first login.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
