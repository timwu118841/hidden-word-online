# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
# Toolchain only needed if better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/hidden-word.sqlite \
    CLIENT_DIST=/app/apps/client/dist
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "start"]
