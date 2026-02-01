# OpenClaw Hosted Platform Dockerfile
# Runs the OpenClaw gateway for hosted cloud deployments

FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Copy hosted config for cloud deployments (enables chat API, disables device pairing)
COPY docker/hosted-config.json /app/hosted-config.json

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
USER node

# Create state directory
RUN mkdir -p /tmp/.openclaw

# Expose the gateway port
EXPOSE 8080

# Start the gateway in HTTP server mode
# - Use "gateway" directly (not "gateway run") - the run subcommand has option parsing issues
# - --bind lan: Bind to all interfaces (0.0.0.0)
# - --allow-unconfigured: Allow starting without gateway.mode=local in config
# - Token auth is required for non-loopback binding, injected via OPENCLAW_GATEWAY_TOKEN env var
CMD ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "8080", "--allow-unconfigured"]
