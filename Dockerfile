FROM node:22-alpine AS builder

WORKDIR /app
ENV HUSKY=0

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY index.html postcss.config.js tsconfig.json vite.config.mts ./
COPY messages ./messages
COPY public ./public
COPY src ./src
RUN npm run build

FROM caddy:2-alpine AS production

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
