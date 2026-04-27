FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts/patch-novnc.cjs ./scripts/patch-novnc.cjs
RUN node ./scripts/patch-novnc.cjs

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY scripts/patch-novnc.cjs ./scripts/patch-novnc.cjs
RUN node ./scripts/patch-novnc.cjs

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/data ./data

EXPOSE 3000
EXPOSE 3010

CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
