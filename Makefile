.PHONY: dev test lint up down register-homepilot persona

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
