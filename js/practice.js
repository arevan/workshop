/*
 * practice.js — рендер практики: разборы кейсов с готовыми промтами.
 *
 * Кейсы лежат в /content/practice как markdown-файлы, порядок задаёт
 * manifest.json. Один кейс — одна страница; какая открыта, хранится в хеше
 * адреса (…/practice/#sandbox), поэтому ссылку на конкретный кейс можно
 * кинуть в чат, и она откроется сразу на нужном.
 *
 * Разметка кейса разбирается тем же md.js, что и гайд. Договорённость одна:
 * «## Заголовок» начинает новый шаг, блок кода внутри шага — это промт,
 * и он рендерится панелью с кнопкой «Копировать».
 */
(async function () {
  const root = document.getElementById('practice');

  let cases;
  try {
    const manifest = await CONTENT.loadJSON('../content/practice/manifest.json');
    const files = await Promise.all(
      manifest.cases.map((f) => CONTENT.loadText('../content/practice/' + f))
    );
    cases = files.map((text) => MD.parseFrontmatter(text));
  } catch (err) {
    CONTENT.showServeHelp(root, err);
    return;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const slugOf = (c, i) => c.meta.slug || String(i + 1);

  // Один блок markdown → HTML. Отличие от гайда — блок кода: внутри кейса
  // это всегда промт, значит нужна панель с кнопкой копирования.
  function renderBlock(b) {
    if (b.type === 'code') {
      return '<div class="prompt">' +
        '<div class="prompt-bar">' +
        '<span class="prompt-label">Промт</span>' +
        '<button class="copy" type="button">Копировать</button>' +
        '</div>' +
        `<pre><code>${MD.escapeHtml(b.text)}</code></pre>` +
        '</div>';
    }
    if (b.type === 'note') return `<blockquote><p>${MD.inline(b.text)}</p></blockquote>`;
    if (b.type === 'list') return '<ul>' + b.items.map((i) => `<li>${MD.inline(i)}</li>`).join('') + '</ul>';
    if (b.type === 'olist') return '<ol>' + b.items.map((i) => `<li>${MD.inline(i)}</li>`).join('') + '</ol>';
    if (b.type === 'hr') return '';
    return `<p>${MD.inline(b.text)}</p>`;
  }

  /*
   * Блоки → шаги. Всё, что идёт до первого «##», — вступление к кейсу;
   * дальше каждый «##» открывает новый шаг. Номера шагов проставляются
   * здесь, а не в тексте: поменял порядок заголовков — нумерация сама
   * пересчиталась, править контент не нужно.
   */
  function renderCase(item) {
    const blocks = MD.parseBlocks(item.body);
    const lead = [];
    const steps = [];
    let current = null;

    for (const b of blocks) {
      if (b.type === 'h2') {
        current = { title: b.text, html: '' };
        steps.push(current);
        continue;
      }
      const html = renderBlock(b);
      if (current) current.html += html;
      else lead.push(html);
    }

    const leadHtml = lead.length ? `<div class="p-lead">${lead.join('')}</div>` : '';
    const stepsHtml = steps.map((s, i) => `
      <section class="p-step">
        <div class="p-step-head">
          <span class="num">${pad2(i + 1)}</span>
          <h2>${MD.inline(s.title)}</h2>
        </div>
        ${s.html}
      </section>`
    ).join('');

    return leadHtml + stepsHtml;
  }

  // Какой кейс открыт: по хешу в адресе, по умолчанию первый.
  function currentIndex() {
    const hash = decodeURIComponent(location.hash.slice(1));
    const found = cases.findIndex((c, i) => slugOf(c, i) === hash);
    return found === -1 ? 0 : found;
  }

  root.innerHTML = `
    <header class="p-head">
      <a class="p-back" href="../index.html">← Воркшоп</a>
      <h1>Практика</h1>
      <p class="p-sub">Кейсы, собранные вайбкодингом, — с промтами,
      которые довели их до рабочего состояния.</p>
    </header>
    <nav class="p-cases"></nav>
    <div class="p-body"></div>`;

  const nav = root.querySelector('.p-cases');
  const body = root.querySelector('.p-body');

  function show() {
    const index = currentIndex();

    nav.innerHTML = cases.map((c, i) =>
      `<a href="#${slugOf(c, i)}"${i === index ? ' class="is-current"' : ''}>` +
      `<span class="num">${pad2(i + 1)}</span>${MD.escapeHtml(c.meta.title || '')}</a>`
    ).join('');

    body.innerHTML = renderCase(cases[index]);
  }

  show();
  addEventListener('hashchange', () => {
    show();
    scrollTo({ top: 0 });
  });

  /*
   * Копирование промта. Clipboard API работает не везде (например, если сайт
   * открыт не по localhost), поэтому есть запасной путь: выделяем текст,
   * и участнику остаётся нажать Cmd+C. Пустой кнопки в любом случае не будет.
   */
  body.addEventListener('click', (e) => {
    const button = e.target.closest('.copy');
    if (!button) return;

    const pre = button.closest('.prompt').querySelector('pre');

    const done = (label) => {
      button.textContent = label;
      button.dataset.done = 'true';
      setTimeout(() => {
        button.textContent = 'Копировать';
        button.dataset.done = 'false';
      }, 2000);
    };

    const selectText = () => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pre.textContent).then(
        () => done('Скопировано'),
        () => { selectText(); done('Выделено'); }
      );
    } else {
      selectText();
      done('Выделено');
    }
  });
})();
