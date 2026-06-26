PYTHON = python
PIP = pip
UVICORN = uvicorn
PNPM = pnpm -C web
NPM = npm --prefix client
WEB_PORT = 3000
BACKUP_DIR=./infra/backups
NEO_CONTAINER=neo4j-dev

.PHONY: setup-backend setup-frontend setup-frontend-svelte setup dev \
	dev-backend dev-frontend dev-frontend-svelte build-frontend help

help:
	@echo "Commands available:"
	@echo "  make setup                 - Install all dependencies (backend + frontend)"
	@echo "  make setup-backend         - Install backend (FastAPI) dependencies"
	@echo "  make setup-frontend        - Install frontend (Next.js, web/) dependencies"
	@echo "  make dev-backend           - Run FastAPI on :8300"
	@echo "  make dev-frontend          - Run Next.js dev server (web/) on :$(WEB_PORT)"
	@echo "  make build-frontend        - Production build of the Next.js app (web/)"
	@echo "  make dev-frontend-svelte   - Run the legacy SvelteKit client (client/)"

setup: setup-backend setup-frontend

setup-backend:
	@echo "Installing dependencies in backend"
	cd server && $(PYTHON) -m pip install -r requirements.txt

setup-frontend:
	@echo "Installing dependencies in frontend (Next.js, web/)"
	$(PNPM) install

dev-backend:
	@echo "Init FastAPI..."
	cd server && $(PYTHON) -m uvicorn main:app --reload --port 8300

dev-frontend:
	@echo "Init Next.js (web/)..."
	$(PNPM) dev --port $(WEB_PORT)

build-frontend:
	@echo "Building Next.js app (web/)..."
	$(PNPM) build

# --- Legacy SvelteKit client (se elimina al validar la migración a Next.js) ---
setup-frontend-svelte:
	@echo "Installing dependencies in legacy SvelteKit client"
	cd client && npm install

dev-frontend-svelte:
	@echo "Init SvelteKit (legacy client/)..."
	$(NPM) run dev -- --open --port 5173

preprocess:
	@echo "Preprocessing data..."
	cd notebooks/KG && $(PYTHON) create_kg.py

# Neo4j Backup
backup:
	@mkdir -p $(BACKUP_DIR)
	docker exec $(NEO_CONTAINER) neo4j stop || true
	docker exec $(NEO_CONTAINER) rm -f /var/lib/neo4j/backups/neo4j.dump
	docker exec $(NEO_CONTAINER) mkdir -p backups
	docker exec $(NEO_CONTAINER) neo4j-admin database dump neo4j --to-path=backups
	docker cp $(NEO_CONTAINER):/var/lib/neo4j/backups/neo4j.dump $(BACKUP_DIR)
	docker exec $(NEO_CONTAINER) neo4j start || true

# Neo4j Restore
restore:
ifeq ($(FORCE),true)
	@echo "FORCE enabled: removing old volumes..."
		sudo rm -rf infra/volumes/minio-data/ \
				infra/volumes/neo4j-data/ \
				infra/volumes/neo4j-logs/ \
				infra/volumes/neo4j-import/ \
				infra/volumes/neo4j-plugins/
else
	@echo "INFO: Old volumes will NOT be removed. Use 'make restore FORCE=true' to force deletion."
endif
	@mkdir -p $(BACKUP_DIR)
	docker exec $(NEO_CONTAINER) neo4j stop || true
	docker exec $(NEO_CONTAINER) rm -rf /var/lib/neo4j/data/databases/neo4j
	docker exec $(NEO_CONTAINER) rm -rf /var/lib/neo4j/data/transactions/neo4j
	docker exec $(NEO_CONTAINER) mkdir -p /var/lib/neo4j/backups
	docker cp ./infra/backups/neo4j.dump $(NEO_CONTAINER):/var/lib/neo4j/backups/neo4j.dump
	docker exec $(NEO_CONTAINER) neo4j-admin database load --from-path=backups --overwrite-destination=true neo4j
	docker exec $(NEO_CONTAINER) neo4j start || true