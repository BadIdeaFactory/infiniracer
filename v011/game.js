/* INFINI RACER — vector top-down infinite racer */
(() => {
  // ───────────────────────────────────────────────────────────── canvas/dpr
  const canvas = document.getElementById("game");
  const gpuCanvas = document.getElementById("game-gpu");
  const ctx = canvas.getContext("2d");
  const spdEl = document.getElementById("spd");
  const dstEl = document.getElementById("dst");
  const bstEl = document.getElementById("bst");
  const fpsEl = document.getElementById("fps");
  const scoreEl = document.getElementById("score");
  const sbar = document.getElementById("speedbar");
  const overlay = document.getElementById("overlay");

  // ── WebGPU renderer (opt-in via ?renderer=webgpu, falls back if unavailable).
  // While `webgpu` is null the canvas-2D render path runs unchanged.
  let webgpu = null;
  const URL_PARAMS = new URLSearchParams(location.search);
  const WANT_GPU = URL_PARAMS.get("renderer") === "webgpu";

  // (vignette was a cached canvas gradient; moved to CSS pseudo-element.)

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    if (gpuCanvas) {
      gpuCanvas.width = Math.floor(W * dpr);
      gpuCanvas.height = Math.floor(H * dpr);
      gpuCanvas.style.width = W + "px";
      gpuCanvas.style.height = H + "px";
    }
    if (webgpu) webgpu.resize(W, H, dpr);
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
  // Pre-baked joystick labels — dpr-aware so they stay crisp on retina.
  let _stickLabels = null;

  function bakeStickLabels() {
    function bake(text, color, alpha) {
      const cssW = 200, cssH = 16;
      const c = document.createElement("canvas");
      c.width  = Math.ceil(cssW * dpr);
      c.height = Math.ceil(cssH * dpr);
      const cc = c.getContext("2d");
      cc.scale(dpr, dpr);
      cc.font = "10px JetBrains Mono, Courier New, monospace";
      cc.textAlign = "center";
      cc.textBaseline = "middle";
      cc.fillStyle = color;
      cc.globalAlpha = alpha;
      cc.fillText(text, cssW / 2, cssH / 2);
      return c;
    }
    _stickLabels = {
      throttle: bake("THROTTLE",   "#5cf0ff", 0.75),
      brake:    bake("BRAKE",      "#5cf0ff", 0.75),
      steer:    bake("◀  STEER  ▶", "#5cf0ff", 0.75),
      w: 200, h: 16,
    };
  }

  function updateStickGeom() {
    stick.r  = Math.max(56, Math.min(96, H * 0.075));
    stick.cx = W / 2;
    stick.cy = H - H * 0.10; // mid of bottom fifth
    _stickLabels = null; // re-bake on next draw (accounts for dpr change)
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
  // Fixed seed — same track every run.
  let worldSeed  = 7341;

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

  // Drop track segments + scenery chunks that the player is far past.
  // The renderer only ever looks ~8 segments behind, so anything earlier
  // than that is dead weight. This is the fix for the overnight memory
  // leak — without it the arrays grow forever.
  const TRIM_BEHIND_SEG = 60;     // keep this many segments behind for safety
  const TRIM_TRIGGER    = 240;    // only bother splicing when at least this many can go
  const TRIM_BEHIND_DST = 1500;   // drop scenery chunks that far behind player
  function trimWorld() {
    const dropTo = lastSegIdx - TRIM_BEHIND_SEG;
    if (dropTo > TRIM_TRIGGER) {
      track.splice(0, dropTo);
      lastSegIdx -= dropTo;
    }
    if (sceneryChunks.size > 0 && track.length > 0) {
      const carS = track[Math.min(lastSegIdx, track.length - 1)].s;
      const minChunk = Math.floor((carS - TRIM_BEHIND_DST) / CHUNK);
      // Iterate by keys; deleting during iteration of a Map is allowed.
      for (const k of sceneryChunks.keys()) {
        if (k < minChunk) sceneryChunks.delete(k);
      }
    }
  }

  // ───────────────────────────────────────────────────────────── car
  const car = {
    x: 0, y: 0,
    heading: -Math.PI / 2,
    speed: 0,         // world u/s
    steer: 0,         // smoothed [-1,1]
    rumble: 0,        // visual jitter when off-track
    edgeProximity: 0, // 0 = safe, 1 = right at the edge
    edgeSide: 1,      // 1 = left edge active, -1 = right edge active
  };

  const MAX_SPEED   = 1600;
  const ACCEL       = 280;
  const BRAKE_DECEL = 520;
  const COAST       = 40;
  const STEER_RATE  = 1.6;   // how fast steering follows input
  const TURN_RATE   = 1.5;   // peak yaw rate (rad/s) at low speed
  // Edge repulsion: max lateral push velocity at the very edge.
  // < MAX_SPEED, so a fast perpendicular run can punch through.
  const EDGE_REPEL_MAX  = 620;
  const EDGE_REPEL_ZONE = 75;  // world units inward from the edge

  let bestScore = parseFloat(localStorage.getItem("infiniracer.bestScore") || "0") || 0;
  let bestScoreDirty = false;
  const fmt = (n) => Math.floor(n).toLocaleString("en-US");
  function saveBestScore() {
    if (!bestScoreDirty) return;
    try { localStorage.setItem("infiniracer.bestScore", String(bestScore)); } catch {}
    bestScoreDirty = false;
  }
  // Save best score on a slow cadence + when the tab is hidden / page unloads,
  // not every frame. Per-frame writes were a measurable chunk of updateHUD.
  setInterval(saveBestScore, 3000);
  window.addEventListener("pagehide", saveBestScore);

  // Find closest segment around an estimated index for cheap iteration.
  let lastSegIdx = 0;
  // Per-frame cache so render() and updateHUD() share one search.
  let _frameTrackInfo = null;
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
    car.speed = Math.max(0, Math.min(MAX_SPEED, car.speed));

    // Anti-magnetic edge field: a lateral push toward the centerline that
    // grows quadratically as you near the edge. Strong enough to catch slow
    // drift, but capped below MAX_SPEED so you can punch through if you
    // commit hard / fast.
    const info = carTrackInfo();
    const eZone = Math.min(EDGE_REPEL_ZONE, info.seg.hw * 0.6);
    const edgeDist = info.seg.hw - Math.abs(info.lateral);
    let proximity = 0;
    let repelVx = 0, repelVy = 0;
    if (edgeDist < eZone) {
      proximity = Math.max(0, 1 - Math.max(0, edgeDist) / eZone);
      const sign = info.lateral > 0 ? -1 : 1; // push back toward centerline
      const nx = -Math.sin(info.seg.dir);
      const ny =  Math.cos(info.seg.dir);
      const mag = proximity * proximity * EDGE_REPEL_MAX;
      repelVx = sign * nx * mag;
      repelVy = sign * ny * mag;
    }
    car.edgeProximity = proximity;
    car.edgeSide = info.lateral > 0 ? 1 : -1;

    // Translate (forward velocity + repel velocity).
    car.x += (Math.cos(car.heading) * car.speed + repelVx) * dt;
    car.y += (Math.sin(car.heading) * car.speed + repelVy) * dt;

    // After motion, did we still cross out? Then trigger the crash.
    const info2 = carTrackInfo();
    if (Math.abs(info2.lateral) - info2.seg.hw > 0) {
      triggerCrash();
      return;
    }
    car.rumble *= 0.85;
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
    // Same fixed seed → same world after a crash too.
    worldSeed = 7341;
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
  // (Batching containers + _vignette declared at the top of the IIFE.)

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
    // Hard cap so the O(n²) pair scan can't dominate frames with lots of
    // scenery on screen — visual interest is preserved with way fewer pairs.
    const MAX_PAIRS = 6000;
    let pairs = 0;
    for (let i = 0; i < beams.length; i++) {
      if (pairs >= MAX_PAIRS) break;
      const a = beams[i];
      for (let j = i + 1; j < beams.length; j++) {
        if (++pairs > MAX_PAIRS) break;
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
    const info = _frameTrackInfo || (_frameTrackInfo = carTrackInfo());

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background: when WebGPU is rendering the world layer below, the
    // canvas-2D layer just needs to be cleared transparent so the GPU canvas
    // shows through. Otherwise paint the solid bg here as before.
    if (webgpu) {
      ctx.clearRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#04060a";
      ctx.fillRect(0, 0, W, H);
    }

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

      // Anti-magnetic field visual: brighten + thicken the active edge near
      // the car, and shoot pulsing inward "field" ticks from it.
      const segDist = Math.abs(i - info.idx);
      const fade = Math.max(0, 1 - segDist / 9);
      const fx   = car.edgeProximity * fade;
      const isLeftHot = car.edgeSide > 0;
      const lW = 1.5 + (isLeftHot ? fx : 0) * 1.6;
      const rW = 1.5 + (isLeftHot ? 0 : fx) * 1.6;
      beam(aL.x, aL.y, bL.x, bL.y, "#5cf0ff", lW, G_TRACK);
      beam(aR.x, aR.y, bR.x, bR.y, "#5cf0ff", rW, G_TRACK);

      if (fx > 0.12) {
        const sign = isLeftHot ? 1 : -1;
        const nx = -Math.sin(a.dir), ny = Math.cos(a.dir);
        const ex = a.cx + sign * nx * a.hw;
        const ey = a.cy + sign * ny * a.hw;
        const pulse = 0.55 + 0.45 * Math.sin(phase * 7 + i * 0.55);
        const tickLen = a.hw * 0.22 * fx * pulse;
        const txEnd = ex - sign * nx * tickLen;
        const tyEnd = ey - sign * ny * tickLen;
        const t1 = cam(ex, ey);
        const t2 = cam(txEnd, tyEnd);
        beam(t1.x, t1.y, t2.x, t2.y, "#5cf0ff", 1.0 + fx * 1.4, G_FX);
      }

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

    // ─── Draw beams + dots ──────────────────────────────────────
    // WebGPU path: hand the same beams[] / dots[] arrays to the GPU
    // renderer; one instanced draw call per pipeline.
    if (webgpu) {
      webgpu.drawFrame(beams, dots);
    } else {
      // Canvas-2D path: 2-pass beam stroke + 3-layer phosphor fills.
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.26;
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        ctx.strokeStyle = b.c;
        ctx.lineWidth   = b.w * 2.6;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        ctx.strokeStyle = b.c;
        ctx.lineWidth   = b.w;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < dots.length; k++) {
        const d = dots[k];
        const i = d.i;
        ctx.fillStyle = d.c;
        ctx.globalAlpha = 0.10 * i;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 5 + i * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.40 * i;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 2 + i * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = Math.min(1, i);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.9 + i * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // (CRT scanlines + vignette are now CSS overlays on body — they were
    // 81% of frame time when done as per-frame fillRects with "overlay"
    // composite + radial-gradient sampling. The browser compositor handles
    // them effectively for free.)

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


  // ───────────────────────────────────────────────────────────── joystick
  // Live draws for everything except labels — the canvas-to-canvas
  // `drawImage` static bake we tried turned out slower in Firefox
  // (large transparent bbox = lots of "lighter"-blend pixel work).
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

    // Cardinal ticks — single stroked path with 4 subpaths (same color/width).
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a  = i * Math.PI / 2 - Math.PI / 2;
      ctx.moveTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
      ctx.lineTo(cx + Math.cos(a) * r * 1.10, cy + Math.sin(a) * r * 1.10);
    }
    ctx.stroke();
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

    // Labels — pre-baked offscreen canvases (dpr-aware).
    if (!_stickLabels) bakeStickLabels();
    const lw = _stickLabels.w, lh = _stickLabels.h;
    const halfW = lw / 2;
    ctx.drawImage(_stickLabels.throttle, cx - halfW, cy - r - 14 - lh / 2, lw, lh);
    ctx.drawImage(_stickLabels.brake,    cx - halfW, cy + r + 14 - lh / 2, lw, lh);
    ctx.drawImage(_stickLabels.steer,    cx - halfW, cy + r + 30 - lh / 2, lw, lh);
  }

  // ───────────────────────────────────────────────────────────── HUD
  // Diffed against last-displayed values — `textContent =` is a real DOM
  // write, and doing it on 4 spans every frame was one of the largest
  // remaining costs in the profile. We also skip re-running toLocaleString
  // and re-formatting the speed bar string when nothing changed.
  let _hudSpd = -1, _hudDst = -1, _hudScore = -1, _hudBst = -1;
  let _hudExplosionVisible = -1;  // -1 = unset, 0 = visible, 1 = hidden
  let _hudBarPct = -1;
  function updateHUD() {
    const info = _frameTrackInfo || carTrackInfo();
    const spd = Math.floor(car.speed * 1.05);
    const dst = Math.floor(info.seg.s);
    const score = explosion.active ? explosion.finalScore : Math.floor(car.speed * dst);

    if (spd !== _hudSpd) {
      spdEl.textContent = String(spd).padStart(3, "0");
      _hudSpd = spd;
    }
    if (dst !== _hudDst) {
      dstEl.textContent = String(dst).padStart(6, "0");
      _hudDst = dst;
    }
    if (score !== _hudScore) {
      scoreEl.textContent = fmt(score);
      _hudScore = score;
    }
    const exHidden = explosion.active ? 1 : 0;
    if (exHidden !== _hudExplosionVisible) {
      scoreEl.style.opacity = exHidden ? "0" : "";
      _hudExplosionVisible = exHidden;
    }

    if (score > bestScore) {
      bestScore = score;
      bestScoreDirty = true;
    }
    const bstFloor = Math.floor(bestScore);
    if (bstFloor !== _hudBst) {
      bstEl.textContent = fmt(bstFloor);
      _hudBst = bstFloor;
    }

    // Speed bar — round to whole pct so we update at most ~10× before
    // hitting top speed, instead of every frame.
    const barPct = Math.min(100, Math.round(car.speed / MAX_SPEED * 100));
    if (barPct !== _hudBarPct) {
      sbar.style.width = barPct + "%";
      _hudBarPct = barPct;
    }
  }

  // ───────────────────────────────────────────────────────────── WebGPU
  // Optional GPU path for the line + dot rendering. Replaces the canvas-2D
  // stroke + arc loops with two instanced draw calls. Activated by
  // `?renderer=webgpu` in the URL, falls back automatically if init fails.
  // Game logic, joystick, and crash explosion stay on the canvas-2D layer.
  const WGSL_LINE = `
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) px: vec2<f32>,
  @location(2) start: vec2<f32>,
  @location(3) end:   vec2<f32>,
  @location(4) width: f32,
};
struct U {
  viewport: vec2<f32>,
  glowExtra: f32,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> uni: U;

@vertex
fn vs(
  @builtin(vertex_index) vid: u32,
  @location(0) start: vec2<f32>,
  @location(1) end:   vec2<f32>,
  @location(2) color: vec3<f32>,
  @location(3) width: f32,
) -> VOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0,  1.0), vec2<f32>(-1.0,  1.0),
  );
  let c = corners[vid];
  let d = end - start;
  let len = max(length(d), 0.0001);
  let dir = d / len;
  let perp = vec2<f32>(-dir.y, dir.x);
  let halfPad = width * 0.5 + uni.glowExtra;
  let along  = mix(-halfPad, len + halfPad, (c.x + 1.0) * 0.5);
  let across = c.y * halfPad;
  let px = start + dir * along + perp * across;
  let ndc = vec2<f32>(
    px.x / uni.viewport.x * 2.0 - 1.0,
    1.0 - px.y / uni.viewport.y * 2.0,
  );
  var o: VOut;
  o.clip = vec4<f32>(ndc, 0.0, 1.0);
  o.color = color;
  o.px = px;
  o.start = start;
  o.end = end;
  o.width = width;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  // Distance from pixel to line segment.
  let pa = in.px - in.start;
  let ba = in.end - in.start;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  let dist = length(pa - ba * h);
  let halfW = in.width * 0.5;

  // Two layered hard-edged strokes to match the canvas-2D behaviour exactly:
  //   crisp inner (α 1.0, full width) + mid glow (α 0.26, width × 2.6).
  // Smoothstep starts at the line edge so the line interior keeps full
  // intensity (no AA softening of thin lines). Outer edge is smoothed by
  // ~0.7 CSS px for anti-aliasing.
  let core = 1.0 - smoothstep(halfW, halfW + 0.7, dist);
  let glowEdge = halfW * 2.6;
  let glow = (1.0 - smoothstep(glowEdge, glowEdge + 0.7, dist)) * 0.26;
  let intensity = core + glow;
  return vec4<f32>(in.color * intensity, intensity);
}
`;

  const WGSL_DOT = `
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) intensity: f32,
  @location(2) local: vec2<f32>,
};
struct U {
  viewport: vec2<f32>,
  _p0: f32,
  _p1: f32,
};
@group(0) @binding(0) var<uniform> uni: U;

@vertex
fn vs(
  @builtin(vertex_index) vid: u32,
  @location(0) center: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) intensity: f32,
) -> VOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0,  1.0), vec2<f32>(-1.0,  1.0),
  );
  let c = corners[vid];
  let haloR = 8.0 + intensity * 4.0;
  let local = c * haloR;
  let px = center + local;
  let ndc = vec2<f32>(
    px.x / uni.viewport.x * 2.0 - 1.0,
    1.0 - px.y / uni.viewport.y * 2.0,
  );
  var o: VOut;
  o.clip = vec4<f32>(ndc, 0.0, 1.0);
  o.color = color;
  o.intensity = intensity;
  o.local = local;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  // Three hard-edged disks (matches canvas-2D's three arc fills):
  //   halo: r = 5 + i*3,   α 0.10·i, color
  //   mid:  r = 2 + i*1.2, α 0.40·i, color
  //   core: r = 0.9 + i*0.6, α min(1, i), white
  // Smoothstep starting at the disk edge keeps the interior at full
  // intensity (matches canvas-2D fills) with ~0.5 CSS px AA on the rim.
  let dist = length(in.local);
  let i = in.intensity;

  let haloR = 5.0 + i * 3.0;
  let halo = (1.0 - smoothstep(haloR, haloR + 0.5, dist)) * (0.10 * i);

  let midR = 2.0 + i * 1.2;
  let mid  = (1.0 - smoothstep(midR, midR + 0.5, dist)) * (0.40 * i);

  let coreR = 0.9 + i * 0.6;
  let core  = (1.0 - smoothstep(coreR, coreR + 0.5, dist)) * min(1.0, i);

  let rgb = (halo + mid) * in.color + vec3<f32>(core, core, core);
  return vec4<f32>(rgb, halo + mid + core);
}
`;

  async function initWebGPU() {
    if (!navigator.gpu) {
      console.warn("[InfiniRacer] WebGPU not supported by this browser");
      return null;
    }
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) { console.warn("[InfiniRacer] no WebGPU adapter"); return null; }
      device = await adapter.requestDevice();
    } catch (e) {
      console.warn("[InfiniRacer] WebGPU device request failed:", e);
      return null;
    }
    device.lost.then((info) => {
      console.warn("[InfiniRacer] WebGPU device lost:", info);
      webgpu = null;
    });

    const ctxGpu = gpuCanvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctxGpu.configure({ device, format, alphaMode: "opaque" });

    // Uniform buffer (viewport size + glow padding).
    const uniformBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uniformData = new Float32Array([0, 0, 18.0, 0]);

    const additiveBlend = {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
    };

    // ─── line pipeline ───
    const lineModule = device.createShaderModule({ code: WGSL_LINE });
    const linePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: lineModule,
        entryPoint: "vs",
        buffers: [{
          arrayStride: 32, // 8 + 8 + 12 + 4
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0,  format: "float32x2" }, // start
            { shaderLocation: 1, offset: 8,  format: "float32x2" }, // end
            { shaderLocation: 2, offset: 16, format: "float32x3" }, // color rgb
            { shaderLocation: 3, offset: 28, format: "float32"   }, // width
          ],
        }],
      },
      fragment: {
        module: lineModule,
        entryPoint: "fs",
        targets: [{ format, blend: additiveBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const lineBindGroup = device.createBindGroup({
      layout: linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
    });

    // ─── dot pipeline ───
    const dotModule = device.createShaderModule({ code: WGSL_DOT });
    const dotPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: dotModule,
        entryPoint: "vs",
        buffers: [{
          arrayStride: 24, // 8 + 12 + 4
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0,  format: "float32x2" }, // center
            { shaderLocation: 1, offset: 8,  format: "float32x3" }, // color rgb
            { shaderLocation: 2, offset: 20, format: "float32"   }, // intensity
          ],
        }],
      },
      fragment: {
        module: dotModule,
        entryPoint: "fs",
        targets: [{ format, blend: additiveBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const dotBindGroup = device.createBindGroup({
      layout: dotPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
    });

    // Instance buffers — grow on demand.
    let lineCap = 0, lineBuf = null, lineCpu = null;
    function ensureLineBuf(n) {
      if (n <= lineCap) return;
      lineCap = Math.max(n, lineCap * 2 || 256);
      if (lineBuf) lineBuf.destroy();
      lineBuf = device.createBuffer({
        size: lineCap * 32,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      lineCpu = new Float32Array(lineCap * 8);
    }
    let dotCap = 0, dotBuf = null, dotCpu = null;
    function ensureDotBuf(n) {
      if (n <= dotCap) return;
      dotCap = Math.max(n, dotCap * 2 || 512);
      if (dotBuf) dotBuf.destroy();
      dotBuf = device.createBuffer({
        size: dotCap * 24,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      dotCpu = new Float32Array(dotCap * 6);
    }

    // hex "#rrggbb" → [r, g, b] floats. Cached.
    const colorCache = new Map();
    function hexToRGB(hex) {
      let v = colorCache.get(hex);
      if (v) return v;
      v = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      ];
      colorCache.set(hex, v);
      return v;
    }

    return {
      resize(w, h) {
        uniformData[0] = w;
        uniformData[1] = h;
        device.queue.writeBuffer(uniformBuf, 0, uniformData);
      },
      drawFrame(beams, dots) {
        ensureLineBuf(beams.length);
        for (let i = 0; i < beams.length; i++) {
          const b = beams[i];
          const c = hexToRGB(b.c);
          const o = i * 8;
          lineCpu[o    ] = b.x1;
          lineCpu[o + 1] = b.y1;
          lineCpu[o + 2] = b.x2;
          lineCpu[o + 3] = b.y2;
          lineCpu[o + 4] = c[0];
          lineCpu[o + 5] = c[1];
          lineCpu[o + 6] = c[2];
          lineCpu[o + 7] = b.w;
        }
        if (beams.length > 0) {
          device.queue.writeBuffer(lineBuf, 0, lineCpu, 0, beams.length * 8);
        }
        ensureDotBuf(dots.length);
        for (let i = 0; i < dots.length; i++) {
          const d = dots[i];
          const c = hexToRGB(d.c);
          const o = i * 6;
          dotCpu[o    ] = d.x;
          dotCpu[o + 1] = d.y;
          dotCpu[o + 2] = c[0];
          dotCpu[o + 3] = c[1];
          dotCpu[o + 4] = c[2];
          dotCpu[o + 5] = d.i;
        }
        if (dots.length > 0) {
          device.queue.writeBuffer(dotBuf, 0, dotCpu, 0, dots.length * 6);
        }

        const encoder = device.createCommandEncoder();
        const view = ctxGpu.getCurrentTexture().createView();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view,
            clearValue: { r: 4 / 255, g: 6 / 255, b: 10 / 255, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        if (beams.length > 0) {
          pass.setPipeline(linePipeline);
          pass.setBindGroup(0, lineBindGroup);
          pass.setVertexBuffer(0, lineBuf);
          pass.draw(6, beams.length);
        }
        if (dots.length > 0) {
          pass.setPipeline(dotPipeline);
          pass.setBindGroup(0, dotBindGroup);
          pass.setVertexBuffer(0, dotBuf);
          pass.draw(6, dots.length);
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
    };
  }

  // ───────────────────────────────────────────────────────────── loop
  ensureTrackTo(2400);

  if (WANT_GPU) {
    initWebGPU().then((r) => {
      if (r) {
        webgpu = r;
        webgpu.resize(W, H);
        console.log("[InfiniRacer] WebGPU renderer active");
      } else {
        console.warn("[InfiniRacer] WebGPU init failed; canvas-2D fallback in use");
      }
    });
  }

  let last = performance.now();
  let trimAccum = 0;
  let fpsAccum = 0, fpsCount = 0;
  let pageVisible = !document.hidden;

  // When the tab is hidden, rAF already throttles to ~1Hz in most browsers
  // and to 0 when truly backgrounded. Belt + braces: gate the loop body so
  // we don't run physics/render at all while hidden, and reset `last` on
  // return so the first dt isn't a giant catch-up jump.
  document.addEventListener("visibilitychange", () => {
    pageVisible = !document.hidden;
    if (pageVisible) last = performance.now();
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (!pageVisible) { last = now; return; }

    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dtSim = dtReal * getTimeScale();

    _frameTrackInfo = null; // invalidate per-frame caches

    readInput(dtReal);
    if (started && !explosion.active) updateCar(dtSim);
    updateExplosion(dtSim, dtReal);

    // Cheap world trim every ~1s so the track + scenery arrays don't grow
    // forever (the overnight-leak fix).
    trimAccum += dtReal;
    if (trimAccum > 1.0) { trimAccum = 0; trimWorld(); }

    // FPS readout — update twice a second so the number is readable.
    fpsAccum += dtReal;
    fpsCount++;
    if (fpsAccum >= 0.5) {
      fpsEl.textContent = String(Math.round(fpsCount / fpsAccum));
      fpsAccum = 0; fpsCount = 0;
    }

    render(dtReal);
    updateHUD();
  }
  requestAnimationFrame(frame);
})();
