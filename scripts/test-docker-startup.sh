#!/bin/sh
# Isolated smoke test: never uses Compose, .env, production databases or volumes.
set -eu
cd "$(dirname "$0")/.."

id="caf-startup-test-$(date +%s)-$$"
image="${CAF_TEST_IMAGE:-$id:local}"
network="$id-net"
db="$id-db"
app="$id-app"
failed="$id-failed"
cleanup() {
  docker rm -f "$app" "$failed" "$db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ -z "${CAF_TEST_IMAGE:-}" ]; then
  docker build --no-cache --progress=plain -t "$image" .
fi

# Compare the installed CLI and client to the project's lockfile, offline.
docker run --rm -i --network none --entrypoint node "$image" -e '
  const assert = require("node:assert/strict");
  const lock = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  for (const name of ["prisma", "@prisma/client"]) {
    const version = require(name + "/package.json").version;
    assert.equal(version, lock.packages["node_modules/" + name].version);
    assert.match(version, /^6\./);
    console.log(name + ": " + version);
  }
  // npm retains TypeScript as an optional production peer.
  const typescript = require("typescript/package.json").version;
  assert.equal(typescript, lock.packages["node_modules/typescript"].version);
  console.log("Prisma optional TypeScript peer: " + typescript);
  for (const name of ["tailwindcss", "tsx"]) {
    assert.throws(() => require.resolve(name + "/package.json"));
  }
' < package-lock.json
docker run --rm --network none --entrypoint node "$image" node_modules/prisma/build/index.js --version

# An unreachable database must terminate startup without starting Next.js.
docker run -d --name "$failed" --network none \
  -e DATABASE_URL='postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=2' \
  -e AUTH_SECRET='isolated-smoke-test-secret-never-use-in-production' \
  -e RUN_SEED=0 "$image" >/dev/null
attempt=0
while [ "$(docker inspect -f '{{.State.Running}}' "$failed")" = true ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$failed"
    echo 'FAIL: migration failure did not terminate startup.' >&2
    exit 1
  fi
  sleep 1
done
docker logs "$failed" > /dev/null
test "$(docker inspect -f '{{.State.ExitCode}}' "$failed")" -ne 0
failure_logs=$(docker logs "$failed" 2>&1)
printf '%s\n' "$failure_logs"
printf '%s\n' "$failure_logs" | grep -q 'Startup failed: database migrations'
if printf '%s\n' "$failure_logs" | grep -q 'Starting CAF Portal'; then
  echo 'FAIL: server started after migration failure.' >&2
  exit 1
fi

# PostgreSQL data is held in test-only tmpfs; no named or existing volumes.
docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke \
  postgres:16-alpine >/dev/null
attempt=0
until docker exec "$db" pg_isready -U smoke -d smoke >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then docker logs "$db"; exit 1; fi
  sleep 1
done
docker run -d --name "$app" --network "$network" \
  -p 127.0.0.1::3000 \
  -e DATABASE_URL="postgresql://smoke:smoke@$db:5432/smoke" \
  -e AUTH_SECRET='isolated-smoke-test-secret-never-use-in-production' \
  -e RUN_SEED=0 "$image" >/dev/null
port=$(docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$app")
attempt=0
until [ "$(curl --noproxy '*' --max-time 3 -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login" || true)" = 200 ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then docker logs "$app"; exit 1; fi
  sleep 1
done
test "$(curl --noproxy '*' --max-time 3 -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")" = 307
docker logs "$app"
echo 'PASS: locked Prisma 6, offline CLI, migration failure exit, /login HTTP 200, / HTTP 307.'
