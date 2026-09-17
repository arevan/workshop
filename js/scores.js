/*
 * scores.js — судейские листы и итоги хакатона.
 *
 * Сайт статический, поэтому сданные листы хранятся во внешней базе
 * (Supabase). Страница ходит туда обычным fetch, без библиотек, и вызывает
 * три функции базы: сдать лист, получить итоги, очистить итоги. Сама
 * таблица для сайта закрыта. Схема базы — supabase/migrations/…_jury_scores.sql.
 *
 * Пока судья заполняет лист, оценки лежат в его браузере (localStorage):
 * закрыл вкладку — ничего не потерял. В базу лист уходит по кнопке «Сдать».
 *
 * Экраны переключаются хешем адреса:
 *   (пусто)     список листов
 *   #turlaev    лист судьи (id из scores.json)
 *   #results    общие итоги и победители
 *
 * Жюри, команды, критерии, шкала и адрес базы — в /content/scores/scores.json.
 */
(async function () {
  const root = document.getElementById('scores');

  let cfg;
  try {
    cfg = await CONTENT.loadJSON('../content/scores/scores.json');
  } catch (err) {
    CONTENT.showServeHelp(root, err);
    return;
  }

  const { jurors, teams, criteria, scale } = cfg;
  const values = scale.map((s) => s.value);
  const maxPerSheet = criteria.length * Math.max(...values);
  const tiebreak = criteria.find((c) => c.id === cfg.tiebreak) || criteria[0];
  const admin = jurors.find((j) => j.admin);
  const REFRESH_MS = 30000; // как часто итоги подтягивают свежие листы

  // ---------- Мелкие помощники ----------

  const pad2 = (n) => String(n).padStart(2, '0');
  // Экранируем и кавычки: текст попадает не только в теги, но и в атрибуты.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const isScore = (v) => values.includes(v);
  const num1 = (x) => x.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dateOf = (ms) => new Date(ms).toLocaleString('ru-RU',
    { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const timeOf = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const plural = (n, one, few, many) => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  };
  const jurorById = (id) => jurors.find((j) => j.id === id);

  // localStorage может быть недоступен (приватный режим, запрет cookies) —
  // тогда страница работает, просто ничего не помнит после перезагрузки.
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };
  const draftKey = (judgeId) => 'scores:draft:' + judgeId; // черновик листа
  const ME = 'scores:me';                                   // кто сдавал лист с этого устройства

  function loadDraft(judgeId) {
    const d = store.get(draftKey(judgeId), {});
    return { scores: d.scores || {}, submittedAt: d.submittedAt || 0, changed: !!d.changed };
  }

  // ---------- База ----------

  const storage = cfg.storage || {};
  const apiReady = Boolean(storage.url && storage.key);

  // Коды ошибок задают SQL-функции (raise exception '…') — здесь их тексты.
  const API_ERRORS = {
    bad_judge: 'База не узнала судью. Обновите страницу и сдайте лист ещё раз.',
    bad_scores: 'База не приняла лист. Обновите страницу и сдайте его ещё раз.',
    network: 'Нет связи с базой оценок. Проверьте интернет и попробуйте ещё раз — оценки сохранены в браузере.',
  };
  const errorText = (err) => API_ERRORS[err.message]
    || `База ответила ошибкой (${err.message}). Напишите организатору.`;

  // Вызов функции базы: POST /rest/v1/rpc/имя, аргументы — JSON.
  // Ключ публичный: он только пропускает к базе, что можно — решают функции.
  async function rpc(fn, args = {}) {
    let res;
    try {
      res = await fetch(`${storage.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: storage.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch {
      throw new Error('network');
    }
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(body && body.message in API_ERRORS ? body.message : 'HTTP ' + res.status);
    return body;
  }

  // В базу уходят только настоящие оценки: известные команды, критерии и баллы.
  function cleanScores(scores) {
    const out = {};
    for (const t of teams) {
      for (const c of criteria) {
        const v = scores[t.id]?.[c.id];
        if (isScore(v)) (out[t.id] ||= {})[c.id] = v;
      }
    }
    return out;
  }

  // ---------- Общая шапка ----------

  function header(current) {
    const links = jurors.map((j) =>
      `<a href="#${j.id}" class="${current === j.id ? 'is-current' : ''}">${esc(j.name)}</a>`).join('');
    return `
      <a class="s-back" href="../index.html">← Воркшоп</a>
      <header class="s-head">
        <h1>${esc(cfg.title)}</h1>
        <p class="s-sub">${esc(cfg.subtitle)}</p>
      </header>
      ${current ? `<nav class="s-switch" aria-label="Листы и итоги">
        ${links}<a href="#results" class="s-switch-results ${current === 'results' ? 'is-current' : ''}">Итоги</a>
      </nav>` : ''}`;
  }

  // ---------- Экран: выбор листа ----------

  function renderIndex() {
    root.innerHTML = header(null) + `
      <nav class="s-doors" aria-label="Судейские листы">
        ${jurors.map((j) => {
          const d = loadDraft(j.id);
          const state = d.submittedAt && !d.changed ? 'сдан' : filledTeams(d) || d.submittedAt ? 'в работе' : '';
          return `<a href="#${j.id}"><span class="t">${esc(j.name)}</span>` +
            `<span class="st">${state}</span><span class="arr">→</span></a>`;
        }).join('')}
        <a href="#results" class="s-doors-results"><span class="t">Итоги</span>` +
          `<span class="st"></span><span class="arr">→</span></a>
      </nav>`;
  }

  // ---------- Экран: лист судьи ----------

  let sheetJudge = null;
  let sheet = null;
  let sending = false;

  function filledIn(s, teamId) {
    const row = s.scores[teamId] || {};
    return criteria.filter((c) => isScore(row[c.id])).length;
  }
  function filledTeams(s) {
    return teams.filter((t) => filledIn(s, t.id) === criteria.length).length;
  }
  const isEmpty = (s) => !teams.some((t) => filledIn(s, t.id));

  function renderSheet(judge) {
    sheetJudge = judge;
    sheet = loadDraft(judge.id);

    root.innerHTML = header(judge.id) + `
      <section class="s-intro">
        <p class="s-kicker">Лист судьи</p>
        <h2 class="s-judge">${esc(judge.name)}</h2>
        <p class="s-lead">Ставьте оценки сами, не сверяясь с коллегами. Пока лист
        не сдан, оценки хранятся только в этом браузере. Когда всё заполнено —
        сдайте лист: он попадёт в общие итоги.</p>
      </section>

      <ol class="s-scale" aria-label="Шкала оценок">
        ${scale.map((s) => `<li><span class="n">${s.value}</span><span class="w">${esc(s.label)}</span></li>`).join('')}
      </ol>

      <form class="s-sheet" id="sheet-form" autocomplete="off" onsubmit="return false">
        ${teams.map((t, ti) => `
          <article class="s-team" id="team-${t.id}">
            <div class="s-team-head">
              <span class="num">${pad2(ti + 1)}</span>
              <h3>${esc(t.name)}</h3>
              <span class="s-team-sum" id="sum-${t.id}"></span>
            </div>
            <div class="s-crits">
              ${criteria.map((c) => `
                <div class="s-crit">
                  <div class="s-crit-text">
                    <span class="name" id="lbl-${t.id}-${c.id}">${esc(c.name)}</span>
                    <span class="hint">${esc(c.hint)}</span>
                  </div>
                  <div class="s-radios" role="radiogroup" aria-labelledby="lbl-${t.id}-${c.id}">
                    ${values.map((v) => `
                      <input type="radio" id="r-${t.id}-${c.id}-${v}" name="r-${t.id}-${c.id}" value="${v}"
                        data-team="${t.id}" data-crit="${c.id}"${sheet.scores[t.id]?.[c.id] === v ? ' checked' : ''}>
                      <label for="r-${t.id}-${c.id}-${v}">${v}</label>`).join('')}
                  </div>
                </div>`).join('')}
            </div>
          </article>`).join('')}
      </form>

      <section class="s-mine" id="mine" hidden></section>

      <div class="s-dock">
        <div class="s-dock-text">
          <span class="s-progress" id="progress"></span>
          <span class="s-missing" id="missing"></span>
          <span class="s-error" id="sheet-error" role="alert"></span>
        </div>
        <button type="button" class="s-btn" id="submit"></button>
      </div>`;

    updateSheetStatus();
    if (sheet.submittedAt && !sheet.changed) showMine();
    syncSheet(judge);
  }

  function saveDraft() {
    store.set(draftKey(sheetJudge.id), sheet);
  }

  function updateSheetStatus() {
    const missing = [];
    for (const t of teams) {
      const n = filledIn(sheet, t.id);
      const sumEl = document.getElementById('sum-' + t.id);
      if (n === criteria.length) {
        const sum = criteria.reduce((a, c) => a + sheet.scores[t.id][c.id], 0);
        sumEl.textContent = `${sum} из ${maxPerSheet}`;
        sumEl.classList.add('is-done');
      } else {
        sumEl.textContent = n ? `${n} из ${criteria.length}` : '';
        sumEl.classList.remove('is-done');
        missing.push(n ? `${t.name} (ещё ${criteria.length - n})` : t.name);
      }
    }
    const done = teams.length - missing.length;
    const progress = document.getElementById('progress');
    const hint = document.getElementById('missing');
    const btn = document.getElementById('submit');

    if (sheet.submittedAt && !sheet.changed) {
      progress.textContent = 'Лист сдан ' + dateOf(sheet.submittedAt);
      hint.textContent = 'Оценки в общих итогах. Поменяете оценку — лист нужно будет сдать заново.';
      btn.textContent = 'Открыть итоги';
      btn.disabled = false;
      return;
    }

    progress.textContent = sheet.submittedAt
      ? 'Есть правки после сдачи'
      : `Оценено ${done} из ${teams.length} ${plural(teams.length, 'команды', 'команд', 'команд')}`;
    if (!apiReady) {
      hint.textContent = 'База оценок ещё не подключена — сдать лист пока нельзя.';
    } else if (missing.length === teams.length && isEmpty(sheet)) {
      hint.textContent = `В каждой команде ${criteria.length} критериев — кнопка сдачи включится, когда заполните все.`;
    } else if (missing.length) {
      hint.textContent = 'Осталось: ' + missing.join(', ');
    } else {
      hint.textContent = 'Все оценки на месте.';
    }
    btn.textContent = sending ? 'Отправляем…' : sheet.submittedAt ? 'Сдать заново' : 'Сдать лист';
    btn.disabled = sending || !apiReady || missing.length > 0;
  }

  function showSheetError(text) {
    document.getElementById('sheet-error').textContent = text;
  }

  // Личные итоги судьи: рейтинг команд только по его листу.
  // Считаются тем же кодом, что и общие, — просто из одного листа.
  function showMine() {
    const box = document.getElementById('mine');
    const rows = computeRows({ [sheetJudge.id]: sheet });
    box.innerHTML = `
      <h2 class="s-h2">Ваши итоги</h2>
      <p class="s-text">Рейтинг команд по вашим оценкам. Общий итог жюри — во вкладке «Итоги».</p>
      <ol class="s-mine-list">
        ${rows.map((r) => `
          <li>
            <span class="place">${r.place}</span>
            <span class="team">${esc(r.t.name)}</span>
            <span class="score">${r.total}<span class="of"> из ${maxPerSheet}</span></span>
          </li>`).join('')}
      </ol>`;
    box.hidden = false;
  }

  async function submitSheet() {
    if (sheet.submittedAt && !sheet.changed) {
      location.hash = 'results';
      return;
    }
    const judge = sheetJudge;
    sending = true;
    showSheetError('');
    updateSheetStatus();
    try {
      const at = await rpc('jury_submit', { p_judge: judge.id, p_scores: cleanScores(sheet.scores) });
      store.set(ME, judge.id);
      if (sheetJudge !== judge) return; // пока ждали ответ, судья ушёл на другой экран
      sheet.submittedAt = Date.parse(at) || Date.now();
      sheet.changed = false;
      saveDraft();
      showMine();
      document.getElementById('mine').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (sheetJudge === judge) showSheetError(errorText(err));
    } finally {
      sending = false;
      if (sheetJudge === judge) updateSheetStatus();
    }
  }

  function markChanged() {
    if (sheet.submittedAt && !sheet.changed) {
      sheet.changed = true;
      document.getElementById('mine').hidden = true;
    }
    saveDraft();
    showSheetError('');
    updateSheetStatus();
  }

  // Сверяем лист с базой:
  // — черновик пуст, а в базе лист есть (судья сдавал с другого устройства) —
  //   подтягиваем его;
  // — черновик помечен сданным, а в базе листа нет (итоги очистили) —
  //   снимаем отметку, оценки остаются, лист можно сдать снова.
  async function syncSheet(judge) {
    if (!apiReady) return;
    let rows;
    try {
      rows = await rpc('jury_results');
    } catch {
      return;
    }
    if (sheetJudge !== judge || sending) return;
    const own = (rows || []).find((r) => r.judge_id === judge.id);

    if (own && own.scores && isEmpty(sheet)) {
      store.set(draftKey(judge.id), { scores: own.scores, submittedAt: Date.parse(own.submitted_at), changed: false });
      renderSheet(judge);
    } else if (!own && sheet.submittedAt) {
      sheet.submittedAt = 0;
      sheet.changed = false;
      saveDraft();
      document.getElementById('mine').hidden = true;
      updateSheetStatus();
    }
  }

  // ---------- Экран: итоги ----------

  function computeRows(sheets) {
    const list = Object.entries(sheets);
    const rows = teams.map((t, order) => {
      const crit = criteria.map((c) => {
        const marks = list
          .map(([judgeId, s]) => ({ judgeId, v: s.scores[t.id]?.[c.id] }))
          .filter((m) => isScore(m.v));
        const nums = marks.map((m) => m.v);
        const sum = nums.reduce((a, b) => a + b, 0);
        return {
          c,
          marks,
          sum,
          avg: nums.length ? sum / nums.length : null,
          min: Math.min(...nums),
          max: Math.max(...nums),
          spread: nums.length > 1 ? Math.max(...nums) - Math.min(...nums) : 0,
          hist: values.map((v) => nums.filter((x) => x === v).length),
        };
      });
      const total = crit.reduce((a, x) => a + x.sum, 0);
      const tb = crit.find((x) => x.c.id === tiebreak.id).sum;
      return { t, order, crit, total, tb };
    });

    // Сначала общий балл, при равенстве — дополнительный критерий из scores.json.
    // Если совпало и то и другое, место делят — решает жюри.
    const ahead = (a, b) => a.total > b.total || (a.total === b.total && a.tb > b.tb);
    rows.sort((a, b) => b.total - a.total || b.tb - a.tb || a.order - b.order);
    for (const r of rows) r.place = 1 + rows.filter((o) => ahead(o, r)).length;
    // Второй проход: места должны быть посчитаны у всех, прежде чем искать совпадения.
    for (const r of rows) {
      r.shared = rows.some((o) => o !== r && o.place === r.place);
      r.byTiebreak = rows.some((o) => o !== r && o.total === r.total && o.tb !== r.tb);
    }
    return rows;
  }

  let refreshTimer = null;
  let resultsToken = 0;

  function stopRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  async function renderResults({ quiet = false } = {}) {
    sheet = null;
    sheetJudge = null;
    if (!apiReady) {
      root.innerHTML = header('results') + `
        <section class="s-block"><h2 class="s-h2">База не подключена</h2>
        <p class="s-text">Итоги появятся, когда в scores.json будет указан адрес базы оценок.</p></section>`;
      return;
    }

    const token = ++resultsToken;
    if (!quiet) root.innerHTML = header('results') + '<p class="s-text">Загружаем итоги…</p>';
    let rows;
    try {
      rows = await rpc('jury_results');
    } catch (err) {
      if (token !== resultsToken || location.hash !== '#results') return;
      if (quiet) return; // фоновое обновление не сработало — оставляем то, что уже на экране
      root.innerHTML = header('results') + `
        <section class="s-block">
          <p class="s-error" role="alert">${esc(errorText(err))}</p>
          <button type="button" class="s-btn" id="retry">Попробовать ещё раз</button>
        </section>`;
      return;
    }
    if (token !== resultsToken || location.hash !== '#results') return;

    drawResults(rows);
    if (!refreshTimer) refreshTimer = setInterval(() => {
      if (!document.hidden) renderResults({ quiet: true });
    }, REFRESH_MS);
  }

  function drawResults(rows) {
    // Из базы берём только известных судей и только объекты с оценками.
    const sheets = {};
    for (const r of rows || []) {
      if (jurorById(r.judge_id) && r.scores && typeof r.scores === 'object') {
        sheets[r.judge_id] = { scores: r.scores, submittedAt: Date.parse(r.submitted_at) };
      }
    }
    const n = Object.keys(sheets).length;
    const nameOf = (id) => jurorById(id)?.name || 'Судья';

    const toolbar = `
      <div class="s-toolbar">
        <span>Обновлено в ${timeOf(Date.now())}</span>
        <button type="button" class="s-quiet" id="refresh">Обновить</button>
      </div>`;

    const jurorsHtml = `
      <div class="s-jurors">
        ${jurors.map((j) => {
          const s = sheets[j.id];
          return `<div class="s-juror"><span class="name">${esc(j.name)}</span>` +
            (s ? `<span class="st is-in">Лист сдан · ${dateOf(s.submittedAt)}</span>`
               : '<span class="st">Ещё не сдал</span>') + '</div>';
        }).join('')}
      </div>`;

    // Кнопку очистки видит только устройство, с которого сдавал лист организатор.
    const clearHtml = admin && store.get(ME, '') === admin.id
      ? `<section class="s-block s-reset">
          <button type="button" class="s-quiet" id="clear-results">Удалить все сданные листы</button>
        </section>` : '';

    if (!n) {
      root.innerHTML = header('results') + toolbar + `
        <section class="s-block">
          <h2 class="s-h2">Пока никто не сдал лист</h2>
          <p class="s-text">Итоги появятся здесь, как только первый судья сдаст оценки.</p>
          ${jurorsHtml}
        </section>` + clearHtml;
      return;
    }

    const rowsByPlace = computeRows(sheets);
    const complete = n === jurors.length;
    const maxTotal = n * maxPerSheet;
    const podium = rowsByPlace.filter((r) => r.place <= cfg.winners);

    const podiumHtml = `
      <ol class="s-podium">
        ${podium.map((r) => `
          <li class="${r.place === 1 ? 'is-first' : ''}">
            <span class="place">${r.place}</span>
            <span class="team">${esc(r.t.name)}${r.shared ? '<span class="tie">делят место — решает жюри</span>' : ''}</span>
            <span class="score">${r.total}<span class="of"> из ${maxTotal}</span></span>
          </li>`).join('')}
      </ol>`;

    const hist = (h) => {
      const top = Math.max(1, ...h);
      return `<span class="s-hist" aria-hidden="true">${h.map((k) =>
        k ? `<i style="height:${Math.max(3, Math.round((k / top) * 16))}px"></i>` : '<i class="zero"></i>').join('')}</span>`;
    };

    const gap = cfg.disputeGap;
    const tableHtml = `
      <div class="s-table-wrap">
        <table class="s-table">
          <thead><tr>
            <th>Место</th><th>Команда</th>
            ${criteria.map((c, i) => `<th title="${esc(c.name)}"><span class="i">${pad2(i + 1)}</span>${esc(c.short)}</th>`).join('')}
            <th>Итого</th>
          </tr></thead>
          <tbody>
            ${rowsByPlace.map((r) => `
              <tr>
                <td class="place">${r.place}</td>
                <td class="team">${esc(r.t.name)}<span class="meta">Показ ${pad2(r.order + 1)}${r.t.solo ? ' · соло' : ''}</span></td>
                ${r.crit.map((x) => `
                  <td class="crit" title="${esc(x.c.name + ': ' + x.marks.map((m) => nameOf(m.judgeId) + ' — ' + m.v).join(', '))}">
                    <span class="avg${x.spread >= gap ? ' is-split' : ''}">${x.avg === null ? '—' : num1(x.avg)}</span>
                    ${hist(x.hist)}
                  </td>`).join('')}
                <td class="total"><span class="big">${r.total}</span><span class="of">в среднем ${num1(r.total / n)} из ${maxPerSheet}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    const disputes = [];
    for (const r of rowsByPlace) for (const x of r.crit) if (x.spread >= gap) disputes.push({ r, x });
    disputes.sort((a, b) => b.x.spread - a.x.spread || a.r.order - b.r.order);
    const disputesHtml = disputes.length
      ? `<div class="s-disputes">${disputes.map(({ r, x }) => `
          <div class="s-dispute">
            <span class="what">${esc(r.t.name)}<span>${esc(x.c.name)}</span></span>
            <span class="who">${x.marks.map((m) => `<span class="mark">${esc(nameOf(m.judgeId))} ${m.v}</span>`).join(' · ')}</span>
            <span class="range">от ${x.min} до ${x.max}</span>
          </div>`).join('')}</div>`
      : `<p class="s-text">Оценки нигде не разошлись на ${gap} балла и больше — итоги можно утверждать.</p>`;

    const tbNote = rowsByPlace.some((r) => r.byTiebreak)
      ? ` При равном общем балле выше команда, у которой больше баллов по критерию «${esc(tiebreak.name)}».` : '';

    root.innerHTML = header('results') + toolbar + `
      <section class="s-block">
        <p class="s-kicker">${complete ? 'Победители' : `Предварительно · сдали ${n} из ${jurors.length}`}</p>
        ${podiumHtml}
        <p class="s-text">Общий балл — сумма оценок всех судей по всем критериям,
        максимум ${maxTotal}.${tbNote}</p>
      </section>

      <section class="s-block">
        <h2 class="s-h2">Листы жюри</h2>
        ${jurorsHtml}
      </section>

      <section class="s-block">
        <h2 class="s-h2">Все команды</h2>
        <p class="s-text">В ячейке — средняя оценка судей, под ней — сколько судей
        поставили 1, 2, 3, 4 и 5. Оранжевая цифра — оценки разошлись на ${gap}+ балла.</p>
        ${tableHtml}
      </section>

      <section class="s-block">
        <h2 class="s-h2">О чём договориться</h2>
        <p class="s-text">Обсуждаем только эти пары «команда — критерий». Кто передумал —
        правит свой лист и сдаёт его заново, итоги пересчитаются сами.</p>
        ${disputesHtml}
      </section>` + clearHtml;
  }

  async function clearResults(button) {
    if (!confirm('Удалить все сданные листы из базы? Судьям придётся сдать их заново. Черновики в браузерах останутся.')) return;
    button.disabled = true;
    try {
      await rpc('jury_clear');
      // Свой черновик на этом устройстве тоже больше не «сдан».
      const own = loadDraft(admin.id);
      if (own.submittedAt) store.set(draftKey(admin.id), { ...own, submittedAt: 0, changed: false });
      renderResults();
    } catch (err) {
      button.disabled = false;
      alert(errorText(err));
    }
  }

  // ---------- События ----------
  // Слушатели вешаем один раз на корень: экраны перерисовываются целиком,
  // а делегирование переживает любую перерисовку.

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!sheet || el.type !== 'radio' || !el.dataset.team) return;
    const { team, crit } = el.dataset;
    (sheet.scores[team] ||= {})[crit] = Number(el.value);
    markChanged();
  });

  root.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.id === 'submit') submitSheet();
    if (target.id === 'refresh' || target.id === 'retry') renderResults({ quiet: target.id === 'refresh' });
    if (target.id === 'clear-results') clearResults(target);
  });

  // ---------- Маршрутизация ----------

  function route() {
    let hash = location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch {}
    stopRefresh();

    if (hash === 'results') {
      renderResults();
    } else if (jurorById(hash)) {
      renderSheet(jurorById(hash));
    } else {
      sheet = null;
      sheetJudge = null;
      renderIndex();
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();
})();
