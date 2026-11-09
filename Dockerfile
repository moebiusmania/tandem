# syntax=docker/dockerfile:1.7

# Base images are pinned by digest (multi-arch index) for reproducible builds. To update, bump
# BUN_VERSION and replace both digests with the ones `docker pull <image:tag>` prints.
ARG BUN_VERSION=1.4.4

# ── build: install deps, vendor browser assets, bundle the server and the user CLI ──
FROM oven/bun:${BUN_VERSION}-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e AS build
WORKDIR /app

COPY package.json bun.lock ./
# Lifecycle scripts stay off while installing; the only one (vendor.ts) runs below, explicitly.
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun scripts/vendor.ts \
 && bun build src/index.ts --target=bun --define 'process.env.NODE_ENV="production"' --outfile=dist/server.js \
 && bun build scripts/create-user.ts --target=bun --define 'process.env.NODE_ENV="production"' --outfile=dist/create-user.js \
 && mkdir -p /out/data

# ── runtime: distroless (no shell, no package manager), non-root ──
FROM oven/bun:${BUN_VERSION}-distroless@sha256:153a951ae40106e125898103e6e990ee0f38e6aee7f561029e26cf9fbed23470 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/tandem.sqlite \
    HOME=/tmp \
    TMPDIR=/tmp \
    TZ=UTC \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

# Code and assets are owned by root and read-only for the app user; only data/ is writable.
COPY --from=build /app/dist/server.js /app/dist/create-user.js ./
COPY --from=build /app/public ./public
# Owned by the app user so a fresh named volume inherits the right owner.
COPY --from=build --chown=65532:65532 /out/data ./data

USER 65532:65532
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/bun", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/bun"]
CMD ["server.js"]
