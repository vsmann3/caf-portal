# ---- shared native runtime requirements ----
FROM node:22-alpine AS base
RUN apk add --no-cache openssl

# ---- deps ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Keep the complete locked production dependency graph, including the Prisma CLI
# and its engines. Do not rely on Next.js tracing a CLI it never imports.
FROM base AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --omit=dev --omit=peer --no-audit --no-fund

# ---- build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p public && node node_modules/prisma/build/index.js generate && npm run build
RUN node node_modules/typescript/bin/tsc prisma/seed.ts --outDir seed-runtime --module commonjs --target ES2020 --esModuleInterop --skipLibCheck
# The runner gets its production tree below; discard redundant traced copies
# instead of merging any extra traced dependencies back into that tree.
RUN rm -rf .next/standalone/node_modules

# ---- run ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/public ./public
# Keep the unchanged production tree cached across application rebuilds.
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/assets/fonts ./assets/fonts
COPY --from=builder /app/seed-runtime ./seed-runtime
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/storage /app/.next/cache && chown -R appuser:appgroup /app/storage /app/.next/cache

USER appuser
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
