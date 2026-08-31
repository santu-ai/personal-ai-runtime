FROM node:20-slim AS builder

ARG VITE_API_HOST=localhost
ARG VITE_API_PORT=8000
ARG VITE_AUTH_TOKEN=
ENV VITE_API_HOST=${VITE_API_HOST}
ENV VITE_API_PORT=${VITE_API_PORT}
ENV VITE_AUTH_TOKEN=${VITE_AUTH_TOKEN}

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

FROM caddy:2-alpine

COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/frontend/dist /usr/share/caddy

EXPOSE 5173
