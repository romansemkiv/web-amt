# WebAMT — Intel(R) AMT web console
# Minimal production image for the stateless WebSocket <-> TCP/TLS relay.

FROM node:20-alpine

# Small init so signals (Ctrl+C, docker stop) are handled cleanly
RUN apk add --no-cache tini

WORKDIR /app

# Install only production dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the application
COPY server.js mps.js ./
COPY public ./public

# Run as the built-in unprivileged node user
USER node

ENV NODE_ENV=production
# 3000 = web console; 4433 = MPS/CIRA listener (only used when --mps is passed).
EXPOSE 3000 4433

ENTRYPOINT ["/sbin/tini", "--"]
# --any binds 0.0.0.0 so the port is reachable from outside the container.
# To enable CIRA, override the command, e.g.:
#   command: ["node","server.js","--any","--mps","--mps-user","admin","--mps-pass","secret"]
CMD ["node", "server.js", "--any"]
