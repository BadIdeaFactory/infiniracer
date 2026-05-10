/* INFINI RACER — vector top-down infinite racer */
(() => {
  // ───────────────────────────────────────────────────────────── canvas/dpr
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const spdEl = document.getElementById("spd");
  const dstEl = document.getElementById("dst");
  const bstEl = document.getElementById("bst");
  const scoreEl = document.getElementById("score");
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
    updateStickGeom();
  }
  window.addEventListener("resize", resize);

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

  // ── Virtual joystick (mouse / touch). Lives in the bottom fifth.
  const stick = {
    active: false,
    pointerId: -1,
    cx: 0, cy: 0, r: 70,
    knobX: 0, knobY: 0,
  };
  function updateStickGeom() {
    stick.r  = Math.max(56, Math.min(96, H * 0.075));
    stick.cx = W / 2;
    stick.cy = H - H * 0.10; // mid of bottom fifth
  }
  function pointInStickZone(py) {
    return py >= H * 0.80; // bottom fifth
  }
  function setStickFromPointer(px, py) {
    const dx = px - stick.cx;
    const dy = py - stick.cy;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d <= stick.r) { stick.knobX = dx; stick.knobY = dy; }
    else { stick.knobX = dx / d * stick.r; stick.knobY = dy / d * stick.r; }
  }
  canvas.addEventListener("pointerdown", (e) => {
    startIfNeeded();
    if (pointInStickZone(e.clientY)) {
      e.preventDefault();
      stick.active = true;
      stick.pointerId = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      setStickFromPointer(e.clientX, e.clientY);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (stick.active && e.pointerId === stick.pointerId) {
      setStickFromPointer(e.clientX, e.clientY);
    }
  });
  function endStick(e) {
    if (stick.active && e.pointerId === stick.pointerId) {
      stick.active = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  }
  canvas.addEventListener("pointerup", endStick);
  canvas.addEventListener("pointercancel", endStick);
  canvas.addEventListener("pointerleave", endStick);
  // Overlay sits in front of the canvas; let any click on it dismiss + start.
  overlay.addEventListener("pointerdown", startIfNeeded);

  // Unified input — keyboard ORed with analog joystick.
  const input = { throttle: 0, brake: 0, left: 0, right: 0 };
  function readInput(dt) {
    // Spring knob back to center when not actively dragged.
    if (!stick.active) {
      const k = Math.exp(-12 * dt);
      stick.knobX *= k;
      stick.knobY *= k;
      if (Math.abs(stick.knobX) < 0.4) stick.knobX = 0;
      if (Math.abs(stick.knobY) < 0.4) stick.knobY = 0;
    }
    const sx = stick.knobX / stick.r;
    const sy = stick.knobY / stick.r;
    const dz = (v) => Math.abs(v) < 0.10 ? 0 : Math.sign(v) * (Math.abs(v) - 0.10) / 0.90;
    const sxd = dz(sx), syd = dz(sy);
    const kT = (keys["arrowup"]    || keys["q"]) ? 1 : 0;
    const kB = (keys["arrowdown"]  || keys["a"]) ? 1 : 0;
    const kL = (keys["arrowleft"]  || keys["o"]) ? 1 : 0;
    const kR = (keys["arrowright"] || keys["p"]) ? 1 : 0;
    input.throttle = Math.max(kT, Math.max(0, -syd));
    input.brake    = Math.max(kB, Math.max(0,  syd));
    input.left     = Math.max(kL, Math.max(0, -sxd));
    input.right    = Math.max(kR, Math.max(0,  sxd));
  }

  resize();

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
  // Each segment carries its own half-width — the width holds for long
  // stretches (plateaus) and snaps between bands via a double smoothstep.
  const TRACK_HW_MIN = 38;
  const TRACK_HW_MAX = 230;
  const SEG_LEN  = 28;
  const track    = [];        // { s, cx, cy, dir, hw, lx, ly, rx, ry }
  let worldSeed  = (Math.random() * 1e6) | 0;

  const smoothstep = (t) => t * t * (3 - 2 * t);

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
      // Width:
      //   wA: slow base (~5500u wavelength → tens of seconds at top speed).
      //   Double-smoothstep flattens out the middle so the track sits at a
      //   given width band for long stretches before sliding to a new one.
      //   wB: small jitter so plateaus aren't dead-flat.
      const wA = noise1(ws * 0.00018 + 100.5);
      const wB = noise1(ws * 0.0040  +  73.1);
      const shaped = smoothstep(smoothstep(wA));
      const widthN = Math.min(1, Math.max(0, shaped + (wB - 0.5) * 0.08));
      let hw = TRACK_HW_MIN + widthN * (TRACK_HW_MAX - TRACK_HW_MIN);
      // Always start the run reasonably wide so the player isn't pinched at spawn.
      if (sNew < 280) hw = Math.max(hw, TRACK_HW_MAX * 0.55);
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

  let bestScore = parseFloat(localStorage.getItem("infiniracer.bestScore") || "0") || 0;
  const fmt = (n) => Math.floor(n).toLocaleString("en-US");

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
    const { throttle, brake, left, right } = input;

    // Smooth steering input. (target is analog [-1, 1].)
    const target = right - left;
    car.steer += (target - car.steer) * Math.min(1, dt * STEER_RATE * 6);

    // Yaw: fades a bit at high speed so it feels heavier.
    const speedRatio = car.speed / MAX_SPEED;
    const yaw = car.steer * TURN_RATE * (0.55 + 0.6 * Math.min(1, speedRatio + 0.15));
    car.heading += yaw * dt;

    // Speed (analog).
    if (throttle > 0) car.speed += ACCEL * throttle * dt;
    if (brake    > 0) car.speed -= BRAKE_DECEL * brake * dt;
    if (throttle === 0 && brake === 0) car.speed -= COAST * dt;

    // Off-track check: any excursion past the (variable) edge ends the run.
    const info = carTrackInfo();
    const off  = Math.abs(info.lateral) - info.seg.hw;
    if (off > 0) {
      triggerCrash();
      return;
    }
    car.rumble *= 0.85;

    car.speed = Math.max(0, Math.min(MAX_SPEED, car.speed));

    // Translate.
    car.x += Math.cos(car.heading) * car.speed * dt;
    car.y += Math.sin(car.heading) * car.speed * dt;
  }

  // ───────────────────────────────────────────────────────────── crash / reset
  // The crash sequence runs in slow-mo for `duration` real seconds, then the
  // world is regenerated and the car spawns fresh.
  const explosion = {
    active: false,
    t: 0,
    duration: 2.4,
    cx: 0, cy: 0,
    finalScore: 0,
    debris: [],
    sparks: [],
    shockwaves: [],
    flashCol: "#ffffff",
  };

  // Car shape lines, kept here so the crash can shatter them into debris.
  const CAR_LINES = [
    [[ 0, -22], [ 5, -14], "#e8fffb"],
    [[ 5, -14], [ 9,  -2], "#e8fffb"],
    [[ 9,  -2], [ 9,  10], "#e8fffb"],
    [[ 9,  10], [ 5,  18], "#e8fffb"],
    [[ 5,  18], [-5,  18], "#e8fffb"],
    [[-5,  18], [-9,  10], "#e8fffb"],
    [[-9,  10], [-9,  -2], "#e8fffb"],
    [[-9,  -2], [-5, -14], "#e8fffb"],
    [[-5, -14], [ 0, -22], "#e8fffb"],
    [[ 0,  -2], [ 4,   4], "#5cf0ff"],
    [[ 4,   4], [ 0,  10], "#5cf0ff"],
    [[ 0,  10], [-4,   4], "#5cf0ff"],
    [[-4,   4], [ 0,  -2], "#5cf0ff"],
    [[-10, -10], [-10, -3], "#ffb14b"],
    [[ 10, -10], [ 10, -3], "#ffb14b"],
    [[-10,   8], [-10, 15], "#ffb14b"],
    [[ 10,   8], [ 10, 15], "#ffb14b"],
  ];

  function triggerCrash() {
    const cx0 = W / 2, cy0 = H / 2;
    const scale = getZoom();
    const tilt  = car.steer * 0.16;
    const tcs = Math.cos(tilt), tsn = Math.sin(tilt);
    const dst = Math.floor(carTrackInfo().seg.s);

    explosion.active = true;
    explosion.t = 0;
    explosion.cx = cx0;
    explosion.cy = cy0;
    explosion.finalScore = Math.floor(car.speed * dst);
    explosion.debris = [];
    explosion.sparks = [];
    const big = Math.max(W, H);
    explosion.shockwaves = [
      { startT: 0.00, color: "#ffffff", maxR: big * 1.10, dur: 1.2 },
      { startT: 0.06, color: "#ffe98b", maxR: big * 0.95, dur: 1.1 },
      { startT: 0.16, color: "#ffb14b", maxR: big * 0.80, dur: 1.0 },
      { startT: 0.30, color: "#ff5c4b", maxR: big * 0.65, dur: 0.95 },
      { startT: 0.55, color: "#5cf0ff", maxR: big * 0.50, dur: 0.85 },
    ];

    // Shatter the car body into per-line debris pieces.
    for (const [[x1, y1], [x2, y2], col] of CAR_LINES) {
      // Apply tilt + zoom into screen space (matches the live render).
      const tx1 = (x1 * tcs - y1 * tsn) * scale;
      const ty1 = (x1 * tsn + y1 * tcs) * scale;
      const tx2 = (x2 * tcs - y2 * tsn) * scale;
      const ty2 = (x2 * tsn + y2 * tcs) * scale;
      const sx1 = cx0 + tx1, sy1 = cy0 + ty1;
      const sx2 = cx0 + tx2, sy2 = cy0 + ty2;
      const mx = (sx1 + sx2) / 2, my = (sy1 + sy2) / 2;
      const dx = mx - cx0, dy = my - cy0;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ax = dx / len, ay = dy / len;
      const sp = 90 + Math.random() * 280;
      explosion.debris.push({
        x: mx, y: my,
        // Endpoint offsets relative to debris midpoint (for rotation).
        lx1: tx1 - (mx - cx0), ly1: ty1 - (my - cy0),
        lx2: tx2 - (mx - cx0), ly2: ty2 - (my - cy0),
        vx: ax * sp + (Math.random() - 0.5) * 110,
        vy: ay * sp + (Math.random() - 0.5) * 110,
        angle: 0, va: (Math.random() - 0.5) * 11,
        color: col,
        ttl: 1.6 + Math.random() * 1.6,
        life: 1,
      });
    }

    // Bright spark fan.
    const sparkCols = ["#ff5c4b", "#ffe98b", "#ffb14b", "#ffffff", "#ffffff"];
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 140 + Math.random() * 540;
      explosion.sparks.push({
        x: cx0, y: cy0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ttl: 0.5 + Math.random() * 1.6,
        life: 1,
        color: sparkCols[(Math.random() * sparkCols.length) | 0],
        size: 0.8 + Math.random() * 2.2,
      });
    }

    car.speed = 0;
    car.rumble = 0;
  }

  function commitReset() {
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
    explosion.active = false;
    explosion.debris = [];
    explosion.sparks = [];
    explosion.shockwaves = [];
  }

  // Slow-mo curve while crashing (real-time fraction → simulation scale).
  function getTimeScale() {
    if (!explosion.active) return 1;
    const t = Math.min(1, explosion.t / explosion.duration);
    // Sit very slow for most of the crash, then ease back to normal at the end.
    return 0.10 + Math.pow(t, 2.6) * 0.90;
  }

  function updateExplosion(dtSim, dtReal) {
    if (!explosion.active) return;
    explosion.t += dtReal;
    for (const d of explosion.debris) {
      d.x += d.vx * dtSim;
      d.y += d.vy * dtSim;
      d.vx *= Math.exp(-0.7 * dtSim);
      d.vy *= Math.exp(-0.7 * dtSim);
      d.angle += d.va * dtSim;
      d.va *= Math.exp(-0.5 * dtSim);
      d.life -= dtSim / d.ttl;
    }
    for (const s of explosion.sparks) {
      s.x += s.vx * dtSim;
      s.y += s.vy * dtSim;
      s.vx *= Math.exp(-1.4 * dtSim);
      s.vy *= Math.exp(-1.4 * dtSim);
      s.life -= dtSim / s.ttl;
    }
    if (explosion.t >= explosion.duration) commitReset();
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
    // Skipped while a crash explosion is playing — the debris takes over.
    if (!explosion.active) {
      const cx0 = W / 2, cy0 = H / 2;
      const tilt = car.steer * 0.16;
      const carScale = zoom;
      const rj = car.rumble ? (Math.random() - 0.5) * car.rumble * 3 * carScale : 0;
      const p = (x, y) => {
        const sx = x * carScale, sy = y * carScale;
        const cs = Math.cos(tilt), sn = Math.sin(tilt);
        return { x: cx0 + (sx * cs - sy * sn) + rj, y: cy0 + (sx * sn + sy * cs) };
      };

      // Body outline.
      const body = [
        [ 0, -22], [ 5, -14], [ 9,  -2], [ 9,  10], [ 5,  18],
        [-5,  18], [-9,  10], [-9,  -2], [-5, -14],
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
      [
        [-10, -10, -10, -3],
        [ 10, -10,  10, -3],
        [-10,   8, -10, 15],
        [ 10,   8,  10, 15],
      ].forEach(([x1, y1, x2, y2]) => {
        const a = p(x1, y1), b = p(x2, y2);
        beam(a.x, a.y, b.x, b.y, "#ffb14b", 1.4, G_CAR);
      });

      // Thrust flicker — scales with analog throttle.
      if (input.throttle > 0.05 && car.speed > 5) {
        const th = input.throttle;
        const f = (0.4 + Math.random() * 0.7) * (0.5 + th * 0.7);
        const t = p(0, 18 + f * 14);
        const l = p(-3, 18);
        const r = p( 3, 18);
        beam(l.x, l.y, t.x, t.y, "#ff5c4b", 1.3, G_FX);
        beam(r.x, r.y, t.x, t.y, "#ff5c4b", 1.3, G_FX);
        const tt = p(0, 18 + f * 7);
        const ll = p(-1.5, 18);
        const rr = p( 1.5, 18);
        beam(ll.x, ll.y, tt.x, tt.y, "#ffe98b", 1.0, G_FX);
        beam(rr.x, rr.y, tt.x, tt.y, "#ffe98b", 1.0, G_FX);
      }
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

    // ─── Virtual joystick (HUD overlay) ─────────────────────────
    drawJoystick();

    // ─── Crash explosion (drawn last so it owns the screen) ─────
    if (explosion.active) drawExplosion();
  }

  // ─── Explosion render ────────────────────────────────────────
  function drawExplosion() {
    const t = explosion.t;
    const cx = explosion.cx, cy = explosion.cy;

    // 1) Radial darken behind the spectacle, eases in then out.
    {
      const k = Math.min(1, t / 0.15) * (1 - Math.max(0, (t - explosion.duration * 0.85) / (explosion.duration * 0.15)));
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
      grad.addColorStop(0, `rgba(0, 0, 0, 0)`);
      grad.addColorStop(1, `rgba(0, 0, 0, ${0.55 * k})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // 2) Initial bloom / blast flash (first ~0.25s real time).
    if (t < 0.45) {
      const a = Math.pow(1 - t / 0.45, 2);
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
      glow.addColorStop(0,   `rgba(255, 255, 255, ${0.85 * a})`);
      glow.addColorStop(0.2, `rgba(255, 233, 139, ${0.55 * a})`);
      glow.addColorStop(0.5, `rgba(255, 92, 75, ${0.25 * a})`);
      glow.addColorStop(1,   `rgba(255, 92, 75, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }

    // 3) Shockwave rings.
    ctx.globalCompositeOperation = "lighter";
    for (const sw of explosion.shockwaves) {
      const age = t - sw.startT;
      if (age < 0) continue;
      const p = Math.min(1, age / sw.dur);
      if (p >= 1) continue;
      const r = sw.maxR * (1 - Math.pow(1 - p, 3));
      const a = Math.pow(1 - p, 1.6);
      // Soft halo.
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 22 * (0.4 + a * 0.7);
      ctx.globalAlpha = 0.10 * a;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // Mid glow.
      ctx.lineWidth = 8;
      ctx.globalAlpha = 0.28 * a;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // Crisp ring.
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 4) Debris (rotating line shards).
    ctx.lineCap = "round";
    for (const d of explosion.debris) {
      if (d.life <= 0) continue;
      const cs = Math.cos(d.angle), sn = Math.sin(d.angle);
      const x1 = d.x + (d.lx1 * cs - d.ly1 * sn);
      const y1 = d.y + (d.lx1 * sn + d.ly1 * cs);
      const x2 = d.x + (d.lx2 * cs - d.ly2 * sn);
      const y2 = d.y + (d.lx2 * sn + d.ly2 * cs);
      const a = Math.max(0, d.life);
      // Glow pass.
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.18 * a;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.4 * a;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // Crisp pass.
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // Endpoint phosphor dots.
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x1, y1, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x2, y2, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 5) Sparks.
    ctx.globalCompositeOperation = "lighter";
    for (const s of explosion.sparks) {
      if (s.life <= 0) continue;
      const a = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = 0.35 * a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.75 * a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 0.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 6) WIPEOUT + frozen score readout.
    if (t > 0.30 && t < explosion.duration - 0.15) {
      const fadeIn  = Math.min(1, (t - 0.30) / 0.35);
      const fadeOut = 1 - Math.min(1, Math.max(0, (t - (explosion.duration - 0.55)) / 0.40));
      const a = fadeIn * fadeOut;
      const titleSize = Math.max(38, Math.min(96, W * 0.07));
      const scoreSize = Math.max(20, Math.min(48, W * 0.034));

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.font = `${titleSize}px "Press Start 2P", "Courier New", monospace`;
      ctx.shadowColor = "#ff5c4b";
      ctx.shadowBlur = 28;
      ctx.fillStyle = `rgba(255, 92, 75, ${a})`;
      ctx.fillText("WIPEOUT", cx, cy - titleSize * 0.6);

      ctx.font = `${scoreSize}px "Press Start 2P", "Courier New", monospace`;
      ctx.shadowColor = "#5cf0ff";
      ctx.shadowBlur = 22;
      ctx.fillStyle = `rgba(232, 255, 251, ${a})`;
      ctx.fillText(fmt(explosion.finalScore), cx, cy + titleSize * 0.55);
      ctx.shadowBlur = 0;
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

  // ───────────────────────────────────────────────────────────── joystick
  function drawJoystick() {
    const cx = stick.cx, cy = stick.cy, r = stick.r;
    const kx = cx + stick.knobX, ky = cy + stick.knobY;
    const dist = Math.sqrt(stick.knobX * stick.knobX + stick.knobY * stick.knobY);
    const norm = Math.min(1, dist / r);

    // Background plate so it reads against busy world geometry.
    const plate = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
    plate.addColorStop(0, "rgba(4, 6, 10, 0.55)");
    plate.addColorStop(1, "rgba(4, 6, 10, 0)");
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = "round";

    // Outer ring (with glow) — soft halo first, crisp line second.
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#5cf0ff";
    ctx.lineWidth = 8;
    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = stick.active ? 0.95 : 0.65;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Inner deadzone marker.
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Cardinal ticks + labels (axis hints).
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < 4; i++) {
      const a  = i * Math.PI / 2 - Math.PI / 2;
      const ix = cx + Math.cos(a) * r * 0.92;
      const iy = cy + Math.sin(a) * r * 0.92;
      const ox = cx + Math.cos(a) * r * 1.10;
      const oy = cy + Math.sin(a) * r * 1.10;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ox, oy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Phosphor dots at the tick endpoints (vector terminal flavour).
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const a  = i * Math.PI / 2 - Math.PI / 2;
      const ox = cx + Math.cos(a) * r * 1.10;
      const oy = cy + Math.sin(a) * r * 1.10;
      ctx.fillStyle = "#5cf0ff";
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(ox, oy, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // Stem from center to knob (only visible when displaced).
    if (norm > 0.02) {
      ctx.strokeStyle = "#ffb14b";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55 + norm * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(kx, ky);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Knob — additive halo + hot core.
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ffb14b";
    ctx.globalAlpha = 0.18 + norm * 0.20;
    ctx.beginPath(); ctx.arc(kx, ky, r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.45 + norm * 0.30;
    ctx.beginPath(); ctx.arc(kx, ky, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffb14b";
    ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.arc(kx, ky, r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(kx, ky, r * 0.06, 0, Math.PI * 2); ctx.fill();

    // Labels.
    ctx.font = "10px JetBrains Mono, Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#5cf0ff";
    ctx.globalAlpha = 0.75;
    ctx.fillText("THROTTLE", cx, cy - r - 14);
    ctx.fillText("BRAKE",    cx, cy + r + 14);
    ctx.fillText("◀  STEER  ▶", cx, cy + r + 30);
    ctx.globalAlpha = 1;
  }

  // ───────────────────────────────────────────────────────────── HUD
  function updateHUD() {
    const spd = Math.floor(car.speed * 1.05);
    const dst = Math.floor(carTrackInfo().seg.s);
    const score = explosion.active ? explosion.finalScore : Math.floor(car.speed * dst);
    spdEl.textContent = String(spd).padStart(3, "0");
    dstEl.textContent = String(dst).padStart(6, "0");
    // During the crash sequence the in-canvas explosion shows the score —
    // hide the top-center HUD copy so they don't compete.
    scoreEl.textContent = fmt(score);
    scoreEl.style.opacity = explosion.active ? "0" : "";
    if (score > bestScore) {
      bestScore = score;
      try { localStorage.setItem("infiniracer.bestScore", String(bestScore)); } catch {}
    }
    bstEl.textContent = fmt(bestScore);
    sbar.style.width = (car.speed / MAX_SPEED * 100).toFixed(1) + "%";
  }

  // ───────────────────────────────────────────────────────────── loop
  ensureTrackTo(2400);

  let last = performance.now();
  function frame(now) {
    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dtSim = dtReal * getTimeScale();
    readInput(dtReal);
    if (started && !explosion.active) updateCar(dtSim);
    updateExplosion(dtSim, dtReal);
    render(dtReal);
    updateHUD();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
