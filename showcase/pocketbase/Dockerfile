# Install the official PocketBase binary straight from GitHub releases.
# Rationale: there is no first-party `ghcr.io/pocketbase/pocketbase` image,
# and community images (`muchobien/pocketbase`, `spectado/pocketbase`, etc.)
# add an untracked supply-chain dependency for what is really a single-
# binary Go app. Downloading the release artifact is reproducible and
# pinned via PB_VERSION + published SHA256 (verified below).
FROM alpine:3.19 AS fetch
ARG PB_VERSION=0.22.21
ARG TARGETARCH
# Checksums taken from the official release checksums.txt (signed by the
# PocketBase release pipeline). These cover the two arches we actually
# ship (linux/amd64 and linux/arm64). Extend this map if/when we add
# another arch to the Railway deploy matrix.
# Source: https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/checksums.txt
ARG PB_SHA256_AMD64=b63271053a2ea2c703f3438a8fc7db89775d6f5667765b72a5157bfaa35414e6
ARG PB_SHA256_ARM64=280e9e62c29e26fda1f5fc0f6870a780766532fcbd2c301013866c7457363ed9
RUN set -eux; \
    apk add --no-cache ca-certificates unzip wget; \
    case "${TARGETARCH:-amd64}" in \
      amd64) ARCH_SLUG=amd64; EXPECTED_SHA="${PB_SHA256_AMD64}" ;; \
      arm64) ARCH_SLUG=arm64; EXPECTED_SHA="${PB_SHA256_ARM64}" ;; \
      *) echo "unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    ASSET="pocketbase_${PB_VERSION}_linux_${ARCH_SLUG}.zip"; \
    wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${ASSET}" -O /tmp/pb.zip; \
    # Verify the downloaded artifact against the pinned SHA256 before we
    # touch it. `sha256sum -c` exits non-zero on mismatch, which aborts
    # the build — a tampered or corrupted artifact never reaches the
    # runtime stage.
    echo "${EXPECTED_SHA}  /tmp/pb.zip" | sha256sum -c -; \
    unzip -q /tmp/pb.zip -d /pb; \
    chmod +x /pb/pocketbase; \
    /pb/pocketbase --version

FROM alpine:3.19
# `su-exec` is alpine's minimal privilege-drop helper (~30 KB static
# binary). Used by entrypoint.sh to run PocketBase as `pocketbase` while
# still being able to chown /pb_data at container start — see the
# entrypoint for the full rationale.
RUN apk add --no-cache ca-certificates su-exec
# Create a non-root user + group for the runtime. PocketBase needs write
# access to /pb_data (SQLite db + uploads). We pre-create the directory
# and chown it at build time for the case where no volume is mounted,
# but note: Railway mounts a fresh root-owned volume at /pb_data which
# clobbers this chown. entrypoint.sh re-chowns at container start to
# handle that path, then drops to the `pocketbase` user via su-exec.
RUN addgroup -S pocketbase && adduser -S -G pocketbase pocketbase \
    && mkdir -p /pb_data \
    && chown -R pocketbase:pocketbase /pb_data
COPY --from=fetch /pb/pocketbase /usr/local/bin/pocketbase
# Migration convention: PocketBase itself prefixes migration runtime errors
# with the filename ("failed to apply migration <file>: <err>"), so we rely
# on that rather than hand-wrapping every up/down with a prefix helper.
# If PB's logging ever stops including the filename, wrap each up/down
# with `try { ... } catch (e) { throw new Error('[migration <file>] ' + e) }`.
COPY --chown=pocketbase:pocketbase pb_migrations /pb_migrations
COPY --chown=pocketbase:pocketbase pb_hooks /pb_hooks
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
VOLUME ["/pb_data"]
EXPOSE 8090
# Run as root so entrypoint.sh can chown the freshly-mounted volume.
# The shim drops to the `pocketbase` user via su-exec before exec()ing
# the pocketbase binary — so PB still runs unprivileged.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "serve", "--http=0.0.0.0:8090", "--dir=/pb_data", "--migrationsDir=/pb_migrations", "--hooksDir=/pb_hooks"]
