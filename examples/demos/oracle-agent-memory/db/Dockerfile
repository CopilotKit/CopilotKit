# Custom Oracle AI Database image for Railway (Option B — self-host).
#
# It is the freely-pullable Oracle Database Free image with the `cookbook` user
# baked in, so the database comes up ready with no manual setup step.
#
# Build + push to a PRIVATE registry ONLY — re-publishing Oracle's image
# publicly violates the Oracle license. See build-and-push.sh.
#
# :latest-lite is the smaller Free variant (faster pulls / less disk on Railway)
# and still includes AI Vector Search. Switch to :latest if you hit a missing
# feature.
FROM container-registry.oracle.com/database/free:latest-lite

# Admin (SYS / SYSTEM / PDBADMIN) password — matches the local docker-compose default.
ENV ORACLE_PWD=cookbook_admin_pw

# Startup scripts (run on every container start, alphabetical order). We use the
# *startup* hook rather than the *setup* hook: the Free image does NOT reliably
# execute setup/ scripts (see the note in db/init/01-create-user.sql), and our SQL
# is idempotent, so running it each boot is safe and robust. Baking it in (vs a
# volume mount) also avoids the mount-timing race the local compose hit.
#
# 00 registers FREEPDB1 with the TCP listener on the container's IPv4 address so the
#    agent can reach it over Railway's dual-stack private network (Railway fix — see
#    the file header). A shell script (not SQL) because it must read the IPv4 from
#    `hostname -I`; UTL_INADDR only yields the IPv6 address. No exec bit / chmod: the
#    image runs as a non-root user (chmod during build is denied), and the startup
#    hook *sources* non-executable .sh files — the script is written to be source-safe.
# 01 creates the `cookbook` application user (idempotent).
COPY init/00-register-listener.sh /opt/oracle/scripts/startup/00-register-listener.sh
COPY init/01-create-user.sql /opt/oracle/scripts/startup/01-create-user.sql
