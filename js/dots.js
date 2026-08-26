/*
 * dots.js — живой фон: сетка точек, которая расходится под курсором.
 *
 * Как это работает:
 *   1. Рисуем плотную регулярную сетку точек на canvas.
 *   2. Точки рядом с курсором отходят в стороны и светлеют.
 *   3. Если курсор не двигается пару секунд, влияние плавно гаснет
 *      и сетка возвращается на место.
 *
 * Про скорость: точек тысячи, поэтому дальние (их большинство) рисуются
 * одним общим путём, и только те, что попали в радиус курсора, —
 * по отдельности со своей яркостью.
 *
 * Настройки — переменные --dots-* в css/tokens.css.
 */
(function () {
  const canvas = document.getElementById('dots');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Читаем настройки из CSS-переменных: одно место правды на весь проект.
  const css = getComputedStyle(document.documentElement);
  const num = (name, fallback) => {
    const v = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const GAP = num('--dots-gap', 18);          // шаг сетки, px
  const SIZE = num('--dots-size', 1.1);       // радиус точки, px
  const RADIUS = num('--dots-radius', 190);   // радиус влияния курсора, px
  const PUSH = num('--dots-push', 14);        // насколько точки отходят, px
  const BASE = num('--dots-opacity', 0.14);   // яркость в покое
  const PEAK = num('--dots-peak', 0.7);       // яркость под курсором
  const IDLE = num('--dots-idle', 2000);      // мс покоя до возврата сетки
  const COLOR = (css.getPropertyValue('--dots-color') || '#8E8E8E').trim();

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Настоящее положение курсора и то, что используется при отрисовке:
  // второе догоняет первое с задержкой, поэтому волна выглядит инертной.
  let targetX = -9999;
  let targetY = -9999;
  let mouseX = targetX;
  let mouseY = targetY;

  // Сила эффекта: 1 — курсор активен, 0 — сетка распрямлена.
  let influence = 0;
  let influenceTarget = 0;
  let idleTimer = 0;

  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let offsetX = 0;
  let offsetY = 0;
  let raf = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2); // на retina не более 2×
    width = innerWidth;
    height = innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Сетку центрируем, чтобы поля по краям были одинаковые.
    cols = Math.ceil(width / GAP) + 1;
    rows = Math.ceil(height / GAP) + 1;
    offsetX = (width - (cols - 1) * GAP) / 2;
    offsetY = (height - (rows - 1) * GAP) / 2;
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR;

    // Точки внутри этого прямоугольника могут попасть под влияние курсора —
    // остальные заведомо нет, и их можно рисовать пачкой.
    const active = influence > 0.004;
    const minI = active ? Math.floor((mouseX - RADIUS - offsetX) / GAP) : 0;
    const maxI = active ? Math.ceil((mouseX + RADIUS - offsetX) / GAP) : -1;
    const minJ = active ? Math.floor((mouseY - RADIUS - offsetY) / GAP) : 0;
    const maxJ = active ? Math.ceil((mouseY + RADIUS - offsetY) / GAP) : -1;

    // 1. Дальние точки — одним путём с общей яркостью: так быстрее всего.
    ctx.globalAlpha = BASE;
    ctx.beginPath();
    for (let i = 0; i < cols; i++) {
      const near = active && i >= minI && i <= maxI;
      for (let j = 0; j < rows; j++) {
        if (near && j >= minJ && j <= maxJ) continue; // разберём отдельно
        const x = offsetX + i * GAP;
        const y = offsetY + j * GAP;
        ctx.moveTo(x + SIZE, y);
        ctx.arc(x, y, SIZE, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    if (!active) { ctx.globalAlpha = 1; return; }

    // 2. Точки рядом с курсором — по одной, со своим смещением и яркостью.
    for (let i = Math.max(0, minI); i <= Math.min(cols - 1, maxI); i++) {
      for (let j = Math.max(0, minJ); j <= Math.min(rows - 1, maxJ); j++) {
        const x = offsetX + i * GAP;
        const y = offsetY + j * GAP;
        const dx = x - mouseX;
        const dy = y - mouseY;
        const dist = Math.hypot(dx, dy);

        let px = x;
        let py = y;
        let alpha = BASE;

        if (dist < RADIUS) {
          // Влияние спадает к краю радиуса; квадрат даёт мягкий край.
          const force = (1 - dist / RADIUS) ** 2 * influence;
          const shift = force * PUSH;
          if (dist > 0.001) {
            px += (dx / dist) * shift;
            py += (dy / dist) * shift;
          }
          alpha = BASE + (PEAK - BASE) * force;
        }

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(px, py, SIZE, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    // Курсор догоняем, влияние гасим/набираем — оба движения плавные.
    const dx = targetX - mouseX;
    const dy = targetY - mouseY;
    mouseX += dx * 0.12;
    mouseY += dy * 0.12;
    influence += (influenceTarget - influence) * 0.06;

    draw();

    // Цикл останавливаем, только когда всё замерло: и курсор доехал,
    // и сетка вернулась. Иначе rAF впустую греет ноутбук.
    const still = Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4;
    const settled = Math.abs(influenceTarget - influence) < 0.004;
    if (still && settled) {
      influence = influenceTarget;
      draw();
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function wake() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  if (!reduced) {
    addEventListener('mousemove', (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      influenceTarget = 1;
      clearTimeout(idleTimer);
      // Курсор замер — через паузу отпускаем сетку обратно.
      idleTimer = setTimeout(() => { influenceTarget = 0; wake(); }, IDLE);
      wake();
    }, { passive: true });

    // Курсор ушёл за пределы окна — сетка распрямляется сразу.
    addEventListener('mouseleave', () => {
      clearTimeout(idleTimer);
      influenceTarget = 0;
      wake();
    });
  }

  addEventListener('resize', resize);
  resize();
})();
