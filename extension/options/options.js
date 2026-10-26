// options.js
import { getSettings, setSettings, listDocuments, deleteDocument } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);

const FIELDS = ['llmUrl','llmToken','model','temperature','maxTokens','topP',
  'backendUrl','backendToken','locale','maxInputChars','llmTimeout','defaultTags',
  'filenamePattern','promptTemplate'];

async function init() {
  const s = await getSettings();
  FIELDS.forEach(k => { const el = $(k); if (el) el.value = s[k] ?? ''; });
  document.querySelectorAll('input[name=storage]').forEach(r => { r.checked = (r.value === s.storage); });
  renderDocTypes(s.docTypes, s.defaultType);
  renderFrontmatterFields(s.frontmatterFields);
  renderCollections(s.collections, s.docTypes);
  renderLibrary();
  setupTabs();

  $('btn-save').addEventListener('click', save);
  $('btn-test').addEventListener('click', test);
  $('btn-add-col').addEventListener('click', addCollection);
  $('btn-add-type').addEventListener('click', addDocType);
  $('btn-add-fm').addEventListener('click', addFrontmatterField);

  // hash routing
  if (location.hash === '#library') showTab('library');
}

function setupTabs() {
  document.querySelectorAll('.opt__nav button').forEach(b => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
}
function showTab(name) {
  document.querySelectorAll('.opt__nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = (p.dataset.pane !== name));
}

async function save() {
  const partial = {};
  FIELDS.forEach(k => {
    const el = $(k); if (!el) return;
    let v = el.value;
    if (['temperature','topP','maxTokens'].includes(k)) v = Number(v);
    partial[k] = v;
  });
  partial.storage = document.querySelector('input[name=storage]:checked')?.value || 'both';
  // docTypes, defaultType e frontmatterFields gerenciados pelos renders
  const s = await getSettings();
  partial.docTypes = s.docTypes;
  partial.defaultType = s.defaultType;
  partial.frontmatterFields = s.frontmatterFields;
  await setSettings(partial);
  $('save-status').textContent = '✓ salvo · ' + new Date().toLocaleTimeString();
  setTimeout(() => $('save-status').textContent = '', 3000);
}

async function test() {
  $('test-result').textContent = 'testando…';
  await save();
  const r = await chrome.runtime.sendMessage({ type: 'RAG_TEST_CONNECTION' });
  if (r?.ok) {
    $('test-result').innerHTML = `<span class="ok">✓ conectado</span> · ${r.models?.length || 0} modelos`;
  } else {
    $('test-result').innerHTML = `<span class="err">✗ ${escapeHtml(r?.error || 'erro')}</span>`;
  }
}

function renderDocTypes(types, defaultType) {
  const list = $('type-list');
  list.innerHTML = '';
  types.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'col-row';
    row.innerHTML = `
      <span>🏷</span>
      <input class="name" value="${esc(t)}" data-ti="${i}" style="flex:1"/>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;white-space:nowrap">
        <input type="radio" name="defaultType" value="${esc(t)}" ${t === defaultType ? 'checked' : ''}/>
        padrão
      </label>
      <button class="ghost" data-del-type="${i}">remover</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-ti]').forEach(el => el.addEventListener('change', async () => {
    const s = await getSettings();
    const oldVal = s.docTypes[+el.dataset.ti];
    s.docTypes[+el.dataset.ti] = el.value.trim().toLowerCase().replace(/\s+/g, '_') || oldVal;
    // se era o defaultType, atualiza junto
    if (s.defaultType === oldVal) s.defaultType = s.docTypes[+el.dataset.ti];
    await setSettings({ docTypes: s.docTypes, defaultType: s.defaultType });
    renderDocTypes(s.docTypes, s.defaultType);
    renderCollections(s.collections, s.docTypes);
  }));
  list.querySelectorAll('[name=defaultType]').forEach(r => r.addEventListener('change', async () => {
    await setSettings({ defaultType: r.value });
  }));
  list.querySelectorAll('[data-del-type]').forEach(b => b.addEventListener('click', async () => {
    const i = +b.dataset.delType;
    const s = await getSettings();
    if (s.docTypes.length <= 1) return;
    const removed = s.docTypes.splice(i, 1)[0];
    if (s.defaultType === removed) s.defaultType = s.docTypes[0];
    await setSettings({ docTypes: s.docTypes, defaultType: s.defaultType });
    renderDocTypes(s.docTypes, s.defaultType);
    renderCollections(s.collections, s.docTypes);
  }));
}

async function addDocType() {
  const s = await getSettings();
  s.docTypes.push('new-type');
  await setSettings({ docTypes: s.docTypes });
  renderDocTypes(s.docTypes, s.defaultType);
  renderCollections(s.collections, s.docTypes);
}

function renderFrontmatterFields(fields) {
  const list = $('fm-list');
  list.innerHTML = '';
  (fields || []).forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'col-row';
    row.innerHTML = `
      <span>🔑</span>
      <input class="fm-key mono" value="${esc(f.key)}" data-fmi="${i}" data-fmk="key" placeholder="chave" style="width:130px"/>
      <input class="fm-label" value="${esc(f.label)}" data-fmi="${i}" data-fmk="label" placeholder="label" style="flex:1"/>
      <input class="fm-default mono" value="${esc(f.defaultValue ?? '')}" data-fmi="${i}" data-fmk="defaultValue" placeholder="valor padrão" style="width:120px"/>
      <button class="ghost" data-del-fm="${i}">remover</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-fmi]').forEach(el => el.addEventListener('change', async () => {
    const i = +el.dataset.fmi, k = el.dataset.fmk;
    const s = await getSettings();
    s.frontmatterFields[i][k] = el.value.trim();
    if (k === 'key') s.frontmatterFields[i].key = el.value.trim().toLowerCase().replace(/\s+/g, '_') || s.frontmatterFields[i].key;
    await setSettings({ frontmatterFields: s.frontmatterFields });
    renderFrontmatterFields(s.frontmatterFields);
  }));
  list.querySelectorAll('[data-del-fm]').forEach(b => b.addEventListener('click', async () => {
    const i = +b.dataset.delFm;
    const s = await getSettings();
    s.frontmatterFields.splice(i, 1);
    await setSettings({ frontmatterFields: s.frontmatterFields });
    renderFrontmatterFields(s.frontmatterFields);
  }));
}

