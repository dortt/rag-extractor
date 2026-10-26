// lib/markdown.js — frontmatter + nome de arquivo

export function buildMarkdown(input, settings) {
  // input: { title, type, tags, content, collection, ...customFields }
  // customFields = keys configured in settings.frontmatterFields
  const custom = {};
  for (const f of settings.frontmatterFields || []) {
    const val = String(input[f.key] ?? '').trim();
    if (val) custom[f.key] = val; // empty custom fields are omitted
  }
  const fm = {
    title: input.title || 'Untitled',
    type: input.type || settings.defaultType || 'anything',
    tags: normalizeTags(input.tags ?? settings.defaultTags),
    ...custom,
    last_review: new Date().toISOString().slice(0, 10),
  };
  const frontmatter = stringifyFrontmatter(fm);
  const body = (input.content || '').trim();
  const markdown = `${frontmatter}\n\n${body}\n`;
  const slug = slugify(input.title || 'untitled');
  const filename = renderFilename(settings.filenamePattern, {
    slug, type: fm.type, date: fm.last_review,
    collection: (input.collection || 'default').replace(/\s+/g, '-'),
  });
  return {
    title: fm.title, type: fm.type, tags: fm.tags,
    fields: custom,
    lastReview: fm.last_review,
    collection: input.collection || 'default',
    slug, filename, frontmatter, content: body, markdown,
  };
}

export function stringifyFrontmatter(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (k === 'tags' && Array.isArray(v)) {
      lines.push(`tags: ${v.join(', ')}`);
    } else if (Array.isArray(v)) {
      lines.push(`${k}: ${v.join(', ')}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'untitled';
}

function normalizeTags(input) {
  if (Array.isArray(input)) return input.filter(Boolean);
  if (!input) return [];
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}

function renderFilename(pattern, vars) {
  return pattern.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}
