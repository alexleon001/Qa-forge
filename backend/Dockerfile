# Build context: raíz del repo (qa-forge/). Esto nos permite COPIAR shared/
# además de backend/.
#
# Imagen base: Playwright oficial sobre Ubuntu 22.04 (incluye Chromium + libs).
# Bun se copia desde su imagen oficial.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# Bun copiado desde su imagen oficial (variante debian/glibc — compatible con la
# base Ubuntu). Evita `apt-get` en el build: la verificación de firmas de apt
# falla seguido en los builders de Railway (errores GPG / "no space left").
COPY --from=oven/bun:1.3.10 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx

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
# PORT no se hardcodea — Railway/Render/Fly inyectan su propio $PORT que la
# app lee via process.env.PORT (default 3001 para dev local).
EXPOSE 3001

# Push del schema (idempotente) + arranque.
CMD bunx prisma db push --schema=src/db/schema.prisma --accept-data-loss \
  && bun src/index.js
