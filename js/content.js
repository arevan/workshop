/*
 * content.js — загрузка контента.
 * Все тексты лежат в /content как markdown-файлы, код их только скачивает
 * и рендерит. Поправить формулировку = отредактировать md-файл.
 *
 * fetch работает только по http:// — поэтому проект открывается через
 * локальный сервер (см. README). Если открыть index.html двойным кликом,
 * покажем инструкцию вместо белого экрана.
 */

async function loadText(path) {
  // cache: 'no-cache' — браузер каждый раз спрашивает сервер, не изменился ли
  // файл. Без этого правишь текст в content/, обновляешь страницу, а там
  // всё по-старому: браузер отдаёт версию из кеша.
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Не удалось загрузить ' + path + ' (' + res.status + ')');
  return res.text();
}

async function loadJSON(path) {
  return JSON.parse(await loadText(path));
}

function showServeHelp(root, err) {
  console.warn(err);
  const isFile = location.protocol === 'file:';
  root.innerHTML = `
    <div class="serve-help">
      <h1>Почти получилось</h1>
      <p>${isFile
        ? 'Страница открыта как файл, и браузер в этом режиме запрещает ей читать контент из папки <code>content</code>. Это ограничение браузера, а не ошибка.'
        : 'Контент не загрузился. Проверь, что сервер запущен из корня проекта (папки, где лежит README.md).'}</p>
      <p>Самый простой путь: открой папку проекта в своём AI-агенте и попроси —
      «запусти этот сайт локально и открой в браузере».</p>
      <p>Либо запусти сервер сам — одна команда в терминале из папки проекта:</p>
      <pre><code>python3 -m http.server 4173</code></pre>
      <p>и открой <code>http://localhost:4173</code>. Остановить — <code>Ctrl+C</code>.</p>
      <p class="dim">Если установлен Node.js, вместо этого работает <code>npx serve</code>.</p>
    </div>`;
}

window.CONTENT = { loadText, loadJSON, showServeHelp };
