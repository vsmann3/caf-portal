#!/bin/sh
set -eu

cd /app
PRISMA_CLI=/app/node_modules/prisma/build/index.js
if [ ! -f "$PRISMA_CLI" ]; then
  echo "Startup failed: the locked Prisma CLI is missing from the image." >&2
  exit 1
fi

node -e 'console.log("Migration Prisma CLI version: " + require("/app/node_modules/prisma/package.json").version)'

echo "Running database migrations…"
if node "$PRISMA_CLI" migrate deploy --schema=/app/prisma/schema.prisma; then
  echo "Database migrations completed."
else
  status=$?
  echo "Startup failed: database migrations exited with status $status; Next.js will not start." >&2
  exit "$status"
fi

if [ "${RUN_SEED:-0}" = "1" ]; then
  echo "Seeding initial data…"
  node prisma/seed.js 2>/dev/null || npx tsx prisma/seed.ts || true
fi

echo "Starting CAF Portal…"
exec node server.js
