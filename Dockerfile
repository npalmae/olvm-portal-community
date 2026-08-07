FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
COPY prisma ./prisma
RUN npm install
COPY scripts/patch-novnc.cjs ./scripts/patch-novnc.cjs
RUN node ./scripts/patch-novnc.cjs

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssh-client sshpass tar gzip \
    && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/postgresql.asc \
    && printf '%s\n' 'deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npm cache clean --force
RUN npx prisma generate
COPY scripts/patch-novnc.cjs ./scripts/patch-novnc.cjs
RUN node ./scripts/patch-novnc.cjs

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

COPY scripts/migrate-json.cjs ./scripts/migrate-json.cjs
COPY scripts/backup-scheduler.cjs ./scripts/backup-scheduler.cjs
COPY proxy-server.js ./proxy-server.js
COPY start.sh ./start.sh
RUN mkdir -p data && chmod +x start.sh

EXPOSE 3000
EXPOSE 3010

CMD ["./start.sh"]
