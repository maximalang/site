FROM node:24.15.0-bookworm-slim

ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/native-chat-auth/package.json ./apps/native-chat-auth/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @agent-world/native-chat-auth \
    && npm cache clean --force \
    && test "$(id -u node)" = "1000" \
    && test "$(id -g node)" = "1000"
COPY apps/native-chat-auth/src ./apps/native-chat-auth/src
WORKDIR /app/apps/native-chat-auth
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/entrypoint.js"]
