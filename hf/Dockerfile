# Hugging Face Docker Space — https://huggingface.co/spaces/ruslanmv/SmartMirror
# Must listen on 7860. SQLite + local media; no Postgres/MinIO required.
# Build context is the staged tree from deploy/huggingface/deploy.sh (repo HEAD).

FROM python:3.11-slim

RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

# Install the project from the staged monorepo tree.
COPY --chown=user ./pyproject.toml ./README.md ./LICENSE ./
COPY --chown=user ./smartmirror ./smartmirror
COPY --chown=user ./services ./services
COPY --chown=user ./integrations ./integrations
COPY --chown=user ./packages ./packages
COPY --chown=user ./app.py ./app.py

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir .

USER root
RUN mkdir -p /app/data/media && chown -R user:user /app/data
USER user

# Space defaults (override with Space variables / secrets).
ENV SMARTMIRROR_ENV=space \
    SMARTMIRROR_HOST=0.0.0.0 \
    SMARTMIRROR_PORT=7860 \
    SMARTMIRROR_DATABASE_URL=sqlite:////app/data/smartmirror.db \
    SMARTMIRROR_STORAGE=local \
    SMARTMIRROR_MEDIA_DIR=/app/data/media \
    SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud \
    SMARTMIRROR_GROK_IMAGINE=false \
    SMARTMIRROR_INLINE_JOBS=true \
    SMARTMIRROR_SHOPPING=linkout \
    OLLABRIDGE_BASE_URL=https://api.ollabridge.com

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
