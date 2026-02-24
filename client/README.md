# Frontend (`client`)

SvelteKit application for browsing CUAD DOCX contracts, rendering them in the browser, and editing paragraphs.

## Requirements

- Node.js 20+ recommended.
- `npm`.

## Installation

```bash
cd client
npm install
```

## Environment variables

Create `client/.env`:

```bash
PUBLIC_DEV_LOCAL=http://localhost:8300/api/v1
```

This variable defines the API base URL used by `src/lib/api/client.ts`.

## Development

From `client/`:

```bash
npm run dev -- --port 5173
```

Or from the repository root:

```bash
make dev-frontend
```

Local URL: http://localhost:5173

## Useful scripts

- `npm run dev`: start development server.
- `npm run build`: production build.
- `npm run preview`: preview build locally.
- `npm run check`: Svelte/TypeScript checks.
- `npm run lint`: prettier check + eslint.
- `npm run format`: format code.

## Main workflow

1. Loads document list from `GET /list_documents`.
2. Navigates to `/docx?id=<documentId>` when a document is selected.
3. Downloads file with `GET /document_file/{doc_id}`.
4. Renders DOCX and enables inline paragraph editing.

## Common issues

- CORS or `Network Error`: verify backend is running at `http://localhost:8300`.
- Empty dataset list: verify backend can read `infra/CUAD_v1/full_contract_docx`.
- `404` on `document_file`: `doc_id` was not found in `DocumentStore`.
