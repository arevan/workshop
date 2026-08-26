/*
 * guide.js — рендер гайда-раздатки.
 * Разделы лежат в /content/guide как markdown-файлы, порядок задаёт
 * manifest.json. Каждый раздел — секция с якорем (#env-ios и т.п.).
 */
(async function () {
  const root = document.getElementById('guide');

  let sections;
  try {
    const manifest = await CONTENT.loadJSON('../content/guide/manifest.json');
    const files = await Promise.all(
      manifest.sections.map((f) => CONTENT.loadText('../content/guide/' + f))
    );
    sections = files.map((text) => MD.parseFrontmatter(text));
  } catch (err) {
    CONTENT.showServeHelp(root, err);
    return;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  // Блоки markdown → HTML. «## …» в теле раздела становится h3.
  function renderBlocks(blocks) {
    return blocks.map((b) => {
      if (b.type === 'h2') return `<h3>${MD.inline(b.text)}</h3>`;
      if (b.type === 'code') return `<pre><code>${MD.escapeHtml(b.text)}</code></pre>`;
      // Картинка. Открывается в полном размере по клику — на широких
      // скриншотах интерфейса иначе не разглядеть подписи.
      // Если файла ещё нет — прячем весь блок, чтобы не было «сломанной»
      // иконки: гайд читается и без скриншотов.
      if (b.type === 'img') {
        const cls = /phone|ios-/.test(b.src) ? 'shot shot-phone' : 'shot';
        const src = MD.escapeHtml(b.src);
        return `<figure class="${cls}">` +
          `<a href="${src}" target="_blank" rel="noopener">` +
          `<img src="${src}" alt="${MD.escapeHtml(b.alt)}"` +
          ` onerror="this.closest('figure').hidden = true"></a>` +
          (b.alt ? `<figcaption>${MD.inline(b.alt)}</figcaption>` : '') +
          '</figure>';
      }
      if (b.type === 'note') return `<blockquote><p>${MD.inline(b.text)}</p></blockquote>`;
      if (b.type === 'list') return '<ul>' + b.items.map((i) => `<li>${MD.inline(i)}</li>`).join('') + '</ul>';
      if (b.type === 'olist') return '<ol>' + b.items.map((i) => `<li>${MD.inline(i)}</li>`).join('') + '</ol>';
      if (b.type === 'hr') return '';
      return `<p>${MD.inline(b.text)}</p>`;
    }).join('');
  }

  const toc = sections.map((s, i) =>
    `<a href="#${s.meta.slug || i}"><span class="num">${pad2(i + 1)}</span>${MD.escapeHtml(s.meta.title || '')}</a>`
  ).join('');

  const bodyHtml = sections.map((s, i) => `
    <section class="g-section" id="${s.meta.slug || i}">
      <h2><span class="num">${pad2(i + 1)}</span>${MD.escapeHtml(s.meta.title || '')}</h2>
      ${renderBlocks(MD.parseBlocks(s.body))}
    </section>`
  ).join('');

  root.innerHTML = `
    <header class="g-head">
      <a class="g-back" href="../index.html">← Воркшоп</a>
      <h1>Гайд</h1>
      <p class="g-intro">Раздатка воркшопа: окружение для iPhone и Android, шаблоны промтов,
      git в двух фразах и чек-лист перед хакатоном. Открывается с телефона — сохрани ссылку.</p>
    </header>
    <nav class="g-toc">${toc}</nav>
    ${bodyHtml}`;

  /*
   * Лайтбокс: клик по скриншоту показывает его во весь экран.
   * Закрывается тремя способами — крестик, клик мимо картинки, Esc.
   * Если JS не сработал, ссылка остаётся обычной: картинка просто откроется
   * отдельной страницей.
   */
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Закрыть">×</button>' +
    '<img alt=""><span class="lightbox-hint">Закрыть — Esc или клик мимо картинки</span>';
  document.body.appendChild(box);
  const bigImage = box.querySelector('img');

  function openLightbox(src, alt) {
    bigImage.src = src;
    bigImage.alt = alt;
    box.classList.add('open');
    document.body.style.overflow = 'hidden'; // страница под оверлеем не скроллится
    box.querySelector('.lightbox-close').focus();
  }

  function closeLightbox() {
    box.classList.remove('open');
    document.body.style.overflow = '';
    bigImage.removeAttribute('src');
  }

  root.addEventListener('click', (e) => {
    const link = e.target.closest('figure.shot a');
    if (!link) return;
    e.preventDefault();
    openLightbox(link.getAttribute('href'), link.querySelector('img').alt);
  });

  // Клик по фону или крестику закрывает; по самой картинке — нет,
  // чтобы её можно было рассматривать, не боясь промахнуться.
  box.addEventListener('click', (e) => {
    if (e.target !== bigImage) closeLightbox();
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.classList.contains('open')) closeLightbox();
  });
})();
