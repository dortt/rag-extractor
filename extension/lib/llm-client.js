// lib/llm-client.js — fala com servidor compatível OpenAI (Ollama, llama.cpp, LM Studio)

export async function testConnection(settings) {
  const url = settings.llmUrl.replace(/\/$/, '') + '/models';
  try {
    const res = await fetch(url, {
      headers: settings.llmToken ? { Authorization: `Bearer ${settings.llmToken}` } : {},
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// onProgress(current, total) — chamado antes de cada chunk; total=1 se não houver split
// Returns { markdown: string, tags: string } — tags is a comma-separated suggestion or ''
export async function generateMarkdown(settings, payload, onProgress = null) {
  const maxChars = Number(settings.maxInputChars) || 0; // 0 = ilimitado
  const rawContent = payload.text || stripHtml(payload.html);
  const chunks = maxChars > 0 ? splitIntoChunks(rawContent, maxChars) : [rawContent];

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i + 1, chunks.length);
    parts.push(await _generateSingle(settings, payload, chunks[i]));
  }
  const combined = parts.join('\n\n');
  // Extract <!-- tags: ... --> comment appended by LLM (last occurrence wins)
  const tagMatch = [...combined.matchAll(/<!--\s*tags:\s*([^-]+?)-->/gi)].at(-1);
  const tags = tagMatch ? tagMatch[1].trim() : '';
  const markdown = combined.replace(/<!--\s*tags:\s*[^-]+?-->/gi, '').trimEnd();
  return { markdown, tags };
}

async function _generateSingle(settings, payload, content) {
  const prompt = renderTemplate(settings.promptTemplate, {
    content,
    url: payload.url || '',
    title: payload.title || '',
    type: payload.hints?.type || settings.defaultType,
    locale: payload.hints?.locale || settings.locale,
    date: new Date().toISOString().slice(0, 10),
  });

  const timeoutMs = (Number(settings.llmTimeout) || 600) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = settings.llmUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: settings.model,
    temperature: Number(settings.temperature) || 0.2,
    top_p: Number(settings.topP) || 0.9,
    max_tokens: Number(settings.maxTokens) || 4096,
    messages: [
      { role: 'system', content: 'You are a technical writer converting web page content into structured Markdown for a RAG knowledge base. Output only clean Markdown. No frontmatter. No code fences. At the very end of your output, append exactly one line: <!-- tags: tag1, tag2, tag3 --> with 4-8 relevant lowercase tags for the document.' },
      { role: 'user', content: prompt },
    ],
    stream: false,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(settings.llmToken ? { Authorization: `Bearer ${settings.llmToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const result = data?.choices?.[0]?.message?.content || '';
    return result.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  } finally {
    clearTimeout(timer);
  }
}

// Divide em chunks no limite de maxChars, quebrando em parágrafo duplo quando possível
function splitIntoChunks(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) { chunks.push(current); current = ''; }
      if (para.length > maxChars) {
        for (let i = 0; i < para.length; i += maxChars) chunks.push(para.slice(i, i + maxChars));
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}
