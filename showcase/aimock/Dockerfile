FROM ghcr.io/copilotkit/aimock:1.13.0
COPY smoke.json /fixtures/smoke.json
COPY feature-parity.json /fixtures/feature-parity.json
CMD ["--proxy-only", \
     "--provider-openai", "https://api.openai.com", \
     "--provider-anthropic", "https://api.anthropic.com", \
     "--provider-gemini", "https://generativelanguage.googleapis.com", \
     "--fixtures", "/fixtures", \
     "--host", "0.0.0.0", \
     "--port", "4010"]
