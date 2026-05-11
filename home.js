// Psychedelic particle backdrop (Llamasoft-style hue-cycling phosphor dots
// with occasional shooting streaks). Shared by index.html + versions.html.
// Counts scale down on small viewports / mobile so the page stays light.
(() => {
  const c = document.getElementById("psych");
  if (!c) return;
  const ctx = c.getContext("2d");
  let W, H, dpr, isSmall, N;
  const dots = [];
  const streaks = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    c.width  = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width  = W + "px";
    c.style.height = H + "px";
    isSmall = Math.min(W, H) < 720;
    const targetN = isSmall ? 35 : 95;
    // Top up / shed dots as the count target changes.
    while (dots.length < targetN) {
      dots.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 90,
        vy: (Math.random() - 0.5) * 90,
        h: Math.random() * 360,
        s: 1.2 + Math.random() * 4.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    if (dots.length > targetN) dots.length = targetN;
    N = targetN;
  }
  window.addEventListener("resize", resize);
  resize();

  function spawnStreak() {
    const a = Math.random() * Math.PI * 2;
    streaks.push({
      x: W * 0.5 + Math.cos(a) * 10,
      y: H * 0.5 + Math.sin(a) * 10,
      vx: Math.cos(a) * (520 + Math.random() * 380),
      vy: Math.sin(a) * (520 + Math.random() * 380),
      life: 1,
      h: Math.random() * 360,
      tail: [],
    });
  }

  let last = performance.now();
  let t = 0;
  let nextStreak = 0.8;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(7, 0, 15, 0.16)";
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < -10) d.x = W + 10;
      if (d.x > W + 10) d.x = -10;
      if (d.y < -10) d.y = H + 10;
      if (d.y > H + 10) d.y = -10;
      d.h = (d.h + 36 * dt) % 360;
      const flick = 0.6 + 0.4 * Math.sin(t * 5 + d.phase);
      ctx.fillStyle = `hsl(${d.h}, 100%, 60%)`;
      ctx.globalAlpha = 0.18 * flick;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s * 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.5 * flick;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = flick;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    nextStreak -= dt;
    if (nextStreak <= 0) {
      spawnStreak();
      nextStreak = (isSmall ? 1.2 : 0.6) + Math.random() * 1.6;
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.tail.push({ x: s.x, y: s.y });
      if (s.tail.length > 14) s.tail.shift();
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 0.55;
      if (s.life <= 0 || s.x < -50 || s.x > W + 50 || s.y < -50 || s.y > H + 50) {
        streaks.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `hsl(${s.h}, 100%, 65%)`;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = s.life * 0.85;
      ctx.beginPath();
      for (let k = 0; k < s.tail.length - 1; k++) {
        const p1 = s.tail[k], p2 = s.tail[k + 1];
        if (k === 0) ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = s.life;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
