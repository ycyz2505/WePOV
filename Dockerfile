# 第一人称 / WePOV 运行时镜像
# 生产直接以 tsx 运行 TypeScript：workspace 包以 src 形式互相引用，
# 免去多包编译顺序，构建结果与 CI 一致。

FROM node:22.11.0-bookworm-slim AS base
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NODE_ENV=production
WORKDIR /app

# 依赖层单独缓存
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/android/package.json apps/android/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/security/package.json packages/security/
COPY packages/ui/package.json packages/ui/
RUN npm ci --include=dev --workspaces --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build --workspace @wepov/web

FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json .npmrc ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["/usr/local/bin/start.sh"]
