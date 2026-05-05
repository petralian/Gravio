# ──────────────────────────────────────────────
# Gravio — Production Dockerfile
# Node.js 20 Alpine, single-stage, non-root user
# ──────────────────────────────────────────────

FROM node:20-alpine

# Install native build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first so Docker can cache the npm install layer
COPY package.json package-lock.json ./

# ci installs exact versions from lockfile
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY agent-quality/ ./agent-quality/

# Create non-root user
RUN addgroup -S gravio && adduser -S gravio -G gravio
RUN chown -R gravio:gravio /app

# /data is the persistent volume mount point on Fly.io
# We create it so the directory exists even when running locally without a volume
RUN mkdir -p /data && chown gravio:gravio /data

USER gravio

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/server.mjs"]
