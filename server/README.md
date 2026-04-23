# Backend (`server`)

FastAPI service to list CUAD DOCX contracts, serve files, and build a relationship graph from paragraph data.

## Requirements

- Python 3.11+ recommended.
- `pip`.

## Installation

From the repository root:

```bash
make setup-backend
```

Or manually:

```bash
cd server
python3 -m pip install -r requirements.txt
```

## Environment variables

`server/.env` (optional for LLM features and Neo4j health check):

```bash
GEMINI_API_KEY=your_api_key
OPENAI_API_KEY=your_api_key
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j_password
NEO4J_DATABASE=neo4j
```

Notes:

- Contract assistant uses `GEMINI_API_KEY` by default.
- OpenAI support is available via provider selection when `OPENAI_API_KEY` is configured.
- Neo4j vars are used by `/health` and `/health/neo4j` connectivity checks.
- Do not commit `.env` files.

## Run in development

From repository root:

```bash
make dev-backend
```

Or manually:

```bash
cd server
python3 -m uvicorn main:app --reload --port 8300
```

Local base URL: `http://localhost:8300`

## Endpoints

- `GET /`: simple status message.
- `GET /health`: health check.
- `GET /health/neo4j`: direct Neo4j health check (`200` or `503`).
- `GET /api/v1/list_documents`: list available CUAD documents.
- `GET /api/v1/document_file/{doc_id}`: download DOCX by id.
- `POST /api/v1/process`: generate the base paragraph graph (`nodes` + `edges`) with local JSON cache (`infra/json/graph_cache` by default).
- `POST /api/v1/assistant/chat`: contract assistant response with paragraph citations.

## Data dependency

`DocumentStore` loads files from:

- `../infra/CUAD_v1/full_contract_docx` (relative to `server/`).

Because of this, start the backend from `server/` or use `make dev-backend` (already does `cd server`).

## Performance notes

- `POST /api/v1/process` uses `sentence-transformers` (`all-MiniLM-L6-v2`).
- On first run, model download/initialization can take longer.
- Current implementation instantiates the model per request.

## Common issues

- `Dataset directory not found`: verify `infra/CUAD_v1/full_contract_docx` exists.
- Empty document list: dataset folder is empty or initialization failed.
- Dependency/import errors: reinstall with `pip install -r requirements.txt`.
