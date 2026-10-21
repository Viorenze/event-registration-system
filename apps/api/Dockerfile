FROM node:24-alpine
RUN exit 1
WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g pnpm@12.14.0 && \
    pnpm config set registry https://registry.npmmirror.com

# Copy workspace definition and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

# Install dependencies strictly according to lockfile
RUN pnpm install --frozen-lockfile

# Copy tsconfigs and source code
COPY tsconfig.base.json tsconfig.json ./
COPY packages/db ./packages/db
COPY apps/api ./apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV API_PORT=3001
ENV API_HOST=0.0.0.0
EXPOSE 3001

CMD ["node", "src/index.ts"]
