// background.js — service worker (MV3)
// - Recebe mensagens do content-script e do popup/side-panel
// - Conversa com o LLM e com o backend de armazenamento
// - Mantém os documentos em chrome.storage.local

import { generateMarkdown, testConnection } from './lib/llm-client.js';
import { uploadToBackend } from './lib/backend-client.js';
import { buildMarkdown, slugify } from './lib/markdown.js';
import { getSettings, saveDocument, listDocuments, deleteDocument, setJobStatus, clearJobStatus } from './lib/storage.js';

// Atalhos de teclado
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'activate-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'RAG_ACTIVATE_SELECTION' });
  } else if (command === 'open-library') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#library') });
  }
});

// Menu de contexto
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'rag-capture',
    title: 'RAG Extractor: capturar este elemento',
    contexts: ['all'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'rag-capture' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'RAG_ACTIVATE_SELECTION' });
  }
});

// Permite abrir o side panel ao clicar no ícone (com pinned action)
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

// ─────────────────────────────────────────────────────────────
// Long-lived port — usado pelo content script para gerações longas.
// Mantém o service worker vivo enquanto o LLM processa, e envia
// progresso (heartbeat) de volta para feedback visual.
// ─────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rag-generate') return;
  console.log('[RAG bg] port conectado');

  let heartbeat = null;
  let alive = true;
  let jobFinished = false;

  port.onDisconnect.addListener(() => {
    alive = false;
    if (heartbeat) clearInterval(heartbeat);
    if (!jobFinished) {
      setJobStatus({ state: 'error', text: 'LLM demorou demais ou conexão perdida — tente novamente', finishedAt: Date.now() });
    }
    console.log('[RAG bg] port desconectado');
  });

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'RAG_GENERATE') return;
    try {
      const settings = await getSettings();
      console.log('[RAG bg] iniciando geração com', settings.model, '@', settings.llmUrl);
      const startedAt = Date.now();
      await setJobStatus({
        state: 'generating',
        title: msg.payload.title,
        url: msg.payload.url,
        startedAt,
        elapsed: 0,
        text: `Enviando ao LLM (${settings.model})…`,
      });
      port.postMessage({ type: 'RAG_PROGRESS', text: `Enviando ao LLM (${settings.model})…` });

      let secs = 0;
      heartbeat = setInterval(async () => {
        secs += 2;
        const text = `Aguardando LLM… (${secs}s)`;
        await setJobStatus({
          state: 'generating',
          title: msg.payload.title,
          url: msg.payload.url,
          startedAt,
          elapsed: secs,
          text,
        });
        if (alive) {
          try { port.postMessage({ type: 'RAG_PROGRESS', text }); } catch {}
        }
      }, 2000);

      const { markdown, tags } = await generateMarkdown(settings, msg.payload, (current, total) => {
        const text = total > 1 ? `Processando parte ${current}/${total}…` : `Aguardando LLM (${settings.model})…`;
        setJobStatus({ state: 'generating', title: msg.payload.title, url: msg.payload.url, startedAt, elapsed: 0, text });
        if (alive) try { port.postMessage({ type: 'RAG_PROGRESS', text }); } catch {}
      });
      clearInterval(heartbeat);
      jobFinished = true;
      console.log('[RAG bg] geração concluída:', markdown.length, 'chars');
      await setJobStatus({
        state: 'success',
        title: msg.payload.title,
        url: msg.payload.url,
        text: `Markdown gerado (${markdown.length} chars) — pronto para revisão`,
        finishedAt: Date.now(),
      });
      if (alive) port.postMessage({ type: 'RAG_GENERATED', generated: markdown, tags });
    } catch (err) {
      clearInterval(heartbeat);
      jobFinished = true;
      console.error('[RAG bg] erro na geração:', err);
      await setJobStatus({
        state: 'error',
        title: msg.payload?.title,
        url: msg.payload?.url,
        text: 'Erro: ' + String(err?.message || err),
        finishedAt: Date.now(),
      });
      if (alive) port.postMessage({ type: 'RAG_ERROR', error: String(err?.message || err) });
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Roteador de mensagens
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Padrão async: retornamos true e chamamos sendResponse depois
  (async () => {
    try {
      switch (msg.type) {
        case 'RAG_PING':
          sendResponse({ ok: true });
          break;

        case 'RAG_TEST_CONNECTION': {
          const settings = await getSettings();
          const result = await testConnection(settings);
          sendResponse(result);
          break;
        }

        case 'RAG_GENERATE': {
          // msg.payload = { html, text, url, title, hints }
          const settings = await getSettings();
          const { markdown, tags } = await generateMarkdown(settings, msg.payload);
          sendResponse({ ok: true, generated: markdown, tags });
          break;
        }

        case 'RAG_SAVE': {
          // msg.payload = { title, type, tags, locale, source, content, collection }
          const settings = await getSettings();
          const doc = buildMarkdown(msg.payload, settings);
          const stored = await saveDocument(doc);

          let upload = null;
          if (settings.storage === 'both' || settings.storage === 'remote') {
            try { upload = await uploadToBackend(settings, doc); }
            catch (err) { upload = { ok: false, error: String(err) }; }
          }
          sendResponse({ ok: true, doc: stored, upload });
          break;
        }

        case 'RAG_LIST_DOCS': {
          const docs = await listDocuments();
          sendResponse({ ok: true, docs });
          break;
        }

        case 'RAG_DELETE_DOC': {
          await deleteDocument(msg.id);
          sendResponse({ ok: true });
          break;
        }

        case 'RAG_OPEN_SIDE_PANEL': {
          if (sender.tab?.id) {
            await chrome.sidePanel.open({ tabId: sender.tab.id });
          }
          sendResponse({ ok: true });
          break;
        }

        case 'RAG_OPEN_PREVIEW': {
          // Abre preview como aba (não é bloqueado por adblocker, ao contrário de window.open)
          const previewUrl = chrome.runtime.getURL('preview/preview.html');
          await chrome.tabs.create({ url: previewUrl, active: true });
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'unknown message type: ' + msg.type });
      }
    } catch (err) {
      console.error('[RAG bg]', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // mantém sendResponse vivo
});
