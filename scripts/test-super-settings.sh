#!/bin/sh
# Isolated app, PostgreSQL and SMTP capture server. Never uses production .env.
set -eu
cd "$(dirname "$0")/.."
id="caf-settings-test-$(date +%s)-$$"
image="${CAF_TEST_IMAGE:-$id:local}"
network="$id-net"
db="$id-db"
mail="$id-mail"
app="$id-app"
passed=0
cleanup() {
  if [ "${CAF_KEEP_TEST:-0}" = 1 ] && [ "$passed" = 1 ]; then
    echo "Retained isolated fixture: $id"
  else
    docker rm -f "$app" "$mail" "$db" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
if [ -z "${CAF_TEST_IMAGE:-}" ]; then docker build --no-cache --progress=plain -t "$image" .; fi
docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke postgres:16-alpine >/dev/null
docker run -d --name "$mail" --network "$network" --network-alias mail \
  --mount "type=bind,src=$PWD/scripts/test-smtp-server.cjs,dst=/fixture.cjs,readonly" \
  node:22-alpine node /fixture.cjs >/dev/null
attempt=0
until docker exec "$db" pg_isready -h 127.0.0.1 -U smoke -d smoke >/dev/null 2>&1; do
  attempt=$((attempt + 1)); if [ "$attempt" -ge 60 ]; then docker logs "$db"; exit 1; fi
  sleep 1
done
docker run -d --name "$app" --network "$network" -p 127.0.0.1::3000 \
  -e DATABASE_URL="postgresql://smoke:smoke@$db:5432/smoke" \
  -e AUTH_SECRET=isolated-settings-test-secret-never-use-in-production \
  -e APP_URL=https://portal.example.test -e RUN_SEED=1 -e CAF_ISOLATED_TEST=1 \
  -e SEED_SUPER_ADMIN_EMAIL=settings-admin@example.test \
  -e SEED_SUPER_ADMIN_PASSWORD=isolated-settings-admin-password "$image" >/dev/null
port=$(docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$app")
attempt=0
until [ "$(curl --noproxy '*' --max-time 3 -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login" || true)" = 200 ]; do
  attempt=$((attempt + 1)); if [ "$attempt" -ge 60 ]; then docker logs "$app"; exit 1; fi
  sleep 1
done
docker exec -i "$app" node < scripts/test-super-settings.cjs
docker exec -i "$app" node < scripts/test-caf.cjs
docker exec -i "$app" node < scripts/test-profile.cjs
docker exec -i "$app" node < scripts/test-caf-pdf.cjs
docker exec -i "$app" node < scripts/test-radius-safety.cjs
passed=1
printf 'TEST_APP=%s\nTEST_DB=%s\nTEST_MAIL=%s\nTEST_NETWORK=%s\nTEST_PORT=%s\nTEST_IMAGE=%s\n' "$app" "$db" "$mail" "$network" "$port" "$image" > test-fixture.env
echo "PASS: settings and SMTP integration. Test port: $port"