async function addFrontmatterField() {
  const s = await getSettings();
  s.frontmatterFields.push({ key: 'new_field', label: 'New field', defaultValue: '' });
  await setSettings({ frontmatterFields: s.frontmatterFields });
  renderFrontmatterFields(s.frontmatterFields);
}

function renderCollections(cols, docTypes) {
  const types = docTypes || ['system','class','quest','glossary','anything'];
  const list = $('col-list');
  list.innerHTML = '';
  cols.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'col-row';
    row.innerHTML = `
      <span>📁</span>
      <input class="name" value="${esc(c.name)}" data-key="name" data-i="${i}"/>
      <select data-key="type" data-i="${i}">
        ${types.map(t => `<option ${t === c.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <button class="ghost" data-del="${i}">remover</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-key]').forEach(el => el.addEventListener('change', async () => {
    const i = +el.dataset.i, key = el.dataset.key;
    const s = await getSettings(); s.collections[i][key] = el.value;
    await setSettings({ collections: s.collections });
  }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const i = +b.dataset.del;
    const s = await getSettings(); s.collections.splice(i, 1);
    await setSettings({ collections: s.collections });
    renderCollections(s.collections, s.docTypes);
  }));
}

async function addCollection() {
  const s = await getSettings();
  const id = 'col-' + Date.now();
  s.collections.push({ id, name: 'nova-coleção', type: s.defaultType || s.docTypes[0] || 'anything' });
  await setSettings({ collections: s.collections });
  renderCollections(s.collections, s.docTypes);
}

async function renderLibrary() {
  const docs = await listDocuments();
  const list = $('lib-list');
  if (!docs.length) { list.innerHTML = '<div class="dim" style="padding:24px;text-align:center">Nenhum documento salvo ainda.</div>'; return; }
  list.innerHTML = '';
  docs.forEach(d => {
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `
      <span>📄</span>
      <span class="name">${esc(d.title)}</span>
      <span class="pill">${esc(d.type)}</span>
      <span class="meta">${esc(d.collection)} · ${esc(d.savedAt?.slice(0,10) || '')}</span>
      <button class="ghost" data-dl="${d.id}">baixar</button>
      <button class="ghost" data-del="${d.id}">apagar</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
    const d = (await listDocuments()).find(x => x.id === b.dataset.dl);
    if (!d) return;
    const blob = new Blob([d.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: d.filename, saveAs: true });
  }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar este documento?')) return;
    await deleteDocument(b.dataset.del);
    renderLibrary();
  }));
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeHtml(s) { return esc(s); }

init();
