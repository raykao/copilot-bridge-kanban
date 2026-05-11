FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json tsconfig.server.json tsconfig.client.json ./
COPY index.html vite.config.ts ./
COPY postcss.config.js ./
COPY src/ src/
RUN npm run build

FROM node:22-slim AS production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm
COPY --from=build /app/dist ./dist
RUN mkdir -p /data
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/kanban.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
