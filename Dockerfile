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
COPY server.js ./
COPY public ./public

# Run as the built-in unprivileged node user
USER node

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# --any binds 0.0.0.0 so the port is reachable from outside the container.
CMD ["node", "server.js", "--any"]
