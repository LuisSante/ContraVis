# Structure Response

Quick reference for JSON structures used across this project.

## 1) Base URL and prefixes

- FastAPI backend base:
  - `http://localhost:8000` (depending on how you run the server)
- Main API prefix:
  - `/api/v1`
- Frontend uses `PUBLIC_DEV_LOCAL` as `baseURL` in:
  - `client/src/lib/api/client.ts`

---

## 2) System endpoints

### `GET /`

Response:

```json
{
  "message": "Hola desde FastAPI"
}
```

### `GET /health`

Response:

```json
{
  "status": "ok"
}
```

### `GET /documents/init`

Response:

```json
{
  "message": "Document initialization endpoint"
}
```

---

## 3) API endpoints (`/api/v1`)

### `GET /api/v1/`

Response:

```json
{
  "message": "Document initialization endpoint"
}
```

### `GET /api/v1/list_documents`

Response (`DatasetDocument[]`):

```json
[
  {
    "id": "StampscomInc_..._Agreement",
    "name": "StampscomInc_..._Agreement.docx",
    "full_path": "/abs/path/to/file.docx",
    "origin": "dataset",
    "processed": true
  }
]
```

### `GET /api/v1/document_file/{doc_id}`

- **Not JSON**: returns a `.docx` file (`FileResponse`).
- Typical JSON errors:

```json
{
  "detail": "Document not found"
}
```

```json
{
  "detail": "Only DOCX documents are supported"
}
```

### `POST /api/v1/process`

Request:

```json
{
  "documentId": "doc-123",
  "pages": [
    {
      "pageNumber": 1,
      "elements": [
        {
          "id": "p-1",
          "text": "This Agreement starts on Jan 15.",
          "x": 10.0,
          "y": 20.0,
          "fontSize": 11.0
        }
      ]
    }
  ]
}
```

Response:

```json
{
  "status": "success",
  "documentId": "doc-123",
  "graph": {
    "nodes": [
      {
        "id": "p-1",
        "documentId": "doc-123",
        "text": "This Agreement starts on Jan 15.",
        "paragraph_enum": 0,
        "page": 1,
        "relationsCount": 0,
        "x": 10.0,
        "y": 20.0,
        "fontSize": 11.0
      }
    ],
    "edges": []
  }
}
```

### `POST /api/v1/assistant/chat`

Request (`AssistantChatRequest`):

```json
{
  "documentId": "doc-123",
  "question": "What happens if payment is late?",
  "mode": "explain",
  "scope": "selected",
  "provider": "openai",
  "selectedParagraphId": "p-10",
  "relatedParagraphs": [
    {
      "id": "p-11",
      "relationTypes": ["reference", "semantic_similarity"],
      "semanticScore": 0.87,
      "references": ["section 4.2"]
    }
  ],
  "paragraphNodes": [
    {
      "id": "p-10",
      "text": "Buyer shall pay within 30 days.",
      "paragraph_enum": 10,
      "page": 2
    }
  ],
  "history": [
    {
      "role": "user",
      "content": "Summarize liabilities."
    }
  ]
}
```

Response (`AssistantChatResponse`):

```json
{
  "answer": "Late payment may trigger penalties under clause 4.2.",
  "citations": [
    {
      "id": "p-10",
      "excerpt": "Buyer shall pay within 30 days...",
      "page": 2,
      "paragraph_enum": 10
    }
  ],
  "suggestedQuestions": [
    "Is there a cure period for non-payment?"
  ],
  "mode": "explain",
  "scope": "selected",
  "provider": "openai"
}
```

### `POST /api/v1/assistant/simplify`

Request (`SimplifySelectionRequest`):

```json
{
  "documentId": "doc-123",
  "provider": "openai",
  "paragraphId": "p-20",
  "paragraphText": "Notwithstanding the foregoing...",
  "selectionStart": 0,
  "selectionEnd": 40,
  "relatedParagraphs": []
}
```

Response (`SimplifySelectionResponse`):

