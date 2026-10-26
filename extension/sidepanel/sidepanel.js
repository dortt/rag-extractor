// sidepanel.js
import { getSettings, listDocuments, getJobStatus, clearJobStatus } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);

let _successTimer = null;

function renderJob(job) {
  const bar = $('job-bar');
  const text = $('job-text');
  if (!job || job.state === 'idle') { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden', 'success', 'error');
  if (job.state === 'success') {
    bar.classList.add('success');
    if (_successTimer) clearTimeout(_successTimer);
    _successTimer = setTimeout(async () => { await clearJobStatus(); bar.classList.add('hidden'); }, 4000);
  }
  if (job.state === 'error') bar.classList.add('error');
  text.textContent = job.text || job.state;
}

let pending = null; // { html, text, url, title, generated }
let _fmFields = [];

async function init() {
  const settings = await getSettings();
  _fmFields = settings.frontmatterFields || [];

  // Job status persistente
  renderJob(await getJobStatus());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.rag_job_status) renderJob(changes.rag_job_status.newValue);
  });
  const typeSel = $('f-type');
  for (const t of (settings.docTypes || [])) {
    const o = document.createElement('option'); o.value = t; o.textContent = t; typeSel.appendChild(o);
  }
  typeSel.value = settings.defaultType;

  renderFmInputs(_fmFields);

  const colSel = $('f-collection');
  for (const c of settings.collections) {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; colSel.appendChild(o);
  }

  const docs = await listDocuments();
  $('doc-count').textContent = `${docs.length} docs`;
  const list = $('recent-list');
  list.innerHTML = '';
  docs.slice(0, 6).forEach(d => {
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.innerHTML = `<span>📄</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</span><span class="when">${rel(d.savedAt)}</span>`;
    list.appendChild(el);
  });

  refreshStatus(settings);

  $('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('job-dismiss').addEventListener('click', async () => { await clearJobStatus(); $('job-bar').classList.add('hidden'); });
  $('btn-activate').addEventListener('click', activateSelection);
  $('btn-cancel').addEventListener('click', () => switchTo('idle'));
  $('btn-save').addEventListener('click', save);
  $('btn-print').addEventListener('click', openPrint);

  // ESC no side panel → desativa modo seleção na aba ativa
  window.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'RAG_DEACTIVATE_SELECTION' }).catch(() => {});
  }, true);

  // Escuta capturas (background dispara para o side panel)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'RAG_CAPTURED') {
      pending = msg.payload;
      $('f-title').value = pending.title || '';
      $('f-content').value = pending.generated || '';
      $('edit-meta').textContent = `${(pending.text || '').length} chars · ${pending.url || ''}`;
      const derived = deriveSourceUrls(pending.url || '', _fmFields);
      Object.entries(derived).forEach(([key, val]) => {
        const el = $(`f-fm-${key}`);
        if (el && val) el.value = val;
      });
      switchTo('edit');
    }
  });
}

function switchTo(view) {
  $('view-idle').classList.toggle('hidden', view !== 'idle');
  $('view-edit').classList.toggle('hidden', view !== 'edit');
}

async function activateSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: 'RAG_ACTIVATE_SELECTION', viaSidePanel: true }).catch(async () => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'RAG_ACTIVATE_SELECTION', viaSidePanel: true });
  });
}

async function save() {
  if (!pending) return;
  const fmValues = {};
  _fmFields.forEach(f => { fmValues[f.key] = ($(`f-fm-${f.key}`)?.value || '').trim(); });
  const r = await chrome.runtime.sendMessage({
    type: 'RAG_SAVE',
    payload: {
      title: $('f-title').value,
      type: $('f-type').value,
      tags: $('f-tags').value,
      ...fmValues,
      content: $('f-content').value,
      collection: $('f-collection').value,
    },
  });
  if (r?.ok) {
    pending = null;
    switchTo('idle');
    init();
  } else {
    alert('Erro ao salvar: ' + (r?.error || ''));
  }
}

async function refreshStatus(settings) {
  $('status-text').textContent = new URL(settings.llmUrl).host + ' · ' + settings.model;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'RAG_TEST_CONNECTION' });
    if (!r?.ok) throw new Error();
  } catch { $('status-dot').classList.add('off'); }
}

function renderFmInputs(fields) {
  const container = $('f-fm-fields');
  container.innerHTML = '';
  (fields || []).forEach(f => {
    const lbl = document.createElement('label');
    lbl.innerHTML = `${esc(f.label)}<input id="f-fm-${esc(f.key)}" class="mono" placeholder="${esc(f.defaultValue ?? '')}"/>`;
    container.appendChild(lbl);
  });
}

async function openPrint() {
  if (!pending) return;
  await chrome.storage.local.set({
    rag_print_pending: {
      title: $('f-title').value,
      type: $('f-type').value,
      tags: $('f-tags').value,
      content: $('f-content').value,
    },
  });
  chrome.tabs.create({ url: chrome.runtime.getURL('preview/print.html') });
}

function rel(iso) { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (m > 1440) return Math.floor(m/1440)+'d'; if (m > 60) return Math.floor(m/60)+'h'; return Math.max(1, m)+'m'; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Fills the optional 'source_url' frontmatter field with the captured page URL.
function deriveSourceUrls(url, fields) {
  const keys = new Set((fields || []).map(f => f.key));
  return url && keys.has('source_url') ? { source_url: url } : {};
}

init();
