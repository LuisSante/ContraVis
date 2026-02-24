# Document Graph

Monorepo to explore CUAD contracts in DOCX format, edit paragraphs, and build a paragraph relationship graph.

## Repository structure

- `client/`: SvelteKit frontend (Vite + TypeScript).
- `server/`: FastAPI backend.
- `infra/`: Datasets and support files (CUAD, ContractNLI, etc.).
- `notebooks/`: Exploration and experiment notebooks.

## Requirements

- Python 3.11+ recommended.
- Node.js 20+ recommended.
- `npm`.

## Quick start (full stack)

1. Install dependencies:

```bash
make setup
```

2. Configure environment variables:

- Frontend (`client/.env`):

```bash
PUBLIC_DEV_LOCAL=http://localhost:8300/api/v1
```

- Backend (`server/.env`, currently optional):

```bash
OPENAI_API_KEY=your_api_key
```

3. Start backend (terminal 1):

```bash
make dev-backend
```

4. Start frontend (terminal 2):

```bash
make dev-frontend
```

5. Open the app:

- Frontend: http://localhost:5173
- Backend health endpoint: http://localhost:8300/health

## Current workflow

1. Frontend requests documents with `GET /api/v1/list_documents`.
2. After selecting a document, it downloads the DOCX with `GET /api/v1/document_file/{doc_id}`.
3. Frontend renders the document and supports local paragraph editing.
4. `POST /api/v1/process` is available to generate graph data from paragraph input.

## Data dependency (important)

The backend reads documents from:

- `infra/CUAD_v1/full_contract_docx`

If this folder is missing or empty, the document list will be empty.

## Module documentation

- Backend: [server/README.md](server/README.md)
- Frontend: [client/README.md](client/README.md)
