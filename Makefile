# Synesthete — developer commands
VENV := .venv
PY   := $(VENV)/bin/python

.PHONY: help doctor analyzer dev fixtures analyze test typecheck screenshot

help:
	@echo "Synesthete targets:"
	@echo "  make doctor      dependency preflight (analyzer venv)"
	@echo "  make analyzer    run the FastAPI analyzer service on :8000"
	@echo "  make dev         run the Vite frontend dev server"
	@echo "  make fixtures    generate synthetic test fixtures -> fixtures/"
	@echo "  make analyze FILE=path.wav   POST a file to the running analyzer"
	@echo "  make test        frontend (vitest) + analyzer (pytest)"
	@echo "  make typecheck   strict TypeScript check"
	@echo "  make screenshot  headless render screenshot -> test/screenshots/"

doctor:
	$(PY) -m analyzer.doctor

analyzer:
	$(VENV)/bin/uvicorn analyzer.api:app --reload --port 8000

dev:
	npm run dev

fixtures:
	$(PY) -m analyzer.make_fixtures

analyze:
	@test -n "$(FILE)" || (echo "usage: make analyze FILE=path/to/audio.wav"; exit 1)
	curl -s -F "file=@$(FILE)" http://127.0.0.1:8000/analyze | python3 -m json.tool

typecheck:
	npm run typecheck

test:
	npm test
	$(PY) -m pytest analyzer/tests -q

screenshot:
	npm run screenshot
