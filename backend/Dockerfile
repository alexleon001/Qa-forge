# Build context: raíz del repo (qa-forge/). Esto nos permite COPIAR shared/
# además de backend/.
#
# Imagen base: Playwright oficial sobre Ubuntu 22.04 (incluye Chromium + libs).
# Añadimos Bun encima.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV BUN_INSTALL=/usr/local
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10" \
  && ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer cache: deps primero.
COPY backend/package.json backend/bun.lock* ./backend/
RUN cd backend && (bun install --frozen-lockfile || bun install)

# Código del backend y del shared (que importan los runners/analyzers).
COPY backend/ ./backend/
COPY shared/ ./shared/

WORKDIR /app/backend
RUN bunx prisma generate --schema=src/db/schema.prisma

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Push del schema (idempotente) + arranque.
CMD bunx prisma db push --schema=src/db/schema.prisma --accept-data-loss \
  && bun src/index.js
