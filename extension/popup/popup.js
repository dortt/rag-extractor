// popup.js
import { getSettings, setSettings, listDocuments, getJobStatus } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);

function renderJob(job) {
  const banner = $('job-banner');
  const text = $('job-text');
  if (!job || job.state === 'idle') { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden', 'success', 'error');
  if (job.state === 'success') banner.classList.add('success');
  if (job.state === 'error') banner.classList.add('error');
  text.textContent = job.text || job.state;
}

async function init() {
  const settings = await getSettings();

  // Status do job (persistente)
  renderJob(await getJobStatus());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.rag_job_status) renderJob(changes.rag_job_status.newValue);
  });

  // Populate selects
  const colSel = $('sel-collection');
  for (const c of settings.collections) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name; colSel.appendChild(o);
  }
  const typeSel = $('sel-type');
  for (const t of (settings.docTypes || [])) {
    const o = document.createElement('option'); o.value = t; o.textContent = t; typeSel.appendChild(o);
  }
  typeSel.value = settings.defaultType;
  $('sel-locale').value = settings.locale;

  // Status do servidor
  refreshStatus(settings);

  // Recentes
  const docs = await listDocuments();
  const recent = $('recent-list');
  if (!docs.length) {
    recent.innerHTML = '<div class="recent__empty">nenhuma captura ainda</div>';
  } else {
    docs.slice(0, 4).forEach(d => {
      const el = document.createElement('div');
      el.className = 'recent__item';
      el.innerHTML = `<span>📄</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.title)}</span><span class="when">${relative(d.savedAt)}</span>`;
      recent.appendChild(el);
    });
  }
  $('foot-stats').textContent = `${docs.length} doc${docs.length === 1 ? '' : 's'}`;

  $('btn-select').addEventListener('click', activateSelection);
  $('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-library').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#library') }));
  $('btn-sidepanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  });

  // Persiste mudanças nos selects
  ['sel-type','sel-locale'].forEach(id => {
    $(id).addEventListener('change', async () => {
      await setSettings({
        defaultType: $('sel-type').value,
        locale: $('sel-locale').value,
      });
    });
  });
}

async function refreshStatus(settings) {
  $('status-dot').className = 'dot';
  $('status-text').textContent = new URL(settings.llmUrl).host;
  $('status-model').textContent = settings.model;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'RAG_TEST_CONNECTION' });
    if (!r?.ok) throw new Error(r?.error || 'offline');
  } catch (err) {
    $('status-dot').className = 'dot off';
    $('status-text').textContent = 'sem conexão';
  }
}

async function activateSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: 'RAG_ACTIVATE_SELECTION' }).catch(async () => {
    // Content script não está injetado? Injeta na hora.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'RAG_ACTIVATE_SELECTION' });
  });
  window.close();
}

function relative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d > 0) return d + 'd';
  const h = Math.floor(ms / 3600000);
  if (h > 0) return h + 'h';
  return Math.max(1, Math.floor(ms / 60000)) + 'm';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

init();
