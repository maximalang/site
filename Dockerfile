# syntax=docker/dockerfile:1.7
FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS dependencies

WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/codex-worker/package.json apps/codex-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/codex-adapter/package.json packages/codex-adapter/package.json
COPY packages/conversation-service/package.json packages/conversation-service/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/model-gateway/package.json packages/model-gateway/package.json
COPY packages/openclaw-adapter/package.json packages/openclaw-adapter/package.json
COPY packages/postgres-store/package.json packages/postgres-store/package.json
COPY packages/read-model/package.json packages/read-model/package.json
RUN npm ci --ignore-scripts

FROM dependencies AS build
COPY . .
RUN npm run clean && npm run build

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS runtime

ENV HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    PORT=3000
WORKDIR /app

RUN groupadd --system --gid 10001 agent-world \
    && useradd --system --uid 10001 --gid agent-world --home-dir /nonexistent agent-world
COPY --from=build --chown=10001:10001 /workspace/apps/web/.next/standalone ./

USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
