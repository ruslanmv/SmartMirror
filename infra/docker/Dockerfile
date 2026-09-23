FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml README.md /app/
COPY smartmirror /app/smartmirror
COPY services /app/services
COPY integrations /app/integrations
COPY scripts /app/scripts

RUN pip install --no-cache-dir .

EXPOSE 8100
CMD ["uvicorn", "services.api.app.main:app", "--host", "0.0.0.0", "--port", "8100"]
