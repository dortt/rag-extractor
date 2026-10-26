# RAG Extractor

A Chrome extension (Manifest V3) that captures any element from any web page, sends it to a **local LLM** (Ollama, llama.cpp, LM Studio or any OpenAI-compatible server) and turns it into clean, structured **Markdown for a RAG knowledge base**.

> **Status:** portfolio project, not actively maintained. Feel free to fork it.

## How it works

```
 Web page ──(select element)──► Content script ──► Background worker
                                                       │
                                     OpenAI-compatible LLM (local)
                                                       │
                              Markdown + suggested tags ◄┘
                                                       │
            Editable preview (title, type, tags, custom frontmatter)
                                                       │
              Saved locally (chrome.storage) and/or POSTed to a backend
                                                       │
                     backends/python (FastAPI) or backends/php ──► ./rag-store/*.md
```

**Highlights**

- **Site-agnostic capture:** hover-to-highlight overlay works on any page; keyboard shortcut, popup, context menu or a persistent side panel for batch capture.
- **LLM pipeline:** configurable prompt template with variables (`{{content}}`, `{{url}}`, `{{type}}`, `{{locale}}`), per-type output structure, long pages split into chunks, request timeout, and automatic tag suggestion.
- **Configurable frontmatter:** document types, collections (mapped to folders via a filename pattern such as `{{type}}/{{slug}}.md`) and custom YAML fields. A `source_url` field is auto-filled with the captured page URL.
- **Backends with the same contract:** FastAPI or plain PHP, with optional Bearer-token auth, path-traversal protection and CORS restricted to Chrome extension origins.
- **No build step:** vanilla JavaScript ES modules.

## Project structure

```
rag-extractor/
├── extension/            ← load this folder in chrome://extensions
│   ├── manifest.json
│   ├── background.js     (service worker: LLM calls, saving, context menu)
│   ├── content/          (selection overlay)
│   ├── popup/
│   ├── sidepanel/        (persistent capture flow)
│   ├── options/
│   ├── preview/          (editable preview + print view)
│   ├── lib/              (llm-client, backend-client, storage, markdown)
│   └── icons/
└── backends/
    ├── python/server.py  (FastAPI)
    └── php/server.php
```

## Getting started

### 1. Run an OpenAI-compatible LLM server

```bash
ollama serve                       # http://localhost:11434
ollama pull qwen2.5:14b-instruct   # or any instruction-tuned model
```

The extension uses the OpenAI-compatible endpoint `http://localhost:11434/v1`.

### 2. Run a storage backend (optional)

Python (FastAPI):

```bash
cd backends/python
pip install -r requirements.txt
uvicorn server:app --port 8000     # files go to ./rag-store
```

PHP:

```bash
cd backends/php
php -S localhost:8001 server.php   # files go to ./rag-store
```

Both expose the same API:

| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/rag/ingest` | Receives `{ filename, frontmatter, content, markdown }` |
| `GET` | `/rag/list` | Lists stored `.md` files |
| `DELETE` | `/rag/{filename}` | Deletes a stored file |

Optional auth: set `RAG_TOKEN=<secret>` before starting the server and fill the same token in the extension options.

### 3. Load the extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Open the extension options, set the LLM URL and model, and click **Test connection**.

### 4. Capture content

1. Press `Alt+Shift+S` (or use the popup, the side panel, or right-click → *RAG Extractor*).
2. Hover over the page: the highlighted block is what will be captured. Click it.
3. Review the generated Markdown in the preview, adjust metadata and save.

## Example output

```yaml
---
title: Getting started with the API
type: guide
tags: api, authentication, quickstart
source_url: https://docs.example.com/api/getting-started
last_review: 2026-04-28
---

## Overview
…
```

## Notes

- The user interface is currently in Portuguese (pt-BR); prompts and generated content default to English (`locale` is configurable).
- Possible next steps: streaming responses, an embeddings endpoint (e.g. sqlite-vec or pgvector), multi-element capture into a single document.

## License

MIT, see [LICENSE](LICENSE).
