# One image for staging and prod: the Hono server, which serves the API and the built SPA.
# Environment-specific settings (database URLs, secrets, Sentry) come from Fly at runtime.
#
#   docker build -t ping .
#
# Keep the Node major in step with .nvmrc.
FROM node:26.13.1-slim AS base
ENV CI=true
WORKDIR /app
# Node 25+ ships without corepack, so install the pnpm version package.json pins.
COPY package.json ./
RUN npm install --global --no-fund --no-audit \
      "$(node -p "require('./package.json').packageManager")"

# The manifests every install needs, copied first so a source change keeps the
# dependency layers cached.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Builds the SPA into apps/web/dist.
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json ./
COPY apps/web apps/web
COPY apps/server apps/server
COPY packages/shared packages/shared
RUN pnpm build

# The server's production dependencies and nothing else.
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@ping/server..."

FROM node:26.13.1-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=prod-deps /app ./
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
WORKDIR /app/apps/server
EXPOSE 8080
# Node directly, with tsx as a loader: no pnpm wrapper and no tsx child process, because
# prod has 256 MB. index.ts handles SIGINT and SIGTERM, so Node can be PID 1.
CMD ["node", "--import", "tsx", "src/index.ts"]
