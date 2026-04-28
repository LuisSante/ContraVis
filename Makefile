PYTHON = python
PIP = pip
UVICORN = uvicorn
NPM = npm --prefix client
BACKUP_DIR=./infra/backups
NEO_CONTAINER=neo4j-dev

.PHONY: setup-backend setup-frontend setup dev help

help:
	@echo "Comands available:"
	@echo "  make setup          - Install all dependencies for backend and frontend""

setup: setup-backend setup-frontend

setup-backend:
	@echo "Installing dependencies in backend"
	cd server && $(PYTHON) -m pip install -r requirements.txt

setup-frontend:
	@echo "Installing dependencies in frontend"
	cd client && npm install

dev-backend:
	@echo "Init FastAPI..."
	cd server && $(PYTHON) -m uvicorn main:app --reload --port 8300

dev-frontend:
	@echo "Init SvelteKit..."
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