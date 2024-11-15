
FROM public.ecr.aws/docker/library/python:3.12.0-slim-bullseye
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
ARG EXAMPLE_DIR=examples/coagents-research-canvas/agent

ENV POETRY_VIRTUALENVS_CREATE=false

# Install poetry
RUN pip install poetry

# Use local CopilotKit Python SDK
COPY sdk-python/ /opt/sdk-python
WORKDIR /opt/sdk-python
RUN poetry install

WORKDIR /asset

# Copy poetry files first for better caching
COPY ${EXAMPLE_DIR}/pyproject.toml ${EXAMPLE_DIR}/poetry.lock ./

RUN poetry config virtualenvs.create false \
&& poetry install --no-interaction --no-ansi

RUN poetry add /opt/sdk-python

# Then copy the application code
COPY ${EXAMPLE_DIR}/ ./

CMD ["poetry", "run", "demo"]