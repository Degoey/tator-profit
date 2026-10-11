# syntax=docker/dockerfile:1
#
# Tatorprofit — production image for Next.js 16 (App Router) + Prisma 6.
#
# Multi-stage: `deps` installs the exact locked dependency tree, `builder` compiles
# the standalone server, `runner` ships only what is needed to serve traffic.
# The final image runs as the unprivileged `nextjs` user and never contains `.env`.

# ---------------------------------------------------------------------------
# Stage 1 — dependencies (cached unless package.json / lockfile / schema change)
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
# libc6-compat: glibc shims some native modules expect on musl.
# openssl: required by the Prisma query engine.
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
# The schema is needed here so Prisma's postinstall can generate the client.
COPY prisma ./prisma

RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so they
# must be present now, not at runtime. Override with --build-arg for each target
# environment (they are public by definition, never secrets).
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ARG NEXT_PUBLIC_WHATSAPP_CS_NUMBER="62xxxxxxxxxx"
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_WHATSAPP_CS_NUMBER=$NEXT_PUBLIC_WHATSAPP_CS_NUMBER

# Build-time-only placeholders. `next build` runs with NODE_ENV=production, and the
# app refuses to start without a >=32 character AUTH_TOKEN_SECRET in that mode.
# Passed inline on the RUN line (not as ARG/ENV) so they never land in the image
# configuration or in a layer's metadata — only the real runtime value is used.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    AUTH_TOKEN_SECRET="build-time-placeholder-not-a-real-secret-000000" \
    sh -c 'npx prisma generate && npm run build'

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
# openssl is still needed at runtime by the Prisma engine.
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PAYMENT_PROOF_DIR=/app/storage/payment-proofs

# Unprivileged runtime user (uid/gid 1001). No shell, no home directory.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# Standalone output: server.js plus only the traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma CLI + engines so the container can run `prisma migrate deploy` on start.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# Private payment-proof directory: a mounted volume, owned by the runtime user.
RUN mkdir -p /app/storage/payment-proofs \
 && chown -R nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
