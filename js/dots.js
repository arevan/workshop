/*
 * dots.js — живой фон: сетка точек, которая расходится под курсором.
 *
 * Как это работает:
 *   1. Рисуем плотную регулярную сетку точек на canvas.
 *   2. Точки рядом с курсором отходят в стороны — яркость не меняется,
 *      двигается только сама сетка.
 *   3. Если курсор замер на пустом месте, влияние плавно гаснет
 *      и сетка возвращается. Над ссылками и кнопками — держится.
 *
 * Про скорость: точек тысячи, но яркость у всех одна, поэтому вся сетка
 * рисуется одним путём и одной заливкой.
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
  const BASE = num('--dots-opacity', 0.16);   // яркость точки
  const IDLE = num('--dots-idle', 1000);      // мс покоя до возврата сетки
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
    ctx.globalAlpha = BASE;

    // Смещение считаем только для точек в этом прямоугольнике —
    // остальные заведомо вне радиуса курсора.
    const active = influence > 0.004;
    const minI = active ? Math.floor((mouseX - RADIUS - offsetX) / GAP) : 0;
    const maxI = active ? Math.ceil((mouseX + RADIUS - offsetX) / GAP) : -1;
    const minJ = active ? Math.floor((mouseY - RADIUS - offsetY) / GAP) : 0;
    const maxJ = active ? Math.ceil((mouseY + RADIUS - offsetY) / GAP) : -1;

    ctx.beginPath();
    for (let i = 0; i < cols; i++) {
      const nearCol = active && i >= minI && i <= maxI;
      for (let j = 0; j < rows; j++) {
        const x = offsetX + i * GAP;
        const y = offsetY + j * GAP;
        let px = x;
        let py = y;

        if (nearCol && j >= minJ && j <= maxJ) {
          const dx = x - mouseX;
          const dy = y - mouseY;
          const dist = Math.hypot(dx, dy);
          if (dist < RADIUS && dist > 0.001) {
            // Влияние спадает к краю радиуса; квадрат даёт мягкий край.
            const shift = (1 - dist / RADIUS) ** 2 * influence * PUSH;
            px += (dx / dist) * shift;
            py += (dy / dist) * shift;
          }
        }

        ctx.moveTo(px + SIZE, py);
        ctx.arc(px, py, SIZE, 0, Math.PI * 2);
      }
    }
    ctx.fill();
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

      // Над ссылкой или кнопкой курсор специально останавливают —
      // там сетку не отпускаем, иначе эффект гаснет прямо под курсором.
      const overInteractive = e.target instanceof Element &&
        e.target.closest('a, button, [role="button"]');
      if (!overInteractive) {
        // Курсор замер над пустым местом — через паузу сетка возвращается.
        idleTimer = setTimeout(() => { influenceTarget = 0; wake(); }, IDLE);
      }
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
