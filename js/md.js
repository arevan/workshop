/*
 * md.js — крошечный markdown-парсер этого проекта.
 * Понимает ровно то, что используется в контенте, и ничего больше:
 *
 *   ==текст==     жёлтый акцент
 *   **текст**     жирный
 *   `текст`       код
 *   ## Заголовок  подзаголовок / колонка
 *   - пункт       список
 *   1. пункт      нумерованный список
 *   ---           разделитель колонок
 *   ```…```       блок кода (в гайде)
 *
 * Его можно прочитать целиком за пару минут — это и есть цель.
 */

// Экранируем HTML, чтобы текст из контента не превратился в разметку.
function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Инлайновая разметка внутри одной строки.
function inline(s) {
  return escapeHtml(s)
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // стрелки в строках-процессах приглушаем
    .replaceAll(' → ', '<span class="arr">→</span>');
}

/*
 * Frontmatter — блок метаданных между «---» в начале файла:
 *   ---
 *   title: Заголовок слайда
 *   notes: |
 *     Многострочные заметки
 *   ---
 * Возвращает { meta, body }.
 */
function parseFrontmatter(text) {
  const meta = {};
  if (!text.startsWith('---')) return { meta, body: text.trim() };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta, body: text.trim() };

  const head = text.slice(text.indexOf('\n') + 1, end);
  const afterLine = text.indexOf('\n', end + 1);
  const body = afterLine === -1 ? '' : text.slice(afterLine + 1).trim();

  let key = null;
  let collecting = false; // читаем многострочное значение после «ключ: |»
  let buf = [];
  const flush = () => {
    if (collecting && key) meta[key] = buf.join('\n').trim();
    collecting = false;
    buf = [];
  };

  for (const line of head.split('\n')) {
    if (collecting) {
      if (line.startsWith('  ') || line.trim() === '') {
        buf.push(line.replace(/^  /, ''));
        continue;
      }
      flush();
    }
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    key = m[1];
    if (m[2] === '|') { collecting = true; buf = []; }
    else meta[key] = m[2].trim();
  }
  flush();
  return { meta, body };
}

/*
 * Тело файла → массив блоков:
 *   { type: 'p', text }        абзац
 *   { type: 'h2', text }       подзаголовок «## …»
 *   { type: 'list', items }    список «- …»
 *   { type: 'olist', items }   список «1. …»
 *   { type: 'hr' }             разделитель «---»
 *   { type: 'code', text }     блок кода в ```…```
 */
function parseBlocks(body) {
  const blocks = [];
  let list = null;
  let code = null;
  let comment = false; // внутри <!-- … --> — такие строки не рендерим

  for (const raw of body.split('\n')) {
    if (code) {
      if (raw.trim().startsWith('```')) { blocks.push(code); code = null; }
      else code.lines.push(raw);
      continue;
    }
    const t = raw.trim();
    if (comment) {
      if (t.includes('-->')) comment = false;
      continue;
    }
    if (t.startsWith('<!--')) {
      if (!t.includes('-->')) comment = true;
      continue;
    }
    if (t.startsWith('```')) { code = { type: 'code', lines: [] }; list = null; continue; }
    if (!t) { list = null; continue; }
    if (t.startsWith('## ')) { list = null; blocks.push({ type: 'h2', text: t.slice(3) }); continue; }
    if (t === '---') { list = null; blocks.push({ type: 'hr' }); continue; }
    if (t.startsWith('- ')) {
      if (!list || list.type !== 'list') { list = { type: 'list', items: [] }; blocks.push(list); }
      list.items.push(t.slice(2));
      continue;
    }
    const num = t.match(/^\d+\.\s+(.*)$/);
    if (num) {
      if (!list || list.type !== 'olist') { list = { type: 'olist', items: [] }; blocks.push(list); }
      list.items.push(num[1]);
      continue;
    }
    list = null;
    blocks.push({ type: 'p', text: t });
  }
  if (code) blocks.push(code);
  for (const b of blocks) {
    if (b.type === 'code') { b.text = b.lines.join('\n'); delete b.lines; }
  }
  return blocks;
}

window.MD = { escapeHtml, inline, parseFrontmatter, parseBlocks };
