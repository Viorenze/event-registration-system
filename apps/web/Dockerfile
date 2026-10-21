FROM event-system-api:latest
WORKDIR /app

# Copy web manifest and install web dependencies
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# Copy web source
COPY apps/web ./apps/web

ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Build web application
RUN pnpm --filter @event-system/web build

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["pnpm", "start"]
