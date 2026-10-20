#!/bin/sh
# Disposable, network-isolated PostgreSQL. Never uses production data or volumes.
set -eu
cd "$(dirname "$0")/.."
db="caf-upgrade-test-$(date +%s)-$$"
cleanup() { docker rm -f "$db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
docker run -d --name "$db" --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke postgres:16-alpine >/dev/null
attempt=0
until docker exec "$db" pg_isready -U smoke -d smoke >/dev/null 2>&1; do
  attempt=$((attempt + 1)); if [ "$attempt" -ge 60 ]; then exit 1; fi
  sleep 1
done
sql() { docker exec -i "$db" psql -v ON_ERROR_STOP=1 -U smoke -d smoke "$@"; }
sql < prisma/migrations/20261020173000_initial_schema/migration.sql >/dev/null
sql <<'SQL' >/dev/null
INSERT INTO "Company" (id,name,"companyCode","updatedAt") VALUES ('c','Upgrade fixture','UPGRADE',NOW());
INSERT INTO "Franchise" (id,"companyId",code,name,"updatedAt") VALUES ('f1','c','F1','One',NOW()), ('f2','c','F2','Two',NOW());
INSERT INTO "CustomerApplication" (id,"cafNumber","companyId","franchiseId","customerName",mobile,"addressLine1",city,state,pincode,"idProofType","idNumber","connectionType","updatedAt","broadbandUsername")
VALUES ('a1','CAF1','c','f1','Legacy One','9876543210','Legacy address','Delhi','Delhi','110001','PAN','ABCDE1234F','NEW',NOW(),' Duplicate '),
 ('a2','CAF2','c','f2','Legacy Two','9876543211','Legacy address','Delhi','Delhi','110001','PAN','ABCDE1234F','NEW',NOW(),'duplicate');
INSERT INTO "Document" (id,"applicationId","documentType","originalName","mimeType","sizeBytes","storageProvider","storageKey") VALUES ('d','a1','ID_PROOF','legacy.png','image/png',5242880,'local','unchanged-legacy-key');
SQL
if sql < prisma/migrations/20261021100000_caf_redesign/migration.sql > upgrade-conflict.log 2>&1; then
  echo 'FAIL: conflicting legacy usernames were accepted'; exit 1
fi
grep -q 'Duplicate service usernames within a company' upgrade-conflict.log
test "$(sql -Atc 'SELECT COUNT(*) FROM information_schema.columns WHERE table_name = '\''CustomerApplication'\'' AND column_name = '\''businessName'\''')" = 0
test "$(sql -Atc 'SELECT "broadbandUsername" FROM "CustomerApplication" WHERE id = '\''a1'\''')" = ' Duplicate '
# Resolve only the synthetic fixture conflict, then test the additive upgrade.
sql -c 'UPDATE "CustomerApplication" SET "broadbandUsername" = '\''other'\'' WHERE id = '\''a2'\''' >/dev/null
sql < prisma/migrations/20261021100000_caf_redesign/migration.sql >/dev/null
test "$(sql -Atc 'SELECT COUNT(*) FROM "CustomerApplication"')" = 2
test "$(sql -Atc 'SELECT "storageKey" FROM "Document" WHERE id = '\''d'\'' AND "sizeBytes" = 5242880')" = unchanged-legacy-key
test "$(sql -Atc 'SELECT "broadbandUsername" FROM "CustomerApplication" WHERE id = '\''a1'\''')" = ' Duplicate '
echo 'PASS: legacy duplicate preflight/transaction rollback, additive upgrade, unchanged historical username and 5 MB document reference.'
sql <<'SQL' >/dev/null
INSERT INTO "User" (id,email,name,"passwordHash",role,"companyId","updatedAt")
VALUES ('legacy-staff','legacy-staff@example.test','Legacy staff','preserve-legacy-password-hash','COMPANY_ADMIN','c',NOW());
SQL
sql < prisma/migrations/20261021200000_staff_profiles/migration.sql >/dev/null
test "$(sql -Atc 'SELECT COUNT(*) FROM "User" WHERE id = '\''legacy-staff'\'' AND email = '\''legacy-staff@example.test'\'' AND "passwordHash" = '\''preserve-legacy-password-hash'\'' AND "sessionVersion" = 0 AND "emailVerifiedAt" IS NULL')" = 1
echo 'PASS: staff profile migration preserves existing staff email/password hash, defaults session version to zero and leaves email unverified.'
