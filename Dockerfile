FROM node:22-alpine AS base
RUN apk add --no-cache openssl

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
RUN npx prisma generate
RUN mkdir -p /data/images && chown -R nextjs:nodejs /data
USER nextjs
ENV DATA_DIR=/data
ENV HOSTNAME=0.0.0.0
ENV PORT=3456
EXPOSE 3456
CMD ["sh", "-c", "node scripts/check-env.js && npx prisma migrate deploy && node scripts/seed-admin.js && node scripts/seed-flow-providers.js && if [ -f /data/db.json ] && [ ! -f /data/.db-json-imported ]; then node scripts/migrate-db-json-to-postgres.js /data/db.json && touch /data/.db-json-imported; fi && node server.js"]
