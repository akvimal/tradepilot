FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/types/package.json packages/types/package.json

RUN npm ci

COPY apps ./apps
COPY packages ./packages

RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/package.json /app/package-lock.json /app/tsconfig.json /app/tsconfig.base.json ./
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

CMD ["node", "apps/api/dist/apps/api/src/index.js"]
