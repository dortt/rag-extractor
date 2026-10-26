// lib/backend-client.js — POST do markdown final para o servidor de armazenamento

export async function uploadToBackend(settings, doc) {
  if (!settings.backendUrl) return { ok: false, error: 'backendUrl vazio' };
  const res = await fetch(settings.backendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.backendToken ? { Authorization: `Bearer ${settings.backendToken}` } : {}),
    },
    body: JSON.stringify({
      filename: doc.filename,
      frontmatter: doc.frontmatter,
      content: doc.content,
      markdown: doc.markdown, // arquivo completo (frontmatter + conteúdo)
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 120)}` };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, response: data };
}
