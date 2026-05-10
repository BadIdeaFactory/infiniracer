/* INFINI RACER — vector top-down infinite racer */
(() => {
  // ───────────────────────────────────────────────────────────── canvas/dpr
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const spdEl = document.getElementById("spd");
  const dstEl = document.getElementById("dst");
  const bstEl = document.getElementById("bst");
  const sbar = document.getElementById("speedbar");
  const overlay = document.getElementById("overlay");

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  // ───────────────────────────────────────────────────────────── input
  const keys = Object.create(null);
  let started = false;

  function startIfNeeded() {
    if (!started) {
      started = true;
      overlay.classList.add("hidden");
    }
  }
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault();
    startIfNeeded();
  }, { passive: false });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });
  window.addEventListener("pointerdown", startIfNeeded);

  // ───────────────────────────────────────────────────────────── pseudo-noise
  function hash01(n) {
    const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return v - Math.floor(v);
  }
  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash01(i);
    const b = hash01(i + 1);
    const t = f * f * (3 - 2 * f);
    return a * (1 - t) + b * t;
  }

  // ───────────────────────────────────────────────────────────── track gen
  // The track is an infinite procedural ribbon. We append segments as we drive.
  // Each segment carries its own half-width so the track narrows + flares.
  const TRACK_HW_MIN = 50;
  const TRACK_HW_MAX = 160;
  const SEG_LEN  = 28;
  const track    = [];        // { s, cx, cy, dir, hw, lx, ly, rx, ry }
  let worldSeed  = (Math.random() * 1e6) | 0;

  function ensureTrackTo(s) {
    while (track.length === 0 || track[track.length - 1].s < s) {
      const i  = track.length;
      const pv = track[i - 1];
      const sNew = pv ? pv.s + SEG_LEN : 0;
      const ws = sNew + worldSeed;
      // Two octaves of smooth noise = gentle macro curves + mild micro wobble.
      const k1 = (noise1(ws * 0.0009) - 0.5) * 0.10;
      const k2 = (noise1(ws * 0.0042) - 0.5) * 0.025;
      const dir = (pv ? pv.dir : -Math.PI / 2) + (k1 + k2);
      const cx = pv ? pv.cx + Math.cos(dir) * SEG_LEN : 0;
      const cy = pv ? pv.cy + Math.sin(dir) * SEG_LEN : 0;
      const nx = -Math.sin(dir), ny = Math.cos(dir);
      // Width: slow octave for stretches, faster octave for occasional pinches.
      const wA = noise1(ws * 0.0013 + 100.5);
      const wB = noise1(ws * 0.0058 +  73.1);
      const widthN = Math.min(1, Math.max(0, wA * 0.78 + wB * 0.32));
      let hw = TRACK_HW_MIN + widthN * (TRACK_HW_MAX - TRACK_HW_MIN);
      // Always start the run wide so the player isn't pinched at spawn.
      if (sNew < 240) hw = Math.max(hw, TRACK_HW_MAX * 0.85);
      track.push({
        s: sNew, cx, cy, dir, hw,
        lx: cx + nx * hw, ly: cy + ny * hw,
        rx: cx - nx * hw, ry: cy - ny * hw,
      });
    }
  }

  // ───────────────────────────────────────────────────────────── scenery
  // Wireframe shapes scattered alongside the track. Generated in chunks keyed
  // by along-track distance so the world is deterministic + cacheable.
  const CHUNK = 480;
  const sceneryChunks = new Map();

  function buildShape(cx, cy, size, sides, rot) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * size, y: cy + Math.sin(a) * size });
    }
    return { cx, cy, r: size, pts };
  }

  function chunkScenery(idx) {
    const out = [];
    const seed = idx * 1013904223 + 1664525 + worldSeed * 31;
    for (let i = 0; i < 7; i++) {
      const r1 = hash01(seed + i * 17);
      const r2 = hash01(seed + i * 31 + 1);
      const r3 = hash01(seed + i * 53 + 2);
      const r4 = hash01(seed + i * 71 + 3);
      const r5 = hash01(seed + i * 97 + 4);
      const s = idx * CHUNK + r1 * CHUNK;
      ensureTrackTo(s + 200);
      const segIdx = Math.min(Math.floor(s / SEG_LEN), track.length - 1);
      const seg = track[segIdx];
      if (!seg) continue;
      const side = r2 < 0.5 ? -1 : 1;
      const offset = seg.hw + 60 + r3 * 380;
      const nx = -Math.sin(seg.dir), ny = Math.cos(seg.dir);
      const x = seg.cx + nx * offset * side;
      const y = seg.cy + ny * offset * side;
      const size = 18 + r4 * 70;
      const sides = 3 + Math.floor(r5 * 4); // 3..6
      out.push(buildShape(x, y, size, sides, r4 * Math.PI * 2));
    }
    return out;
  }

  function visibleScenery(carS) {
    const a = Math.floor((carS - 600) / CHUNK);
    const b = Math.floor((carS + 1800) / CHUNK);
    const list = [];
    for (let i = a; i <= b; i++) {
      if (!sceneryChunks.has(i)) sceneryChunks.set(i, chunkScenery(i));
      list.push(...sceneryChunks.get(i));
    }
    return list;
  }

  // ───────────────────────────────────────────────────────────── car
  const car = {
    x: 0, y: 0,
    heading: -Math.PI / 2,
    speed: 0,        // world u/s
    steer: 0,        // smoothed [-1,1]
    rumble: 0,       // visual jitter when off-track
  };

  const MAX_SPEED   = 1600;
  const ACCEL       = 280;
  const BRAKE_DECEL = 520;
  const COAST       = 40;
  const STEER_RATE  = 1.6;   // how fast steering follows input
  const TURN_RATE   = 1.5;   // peak yaw rate (rad/s) at low speed

  let bestDist = parseFloat(localStorage.getItem("infiniracer.best") || "0") || 0;

  // Find closest segment around an estimated index for cheap iteration.
  let lastSegIdx = 0;
  function carTrackInfo() {
    const start = Math.max(0, lastSegIdx - 6);
    const end   = Math.min(track.length, lastSegIdx + 24);
    let bi = start, bd = Infinity;
    for (let i = start; i < end; i++) {
      const dx = track[i].cx - car.x;
      const dy = track[i].cy - car.y;
      const d  = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    lastSegIdx = bi;
    const seg = track[bi];
    const dx = car.x - seg.cx, dy = car.y - seg.cy;
    const nx = -Math.sin(seg.dir), ny = Math.cos(seg.dir);
    const lateral = dx * nx + dy * ny;     // signed offset from centerline
    return { seg, idx: bi, lateral };
  }

  function updateCar(dt) {
    const throttle = (keys["arrowup"] || keys["w"]) ? 1 : 0;
    const brake    = (keys["arrowdown"] || keys["s"]) ? 1 : 0;
    const left     = (keys["arrowleft"] || keys["a"]) ? 1 : 0;
    const right    = (keys["arrowright"] || keys["d"]) ? 1 : 0;

    // Smooth steering input.
    const target = right - left;
    car.steer += (target - car.steer) * Math.min(1, dt * STEER_RATE * 6);

    // Yaw: fades a bit at high speed so it feels heavier.
    const speedRatio = car.speed / MAX_SPEED;
    const yaw = car.steer * TURN_RATE * (0.55 + 0.6 * Math.min(1, speedRatio + 0.15));
    car.heading += yaw * dt;

    // Speed.
    if (throttle) car.speed += ACCEL * dt;
    if (brake)    car.speed -= BRAKE_DECEL * dt;
    if (!throttle && !brake) car.speed -= COAST * dt;

    // Off-track check: any excursion past the (variable) edge ends the run.
    const info = carTrackInfo();
    const off  = Math.abs(info.lateral) - info.seg.hw;
    if (off > 0 && crashFlash <= 0) {
      resetRun();
      return;
    }
    car.rumble *= 0.85;

    car.speed = Math.max(0, Math.min(MAX_SPEED, car.speed));

    // Translate.
    car.x += Math.cos(car.heading) * car.speed * dt;
    car.y += Math.sin(car.heading) * car.speed * dt;
  }

  // ───────────────────────────────────────────────────────────── reset
  let crashFlash = 0;
  function resetRun() {
    crashFlash = 1;
    worldSeed = (Math.random() * 1e6) | 0;
    track.length = 0;
    sceneryChunks.clear();
    car.x = 0; car.y = 0;
    car.heading = -Math.PI / 2;
    car.speed = 0;
    car.steer = 0;
    car.rumble = 0;
    lastSegIdx = 0;
    ensureTrackTo(2400);
  }

  // ───────────────────────────────────────────────────────────── camera
  // The car stays drawn at screen center pointing up. World rotates with us.
  function getZoom() {
    return 1.05 / (1 + (car.speed / MAX_SPEED) * 1.35); // ~1.05 → ~0.45
  }

  function makeCam() {
    const zoom = getZoom();
    const a = -car.heading - Math.PI / 2;
    const cs = Math.cos(a), sn = Math.sin(a);
    const cx = car.x, cy = car.y;
    const w2 = W / 2, h2 = H / 2;
    return (wx, wy) => {
      const dx = wx - cx, dy = wy - cy;
      return {
        x: w2 + (dx * cs - dy * sn) * zoom,
        y: h2 + (dx * sn + dy * cs) * zoom,
      };
    };
  }

  // ───────────────────────────────────────────────────────────── beams/dots
  // Everything drawn this frame is collected as line segments + endpoint
  // dots. After collection we compute cross-group intersections so we can
  // place extra-bright "phosphor" dots where unrelated lines cross.
  /** @type {{x1:number,y1:number,x2:number,y2:number,c:string,w:number,g:number}[]} */
  let beams = [];
  /** @type {{x:number,y:number,c:string,i:number}[]} */
  let dots  = [];

  const G_TRACK = 1, G_SCEN = 2, G_CAR = 3, G_FX = 4;

  function beam(x1, y1, x2, y2, c, w, g) {
    beams.push({ x1, y1, x2, y2, c, w, g });
    dots.push({ x: x1, y: y1, c, i: 0.55 });
    dots.push({ x: x2, y: y2, c, i: 0.55 });
  }

  function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay;
    const sx = dx - cx, sy = dy - cy;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / denom;
    const u = ((cx - ax) * ry - (cy - ay) * rx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { x: ax + t * rx, y: ay + t * ry };
    }
    return null;
  }

  function findIntersections() {
    // Cross-group only. Skip when bounding boxes are disjoint.
    for (let i = 0; i < beams.length; i++) {
      const a = beams[i];
      const aMinX = Math.min(a.x1, a.x2), aMaxX = Math.max(a.x1, a.x2);
      const aMinY = Math.min(a.y1, a.y2), aMaxY = Math.max(a.y1, a.y2);
      for (let j = i + 1; j < beams.length; j++) {
        const b = beams[j];
        if (b.g === a.g) continue;
        if (Math.max(a.x1, a.x2) < Math.min(b.x1, b.x2)) continue;
        if (Math.min(a.x1, a.x2) > Math.max(b.x1, b.x2)) continue;
        if (Math.max(a.y1, a.y2) < Math.min(b.y1, b.y2)) continue;
        if (Math.min(a.y1, a.y2) > Math.max(b.y1, b.y2)) continue;
        const p = segIntersect(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
        if (p) dots.push({ x: p.x, y: p.y, c: "#ffffff", i: 1.4 });
      }
    }
  }

  // ───────────────────────────────────────────────────────────── render
  let phase = 0;
  function render(dt) {
    phase += dt;
    const cam = makeCam();
    const zoom = getZoom();
    const info = carTrackInfo();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Solid bg + faint vignette.
    ctx.fillStyle = "#04060a";
    ctx.fillRect(0, 0, W, H);

    beams = [];
    dots  = [];

    // ── Track edges + dashed centerline.
    const carS = info.seg.s;
    const segStart = Math.max(0, info.idx - 8);
    const segEnd   = info.idx + Math.ceil(36 / zoom);
    ensureTrackTo((segEnd + 6) * SEG_LEN);

    for (let i = segStart; i < Math.min(track.length - 1, segEnd); i++) {
      const a = track[i], b = track[i + 1];
      const aL = cam(a.lx, a.ly), bL = cam(b.lx, b.ly);
      const aR = cam(a.rx, a.ry), bR = cam(b.rx, b.ry);
      beam(aL.x, aL.y, bL.x, bL.y, "#5cf0ff", 1.5, G_TRACK);
      beam(aR.x, aR.y, bR.x, bR.y, "#5cf0ff", 1.5, G_TRACK);
      // Dashed center: every 3rd segment, short stroke.
      if (i % 3 === 0) {
        const aC = cam(a.cx, a.cy), bC = cam(b.cx, b.cy);
        beam(aC.x, aC.y, bC.x, bC.y, "#3a8e95", 0.9, G_TRACK);
      }
      // Track tick marks (rungs) every 6 segments.
      if (i % 6 === 0) {
        const aL2 = cam(a.lx, a.ly), aR2 = cam(a.rx, a.ry);
        beam(aL2.x, aL2.y, aR2.x, aR2.y, "#1d5256", 0.7, G_TRACK);
      }
    }

    // ── Scenery.
    const scenery = visibleScenery(carS);
    for (const sh of scenery) {
      const dx = sh.cx - car.x, dy = sh.cy - car.y;
      if (dx * dx + dy * dy > 1900 * 1900) continue;
      const sp = sh.pts.map(p => cam(p.x, p.y));
      // Cull when fully off-screen.
      let onAny = false;
      for (const s of sp) if (s.x > -40 && s.x < W + 40 && s.y > -40 && s.y < H + 40) { onAny = true; break; }
      if (!onAny) continue;
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i], b = sp[(i + 1) % sp.length];
        beam(a.x, a.y, b.x, b.y, "#ffb14b", 1.2, G_SCEN);
      }
    }

    // ── Distance markers (perpendicular bars every ~300 units along track).
    {
      const interval = 300;
      const startMark = Math.floor((carS - 200) / interval) * interval;
      for (let s = startMark; s < carS + 1500; s += interval) {
        if (s < 0) continue;
        const idx = Math.min(track.length - 1, Math.max(0, Math.floor(s / SEG_LEN)));
        const seg = track[idx];
        const nx = -Math.sin(seg.dir), ny = Math.cos(seg.dir);
        const len = seg.hw + 20;
        const a = cam(seg.cx + nx * len, seg.cy + ny * len);
        const b = cam(seg.cx - nx * len, seg.cy - ny * len);
        beam(a.x, a.y, b.x, b.y, "#1d5256", 0.6, G_TRACK);
      }
    }

    // ── Car (drawn directly in screen space, centered, slight steer-tilt).
    // Scales with the world zoom so the car shrinks as the camera pulls back.
    const cx0 = W / 2, cy0 = H / 2;
    const tilt = car.steer * 0.16;
    const carScale = zoom;
    const rj = car.rumble ? (Math.random() - 0.5) * car.rumble * 3 * carScale : 0;
    function p(x, y) {
      const sx = x * carScale, sy = y * carScale;
      const cs = Math.cos(tilt), sn = Math.sin(tilt);
      return { x: cx0 + (sx * cs - sy * sn) + rj, y: cy0 + (sx * sn + sy * cs) };
    }

    // Body outline.
    const body = [
      [ 0, -22],
      [ 5, -14],
      [ 9,  -2],
      [ 9,  10],
      [ 5,  18],
      [-5,  18],
      [-9,  10],
      [-9,  -2],
      [-5, -14],
    ].map(([x, y]) => p(x, y));
    for (let i = 0; i < body.length; i++) {
      const a = body[i], b = body[(i + 1) % body.length];
      beam(a.x, a.y, b.x, b.y, "#e8fffb", 1.7, G_CAR);
    }

    // Cockpit diamond.
    const cock = [[0, -2], [4, 4], [0, 10], [-4, 4]].map(([x, y]) => p(x, y));
    for (let i = 0; i < cock.length; i++) {
      const a = cock[i], b = cock[(i + 1) % cock.length];
      beam(a.x, a.y, b.x, b.y, "#5cf0ff", 1.2, G_CAR);
    }

    // Wheels.
    const wheelY1 = -10, wheelY2 = -3;
    const wheelY3 = 8,   wheelY4 = 15;
    [
      [-10, wheelY1, -10, wheelY2],
      [ 10, wheelY1,  10, wheelY2],
      [-10, wheelY3, -10, wheelY4],
      [ 10, wheelY3,  10, wheelY4],
    ].forEach(([x1, y1, x2, y2]) => {
      const a = p(x1, y1), b = p(x2, y2);
      beam(a.x, a.y, b.x, b.y, "#ffb14b", 1.4, G_CAR);
    });

    // Thrust flicker.
    if ((keys["arrowup"] || keys["w"]) && car.speed > 5) {
      const f = 0.4 + Math.random() * 0.7;
      const t = p(0, 18 + f * 14);
      const l = p(-3, 18);
      const r = p( 3, 18);
      beam(l.x, l.y, t.x, t.y, "#ff5c4b", 1.3, G_FX);
      beam(r.x, r.y, t.x, t.y, "#ff5c4b", 1.3, G_FX);
      // little inner flame
      const tt = p(0, 18 + f * 7);
      const ll = p(-1.5, 18);
      const rr = p( 1.5, 18);
      beam(ll.x, ll.y, tt.x, tt.y, "#ffe98b", 1.0, G_FX);
      beam(rr.x, rr.y, tt.x, tt.y, "#ffe98b", 1.0, G_FX);
    }

    // ── Brilliance points where unrelated lines cross.
    findIntersections();

    // ─── Draw beams ──────────────────────────────────────────────
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Pass 1: wide soft glow (additive).
    ctx.globalCompositeOperation = "lighter";
    for (const b of beams) {
      ctx.strokeStyle = b.c;
      ctx.lineWidth   = b.w * 5;
      ctx.globalAlpha = 0.10;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }

    // Pass 2: medium glow.
    for (const b of beams) {
      ctx.strokeStyle = b.c;
      ctx.lineWidth   = b.w * 2.4;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Pass 3: crisp lines.
    ctx.globalCompositeOperation = "source-over";
    for (const b of beams) {
      ctx.strokeStyle = b.c;
      ctx.lineWidth   = b.w;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }

    // ─── Phosphor dots ──────────────────────────────────────────
    ctx.globalCompositeOperation = "lighter";
    for (const d of dots) {
      const i = d.i;
      // Halo
      ctx.beginPath();
      ctx.arc(d.x, d.y, 5 + i * 3, 0, Math.PI * 2);
      ctx.fillStyle = d.c;
      ctx.globalAlpha = 0.10 * i;
      ctx.fill();
      // Mid
      ctx.beginPath();
      ctx.arc(d.x, d.y, 2 + i * 1.2, 0, Math.PI * 2);
      ctx.globalAlpha = 0.4 * i;
      ctx.fill();
      // Hot core
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.9 + i * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = Math.min(1, i);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // ─── Subtle CRT scanline overlay ────────────────────────────
    drawScanlines();

    // ─── Vignette ───────────────────────────────────────────────
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ─── Crash flash + WIPEOUT text ─────────────────────────────
    if (crashFlash > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255, 92, 75, ${0.35 * crashFlash})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * Math.pow(crashFlash, 2)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      if (crashFlash > 0.35) {
        ctx.font = "700 56px JetBrains Mono, Courier New, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const a = (crashFlash - 0.35) / 0.65;
        ctx.fillStyle = `rgba(255, 92, 75, ${a})`;
        ctx.shadowColor = "#ff5c4b";
        ctx.shadowBlur = 24;
        ctx.fillText("WIPEOUT", W / 2, H / 2);
        ctx.shadowBlur = 0;
      }
      crashFlash = Math.max(0, crashFlash - dt * 1.4);
    }
  }

  // CRT scanlines — drawn cheaply via a thin stripe pattern on each frame.
  let scanlinePattern = null;
  function buildScanlines() {
    const c = document.createElement("canvas");
    c.width = 2; c.height = 3;
    const cc = c.getContext("2d");
    cc.fillStyle = "rgba(255,255,255,0.04)";
    cc.fillRect(0, 0, 2, 1);
    scanlinePattern = ctx.createPattern(c, "repeat");
  }
  function drawScanlines() {
    if (!scanlinePattern) buildScanlines();
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = scanlinePattern;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // ───────────────────────────────────────────────────────────── HUD
  function updateHUD() {
    const spd = Math.floor(car.speed * 1.05);
    const dst = Math.floor(carTrackInfo().seg.s);
    spdEl.textContent = String(spd).padStart(3, "0");
    dstEl.textContent = String(dst).padStart(6, "0");
    if (dst > bestDist) {
      bestDist = dst;
      try { localStorage.setItem("infiniracer.best", String(bestDist)); } catch {}
    }
    bstEl.textContent = String(Math.floor(bestDist)).padStart(6, "0");
    sbar.style.width = (car.speed / MAX_SPEED * 100).toFixed(1) + "%";
  }

  // ───────────────────────────────────────────────────────────── loop
  ensureTrackTo(2400);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (started) updateCar(dt);
    render(dt);
    updateHUD();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
