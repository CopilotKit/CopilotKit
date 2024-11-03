FROM public.ecr.aws/docker/library/python:3.12.0-slim-bullseye
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /asset

ENV POETRY_VIRTUALENVS_CREATE=false

# Install poetry
RUN pip install poetry

# Copy poetry files first for better caching
COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi

# Then copy the application code
COPY ./ ./

CMD ["poetry", "run", "demo"]