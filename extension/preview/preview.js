// preview.js
import { getSettings } from '../lib/storage.js';
import { slugify } from '../lib/markdown.js';

const $ = (id) => document.getElementById(id);

let pending = null;
let _fmFields = [];

async function init() {
  const s = await getSettings();
  _fmFields = s.frontmatterFields || [];

  const typeSel = $('m-type');
  for (const t of (s.docTypes || [])) {
    const o = document.createElement('option'); o.value = t; o.textContent = t; typeSel.appendChild(o);
  }
  typeSel.value = s.defaultType;
  s.collections.forEach(c => {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; $('m-collection').appendChild(o);
  });

  renderFmInputs(_fmFields);

  const stored = await chrome.storage.local.get('rag_preview_pending');
  pending = stored.rag_preview_pending;
  if (!pending) {
    document.body.innerHTML = '<div style="padding:40px;font-family:var(--sans);color:#aaa">Nenhuma captura pendente.</div>';
    return;
  }
  $('m-title').value = pending.title || '';
  $('md').value = pending.content || '';
  if (pending.tags) $('m-tags').value = pending.tags;

  // auto-fill source_url with the captured page URL (if that field is configured)
  const derived = deriveSourceUrls(pending.source || '', _fmFields);
  Object.entries(derived).forEach(([key, val]) => {
    const el = $(`m-fm-${key}`);
    if (el && val) el.value = val;
  });

  updatePreview();

  ['m-title','m-type','m-tags','m-collection'].forEach(id => $(id).addEventListener('input', updatePreview));
  $('md').addEventListener('input', updatePreview);

  $('btn-save').addEventListener('click', save);
  $('btn-copy').addEventListener('click', () => navigator.clipboard.writeText(fullMarkdown()));
  $('btn-download').addEventListener('click', download);
  $('btn-print').addEventListener('click', openPrint);
}

function renderFmInputs(fields) {
  const container = $('m-fm-fields');
  container.innerHTML = '';
  fields.forEach(f => {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'grid-column:1/-1';
    lbl.innerHTML = `${esc(f.label)}<input id="m-fm-${esc(f.key)}" class="mono" placeholder="${esc(f.defaultValue ?? '')}"/>`;
    container.appendChild(lbl);
  });
}

function fullMarkdown() {
  const lines = ['---',
    `title: ${$('m-title').value}`,
    `type: ${$('m-type').value}`,
    `tags: ${$('m-tags').value}`,
  ];
  _fmFields.forEach(f => {
    const val = ($(`m-fm-${f.key}`)?.value || '').trim();
    if (val) lines.push(`${f.key}: ${val}`);
  });
  lines.push(`last_review: ${new Date().toISOString().slice(0,10)}`, '---');
  return lines.join('\n') + '\n\n' + $('md').value + '\n';
}

function updatePreview() {
  $('render').innerHTML = renderMarkdown($('md').value);
  const slug = slugify($('m-title').value || 'untitled');
  $('dest-path').textContent = `${$('m-type').value}/${slug}.md`;
}

async function save() {
  $('pv-status').textContent = 'salvando…';
  const fmValues = {};
  _fmFields.forEach(f => { fmValues[f.key] = ($(`m-fm-${f.key}`)?.value || '').trim(); });
  const r = await chrome.runtime.sendMessage({
    type: 'RAG_SAVE',
    payload: {
      title: $('m-title').value, type: $('m-type').value,
      tags: $('m-tags').value,
      ...fmValues,
      content: $('md').value,
      collection: $('m-collection').value,
    },
  });
  if (r?.ok) {
    $('pv-status').innerHTML = `<span class="ok">✓ salvo</span>${r.upload?.ok ? ' · enviado ao backend' : (r.upload ? ' · backend falhou: ' + (r.upload.error || '') : '')}`;
    await chrome.storage.local.remove('rag_preview_pending');
    setTimeout(() => window.close(), 1500);
  } else {
    $('pv-status').innerHTML = `<span class="err">✗ ${r?.error || 'erro'}</span>`;
  }
}

function download() {
  const blob = new Blob([fullMarkdown()], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: `${slugify($('m-title').value)}.md`, saveAs: true });
}

async function openPrint() {
  await chrome.storage.local.set({
    rag_print_pending: {
      title: $('m-title').value,
      type: $('m-type').value,
      tags: $('m-tags').value,
      content: $('md').value,
    },
  });
  chrome.tabs.create({ url: chrome.runtime.getURL('preview/print.html') });
}

// Fills the optional 'source_url' frontmatter field with the captured page URL.
function deriveSourceUrls(url, fields) {
  const keys = new Set((fields || []).map(f => f.key));
  return url && keys.has('source_url') ? { source_url: url } : {};
}

// Markdown renderer mínimo (sem dependências). Suporta: h2/h3, listas, code, **bold**, *em*, links, tabelas simples.
function renderMarkdown(src) {
  if (!src) return '';
  const lines = src.split('\n');
  const out = [];
  let inList = false, inTable = false, tableHeader = '';
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (/^### /.test(l)) { closeAll(); out.push('<h3>' + esc(l.slice(4)) + '</h3>'); continue; }
    if (/^## /.test(l)) { closeAll(); out.push('<h2>' + esc(l.slice(3)) + '</h2>'); continue; }
    if (/^# /.test(l)) { closeAll(); out.push('<h2>' + esc(l.slice(2)) + '</h2>'); continue; }
    if (/^\s*[-*] /.test(l)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>'); continue;
    }
    if (/^\|.*\|/.test(l)) {
      const cells = l.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) { out.push('<table><thead><tr>' + cells.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'); inTable = true; i++; continue; }
      out.push('<tr>' + cells.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'); continue;
    }
    closeAll();
    if (l.trim()) out.push('<p>' + inline(l) + '</p>');
  }
  closeAll();
  function closeAll() { if (inList) { out.push('</ul>'); inList = false; } if (inTable) { out.push('</tbody></table>'); inTable = false; } }
  return out.join('\n');
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

init();
