FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace package manifests
COPY package*.json ./
COPY packages/client/package*.json ./packages/client/
COPY packages/server/package*.json ./packages/server/

RUN npm install --workspaces

# Copy source
COPY . .

# VITE_CLIENT_ID is not secret — embed it at build time
ARG VITE_CLIENT_ID
ENV VITE_CLIENT_ID=$VITE_CLIENT_ID

RUN npm run build

# ── Runtime image ──────────────────────────────────────────────
FROM node:20-alpine

# Fonts needed for @napi-rs/canvas text rendering
RUN apk add --no-cache fontconfig ttf-freefont

WORKDIR /app

COPY package*.json ./
COPY packages/server/package*.json ./packages/server/

# Install only server production dependencies
RUN npm install --workspace=packages/server --omit=dev

COPY --from=builder /app/packages/server ./packages/server
COPY --from=builder /app/packages/client/dist ./packages/client/dist

EXPOSE 3001
CMD ["node", "packages/server/src/app.js"]
