// lib/storage.js — chrome.storage.local wrapper
// Settings + documentos gerados.

const SETTINGS_KEY = 'rag_settings';
const DOCS_KEY = 'rag_docs';
const STATUS_KEY = 'rag_job_status';

export const DEFAULT_SETTINGS = {
  // LLM
  llmUrl: 'http://localhost:11434/v1',
  llmToken: '',
  model: 'qwen2.5:14b-instruct',
  temperature: 0.2,
  maxTokens: 4096,
  topP: 0.9,
  // Storage
  storage: 'both', // 'local' | 'remote' | 'both'
  backendUrl: 'http://localhost:8000/rag/ingest',
  backendToken: '',
  // Output
  locale: 'en_US',
  maxInputChars: 0,
  llmTimeout: 600,
  docTypes: ['article', 'guide', 'reference', 'glossary', 'anything'],
  defaultType: 'anything',
  frontmatterFields: [
    // 'source_url' is auto-filled with the captured page URL
    { key: 'source_url', label: 'Source URL', defaultValue: '' },
  ],
  defaultTags: '',
  filenamePattern: '{{type}}/{{slug}}.md',
  // Prompt
  promptTemplate: `You are a structured knowledge base writer. Convert web page content into clean, dense Markdown for a RAG knowledge base used by an AI assistant.

Document type: {{type}}
Source URL: {{url}}
Locale: {{locale}}

Output language: {{locale}} — translate if source is in another language.

--- UNIVERSAL RULES ---
- Output ONLY the markdown body. No frontmatter, no code fences, no preamble, no closing remarks.
- Use ## for major sections, ### for subsections, bullet lists for items and steps.
- Facts only — no opinions, no evaluations, no comparisons unless explicitly stated in the source.
- Omit anything unclear rather than inventing content.
- Preserve all proper nouns (names, products, places, technical terms) exactly as they appear.

--- CONTENT CLEANUP ---
- Remove page UI: share buttons, correction requests, "Updated on", breadcrumbs, navigation menus, ads, cookie banners.
- Remove table of contents sections (usually a numbered list at the top labeled "Contents" or similar).
- Remove decorative symbols used as dividers (◈, •, ▶, ★, etc.) when they appear standalone.
- Collapse 3+ consecutive blank lines to a single blank line.

--- IMAGE HANDLING ---
- Images in the content appear as: ![alt text](image_url)
- If the alt text is meaningful (item name, diagram label): keep the image as-is — ![alt](url)
- If the image is purely decorative (no alt, or alt is generic like "image", "icon", "banner"): omit it.
- For diagrams or layout images described in surrounding text: write *See source for diagram.*

--- TABLE CONVERSION ---
- Convert all tables to bullet lists or inline text.
- For list-like tables (name + description columns): format each row as:
  - **Name** — description
- For tables with several attributes per row: one bullet per row, attributes as "key: value" pairs.
- Skip header rows that only repeat column names.

--- STRUCTURE BY TYPE ---
type=article    → ## Summary, then one ## per main topic
type=guide      → ## Overview, ## Prerequisites (if any), ## Steps (numbered), ## Notes
type=reference  → ## Overview, then one ## per entity/feature with its properties as bullets
type=glossary   → one bullet per term: **Term** — definition
type=anything   → choose the clearest structure for the content

Content to convert:
{{content}}`,
  collections: [
    { id: 'default', name: 'default', type: 'anything' },
  ],
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

export async function saveDocument(doc) {
  const stored = await chrome.storage.local.get(DOCS_KEY);
  const docs = stored[DOCS_KEY] || [];
  const id = doc.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...doc, id, savedAt: doc.savedAt || new Date().toISOString() };
  const idx = docs.findIndex(d => d.id === id);
  if (idx >= 0) docs[idx] = record; else docs.unshift(record);
  await chrome.storage.local.set({ [DOCS_KEY]: docs });
  return record;
}

export async function listDocuments() {
  const stored = await chrome.storage.local.get(DOCS_KEY);
  return stored[DOCS_KEY] || [];
}

export async function deleteDocument(id) {
  const stored = await chrome.storage.local.get(DOCS_KEY);
  const docs = (stored[DOCS_KEY] || []).filter(d => d.id !== id);
  await chrome.storage.local.set({ [DOCS_KEY]: docs });
}

// ─── Job status global (visível em todas as superfícies) ───
// state: 'idle' | 'generating' | 'success' | 'error'
export async function setJobStatus(status) {
  await chrome.storage.local.set({ [STATUS_KEY]: { ...status, updatedAt: Date.now() } });
}
export async function getJobStatus() {
  const s = await chrome.storage.local.get(STATUS_KEY);
  return s[STATUS_KEY] || { state: 'idle' };
}
export async function clearJobStatus() {
  await chrome.storage.local.set({ [STATUS_KEY]: { state: 'idle', updatedAt: Date.now() } });
}
