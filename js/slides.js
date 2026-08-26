/*
 * slides.js — движок презентации. Читается сверху вниз, три части:
 *
 *   1. Загрузка: берём список слайдов из manifest.json и читаем md-файлы.
 *   2. Рендер: у каждого layout своя маленькая функция-рендерер.
 *   3. Навигация: клавиатура, клик, свайп, ссылки вида #7, заметки, фуллскрин.
 */
(async function () {
  const stage = document.getElementById('stage');

  /* ================= 1. Загрузка ================= */

  let slides;
  try {
    const deck = await CONTENT.loadJSON('../content/slides/manifest.json');
    const files = await Promise.all(
      deck.slides.map((f) => CONTENT.loadText('../content/slides/' + f))
    );
    slides = files
      .map((text) => {
        const { meta, body } = MD.parseFrontmatter(text);
        return { meta, blocks: MD.parseBlocks(body) };
      })
      // слайд можно выключить, поставив в frontmatter `enabled: false`
      .filter((s) => s.meta.enabled !== 'false');
  } catch (err) {
    CONTENT.showServeHelp(stage, err);
    return;
  }

  /* ================= 2. Рендер ================= */

  const pad2 = (n) => String(n).padStart(2, '0');

  // Каждый элемент слайда появляется с задержкой --i * шаг (см. tokens.css).
  // revealIndex — сквозной счётчик очерёдности внутри одного слайда.
  let revealIndex = 0;
  const reveal = () => `class="reveal" style="--i:${revealIndex++}"`;

  // Строка-процесс: «Idea → Build → Run». Стрелки приглушает MD.inline.
  const renderLine = (text) => `<p class="line" ${reveal()}>${MD.inline(text)}</p>`;

  // Абзац после основного контента: серое примечание или жёлтый тезис (==…==).
  function renderAfter(block) {
    const t = block.text.trim();
    if (/^==.*==$/.test(t)) {
      return `<p class="thesis" ${reveal()}>${MD.escapeHtml(t.slice(2, -2))}</p>`;
    }
    return `<p class="note" ${reveal()}>${MD.inline(t)}</p>`;
  }

  // Раскладываем блоки вокруг первого списка: строки до, список, абзацы после.
  function splitAroundList(blocks) {
    const before = [];
    const after = [];
    let list = null;
    for (const b of blocks) {
      if (b.type === 'list' && !list) list = b.items;
      else if (b.type === 'p') (list ? after : before).push(b);
    }
    return { before, list: list || [], after };
  }

  // Общий рендер списков: нумерация 01 02 03, маркер можно переопределить
  // синтаксисом «- [~50%] Текст» (слайд про стратегию), а галочки — layout checklist.
  function renderListBody(blocks, marker) {
    const { before, list, after } = splitAroundList(blocks);
    let html = before.map((b) => renderLine(b.text)).join('');
    html += '<div class="items">';
    list.forEach((raw, i) => {
      let mark = marker || pad2(i + 1);
      let text = raw;
      const custom = raw.match(/^\[(.+?)\]\s+(.*)$/);
      if (custom) { mark = custom[1]; text = custom[2]; }
      const markClass = marker === '✓' ? 'check' : 'num';
      html += `<div class="item" ${reveal()}>` +
        `<span class="${markClass}">${MD.escapeHtml(mark)}</span>` +
        `<span class="txt">${MD.inline(text)}</span></div>`;
    });
    html += '</div>';
    return html + after.map(renderAfter).join('');
  }

  // Пары «белый термин — серое пояснение». Разделитель — « — » (первое вхождение).
  // Пара целиком в ==…== становится жёлтой.
  function renderPairsList(items) {
    let html = '<div class="pairs">';
    for (let raw of items) {
      let accent = '';
      if (/^==.*==$/.test(raw)) { accent = ' accent'; raw = raw.slice(2, -2); }
      const cut = raw.indexOf(' — ');
      const term = cut === -1 ? raw : raw.slice(0, cut);
      const desc = cut === -1 ? '' : raw.slice(cut + 3);
      html += `<div class="pair${accent}" style="--i:${revealIndex++}">` +
        `<span class="term reveal">${MD.inline(term)}</span>` +
        `<span class="desc reveal">${MD.inline(desc)}</span></div>`;
    }
    return html + '</div>';
  }

  const LAYOUTS = {
    // Нумерованный список, опционально со строкой-процессом сверху.
    list: (blocks) => renderListBody(blocks),

    // Чек-лист с жёлтыми галочками.
    checklist: (blocks) => renderListBody(blocks, '✓'),

    // Пары «термин — пояснение» + абзацы после.
    pairs(blocks) {
      const { list, after } = splitAroundList(blocks);
      return renderPairsList(list) + after.map(renderAfter).join('');
    },

    // Колонки. Новую колонку начинает «## Заголовок» или «---» (без заголовка).
    // Абзацы после колонок — примечание/тезис на всю ширину.
    columns(blocks) {
      const cols = [];
      const after = [];
      let current = null;
      for (const b of blocks) {
        if (b.type === 'h2') { current = { header: b.text, items: [] }; cols.push(current); }
        else if (b.type === 'hr') { current = { header: '', items: [] }; cols.push(current); }
        else if (b.type === 'list') {
          if (!current) { current = { header: '', items: [] }; cols.push(current); }
          current.items.push(...b.items);
        }
        else if (b.type === 'p') after.push(b);
      }
      let html = '<div class="cols">';
      for (const c of cols) {
        html += `<div class="col${c.header ? ' with-header' : ''}">`;
        if (c.header) html += `<h3 ${reveal()}>${MD.inline(c.header)}</h3>`;
        html += c.items.map((it) => `<p ${reveal()}>${MD.inline(it)}</p>`).join('');
        html += '</div>';
      }
      html += '</div>';
      return html + after.map(renderAfter).join('');
    },

    // Сравнение промтов: первая секция (## Структура) — пары слева,
    // остальные (## Плохо, ## Хорошо) — примеры справа.
    compare(blocks) {
      const sections = [];
      let cur = null;
      for (const b of blocks) {
        if (b.type === 'h2') { cur = { title: b.text, blocks: [] }; sections.push(cur); }
        else if (cur) cur.blocks.push(b);
      }
      const [structure, ...examples] = sections;
      const structureItems = structure.blocks.flatMap((b) => (b.type === 'list' ? b.items : []));
      let html = `<div class="compare"><div class="cmp-left">${renderPairsList(structureItems)}</div><div class="cmp-right">`;
      for (const ex of examples) {
        const good = /хорошо/i.test(ex.title);
        const text = ex.blocks.filter((b) => b.type === 'p').map((b) => b.text).join(' ');
        html += `<div class="example ${good ? 'good' : 'bad'} reveal" style="--i:${revealIndex++}">` +
          `<span class="label">${MD.escapeHtml(ex.title)}</span>` +
          `<p>«${MD.inline(text)}»</p></div>`;
      }
      return html + '</div></div>';
    },

    // Перебивка: крупная фраза слева по вертикальному центру.
    break(blocks, meta) {
      let html = `<div class="break-wrap"><h1 class="title reveal" style="--i:${revealIndex++}">${MD.inline(meta.title || '')}</h1>`;
      if (meta.subtitle) html += `<p class="break-sub reveal" style="--i:${revealIndex++}">${MD.inline(meta.subtitle)}</p>`;
      for (const b of blocks) {
        if (b.type === 'p') html += renderLine(b.text);
        if (b.type === 'list') {
          html += '<div class="break-list">' +
            b.items.map((it) => `<p ${reveal()}>${MD.inline(it)}</p>`).join('') + '</div>';
        }
      }
      return html + '</div>';
    },
  };

  // Собираем DOM-элемент слайда: заголовок + правый абзац + тело + подвал.
  function buildSlide(s) {
    revealIndex = 0;
    const layout = s.meta.layout || 'list';
    const el = document.createElement('section');
    el.className = 'slide layout-' + layout;
    if (s.meta.variant) el.classList.add('variant-' + s.meta.variant);

    if (layout === 'break') {
      el.innerHTML = LAYOUTS.break(s.blocks, s.meta);
      return el;
    }

    const title = `<header class="head"><h1 class="title reveal" style="--i:${revealIndex++}">${MD.inline(s.meta.title || '')}</h1></header>`;
    const aside = s.meta.aside
      ? `<aside class="aside reveal" style="--i:${revealIndex++}">${MD.inline(s.meta.aside)}</aside>`
      : '<aside class="aside"></aside>';
    const body = `<div class="body">${(LAYOUTS[layout] || LAYOUTS.list)(s.blocks, s.meta)}</div>`;
    const foot = s.meta.footer
      ? `<footer class="foot reveal" style="--i:${revealIndex++}">${MD.inline(s.meta.footer)}</footer>`
      : '';
    el.innerHTML = title + aside + body + foot;
    return el;
  }

  const els = slides.map((s) => {
    const el = buildSlide(s);
    stage.appendChild(el);
    return el;
  });

  /* ================= 3. Навигация ================= */

  const counter = document.getElementById('counter');
  const bar = document.getElementById('bar');
  const notes = document.getElementById('notes');
  const hint = document.getElementById('hint');
  let cur = -1;
  let notesOpen = false;

  function go(next, updateHash = true) {
    const n = Math.max(0, Math.min(els.length - 1, next));
    if (n === cur) return;
    if (els[cur]) els[cur].classList.remove('active');
    cur = n;
    els[cur].classList.add('active');
    counter.textContent = pad2(cur + 1) + ' / ' + pad2(els.length);
    bar.style.width = ((cur + 1) / els.length) * 100 + '%';
    document.title = pad2(cur + 1) + ' · ' + (slides[cur].meta.title || 'Слайд');
    // адрес вида /slides/#7 — можно дать прямую ссылку на слайд
    if (updateHash) history.replaceState(null, '', '#' + (cur + 1));
    if (notesOpen) renderNotes();
  }

  // Клавиатура. e.code вместо e.key — работает и в русской раскладке.
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.code) {
      case 'ArrowRight':
      case 'PageDown': go(cur + 1); break;              // PageDown/Up шлют кликеры
      case 'ArrowLeft':
      case 'PageUp': go(cur - 1); break;
      case 'Space': e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); break;
      case 'Home': go(0); break;
      case 'End': go(els.length - 1); break;
      case 'KeyF': toggleFullscreen(); break;
      case 'KeyN':
      case 'KeyS': toggleNotes(); break;
      case 'Escape': if (notesOpen) toggleNotes(); break;
    }
  });

  // Клик листает вперёд (кроме ссылок и выделения текста).
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (String(getSelection())) return;
    go(cur + 1);
  });

  // Свайп на таче.
  let touchX = 0;
  let touchY = 0;
  addEventListener('touchstart', (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(cur + (dx < 0 ? 1 : -1));
  }, { passive: true });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // Заметки спикера: оверлей снизу, N или S.
  function renderNotes() {
    const s = slides[cur];
    const next = slides[cur + 1];
    const text = (s.meta.notes || '').trim();
    notes.innerHTML = `<div class="notes-inner">
      <span class="notes-label">Заметки · ${pad2(cur + 1)}</span>
      ${text
        ? text.split('\n').map((l) => `<p>${MD.inline(l)}</p>`).join('')
        : '<p class="notes-none">Для этого слайда заметок нет.</p>'}
      <span class="notes-next">${next
        ? 'Дальше: ' + pad2(cur + 2) + ' · ' + MD.escapeHtml(next.meta.title || '')
        : 'Последний слайд'}</span>
    </div>`;
  }
  function toggleNotes() {
    notesOpen = !notesOpen;
    if (notesOpen) renderNotes();
    notes.classList.toggle('open', notesOpen);
  }

  // Подсказка по клавишам: тает после первого действия или сама по себе.
  const hideHint = () => hint.classList.add('gone');
  setTimeout(hideHint, 7000);
  addEventListener('keydown', hideHint, { once: true });
  addEventListener('click', hideHint, { once: true });

  // Курсор прячется, когда мышь замерла.
  let cursorTimer;
  addEventListener('mousemove', () => {
    document.body.classList.remove('no-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('no-cursor'), 2500);
  });

  // Старт: открываем слайд из адреса (#7) или первый.
  addEventListener('hashchange', () => go((parseInt(location.hash.slice(1), 10) || 1) - 1, false));
  go((parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
