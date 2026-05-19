/* INFINI RACER — vector top-down infinite racer */
(() => {
  // ───────────────────────────────────────────────────────────── canvas/dpr
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const spdEl = document.getElementById("spd");
  const dstEl = document.getElementById("dst");
  const bstEl = document.getElementById("bst");
  const fpsEl = document.getElementById("fps");
  const scoreEl = document.getElementById("score");
  const timerEl = document.getElementById("timer");
  const pipEls = Array.from(document.querySelectorAll("#stage-pips .pip"));
  const trackNumEl  = document.getElementById("track-num");
  const trackNameEl = document.getElementById("track-name");
  const sbar = document.getElementById("speedbar");
  const overlay = document.getElementById("overlay");

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
    // Sit the joystick clear of the bottom edge so the BRAKE / STEER labels
    // fit and we don't fight iOS / Android system gestures (swipe-up, etc).
    // Pad = stick radius + label height + ~50px gesture safe area.
    stick.cy = H - stick.r - 80;
    _stickLabels = null; // re-bake on next draw (accounts for dpr change)
  }
  function pointInStickZone(py) {
    // Cover the joystick + a little above so the top of the knob is grabbable.
    return py >= stick.cy - stick.r - 20;
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
  // World seed varies per track. Set by initial commitReset() / advance to
  // next track. Track 1 → 7341, tracks 2+ deterministic from trackSeedFor().
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

  // Map an along-track distance `s` to its track[] index.
  // After `trimWorld()` splices old segments off the front, `track[0].s`
  // is no longer 0, so `Math.floor(s / SEG_LEN)` points at the wrong row
  // (this was the "power-ups disappear" bug). Returns -1 if `s` falls
  // outside the currently retained window.
  function trackIndexAt(s) {
    if (track.length === 0) return -1;
    const baseS = track[0].s;
    const i = Math.floor((s - baseS) / SEG_LEN);
    if (i < 0 || i >= track.length) return -1;
    return i;
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
      const segIdx = trackIndexAt(s);
      const seg = segIdx >= 0 ? track[segIdx] : null;
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

  // ───────────────────────────────────────────────────────────── power-ups
  // Sparse pickups that, when grabbed, multiply the edge-repel field for a
  // few seconds — track edges feel like a soft wall while it's active.
  // Same chunked-along-the-track pattern as scenery, but generated linearly
  // by an advancing cursor so spacing is easy to tune.
  const powerups = [];          // sorted by .s ascending; mutated as picked up
  let nextPowerupS = 1100;
  const POWERUP_GAP_MIN   = 1500;
  const POWERUP_GAP_RANGE = 1100;
  const POWERUP_RADIUS    = 24;   // hit radius (track-local; visual r = 21)

  function ensurePowerupsTo(s) {
    while (nextPowerupS < s + 700) {
      ensureTrackTo(nextPowerupS + 200);
      const idx = trackIndexAt(nextPowerupS);
      const seg = idx >= 0 ? track[idx] : null;
      if (!seg) { nextPowerupS += POWERUP_GAP_MIN; continue; }
      const r1 = hash01(nextPowerupS * 0.019 + worldSeed * 5.7);
      const lateralRange = Math.max(0, seg.hw - 24);
      const lateralOffset = (r1 - 0.5) * 2 * lateralRange;
      powerups.push({ s: nextPowerupS, lateralOffset, taken: false });
      const r2 = hash01(nextPowerupS * 0.031 + worldSeed * 13.3);
      nextPowerupS += POWERUP_GAP_MIN + r2 * POWERUP_GAP_RANGE;
    }
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
      // Drop pickups (taken or not) once they're well behind us.
      while (powerups.length && powerups[0].s < carS - TRIM_BEHIND_DST) {
        powerups.shift();
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
    boostT: 0,        // seconds remaining on the edge-repel boost (0 = inactive)
    slipAngle: 0,     // radians offset between heading and motion direction (drift)
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
  // Power-up boost: while car.boostT > 0, multiply EDGE_REPEL_MAX so the
  // edge field becomes a near-soft-wall (3.0 × 620 = 1860 > MAX_SPEED).
  const BOOST_REPEL_MUL = 3.0;
  const BOOST_DURATION  = 5.0; // seconds
  // Drift (brake-while-steering at speed): car keeps motion direction
  // while heading rotates faster than usual; slip angle eases up to MAX_SLIP
  // and decays back when the trigger releases.
  const DRIFT_MIN_SPEED   = 220;   // below this, brake is just braking
  const DRIFT_STEER_MIN   = 0.18;  // need at least this much steer commit
  const DRIFT_YAW_BOOST   = 1.55;  // multiplies yaw while drifting
  const DRIFT_BRAKE_MUL   = 0.30;  // softer brake so speed bleeds, not crashes
  const DRIFT_DRAG        = 90;    // extra speed loss while drifting (u/s²)
  const DRIFT_MAX_SLIP    = 0.50;  // ~29° between heading and motion
  const DRIFT_SLIP_GAIN   = 5.5;   // 1/τ for slip build-up
  const DRIFT_SLIP_RECOV  = 6.5;   // 1/τ for slip decay when not drifting

  // ───────────────────────────────────────────────────────────── race
  // OutRun-style: 3 timed stages. Hit each checkpoint before time runs out
  // to advance + refresh the clock. The final checkpoint is the chequered
  // flag — leftover time on the clock at that moment is multiplied into a
  // generous score bonus. Run out of time mid-stage and it's a TIME OVER
  // (same crash sequence as a wipeout, with a different label).
  // Stage gaps bumped up slightly (65 / 85 / 105 = 255 000 u total) and the
  // per-stage clock pulled back to a flat 60 seconds. With carry-over you
  // need to sustain ~1500 u/s (~94% MAX_SPEED) to finish on the wire.
  const STAGES = [
    { distance: 65000,  duration: 60 },
    { distance: 150000, duration: 60 },
    { distance: 255000, duration: 60 },  // = chequered flag
  ];
  const TIME_BONUS_PER_SEC = 250000;
  const FINISH_OVERLAY_DURATION = 9.5;  // seconds — long enough to read score + next-track callout
  const FINISH_SCORE_PHASE      = 5.2;  // score breakdown holds for this long, then NEXT TRACK
  const CP_FLASH_DURATION       = 1.5;  // seconds the CHECKPOINT! banner sits on screen
  // Track-intro: a big centred "TRACK 01 / ROYGBIV" pops in, holds, then
  // shrinks + slides up to the top-of-HUD position. Race timer + checkpoints
  // are paused for the duration so the player gets to read it.
  const TRACK_INTRO_DURATION = 3.6;
  const TRACK_INTRO_HOLD     = 1.7;     // big-centred hold before the shrink phase

  // ── Track progression ──
  // Track 1 keeps the legacy seed (7341) so the original course is preserved.
  // Tracks 2+ derive their seed from hash01 so they're deterministic but feel
  // varied. Names are Boards of Canada song titles — track 1 hard-coded,
  // tracks 2+ picked from the list via hash01 for a procedural feel.
  const TRACK_1_SEED = 7341;
  const TRACK_NAMES = [
    "ROYGBIV",
    "TURQUOISE HEXAGON SUN",
    "AQUARIUS",
    "MUSIC IS MATH",
    "DAWN CHORUS",
    "SUNSHINE RECORDER",
    "AN EAGLE IN YOUR MIND",
    "REACH FOR THE DEAD",
    "OPEN THE LIGHT",
    "TELEPHASIC WORKSHOP",
    "PETE STANDING ALONE",
    "WHITE CYCLOSA",
    "HAPPY CYCLING",
    "TOMORROWS HARVEST",
    "HEY SATURDAY SUN",
    "COLD EARTH",
    "OLSON",
    "MACQUARIE RIDGE",
    "KAINI INDUSTRIES",
    "WILDLIFE ANALYSIS",
  ];
  function trackSeedFor(n) {
    if (n <= 1) return TRACK_1_SEED;
    return Math.floor(hash01(n * 13.37 + 17.6) * 1_000_000);
  }
  function trackNameFor(n) {
    if (n <= 1) return TRACK_NAMES[0];
    const i = Math.floor(hash01(n * 11.7 + 3.3) * (TRACK_NAMES.length - 1)) + 1;
    return TRACK_NAMES[i];
  }

  // Score that accumulates ACROSS tracks within a single run. Reset only on
  // crash (commitReset). Track 1 ends with score → runScoreAccum carries
  // into track 2.
  let runScoreAccum = 0;
  const race = {
    stage: 0,
    timeLeft: STAGES[0].duration,
    finished: false,
    finishedT: 0,        // seconds since the chequered flag
    finalScore: 0,
    finalBaseScore: 0,
    finalBonus: 0,
    cpFlashT: 0,         // brief white flash on checkpoint cross
    trackNum: 1,         // 1, 2, 3, ... — persists across initRace
    trackName: TRACK_NAMES[0],
    introT: 0,           // seconds since the track-intro started (counts up)
  };
  let crashReason = "wipeout"; // "wipeout" | "timeout"
  // Resets the per-track state ONLY — does not touch trackNum / trackName /
  // runScoreAccum, so advanceToNextTrack can reuse this. Also kicks off
  // the track-intro animation by zeroing introT.
  function initRace() {
    race.stage = 0;
    race.timeLeft = STAGES[0].duration;
    race.finished = false;
    race.finishedT = 0;
    race.finalScore = 0;
    race.finalBaseScore = 0;
    race.finalBonus = 0;
    race.cpFlashT = 0;
    race.introT = 0;
    crashReason = "wipeout";
  }

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
    // `let` so the post-finish block can override throttle/brake — the car
    // needs to brake hard past the line so a curve right after the flag
    // doesn't crash it.
    let { throttle, brake, left, right } = input;

    // Post-finish: hold for FINISH_OVERLAY_DURATION showing the score +
    // next-track callout, then advance to the next track (score persists).
    if (race.finished) {
      race.finishedT += dt;
      if (race.finishedT > FINISH_OVERLAY_DURATION) {
        advanceToNextTrack();
        return;
      }
      // Force a smooth deceleration: brake fully, ignore throttle/steer
      // input from the player. Edge repel + steering smoothing still run
      // so the car follows the track shape as it coasts to a stop.
      throttle = 0;
      brake    = 1;
    }

    // Smooth steering input. (target is analog [-1, 1].)
    const target = right - left;
    car.steer += (target - car.steer) * Math.min(1, dt * STEER_RATE * 6);

    // Drift trigger: brake held + meaningful steer commit + enough speed.
    // Below the threshold, brake is just brake (no slide).
    const drifting = brake > 0
      && Math.abs(car.steer) > DRIFT_STEER_MIN
      && car.speed > DRIFT_MIN_SPEED;

    // Yaw: fades a bit at high speed so it feels heavier. Bumped while
    // drifting so the heading rotates faster than the car's actual motion
    // direction — that gap (slipAngle) is what we see as a slide.
    const speedRatio = car.speed / MAX_SPEED;
    const baseYaw = car.steer * TURN_RATE * (0.55 + 0.6 * Math.min(1, speedRatio + 0.15));
    const yaw = baseYaw * (drifting ? DRIFT_YAW_BOOST : 1);
    car.heading += yaw * dt;

    // Slip angle dynamics. Build toward a target offset opposite the steer
    // (so the rear of the car appears to swing out into the turn). Decay
    // back to zero when not drifting — grip recovers.
    if (drifting) {
      const slipTarget = -car.steer * DRIFT_MAX_SLIP;
      const k = Math.min(1, DRIFT_SLIP_GAIN * dt);
      car.slipAngle += (slipTarget - car.slipAngle) * k;
    } else {
      car.slipAngle *= Math.exp(-DRIFT_SLIP_RECOV * dt);
      if (Math.abs(car.slipAngle) < 0.002) car.slipAngle = 0;
    }

    // Speed (analog). Drift softens the brake (so the slide actually
    // continues) but adds extra drag so it isn't free speed.
    if (throttle > 0) car.speed += ACCEL * throttle * dt;
    if (brake    > 0) car.speed -= BRAKE_DECEL * (drifting ? DRIFT_BRAKE_MUL : 1) * brake * dt;
    if (drifting)     car.speed -= DRIFT_DRAG * dt;
    if (throttle === 0 && brake === 0) car.speed -= COAST * dt;
    car.speed = Math.max(0, Math.min(MAX_SPEED, car.speed));

    // Anti-magnetic edge field: a lateral push toward the centerline that
    // grows quadratically as you near the edge. Strong enough to catch slow
    // drift, but capped below MAX_SPEED so you can punch through if you
    // commit hard / fast — UNLESS the boost power-up is active, in which
    // case the cap is multiplied above MAX_SPEED and the edge becomes a
    // soft wall.
    const info = carTrackInfo();
    const boostMul = car.boostT > 0 ? BOOST_REPEL_MUL : 1;
    const eZone = Math.min(EDGE_REPEL_ZONE, info.seg.hw * 0.6);
    const edgeDist = info.seg.hw - Math.abs(info.lateral);
    let proximity = 0;
    let repelVx = 0, repelVy = 0;
    if (edgeDist < eZone) {
      proximity = Math.max(0, 1 - Math.max(0, edgeDist) / eZone);
      const sign = info.lateral > 0 ? -1 : 1; // push back toward centerline
      const nx = -Math.sin(info.seg.dir);
      const ny =  Math.cos(info.seg.dir);
      const mag = proximity * proximity * EDGE_REPEL_MAX * boostMul;
      repelVx = sign * nx * mag;
      repelVy = sign * ny * mag;
    }
    car.edgeProximity = proximity;
    car.edgeSide = info.lateral > 0 ? 1 : -1;

    // Tick the boost timer down each frame. Tick AFTER it influences this
    // frame's repel so the very last frame of boost still helps.
    if (car.boostT > 0) car.boostT = Math.max(0, car.boostT - dt);

    // Translate. Motion direction is heading + slipAngle so during a drift
    // the car slides at an angle to where it's pointing — repel velocity is
    // still in world coords and adds on top.
    const motionDir = car.heading + car.slipAngle;
    car.x += (Math.cos(motionDir) * car.speed + repelVx) * dt;
    car.y += (Math.sin(motionDir) * car.speed + repelVy) * dt;

    // Power-up pickup check. Generate ahead, scan a small window around
    // current position, mark taken if the car's centre is within the
    // pickup radius of any unpicked one.
    ensurePowerupsTo(info.seg.s + 800);
    const post = carTrackInfo();
    for (const pu of powerups) {
      if (pu.taken) continue;
      if (pu.s > post.seg.s + 60) break;
      if (pu.s < post.seg.s - 60) continue;
      const dLong = post.seg.s - pu.s;
      const dLat  = post.lateral - pu.lateralOffset;
      if (dLong * dLong + dLat * dLat > POWERUP_RADIUS * POWERUP_RADIUS) continue;
      pu.taken = true;
      car.boostT = BOOST_DURATION;
      break;
    }

    // After motion, did we still cross out? Then trigger the crash.
    // Skipped during the post-finish hold so a curve right after the
    // chequered flag doesn't wipeout the celebration.
    if (!race.finished && Math.abs(post.lateral) - post.seg.hw > 0) {
      crashReason = "wipeout";
      triggerCrash();
      return;
    }
    car.rumble *= 0.85;

    // ── race timer + checkpoint detection ──
    // Don't tick once finished (post-finish overlay handles flow).
    // Also gated by the track-intro: while the big TRACK XX banner is on
    // screen the clock is paused so the player gets to read it. The intro
    // counter still advances regardless.
    if (race.introT < TRACK_INTRO_DURATION) {
      race.introT += dt;
    }
    if (!race.finished && race.introT >= TRACK_INTRO_DURATION) {
      race.timeLeft -= dt;
      if (race.cpFlashT > 0) race.cpFlashT = Math.max(0, race.cpFlashT - dt);
      if (race.timeLeft <= 0) {
        race.timeLeft = 0;
        crashReason = "timeout";
        triggerCrash();
        return;
      }
      const target = STAGES[race.stage].distance;
      if (post.seg.s >= target) {
        if (race.stage < STAGES.length - 1) {
          // Carry any unused time over and add it to the new stage's clock —
          // rewards fast play with a longer next-stage buffer.
          const carryover = race.timeLeft;
          race.stage++;
          race.timeLeft = STAGES[race.stage].duration + carryover;
          race.cpFlashT = CP_FLASH_DURATION;
        } else {
          // Chequered flag. Lock the final score (base + bonus).
          race.finished = true;
          race.finishedT = 0;
          race.finalBaseScore = Math.floor(car.speed * post.seg.s);
          race.finalBonus = Math.floor(race.timeLeft * TIME_BONUS_PER_SEC);
          race.finalScore = race.finalBaseScore + race.finalBonus;
          race.cpFlashT = 0; // the finish overlay takes over instead
          if (race.finalScore > bestScore) {
            bestScore = race.finalScore;
            bestScoreDirty = true;
          }
        }
      }
    }
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
    // Capture the total visible score (accumulated across previous tracks +
    // this track's running speed × dist) so the WIPEOUT readout shows what
    // the player just lost.
    explosion.finalScore = runScoreAccum + Math.floor(car.speed * dst);
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

  // Wipe the world geometry, scenery + pickup state, and put the car back
  // at the origin. Shared by commitReset (full failure) and
  // advanceToNextTrack (success → next track). Does not touch race state,
  // trackNum, or runScoreAccum.
  function resetWorldGeometry() {
    track.length = 0;
    sceneryChunks.clear();
    powerups.length = 0;
    nextPowerupS = 1100;
    car.x = 0; car.y = 0;
    car.heading = -Math.PI / 2;
    car.speed = 0;
    car.steer = 0;
    car.rumble = 0;
    car.boostT = 0;
    car.slipAngle = 0;
    lastSegIdx = 0;
    ensureTrackTo(2400);
    explosion.active = false;
    explosion.debris = [];
    explosion.sparks = [];
    explosion.shockwaves = [];
  }

  // Cross the chequered flag → start the next track. Score accumulates;
  // trackNum + trackName advance; world regenerates from the new seed.
  function advanceToNextTrack() {
    runScoreAccum += race.finalScore;
    race.trackNum += 1;
    race.trackName = trackNameFor(race.trackNum);
    worldSeed = trackSeedFor(race.trackNum);
    resetWorldGeometry();
    initRace();
  }

  // Full failure reset — crash or time-out. Back to track 1, score wiped.
  function commitReset() {
    runScoreAccum = 0;
    race.trackNum = 1;
    race.trackName = trackNameFor(1);
    worldSeed = trackSeedFor(1);
    resetWorldGeometry();
    initRace();
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
    // Solid bg.
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

    // ── Checkpoints (intermediate bars + chequered finish line).
    for (let i = 0; i < STAGES.length; i++) {
      const target = STAGES[i].distance;
      if (target + 100 < carS) continue;     // already crossed + behind
      if (target > carS + 1500) break;       // too far ahead
      const idx = trackIndexAt(target);
      if (idx < 0) continue;
      const seg = track[idx];
      const nx = -Math.sin(seg.dir), ny = Math.cos(seg.dir);
      const lx = seg.cx + nx * seg.hw, ly = seg.cy + ny * seg.hw;
      const rx = seg.cx - nx * seg.hw, ry = seg.cy - ny * seg.hw;
      const isFinal  = (i === STAGES.length - 1);
      const isActive = (race.stage === i && !race.finished);
      if (isFinal) {
        // Chequered banner — alternating white + cyan thick segments across
        // the track, two rows offset so it reads as a flag.
        const N = 10;
        for (let row = 0; row < 2; row++) {
          for (let k = 0; k < N; k++) {
            const t0 = k / N, t1 = (k + 1) / N;
            const sign = (k + row) & 1;
            const col = sign ? "#ffffff" : "#5cf0ff";
            // Slight forward offset for the second row to fake depth.
            const dirX = Math.cos(seg.dir), dirY = Math.sin(seg.dir);
            const off = row * 6;
            const x0 = lx + (rx - lx) * t0 + dirX * off;
            const y0 = ly + (ry - ly) * t0 + dirY * off;
            const x1 = lx + (rx - lx) * t1 + dirX * off;
            const y1 = ly + (ry - ly) * t1 + dirY * off;
            const a = cam(x0, y0), b = cam(x1, y1);
            beam(a.x, a.y, b.x, b.y, col, 2.0, G_FX);
          }
        }
      } else {
        // Intermediate checkpoint: single bright bar across track.
        const col = isActive ? "#ffe98b" : "#3a8e95";
        const w   = isActive ? 1.8 : 1.2;
        const a = cam(lx, ly), b = cam(rx, ry);
        beam(a.x, a.y, b.x, b.y, col, w, G_FX);
      }
    }

    // ── Power-ups (rotating wireframe hexagons in magenta).
    ensurePowerupsTo(carS + 1500);
    const puRot = phase * 1.2; // shared rotation phase
    for (const pu of powerups) {
      if (pu.taken) continue;
      if (pu.s + 80 < carS - 200) continue;
      if (pu.s > carS + 1500) break;
      const idx0 = trackIndexAt(pu.s);
      const seg = idx0 >= 0 ? track[idx0] : null;
      if (!seg) continue;
      const nx = -Math.sin(seg.dir), ny = Math.cos(seg.dir);
      const wx = seg.cx + nx * pu.lateralOffset;
      const wy = seg.cy + ny * pu.lateralOffset;
      const r = 21;
      // Build hexagon vertices in world space, transform via cam.
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const a = puRot + k * (Math.PI / 3);
        pts.push(cam(wx + Math.cos(a) * r, wy + Math.sin(a) * r));
      }
      const c = "#ff5cff";
      for (let k = 0; k < 6; k++) {
        const a = pts[k], b = pts[(k + 1) % 6];
        beam(a.x, a.y, b.x, b.y, c, 1.4, G_FX);
      }
      // Bright pulsing core dot (uses the dot pipeline by tagging FX).
      const corePulse = 0.6 + 0.4 * Math.sin(phase * 5 + pu.s * 0.01);
      const cp = cam(wx, wy);
      dots.push({ x: cp.x, y: cp.y, c: "#ffffff", i: 1.2 * corePulse, g: G_FX });
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
        const idx = trackIndexAt(s);
        if (idx < 0) continue;
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

      // While the boost is active, swap the car's palette to a magenta-
      // tinted one at ~6 Hz. Square wave (Math.floor) gives a sharp blink
      // rather than a gradient — reads as "powered up".
      const boosting = car.boostT > 0;
      const flashOn  = boosting && (Math.floor(phase * 12) & 1) === 1;
      const bodyCol = flashOn ? "#ff5cff" : "#e8fffb";
      const cockCol = flashOn ? "#ffd6ff" : "#5cf0ff";
      // Wheels brighten to hot orange while drifting so the slide reads.
      const drifting = Math.abs(car.slipAngle) > 0.06;
      const wheelCol = flashOn ? "#ff5cff" : (drifting ? "#ff8d3a" : "#ffb14b");
      const wheelW   = drifting ? 1.8 : 1.4;

      // Body outline.
      const body = [
        [ 0, -22], [ 5, -14], [ 9,  -2], [ 9,  10], [ 5,  18],
        [-5,  18], [-9,  10], [-9,  -2], [-5, -14],
      ].map(([x, y]) => p(x, y));
      for (let i = 0; i < body.length; i++) {
        const a = body[i], b = body[(i + 1) % body.length];
        beam(a.x, a.y, b.x, b.y, bodyCol, 1.7, G_CAR);
      }

      // Cockpit diamond.
      const cock = [[0, -2], [4, 4], [0, 10], [-4, 4]].map(([x, y]) => p(x, y));
      for (let i = 0; i < cock.length; i++) {
        const a = cock[i], b = cock[(i + 1) % cock.length];
        beam(a.x, a.y, b.x, b.y, cockCol, 1.2, G_CAR);
      }

      // Wheels.
      [
        [-10, -10, -10, -3],
        [ 10, -10,  10, -3],
        [-10,   8, -10, 15],
        [ 10,   8,  10, 15],
      ].forEach(([x1, y1, x2, y2]) => {
        const a = p(x1, y1), b = p(x2, y2);
        beam(a.x, a.y, b.x, b.y, wheelCol, wheelW, G_CAR);
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
    // Two passes — mid glow (lighter) + crisp lines (source-over).
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

    // ─── Phosphor dots ──────────────────────────────────────────
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

    // (CRT scanlines + vignette are now CSS overlays on body — they were
    // 81% of frame time when done as per-frame fillRects with "overlay"
    // composite + radial-gradient sampling. The browser compositor handles
    // them effectively for free.)

    // ─── Virtual joystick (HUD overlay) ─────────────────────────
    drawJoystick();

    // ─── Track intro / checkpoint banner / finish / crash ───────
    // Track intro plays at the very start of every track and animates into
    // the HUD label position; the other overlays defer to it.
    if (race.introT < TRACK_INTRO_DURATION && !explosion.active && !race.finished) {
      drawTrackIntro();
    } else if (race.cpFlashT > 0 && !explosion.active && !race.finished) {
      drawCheckpointFlash();
    }
    if (explosion.active) drawExplosion();
    if (race.finished && !explosion.active) drawFinishOverlay();
  }

  // ─── Explosion render ────────────────────────────────────────
  function drawTrackIntro() {
    // Big centred title pops in (overshoot bounce), holds briefly, then
    // fades out while growing — like it's expanding past the camera.
    // The HUD #track-label stays visible the whole time so the player
    // always knows the track name. Race timer is paused for the duration.
    const t = race.introT;
    if (t >= TRACK_INTRO_DURATION) return;

    const ALL  = TRACK_INTRO_DURATION;
    const HOLD = TRACK_INTRO_HOLD;
    const POP  = 0.35;

    let alpha, scale;
    if (t < POP) {
      // Overshoot bounce: 0.5 → 1.15 (at midpoint) → 1.0
      const p = t / POP;
      if (p < 0.5) scale = 0.5 + (1.15 - 0.5) * (p / 0.5);
      else         scale = 1.15 - (1.15 - 1.0) * ((p - 0.5) / 0.5);
      alpha = Math.min(1, p * 2);
    } else if (t < HOLD) {
      alpha = 1;
      scale = 1.0;
    } else {
      // Phase 2: fade out while growing — feels like the title is
      // pushing past the camera. Scale eases out (fast at first, settles);
      // alpha eases in (slow at first, fast at end) so the readout is
      // legible until the growth has started.
      const p = Math.min(1, (t - HOLD) / (ALL - HOLD));
      const eScale = 1 - Math.pow(1 - p, 2);   // ease-out
      alpha = 1 - p * p;                       // ease-in fade
      scale = 1.0 + 1.0 * eScale;              // → 2.0×
    }
    if (alpha <= 0) return;

    const x = W / 2;
    const y = H * 0.42;
    const numSize  = 28 * scale;
    const nameSize = 84 * scale;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Subtle white screen-flash at the very moment of pop-in.
    if (t < 0.15) {
      const flashA = (1 - t / 0.15) * 0.14;
      ctx.fillStyle = `rgba(255, 255, 255, ${flashA})`;
      ctx.fillRect(0, 0, W, H);
    }

    // "TRACK 01" — amber, smaller, sits above the name.
    ctx.font = `${numSize}px "Press Start 2P", monospace`;
    ctx.shadowColor = "#ffb14b";
    ctx.shadowBlur = 18 * scale + 6;
    ctx.fillStyle = `rgba(255, 230, 0, ${alpha})`;
    ctx.fillText("TRACK " + String(race.trackNum).padStart(2, "0"),
                 x, y - nameSize * 0.62);

    // Track name — white with cyan halo, big.
    ctx.font = `${nameSize}px "Press Start 2P", monospace`;
    ctx.shadowColor = "#5cf0ff";
    ctx.shadowBlur = 32 * scale + 8;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillText(race.trackName, x, y + nameSize * 0.25);

    ctx.shadowBlur = 0;
  }

  function drawCheckpointFlash() {
    // race.cpFlashT counts DOWN from CP_FLASH_DURATION to 0; elapsed goes
    // up from 0 → CP_FLASH_DURATION. Snap-zoom from 1.4× to 1.0× while
    // fading in, hold, then fade out.
    const total = CP_FLASH_DURATION;
    const elapsed = total - race.cpFlashT;
    const fadeIn  = 0.15;
    const fadeOut = 0.45;
    let alpha, scale;
    if (elapsed < fadeIn) {
      const p = elapsed / fadeIn;
      alpha = p;
      scale = 1.4 - 0.4 * p;
    } else if (elapsed < total - fadeOut) {
      alpha = 1;
      scale = 1.0;
    } else {
      const p = (elapsed - (total - fadeOut)) / fadeOut;
      alpha = 1 - p;
      scale = 1.0 + 0.06 * p;
    }
    const cx = W / 2;
    const cy = H * 0.34; // upper-third for an OutRun-y banner spot
    const baseSize = Math.max(40, Math.min(108, W * 0.082));
    const size = baseSize * scale;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Behind text: a wide cyan glow halo so it pops against the world.
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.shadowColor = "#ffe600";
    ctx.shadowBlur = 38;
    ctx.fillStyle = `rgba(255, 230, 0, ${alpha})`;
    ctx.fillText("CHECKPOINT!", cx, cy);
    // Inner crisp white-on-amber for a vector-tube hot core.
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 14;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.85})`;
    ctx.font = `${size * 0.94}px "Press Start 2P", monospace`;
    ctx.fillText("CHECKPOINT!", cx, cy);
    ctx.shadowBlur = 0;
  }

  function drawFinishOverlay() {
    const t = race.finishedT;
    const cx = W / 2, cy = H / 2;
    // Backdrop dim ramps in over 0.4s, holds, then fades out near the end.
    const backdropA = Math.min(1, t / 0.4) * (1 - Math.max(0, (t - (FINISH_OVERLAY_DURATION - 0.6)) / 0.6));
    ctx.fillStyle = `rgba(0, 0, 0, ${0.62 * backdropA})`;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const titleSize = Math.max(40, Math.min(112, W * 0.085));
    const lineSize  = Math.max(16, Math.min(34, W * 0.026));

    // Two phases — first the score breakdown, then the next-track callout.
    //   Phase 1: 0 → FINISH_SCORE_PHASE       (fade in 0.4s, hold, fade out 0.5s)
    //   Phase 2: FINISH_SCORE_PHASE → end     (fade in 0.4s, hold, fade out 0.5s)
    const fadeIn = 0.4, fadeOut = 0.5;
    const p1End = FINISH_SCORE_PHASE;
    const p2Start = FINISH_SCORE_PHASE - 0.2; // overlap a tick for crossfade
    const p2End = FINISH_OVERLAY_DURATION;

    let a1 = 0;
    if (t < p1End) {
      a1 = Math.min(1, t / fadeIn);
      a1 *= 1 - Math.max(0, (t - (p1End - fadeOut)) / fadeOut);
    }
    let a2 = 0;
    if (t > p2Start) {
      const tt = t - p2Start;
      a2 = Math.min(1, tt / fadeIn);
      a2 *= 1 - Math.max(0, (t - (p2End - fadeOut)) / fadeOut);
    }

    if (a1 > 0) {
      // Title: "FINISH!" with cyan + amber double glow.
      ctx.font = `${titleSize}px "Press Start 2P", monospace`;
      ctx.shadowColor = "#5cf0ff";
      ctx.shadowBlur = 32;
      ctx.fillStyle = `rgba(232, 255, 251, ${a1})`;
      ctx.fillText("FINISH!", cx, cy - titleSize * 1.1);

      // Score breakdown — base / + bonus / = total.
      ctx.font = `${lineSize}px "Press Start 2P", monospace`;
      ctx.shadowColor = "#5cf0ff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(232, 255, 251, ${a1})`;
      ctx.fillText("SCORE  " + fmt(race.finalBaseScore), cx, cy - lineSize * 0.4);

      ctx.shadowColor = "#ffe600";
      ctx.fillStyle = `rgba(255, 230, 0, ${a1})`;
      ctx.fillText("+ TIME BONUS  " + fmt(race.finalBonus), cx, cy + lineSize * 1.2);

      ctx.shadowColor = "#5cf0ff";
      ctx.shadowBlur = 22;
      ctx.fillStyle = `rgba(255, 255, 255, ${a1})`;
      ctx.fillText("=  " + fmt(race.finalScore), cx, cy + lineSize * 2.8);
    }

    if (a2 > 0) {
      // Phase 2: announce the next track.
      const nextNum = race.trackNum + 1;
      const nextName = trackNameFor(nextNum);
      const labelSize = Math.max(14, Math.min(22, W * 0.018));
      const numSize   = Math.max(28, Math.min(64, W * 0.05));
      const nameSize  = Math.max(26, Math.min(78, W * 0.058));

      ctx.font = `${labelSize}px "Press Start 2P", monospace`;
      ctx.shadowColor = "#5cf0ff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(92, 240, 255, ${a2 * 0.85})`;
      ctx.fillText("NEXT TRACK", cx, cy - nameSize * 0.95 - labelSize * 1.2);

      ctx.font = `${numSize}px "Press Start 2P", monospace`;
      ctx.shadowColor = "#ffe600";
      ctx.shadowBlur = 20;
      ctx.fillStyle = `rgba(255, 230, 0, ${a2})`;
      ctx.fillText(String(nextNum).padStart(2, "0"), cx, cy - nameSize * 0.55);

      ctx.font = `${nameSize}px "Press Start 2P", monospace`;
      ctx.shadowColor = "#5cf0ff";
      ctx.shadowBlur = 30;
      ctx.fillStyle = `rgba(255, 255, 255, ${a2})`;
      ctx.fillText(nextName, cx, cy + nameSize * 0.35);
    }

    ctx.shadowBlur = 0;
  }

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
      ctx.fillText(crashReason === "timeout" ? "TIME OVER" : "WIPEOUT", cx, cy - titleSize * 0.6);

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
  let _hudTimer = "", _hudTimerClass = "";
  let _hudStage = -2;  // -1 = finished, 0..2 active, -2 = unset
  let _hudTrackNum = -1;
  let _hudTrackName = "";
  function updateHUD() {
    const info = _frameTrackInfo || carTrackInfo();
    const spd = Math.floor(car.speed * 1.05);
    const dst = Math.floor(info.seg.s);
    // Score display priorities: explosion → frozen capture (already includes
    // runScoreAccum); race finished → accum + locked final; otherwise live
    // accum + (speed × dist for this track).
    let score;
    if (explosion.active)      score = explosion.finalScore;
    else if (race.finished)    score = runScoreAccum + race.finalScore;
    else                       score = runScoreAccum + Math.floor(car.speed * dst);

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

    // Race timer + urgency class.
    const tShown = race.finished
      ? "FIN"
      : race.timeLeft.toFixed(1).padStart(4, "0");
    if (tShown !== _hudTimer) {
      timerEl.textContent = tShown;
      _hudTimer = tShown;
    }
    let cls = "";
    if (!race.finished) {
      if (race.timeLeft < 5)       cls = "crit";
      else if (race.timeLeft < 10) cls = "warn";
    }
    if (cls !== _hudTimerClass) {
      timerEl.className = cls;
      _hudTimerClass = cls;
    }

    // Stage pip highlighting.
    const stageKey = race.finished ? -1 : race.stage;
    if (stageKey !== _hudStage) {
      for (let i = 0; i < pipEls.length; i++) {
        const el = pipEls[i];
        el.classList.remove("active", "done");
        if (race.finished || i < race.stage) el.classList.add("done");
        else if (i === race.stage)           el.classList.add("active");
      }
      _hudStage = stageKey;
    }

    // Track label (persists across stages; only changes between tracks).
    // Always visible — the canvas intro plays on top of it without hiding it.
    if (race.trackNum !== _hudTrackNum) {
      trackNumEl.textContent = String(race.trackNum).padStart(2, "0");
      _hudTrackNum = race.trackNum;
    }
    if (race.trackName !== _hudTrackName) {
      trackNameEl.textContent = race.trackName;
      _hudTrackName = race.trackName;
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

  // ───────────────────────────────────────────────────────────── loop
  ensureTrackTo(2400);

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
