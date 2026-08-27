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
  // ВАЖНО: rstyle() возвращает только style, класс reveal пишется явно —
  // второй атрибут class браузер молча игнорирует.
  let revealIndex = 0;
  const rstyle = () => `style="--i:${revealIndex++}"`;

  // Строка-процесс: «Idea → Build → Run». Стрелки приглушает MD.inline.
  const renderLine = (text) => `<p class="line reveal" ${rstyle()}>${MD.inline(text)}</p>`;

  // Абзац после основного контента: серое примечание или жёлтый тезис (==…==).
  function renderAfter(block) {
    const t = block.text.trim();
    if (/^==.*==$/.test(t)) {
      return `<p class="thesis reveal" ${rstyle()}>${MD.escapeHtml(t.slice(2, -2))}</p>`;
    }
    return `<p class="note reveal" ${rstyle()}>${MD.inline(t)}</p>`;
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
      html += `<div class="item reveal" ${rstyle()}>` +
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
        if (c.header) html += `<h3 class="reveal" ${rstyle()}>${MD.inline(c.header)}</h3>`;
        html += c.items.map((it) => `<p class="reveal" ${rstyle()}>${MD.inline(it)}</p>`).join('');
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
            b.items.map((it) => `<p class="reveal" ${rstyle()}>${MD.inline(it)}</p>`).join('') + '</div>';
        }
      }
      // QR-коды: строки вида «![Подпись](../assets/qr-x.png)» в теле слайда.
      // Их может быть несколько — встают рядом, подпись под каждым говорит,
      // куда ведёт. Старый вариант через frontmatter (qr + qrlabel) тоже
      // работает: это тот же ряд, просто из одного кода.
      const codes = blocks.filter((b) => b.type === 'img');
      if (meta.qr) codes.push({ src: meta.qr, alt: meta.qrlabel || '' });
      if (codes.length) {
        html += `<div class="break-qrs">` + codes.map((b) =>
          `<figure class="break-qr reveal" style="--i:${revealIndex++}">` +
          `<img src="${MD.escapeHtml(b.src)}" alt="QR-код" onerror="this.closest('figure').hidden = true">` +
          (b.alt ? `<figcaption>${MD.inline(b.alt)}</figcaption>` : '') +
          '</figure>').join('') + '</div>';
      }
      return html + '</div>';
    },

    // Ряд телефонов с записями демок. Каждый кейс — строка вида
    // «![Название — время](../assets/demos/file.mp4)». Пока файла нет,
    // экран остаётся пустым, слайд не ломается.
    mockups(blocks) {
      const items = blocks.filter((b) => b.type === 'img');
      const phones = items.map((b, i) => {
        const src = MD.escapeHtml(b.src);
        const isVideo = /\.(mp4|webm|mov)$/i.test(b.src);
        const media = isVideo
          ? `<video src="${src}" muted loop autoplay playsinline
               onerror="this.closest('.phone').classList.add('empty')"></video>`
          : `<img src="${src}" alt=""
               onerror="this.closest('.phone').classList.add('empty')">`;
        return `<figure class="phone reveal" style="--i:${revealIndex++}">
          <div class="phone-frame">${media}</div>
          ${b.alt ? `<figcaption>${MD.inline(b.alt)}</figcaption>` : ''}
        </figure>`;
      }).join('');
      // Число телефонов уходит в CSS: от него зависит их размер.
      return `<div class="phones" style="--count:${items.length || 1}">${phones}</div>`;
    },

    // Орбита: слова цикла едут по наклонённому эллипсу. Порядок и текст
    // берутся из строки вида «Idea → Build → ==Run== → Polish».
    // Движение считает startOrbit.
    orbit(blocks, meta) {
      const line = blocks.find((b) => b.type === 'p');
      const words = (line ? line.text : '').split('→').map((s) => s.trim()).filter(Boolean);
      // Номер перед словом — иначе на кольце не видно, что за чем идёт.
      const items = words.map((w, i) => {
        const accent = /^==.*==$/.test(w);
        const text = accent ? w.slice(2, -2) : w;
        return `<span class="orbit-word${accent ? ' accent' : ''}">` +
          `<i class="orbit-num">${pad2(i + 1)}</i>${MD.escapeHtml(text)}</span>`;
      }).join('');
      return `<div class="orbit" aria-label="${MD.escapeHtml(words.join(' → '))}">
        <svg class="orbit-path" aria-hidden="true"><ellipse class="orbit-line" /></svg>
        ${items}
      </div>`;
    },

    // Титульный слайд: приветствие печатает само себя в терминальном
    // стиле, строка за строкой. Каждый абзац тела — одна строка.
    // Очередью печати управляет startCoverTyping.
    cover(blocks) {
      const lines = blocks
        .filter((b) => b.type === 'p')
        .map((b) => `<p class="cover-line">` +
          `<span class="cover-prefix">&gt;</span>` +
          `<span class="cover-line-type" data-text="${MD.escapeHtml(b.text)}"></span>` +
          `<span class="cover-caret"></span></p>`)
        .join('');
      return `<div class="cover">${lines}</div>`;
    },
  };

  // Собираем DOM-элемент слайда: заголовок + правый абзац + тело + подвал.
  function buildSlide(s) {
    revealIndex = 0;
    const layout = s.meta.layout || 'list';
    const el = document.createElement('section');
    el.className = 'slide layout-' + layout;
    if (s.meta.variant) el.classList.add('variant-' + s.meta.variant);

    // Перебивка и титул живут вне общей сетки слайда: у них нет
    // ни правого абзаца, ни подвала. Орбита идёт по общему пути.
    if (layout === 'break' || layout === 'cover') {
      el.innerHTML = LAYOUTS[layout](s.blocks, s.meta);
      // Ссылки с перебивок открываем в новой вкладке: показ не должен
      // уезжать со слайда, когда открыли раздел сайта.
      el.querySelectorAll('a[href]').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener';
      });
      return el;
    }

    // Без правого абзаца заголовок занимает всю ширину слайда,
    // иначе справа остаётся пустая колонка.
    if (!s.meta.aside) el.classList.add('no-aside');
    const title = `<header class="head"><h1 class="title reveal" style="--i:${revealIndex++}">${MD.inline(s.meta.title || '')}</h1></header>`;
    const aside = s.meta.aside
      ? `<aside class="aside reveal" style="--i:${revealIndex++}">${MD.inline(s.meta.aside)}</aside>`
      : '';
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

  /* ---------- Перезапуск появления ----------
     Слайды лежат в DOM скрытыми (display:none), и браузер не всегда
     запускает CSS-анимацию в момент, когда слайд становится видимым:
     иногда заголовок так и остаётся прозрачным. Поэтому при каждом показе
     сбрасываем анимацию вручную — заодно слайд «приезжает» и при возврате. */
  function restartReveals(slide) {
    slide.querySelectorAll('.reveal').forEach((node) => {
      node.style.animation = 'none';
      void node.offsetWidth; // принудительный reflow: без него сброс не виден
      node.style.animation = '';
    });
  }

  /* ---------- Орбита ----------
     Слова едут по эллипсу: угол растёт со временем, положение считается
     синусом и косинусом. Ближние (нижняя половина) крупнее и ярче —
     от этого плоский эллипс читается как наклонённое кольцо. */
  let orbitRaf = 0;

  // Цвет слова на орбите меняется вместо прозрачности: полупрозрачный
  // текст пропускает сквозь себя линию орбиты и выглядит перечёркнутым.
  const hexToRgb = (hex) => {
    const h = hex.trim().replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const mix = (a, b, t) =>
    `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

  function startOrbit(slide) {
    cancelAnimationFrame(orbitRaf); // остановить орбиту прошлого слайда
    const box = slide.querySelector('.orbit');
    if (!box) return;
    const words = [...box.querySelectorAll('.orbit-word')];
    if (!words.length) return;

    const step = (Math.PI * 2) / words.length; // равные промежутки по кругу
    const SPEED = 0.00016;                     // радиан в миллисекунду
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Дальние слова уходят к тусклому серому, ближние — к белому.
    const palette = getComputedStyle(document.documentElement);
    const FAR = hexToRgb(palette.getPropertyValue('--text-dim'));
    const NEAR = hexToRgb(palette.getPropertyValue('--text'));
    const ACCENT = hexToRgb(palette.getPropertyValue('--accent'));
    const ACCENT_FAR = ACCENT.map((v) => Math.round(v * 0.45)); // приглушённый жёлтый

    const svg = box.querySelector('.orbit-path');
    const ellipse = svg && svg.querySelector('.orbit-line');
    let lastW = 0;
    let lastH = 0;

    const place = (time) => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      const rx = w / 2 - 60;  // радиусы с запасом, чтобы слова не срезало
      const ry = h / 2 - 30;

      // Рисуем эллипс в реальных пикселях, а не в растянутом viewBox:
      // иначе линия получается разной толщины по горизонтали и вертикали.
      if (ellipse && (w !== lastW || h !== lastH)) {
        lastW = w;
        lastH = h;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        ellipse.setAttribute('cx', w / 2);
        ellipse.setAttribute('cy', h / 2);
        ellipse.setAttribute('rx', rx);
        ellipse.setAttribute('ry', ry);
      }

      words.forEach((el, i) => {
        // Старт снизу (-90°), чтобы первое слово было к зрителю.
        const a = -Math.PI / 2 + i * step + (reduce ? 0 : time * SPEED);
        const x = Math.cos(a) * rx;
        const y = Math.sin(a) * ry;
        // sin > 0 — ближняя половина орбиты: крупнее, ярче и поверх.
        const depth = (Math.sin(a) + 1) / 2;
        const scale = 0.78 + depth * 0.32;
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
        // Глубину показываем цветом, а не прозрачностью: текст остаётся
        // непрозрачным и линия орбиты сквозь него не просвечивает.
        const accent = el.classList.contains('accent');
        el.style.color = accent
          ? mix(ACCENT_FAR, ACCENT, depth)
          : mix(FAR, NEAR, depth);
        el.style.zIndex = Math.round(depth * 100) + 1;
      });
    };

    if (reduce) { place(0); return; }
    const loop = (t) => { place(t); orbitRaf = requestAnimationFrame(loop); };
    orbitRaf = requestAnimationFrame(loop);
  }

  /* ---------- Печатающееся приветствие ----------
     Строки печатаются по очереди; каретка мигает только у той строки,
     которая печатается сейчас, и остаётся у последней. Перезапускается
     при каждом входе на слайд. */
  let typingTimer;
  function typeInto(node, text, speed, done) {
    let n = 0;
    node.textContent = '';
    typingTimer = setInterval(() => {
      n++;
      node.textContent = text.slice(0, n);
      if (n >= text.length) {
        clearInterval(typingTimer);
        if (done) done();
      }
    }, speed);
  }

  function startCoverTyping(slide) {
    clearInterval(typingTimer);   // печать могла идти, если ушли со слайда
    clearTimeout(typingTimer);    // ...или шла пауза между строками
    const lines = [...slide.querySelectorAll('.cover-line')];
    if (!lines.length) return;

    lines.forEach((p) => p.classList.remove('typing', 'done'));

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      lines.forEach((p) => {
        p.querySelector('.cover-line-type').textContent = p.querySelector('.cover-line-type').dataset.text || '';
        p.classList.add('done');
      });
      lines[lines.length - 1].classList.add('typing'); // каретка на последней
      return;
    }

    lines.forEach((p) => { p.querySelector('.cover-line-type').textContent = ''; });

    const typeLine = (i) => {
      if (i >= lines.length) return;
      const p = lines[i];
      const node = p.querySelector('.cover-line-type');
      p.classList.add('typing');
      typeInto(node, node.dataset.text || '', 34, () => {
        p.classList.add('done');
        if (i + 1 < lines.length) {
          p.classList.remove('typing'); // каретка уезжает на следующую строку
          typingTimer = setTimeout(() => typeLine(i + 1), 420);
        }
      });
    };
    typeLine(0);
  }

  /* ================= 3. Навигация ================= */

  const counter = document.getElementById('counter');
  const bar = document.getElementById('bar');
  const notes = document.getElementById('notes');
  const hint = document.getElementById('hint');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  let cur = -1;
  let notesOpen = false;

  function go(next, updateHash = true) {
    const n = Math.max(0, Math.min(els.length - 1, next));
    if (n === cur) return;
    if (els[cur]) els[cur].classList.remove('active');
    cur = n;
    const el = els[cur];
    el.classList.add('active');
    restartReveals(el);
    startCoverTyping(el);
    startOrbit(el);
    // Слайд может управлять фоном: dots: false — выключить,
    // dots: dim — оставить еле заметными.
    const dotsMode = slides[cur].meta.dots;
    document.body.classList.toggle('no-dots', dotsMode === 'false');
    document.body.classList.toggle('dim-dots', dotsMode === 'dim');
    counter.textContent = pad2(cur + 1) + ' / ' + pad2(els.length);
    bar.style.width = ((cur + 1) / els.length) * 100 + '%';
    document.title = pad2(cur + 1) + ' · ' + (slides[cur].meta.title || 'Слайд');
    // адрес вида /slides/#7 — можно дать прямую ссылку на слайд
    if (updateHash) history.replaceState(null, '', '#' + (cur + 1));
    // На краях колоды стрелка гаснет: листать в эту сторону больше нечего.
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === els.length - 1;
    if (notesOpen) renderNotes();
  }

  // Стрелки на экране — та же навигация, что ← и → на клавиатуре.
  prevBtn.addEventListener('click', () => go(cur - 1));
  nextBtn.addEventListener('click', () => go(cur + 1));

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

  // Если мышь не двигают пару секунд, на теле появляется класс idle:
  // курсор и ссылка возврата исчезают. Любое движение возвращает их.
  let idleTimer;
  function noticeMouse() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
  }
  addEventListener('mousemove', noticeMouse);
  noticeMouse(); // запускаем отсчёт сразу, не дожидаясь первого движения

  // Старт: открываем слайд из адреса (#7) или первый.
  addEventListener('hashchange', () => go((parseInt(location.hash.slice(1), 10) || 1) - 1, false));
  go((parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
