#!/bin/sh
set -e

echo "Running database migrations…"
npx prisma migrate deploy

if [ "$RUN_SEED" = "1" ]; then
  echo "Seeding initial data…"
  node prisma/seed.js 2>/dev/null || npx tsx prisma/seed.ts || true
fi

echo "Starting CAF Portal…"
exec node server.js
