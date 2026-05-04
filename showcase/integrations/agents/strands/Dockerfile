FROM python:3.12.13 AS agent-builder
WORKDIR /agent
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

COPY --chown=app:app --from=agent-builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY --chown=app:app src/agent_server.py ./
COPY --chown=app:app src/agents/ ./agents/
COPY --chown=app:app tools/ /app/tools/
ENV PYTHONPATH=/app

COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh
USER app

EXPOSE 8000
CMD ["./entrypoint.sh"]
