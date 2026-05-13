# Build context: raíz del repo (qa-forge/).
# Multi-stage: build con Bun, sirve con nginx alpine.

FROM oven/bun:1.3-alpine AS build
WORKDIR /app

# Deps primero (layer cache).
COPY frontend/package.json frontend/bun.lock* ./frontend/
RUN cd frontend && (bun install --frozen-lockfile || bun install)

# Código del frontend y del shared (que importa el frontend si llegara a usarlo).
COPY frontend/ ./frontend/
COPY shared/ ./shared/

ARG VITE_API_URL=http://localhost:3001
ARG VITE_SOCKET_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

WORKDIR /app/frontend
RUN bun run build

# ── Runtime ──
FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
