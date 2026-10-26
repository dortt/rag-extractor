// content/content.js — injeta overlay, hover/click, captura DOM, envia ao background
(() => {
  if (window.__ragInjected) return;
  window.__ragInjected = true;

  let selecting = false;
  let lastHover = null;
  let banner, hoverBox, highlightBox;
  let toastStyleInjected = false;

  const SAFE_TAGS = new Set([
    'P','SPAN','A','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH',
    'H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','CODE','EM','STRONG','B','I',
    'SECTION','ARTICLE','DIV','MAIN','HEADER','FOOTER','ASIDE','FIGURE','FIGCAPTION',
    'IMG','BR','HR','DL','DT','DD'
  ]);

  let contextMenu = null;

  function showContextMenu(target, x, y) {
    removeContextMenu();

    // Pausa o modo seleção para o menu poder receber cliques/hover normalmente
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    if (highlightBox) highlightBox.style.display = 'none';
    if (hoverBox) hoverBox.style.display = 'none';

    const menu = document.createElement('div');
    menu.id = '__rag-menu';
    menu.style.cssText = [
      'all:initial',
      `position:fixed`,
      `left:${x}px`,
      `top:${y}px`,
      `background:oklch(0.19 0.012 250 / 0.98)`,
      `border:1px solid oklch(0.30 0.012 250)`,
      `border-radius:6px`,
      `box-shadow:0 12px 32px rgba(0,0,0,.5)`,
      `font:500 12px/1 -apple-system,Inter,system-ui,sans-serif`,
      `z-index:2147483647`,
      `overflow:hidden`,
      `min-width:190px`,
      `backdrop-filter:blur(8px)`,
      `color:#e7ecf3`,
    ].join(';');

    const btnStyle = 'all:initial;display:block;width:100%;padding:10px 14px;background:transparent;border:none;color:#e7ecf3;text-align:left;cursor:pointer;font:500 12px/1 -apple-system,Inter,system-ui,sans-serif;box-sizing:border-box';
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:oklch(0.26 0.010 250)';

    const btnMd = document.createElement('button');
    btnMd.id = '__rag-menu-md';
    btnMd.style.cssText = btnStyle;
    btnMd.textContent = '📝 Gerar Markdown';

    const btnPdf = document.createElement('button');
    btnPdf.id = '__rag-menu-pdf';
    btnPdf.style.cssText = btnStyle;
    btnPdf.textContent = '🖨 Imprimir / PDF';

    menu.appendChild(btnMd);
    menu.appendChild(sep);
    menu.appendChild(btnPdf);
    document.documentElement.appendChild(menu);
    contextMenu = menu;

    // Ajusta posição se sair da tela
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)  menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    function resumeSelection() {
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
    }

    btnMd.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      removeContextMenu();
      capture(target);
    });
    btnPdf.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      removeContextMenu();
      deactivate();
      printElement(target);
    });

    // Clique fora fecha o menu e retoma o modo seleção
    setTimeout(() => {
      document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
          removeContextMenu();
          resumeSelection();
        }
      }, { once: true, capture: true });
    }, 0);
  }

  function removeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  function printElement(el) {
    const clone = el.cloneNode(true);
    clone.id = '__rag-print-clone';
    document.body.appendChild(clone);

    // overflow:hidden containers cause white gaps in print — browser reserves space for clipped content.
    // Setting overflow:visible exposes all content so page breaks fall correctly.
    [clone, ...clone.querySelectorAll('*')].forEach(node => {
      const cs = window.getComputedStyle(node);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        node.style.setProperty('overflow', 'visible', 'important');
      }
    });

    const sourceBar = document.createElement('div');
    sourceBar.style.cssText = 'position:static;font:11px ui-monospace,Menlo,monospace;color:#666;margin-top:12px;padding-top:10px;border-top:1px solid #ddd;word-break:break-all';
    sourceBar.textContent = location.href;
    clone.appendChild(sourceBar);

    const style = document.createElement('style');
    style.id = '__rag-print-style';
    style.textContent = `
      @media print {
        html, body { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
        body > *:not(#__rag-print-clone) { display:none !important; }
        #__rag-print-clone { display:block !important; }
      }
    `;
    document.head.appendChild(style);

    window.print();

    clone.remove();
    style.remove();
  }

  function makeUI() {
    banner = document.createElement('div');
    banner.id = '__rag-banner';
    banner.innerHTML = `
      <span class="dot"></span>
      <span>Modo seleção · passe o mouse e clique</span>
      <button id="__rag-cancel">ESC</button>
    `;
    document.documentElement.appendChild(banner);
    document.getElementById('__rag-cancel').addEventListener('click', deactivate);

    hoverBox = document.createElement('div');
    hoverBox.id = '__rag-hover-info';
    document.documentElement.appendChild(hoverBox);

    highlightBox = document.createElement('div');
    highlightBox.id = '__rag-highlight';
    document.documentElement.appendChild(highlightBox);

    const style = document.createElement('style');
    style.id = '__rag-style';
    style.textContent = `
      #__rag-banner{position:fixed;top:12px;left:50%;transform:translateX(-50%);
        background:oklch(0.16 0.012 250 / 0.96);color:#e7ecf3;
        border:1px solid oklch(0.80 0.14 165);border-radius:6px;
        padding:8px 14px;display:flex;align-items:center;gap:10px;
        font:500 12px/1 -apple-system,Inter,system-ui,sans-serif;z-index:2147483646;
        backdrop-filter:blur(8px);box-shadow:0 12px 32px rgba(0,0,0,.4)}
      #__rag-banner .dot{width:8px;height:8px;border-radius:4px;
        background:oklch(0.80 0.14 165);box-shadow:0 0 8px oklch(0.80 0.14 165)}
      #__rag-banner button{background:transparent;border:1px solid oklch(0.30 0.012 250);
        color:#cdd5e0;font:600 10px/1 ui-monospace,Menlo,monospace;
        padding:4px 8px;border-radius:3px;cursor:pointer;margin-left:4px}
      #__rag-hover-info{position:fixed;bottom:12px;left:12px;
        background:oklch(0.16 0.012 250 / 0.96);color:#e7ecf3;
        border:1px solid oklch(0.30 0.012 250);border-radius:6px;
        padding:8px 12px;font:11px ui-monospace,Menlo,monospace;
        z-index:2147483646;display:none;backdrop-filter:blur(8px)}
      #__rag-highlight{position:fixed;pointer-events:none;
        outline:2px solid oklch(0.80 0.14 165);
        background:oklch(0.80 0.14 165 / 0.06);
        border-radius:3px;z-index:2147483645;display:none;
        transition:all .08s ease-out}
      .__rag-toast{position:fixed;bottom:16px;right:16px;
        background:oklch(0.16 0.012 250 / 0.96);color:#e7ecf3;
        border:1px solid oklch(0.30 0.012 250);border-radius:6px;
        padding:10px 14px;font:12px -apple-system,Inter,system-ui,sans-serif;
        z-index:2147483647;backdrop-filter:blur(8px);min-width:240px;
        box-shadow:0 12px 32px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px}
      .__rag-toast.success{border-color:oklch(0.55 0.12 145)}
      .__rag-toast.error{border-color:oklch(0.55 0.18 25)}
    `;
    document.documentElement.appendChild(style);
  }

  function ensureToastStyle() {
    if (toastStyleInjected) return;
    toastStyleInjected = true;
    const s = document.createElement('style');
    s.id = '__rag-toast-style';
    s.textContent = `
      .__rag-toast{position:fixed;bottom:16px;right:16px;
        background:oklch(0.16 0.012 250 / 0.96);color:#e7ecf3;
        border:1px solid oklch(0.30 0.012 250);border-radius:6px;
        padding:10px 14px;font:12px -apple-system,Inter,system-ui,sans-serif;
        z-index:2147483647;backdrop-filter:blur(8px);min-width:260px;max-width:420px;
        box-shadow:0 12px 32px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px}
      .__rag-toast.loading{border-color:oklch(0.80 0.14 165)}
      .__rag-toast.success{border-color:oklch(0.55 0.12 145)}
      .__rag-toast.error{border-color:oklch(0.55 0.18 25)}
      .__rag-toast button{margin-left:auto;background:transparent;
        border:1px solid oklch(0.30 0.012 250);color:#cdd5e0;
        font:600 10px/1 ui-monospace,Menlo,monospace;padding:4px 8px;
        border-radius:3px;cursor:pointer}
    `;
    document.documentElement.appendChild(s);
  }

  function destroyUI() {
    // mantém toast e seu style — só remove o chrome do modo seleção
    ['__rag-banner','__rag-hover-info','__rag-highlight','__rag-style']
      .forEach(id => document.getElementById(id)?.remove());
  }

  function activate() {
    if (selecting) return;
    selecting = true;
    document.documentElement.classList.add('rag-selecting');
    if (!document.getElementById('__rag-banner')) makeUI();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    // window listener (capture) — pega ESC mesmo se foco estiver no side panel não-é-este-window
    window.addEventListener('keydown', onKey, true);
  }

  function deactivate() {
    selecting = false;
    document.documentElement.classList.remove('rag-selecting');
    destroyUI();
    removeContextMenu();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keydown', onKey, true);
    lastHover = null;
  }

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id?.startsWith('__rag-')) return;
    const target = bestSelectable(el);
    if (target === lastHover) return;
    lastHover = target;
    const r = target.getBoundingClientRect();
    Object.assign(highlightBox.style, {
      display: 'block',
      left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
    hoverBox.style.display = 'block';
    hoverBox.innerHTML = `<span style="color:oklch(0.85 0.14 165)">&lt;${target.tagName.toLowerCase()}&gt;</span>` +
      ` <span style="color:#7a8390">·</span> ${describe(target)}`;
  }

  function onClick(e) {
    if (!selecting) return;
    e.preventDefault(); e.stopPropagation();
    const target = lastHover || bestSelectable(document.elementFromPoint(e.clientX, e.clientY));
    if (!target) return;
    showContextMenu(target, e.clientX, e.clientY);
  }

  function onKey(e) {
    if (e.key === 'Escape') { deactivate(); }
  }

  // Encontra o ancestor "interessante" — sobe até achar bloco com texto significativo
  function bestSelectable(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (!SAFE_TAGS.has(cur.tagName)) { cur = cur.parentElement; continue; }
      const text = cur.innerText || '';
      if (text.trim().length > 40 || cur.tagName.match(/^H[1-6]$/) || cur.tagName === 'TABLE') return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function describe(el) {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `<span style="color:#cdd5e0">${id}${cls}</span>`;
  }

  async function capture(el) {
    const sanitized = sanitize(el);
    const html = sanitized.outerHTML;
    const text = htmlToText(sanitized);
    const url = location.href;
    const title = document.title;

    deactivate();
    showToast('Conectando…', 'loading');
    console.log('[RAG] capturado', { textLen: text.length, htmlLen: html.length, url });

    // Usa long-lived port para não perder a resposta se o service worker reiniciar.
    // Também envia heartbeat de progresso para feedback visual.
    let generated = '';
    let suggestedTags = '';
    let llmError = null;

    try {
      const llmResult = await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'rag-generate' });
        let timer = setTimeout(() => {
          port.disconnect();
          reject(new Error('timeout — LLM não respondeu'));
        }, 600_000);

        port.onMessage.addListener((msg) => {
          console.log('[RAG] port msg:', msg);
          if (msg.type === 'RAG_PROGRESS') {
            showToast(msg.text || 'processando…', 'loading');
          } else if (msg.type === 'RAG_GENERATED') {
            clearTimeout(timer);
            port.disconnect();
            resolve({ generated: msg.generated, tags: msg.tags || '' });
          } else if (msg.type === 'RAG_ERROR') {
            clearTimeout(timer);
            port.disconnect();
            reject(new Error(msg.error || 'erro desconhecido'));
          }
        });

        port.onDisconnect.addListener(() => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'port disconnected'));
          }
        });

        port.postMessage({
          type: 'RAG_GENERATE',
          payload: { html, text, url, title, hints: {} },
        });
      });
      generated = llmResult.generated;
      suggestedTags = llmResult.tags;
    } catch (err) {
      console.error('[RAG] erro ao gerar markdown:', err);
      llmError = err.message || String(err);
      generated = `# ${title}\n\n${text}`;
      showToast('LLM falhou — abrindo editor com texto cru. ' + llmError, 'error', 6000);
    }

    await chrome.storage.local.set({
      rag_preview_pending: {
        title, source: url, content: generated,
        tags: suggestedTags,
        capturedAt: Date.now(),
        llmError,
      }
    });

    try {
      await chrome.runtime.sendMessage({ type: 'RAG_OPEN_PREVIEW' });
    } catch (err) {
      console.error('[RAG] erro ao abrir preview:', err);
      showToast('Erro ao abrir preview: ' + err.message, 'error', 4000);
    }
    if (!llmError) hideToast();
  }

  // Extrai texto estruturado de um nó DOM — preserva layout de bloco e converte img→![alt](src)
  function htmlToText(node) {
    const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6',
      'LI','TR','SECTION','ARTICLE','HEADER','FOOTER','FIGURE','BLOCKQUOTE','PRE','DD','BR','HR']);
    const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME']);
    const parts = [];
    function walk(n) {
      if (n.nodeType === 3) { parts.push(n.textContent); return; }
      if (n.nodeType !== 1) return;
      if (SKIP.has(n.tagName)) return;
      if (n.tagName === 'IMG') {
        const alt = (n.getAttribute('alt') || '').trim();
        const src = (n.getAttribute('src') || '').trim();
        if (alt || src) parts.push(` ![${alt}](${src}) `);
        return;
      }
      const isBlock = BLOCK.has(n.tagName);
      const isCell = n.tagName === 'TD' || n.tagName === 'TH';
      if (isBlock) parts.push('\n');
      n.childNodes.forEach(c => walk(c));
      if (isCell) parts.push('\t');
      if (isBlock) parts.push('\n');
    }
    walk(node);
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Sanitização simples — clona e remove scripts/estilos/eventos
  function sanitize(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,object,embed').forEach(n => n.remove());
    walk(clone, (n) => {
      if (n.nodeType !== 1) return;
      [...n.attributes].forEach(a => {
        if (a.name.startsWith('on') || a.name === 'style') n.removeAttribute(a.name);
      });
    });
    return clone;
  }
  function walk(n, fn) { fn(n); n.childNodes && n.childNodes.forEach(c => walk(c, fn)); }

  let toastEl;
  function showToast(text, kind = 'loading', auto = 0) {
    ensureToastStyle();
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.className = '__rag-toast ' + kind;
    toastEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    toastEl.appendChild(span);
    if (kind === 'loading') {
      const btn = document.createElement('button');
      btn.textContent = 'Cancelar';
      btn.addEventListener('click', () => {
        hideToast();
        try { window.dispatchEvent(new CustomEvent('__rag-cancel')); } catch {}
      });
      toastEl.appendChild(btn);
    }
    if (auto) setTimeout(hideToast, auto);
  }
  function hideToast() { toastEl?.remove(); toastEl = null; }

  // Recebe mensagens do background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'RAG_ACTIVATE_SELECTION') activate();
    if (msg?.type === 'RAG_DEACTIVATE_SELECTION') deactivate();
  });

  // ─── Status global persistente ───
  // Lê o status do storage ao carregar e escuta mudanças.
  // Assim, mesmo navegando para outra página, o toast aparece de volta.
  async function syncStatusFromStorage() {
    try {
      const s = await chrome.storage.local.get('rag_job_status');
      const job = s.rag_job_status;
      if (!job || job.state === 'idle') return;
      if (job.state === 'generating') {
        showToast(job.text || 'Processando…', 'loading');
      } else if (job.state === 'success') {
        // Só mostra se foi recente (<10s) — evita spam ao abrir abas antigas
        if (Date.now() - (job.finishedAt || 0) < 10000) {
          showToast(job.text || 'Pronto!', 'success', 4000);
        }
      } else if (job.state === 'error') {
        if (Date.now() - (job.finishedAt || 0) < 10000) {
          showToast(job.text || 'Erro', 'error', 6000);
        }
      }
    } catch {}
  }
  syncStatusFromStorage();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.rag_job_status) return;
    const job = changes.rag_job_status.newValue;
    if (!job) return;
    if (job.state === 'generating') {
      showToast(job.text || 'Processando…', 'loading');
    } else if (job.state === 'success') {
      showToast(job.text || 'Pronto!', 'success', 4000);
    } else if (job.state === 'error') {
      showToast(job.text || 'Erro', 'error', 6000);
    } else if (job.state === 'idle') {
      hideToast();
    }
  });
})();
