
cd agent || exit /b 1

if not exist ".venv" (
    python -m venv .venv
)

.venv\Scripts\activate.ps1

pip install poetry
poetry install --no-root