```json
{
  "paragraphId": "p-20",
  "provider": "openai",
  "originalSnippet": "Notwithstanding the foregoing...",
  "simplifiedSnippet": "Despite the above...",
  "evidence": {
    "paragraph_id": "p-20",
    "selection_start": 0,
    "selection_end": 40
  },
  "audit": {
    "system_prompt": "You are a legal plain-language simplifier...",
    "user_prompt": "Document ID: doc-123 ...",
    "model_response": "{\"simplified_snippet\":\"Despite the above...\"}"
  }
}
```

### `POST /api/v1/assistant/fix_contradiction`

Request (`SimplifySelectionRequest`, with optional `contradictionReason`):

```json
{
  "documentId": "doc-123",
  "provider": "openai",
  "paragraphId": "p-30",
  "paragraphText": "Party A must deliver in 10 days and shall not deliver in 10 days.",
  "selectionStart": 0,
  "selectionEnd": 67,
  "contradictionReason": "Direct negation in delivery obligation",
  "relatedParagraphs": [
    {
      "id": "p-31",
      "text": "Delivery timeline is mandatory.",
      "relationTypes": ["semantic_similarity"]
    }
  ]
}
```

Response (`SimplifySelectionResponse`):

```json
{
  "paragraphId": "p-30",
  "provider": "openai",
  "originalSnippet": "Party A must deliver in 10 days and shall not deliver in 10 days.",
  "simplifiedSnippet": "Party A must deliver in 10 days.",
  "evidence": {
    "paragraph_id": "p-30",
    "selection_start": 0,
    "selection_end": 67
  },
  "audit": {
    "system_prompt": "You are a legal contract editor focused on contradiction repair...",
    "user_prompt": "Document ID: doc-123 ...",
    "model_response": "{\"fixed_snippet\":\"Party A must deliver in 10 days.\"}"
  }
}
```

### `POST /api/v1/contradictions/analyze`

Request (`ContradictionAnalysisRequest`):

```json
{
  "documentId": "doc-123",
  "provider": "openai",
  "temperature": 0.3,
  "model": "gpt-4.1",
  "graph": {
    "nodes": [
      {
        "id": "p-1",
        "documentId": "doc-123",
        "text": "Clause text...",
        "paragraph_enum": 0,
        "page": 1,
        "relationsCount": 2
      }
    ],
    "edges": [
      {
        "source": "p-1",
        "target": "p-2",
        "type": "semantic_similarity",
        "score": 0.83
      }
    ]
  }
}
```

Response (`ContradictionAnalysisResponse`):

```json
{
  "documentId": "doc-123",
  "provider": "openai",
  "temperature": 0.3,
  "model": "gpt-4.1",
  "paragraphResults": [
    {
      "paragraph_id": "p-1",
      "contradiction": true,
      "confidence": 91,
      "brief_reason": "Direct policy reversal in the same obligation.",
      "evidence": {
        "snippet_a": "Party A shall deliver within 10 days",
        "snippet_b": "Party A shall not deliver within 10 days",
        "source_a": "paragraph",
        "source_b": "paragraph",
        "evidence_status": "exact",
        "evidence_note": ""
      }
    }
  ],
  "rawResponse": "{...raw provider output...}"
}
```

### `GET /api/v1/contradictions/saved/{document_id}`

Response (`SavedContradictionsResponse`):

```json
{
  "documentId": "doc-123",
  "sourceFile": "doc-123__openai_latest.json",
  "paragraphResults": [
    {
      "paragraph_id": "p-1",
      "contradiction": true,
      "confidence": 91,
      "brief_reason": "Direct policy reversal in the same obligation.",
      "evidence": {
        "snippet_a": "Party A shall deliver within 10 days",
        "snippet_b": "Party A shall not deliver within 10 days",
        "source_a": "paragraph",
        "source_b": "paragraph",
        "evidence_status": "exact",
        "evidence_note": ""
      }
    }
  ]
}
```

---

## 4) Standard error JSON

