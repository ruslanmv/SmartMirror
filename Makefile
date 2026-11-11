.PHONY: dev test lint up down register-homepilot persona space

dev:
	uvicorn services.api.app.main:app --reload --host 0.0.0.0 --port 8100

test:
	pytest -q

lint:
	ruff check .
	mypy smartmirror integrations services || true

up:
	docker compose -f infra/compose/docker-compose.yml up --build

down:
	docker compose -f infra/compose/docker-compose.yml down

register-homepilot:
	python scripts/register_homepilot.py

persona:
	python integrations/homepilot/personas/build.py

# Publish committed HEAD to https://huggingface.co/spaces/ruslanmv/SmartMirror
# (needs HF_TOKEN). DRY_RUN=1 stages only; STAGE_TO=... keeps a local copy.
space:
	sh deploy/huggingface/deploy.sh
