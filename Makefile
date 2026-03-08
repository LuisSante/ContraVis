PYTHON = python
PIP = pip
UVICORN = uvicorn
NPM = npm --prefix client

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