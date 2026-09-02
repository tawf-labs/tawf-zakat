# Multi-stage Dockerfile for Tawf Zakat Protocol Backend & Frontend Services
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Stage 1: Dependencies
FROM base AS dependencies
COPY package.json bun.lock* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN bun install --frozen-lockfile

# Stage 2: Backend Runtime
FROM base AS backend
COPY --from=dependencies /app/node_modules ./node_modules
COPY backend ./backend
WORKDIR /app/backend
EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001
CMD ["bun", "run", "src/index.ts"]

# Stage 3: Frontend Build & Runtime
FROM base AS frontend
COPY --from=dependencies /app/node_modules ./node_modules
COPY frontend ./frontend
WORKDIR /app/frontend
RUN bun run build
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["bun", "run", ".output/server/index.mjs"]