For FastAPI validation/runtime errors, the common shape is:

```json
{
  "detail": "Error message"
}
```

Common status codes:

- `400`: invalid parameters or invalid state
- `404`: document or saved contradictions not found
- `500`: unexpected internal error

---

## 5) Internal LLM JSON contracts used by services

These are not direct API endpoints, but they are critical to understand parsing and fallback behavior.

### 5.1 Assistant (`services/contract_assistant.py`)

Expected LLM JSON:

```json
{
  "answer": "string",
  "citations": ["paragraph-id-1", "paragraph-id-2"],
  "suggested_questions": ["string"]
}
```

### 5.2 Simplify

Expected LLM JSON:

```json
{
  "simplified_snippet": "string"
}
```

### 5.3 Fix contradiction

Expected LLM JSON:

```json
{
  "fixed_snippet": "string"
}
```

### 5.4 Contradiction analysis (`services/contradiction_analysis.py`)

Expected LLM JSON:

```json
{
  "paragraph_results": [
    {
      "paragraph_id": "string",
      "contradiction": true,
      "confidence": 0,
      "brief_reason": "string",
      "evidence": {
        "snippet_a": "string",
        "snippet_b": "string",
        "source_a": "paragraph",
        "source_b": "context",
        "evidence_status": "exact",
        "evidence_note": ""
      }
    }
  ]
}
```

`document_json` injected into prompt (`Document data (JSON): {document_json}`):

Current mode payload (`mode = "without_kg"` or `mode = "with_kg"`):

```json
{
  "mode": "without_kg",
  "paragraphs": [
    {
      "paragraph_id": "BELLICUM...-p-19",
      "text": "Clause text...",
      "related_paragraphs": [
        {
          "paragraph_id": "BELLICUM...-p-166",
          "text": "Related clause text..."
        }
      ]
    },
    {
      "paragraph_id": "BELLICUM...-p-166",
      "text": "Another clause text...",
      "related_paragraphs": []
    }
  ]
}
```

---

## 6) Structured JSON used by UI in `Why is it a contradiction? (AI cost)`

This object is parsed from `AssistantChatResponse.answer` when the answer contains JSON.

```json
{
  "version": "1.0",
  "paragraph_id": "p-14",
  "overall_summary": "Direct contradiction found.",
  "contradiction_count": 1,
  "contradictions": [
    {
      "id": "c1",
      "contradiction_type": "policy_reversal",
      "why": "One statement directly negates the other.",
      "claim_a": {
        "text": "The parties shall engage in co-branding activities.",
        "source": "paragraph",
        "paragraph_id": "p-14",
        "subject": "The parties",
        "relation": "shall engage",
        "object": "co-branding activities",
        "polarity": "affirmed"
      },
      "claim_b": {
        "text": "The parties shall not engage in co-branding activities.",
        "source": "paragraph",
        "paragraph_id": "p-14",
        "subject": "The parties",
        "relation": "shall engage",
        "object": "co-branding activities",
        "polarity": "negated"
      },
      "conflicting_fields": ["polarity"],
      "confidence": 95
    }
  ],
  "highlights": [
    {
      "phrase": "shall engage in co-branding activities",
      "category": "policy_reversal",
      "claim_id": "c1",
      "source": "paragraph"
    }
  ],
  "highlight_source_text": "Original paragraph text..."
}
```

---

## 7) Frontend -> backend mapping (consumer functions)

Functions in `client/src/lib/utils/docx-page.ts`:

- `fetchBackendGraph` -> `POST /api/v1/process`
- `fetchAssistantResponse` -> `POST /api/v1/assistant/chat`
- `fetchSimplifySelection` -> `POST /api/v1/assistant/simplify`
- `fetchFixContradictionSelection` -> `POST /api/v1/assistant/fix_contradiction`
- `fetchSavedContradictions` -> `GET /api/v1/contradictions/saved/{documentId}`
- `fetchContradictionAnalysis` -> `POST /api/v1/contradictions/analyze`
