"use strict";

(function () {
  var TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  var GROUND = 1000;
  var BAR_Y = GROUND - 320;
  var L = 140;
  var SPACING = 380;
  var BAR_X0 = 200;
  var BAR_HALF = 70;
  var GRAB_R = 45;
  var MAX_W = 6.5;
  var GRAV = 1300;
  var FOOT = 60;
  var HEAD_R = 14;
  var REACH_OPEN = 115;
  var REACH_TUCK = 50;

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, dpr = 1;
  var scale = 1, visW = 0, visH = 0, camX = 0, camY = 0, baseCamY = 0;

  var elScore = document.getElementById("score");
  var elBest = document.getElementById("best");
  var elCombo = document.getElementById("combo");
  var elHint = document.getElementById("hint");
  var elMenuBest = document.getElementById("menuBest");
  var overlay = document.getElementById("overlay");

  var mode = "menu";
  var score = 0;
  var combo = 0;
  var furthest = -1;
  var best = 0;

  try { best = parseInt(localStorage.getItem("turnik_best") || "0", 10) || 0; } catch (e) { best = 0; }

  var input = { pull: false, twistL: false, twistR: false };

  var P = {
    phase: "hang",
    x: 0, y: 0, vx: 0, vy: 0,
    theta: 0, omega: 0,
    phi: 0, spin: 0, tuck: 0,
    rotAccum: 0, barIdx: 0,
    timer: 0, alpha: 1, bounced: false, grabCd: 0
  };

  var floats = [];
  var parts = [];
  var clouds = [];
  var camInit = false;

  for (var ci = 0; ci < 40; ci++) {
    clouds.push({
      x: Math.random() * 12000 - 500,
      y: 60 + Math.random() * 320,
      s: 0.5 + Math.random() * 1.1
    });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  resize();

  function updateView() {
    scale = Math.min(W / 640, H / 460);
    visW = W / scale;
    visH = H / scale;
    baseCamY = GROUND + 40 - visH;
  }

  function barX(i) { return BAR_X0 + i * SPACING; }

  function normAngle(a) {
    a = a % TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  }

  function flipWord(n) {
    var d = n % 10, dd = n % 100;
    if (d === 1 && dd !== 11) return "флип";
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "флипа";
    return "флипов";
  }

  function loadBest() { return best; }

  function saveBest() {
    if (score > best) {
      best = score;
      try { localStorage.setItem("turnik_best", String(best)); } catch (e) {}
    }
  }

  function addFloat(x, y, text, color) {
    floats.push({ x: x, y: y, text: text, color: color, life: 1.3 });
  }

  function burst(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var sp = 60 + Math.random() * 260;
      parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 90,
        life: 0.5 + Math.random() * 0.5,
        color: color,
        r: 2 + Math.random() * 3
      });
    }
  }

  function startHang(idx) {
    if (idx < 0) idx = 0;
    P.phase = "hang";
    P.barIdx = idx;
    P.x = barX(idx);
    P.y = BAR_Y + L;
    P.theta = 0;
    P.omega = 1.1;
    P.phi = 0;
    P.spin = 0;
    P.tuck = 0;
    P.rotAccum = 0;
    P.vx = 0;
    P.vy = 0;
    P.alpha = 1;
    P.bounced = false;
    P.grabCd = 0;
    P.timer = 0;
  }

  function reset() {
    score = 0;
    combo = 0;
    furthest = -1;
    floats.length = 0;
    parts.length = 0;
    startHang(0);
  }

  function awardFlips() {
    var f = Math.floor((Math.abs(P.rotAccum) + 0.02) / TAU);
    if (f > 0) {
      var mult = Math.max(1, combo);
      var pts = f * 100 * mult;
      score += pts;
      addFloat(P.x, P.y - 70, "+" + pts, "#fde047");
    }
    P.rotAccum = 0;
    return f;
  }

  function doRelease() {
    if (mode !== "play" || P.phase !== "hang") return;
    var boost = input.pull ? 1.08 : 1;
    P.vx = L * P.omega * Math.cos(P.theta) * boost;
    P.vy = -L * P.omega * Math.sin(P.theta) * boost;
    P.phase = "fly";
    P.spin = -P.omega;
    P.phi = -P.theta;
    P.rotAccum = 0;
    P.tuck = 0;
    P.grabCd = 0.35;
  }

  function grab(i) {
    var bx = barX(i);
    var dx = P.x - bx, dy = P.y - BAR_Y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 20) { dx = 0; dy = L; d = L; }
    var nx = dx / d, ny = dy / d;
    P.x = bx + nx * L;
    P.y = BAR_Y + ny * L;
    P.theta = Math.atan2(nx, ny);
    P.omega = clamp((P.vx * Math.cos(P.theta) - P.vy * Math.sin(P.theta)) / L, -MAX_W, MAX_W);
    P.phase = "hang";
    P.barIdx = i;
    P.tuck = 0;
    P.spin = 0;
    P.phi = -P.theta;
    P.vx = 0;
    P.vy = 0;
    P.grabCd = 0.25;
    var f = awardFlips();
    if (f > 0) {
      combo++;
      addFloat(P.x, P.y - 80, "ХВАТ! " + f + " " + flipWord(f), "#fde047");
    }
    saveBest();
  }

  function stick() {
    P.phase = "stand";
    P.phi = 0;
    P.y = GROUND - FOOT;
    P.vx = 0; P.vy = 0; P.spin = 0;
    P.tuck = 0;
    P.timer = 1.1;
    var f = awardFlips();
    score += 150;
    if (f > 0) {
      combo++;
      addFloat(P.x, P.y - 90, "ЧИСТО! " + f + " " + flipWord(f) + " +150", "#86efac");
    } else {
      addFloat(P.x, P.y - 90, "ЧИСТО! +150", "#86efac");
    }
    burst(P.x, GROUND, 18, "#86efac");
    saveBest();
  }

  function crash() {
    P.phase = "crash";
    P.timer = 1.5;
    P.bounced = false;
    combo = 0;
    P.spin = (Math.random() * 2 - 1) * 10;
    addFloat(P.x, P.y - 70, "УПАЛ!", "#f87171");
    burst(P.x, GROUND, 14, "#fca5a5");
    saveBest();
  }

  function respawn() {
    var i = Math.round((P.x - BAR_X0) / SPACING);
    if (i < 0) i = 0;
    startHang(i);
  }

  function manualRespawn() {
    if (mode !== "play") return;
    respawn();
  }

  function checkGrab() {
    var r = lerp(REACH_OPEN, REACH_TUCK, P.tuck);
    var hx = P.x + r * Math.sin(P.phi);
    var hy = P.y - r * Math.cos(P.phi);
    var i0 = Math.floor((hx - BAR_X0 - BAR_HALF) / SPACING);
    var i1 = Math.ceil((hx - BAR_X0 + BAR_HALF) / SPACING);
    if (i0 < 0) i0 = 0;
    for (var i = i0; i <= i1; i++) {
      var bx = barX(i);
      var cx = clamp(hx, bx - BAR_HALF, bx + BAR_HALF);
      var dx = hx - cx, dy = hy - BAR_Y;
      if (dx * dx + dy * dy <= GRAB_R * GRAB_R) { grab(i); return; }
    }
  }

  function update(dt) {
    var i;
    for (i = floats.length - 1; i >= 0; i--) {
      floats[i].life -= dt;
      floats[i].y -= 42 * dt;
      if (floats[i].life <= 0) floats.splice(i, 1);
    }
    for (i = parts.length - 1; i >= 0; i--) {
      var pt = parts[i];
      pt.life -= dt;
      pt.vy += GRAV * 0.7 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.life <= 0) parts.splice(i, 1);
    }

    if (mode !== "play") return;

    P.grabCd = Math.max(0, P.grabCd - dt);

    if (P.phase === "hang") {
      if (input.pull) {
        var dir = P.omega >= 0 ? 1 : -1;
        P.omega += dir * 4.2 * dt;
      }
      P.omega += -(GRAV / L) * Math.sin(P.theta) * dt;
      if (!input.pull) P.omega *= (1 - Math.min(1, 0.25 * dt));
      P.omega = clamp(P.omega, -MAX_W, MAX_W);
      P.theta += P.omega * dt;
      P.x = barX(P.barIdx) + L * Math.sin(P.theta);
      P.y = BAR_Y + L * Math.cos(P.theta);
      P.phi = -P.theta;
      P.tuck = 0;
    } else if (P.phase === "fly") {
      P.vy += GRAV * dt;
      P.x += P.vx * dt;
      P.y += P.vy * dt;

      var t = input.pull ? 1 : 0;
      P.tuck += (t - P.tuck) * clamp(dt * 10, 0, 1);
      if (input.pull) P.spin *= (1 + 3.2 * dt);
      else P.spin *= (1 - 0.9 * dt);
      if (input.twistL) P.spin -= 16 * dt;
      if (input.twistR) P.spin += 16 * dt;
      P.spin = clamp(P.spin, -22, 22);
      P.phi += P.spin * dt;
      P.rotAccum += P.spin * dt;

      if (P.grabCd <= 0) checkGrab();

      if (P.phase === "fly") {
        var fy = P.y + FOOT * Math.cos(P.phi);
        if (fy >= GROUND && P.vy > 0) {
          var a = normAngle(P.phi);
          var upright = Math.cos(a) > 0.78;
          var okSpeed = Math.abs(P.spin) < 7.5;
          if (upright && okSpeed) stick();
          else crash();
        }
        if (P.x < -400 || P.y > GROUND + 400) crash();
      }
    } else if (P.phase === "crash") {
      P.vy += GRAV * dt;
      P.x += P.vx * dt;
      P.y += P.vy * dt;
      P.phi += P.spin * dt;
      P.vx *= (1 - 1.4 * dt);
      var cy = P.y + FOOT * Math.cos(P.phi);
      if (cy >= GROUND && P.vy > 0) {
        if (!P.bounced) {
          P.bounced = true;
          burst(P.x, GROUND, 12, "#d6d3d1");
        }
        P.y -= (cy - GROUND);
        P.vy *= -0.32;
        P.vx *= 0.55;
        P.spin *= 0.5;
        if (Math.abs(P.vy) < 70) P.vy = 0;
      }
      P.timer -= dt;
      if (P.timer < 0.6) P.alpha = Math.max(0, P.timer / 0.6);
      if (P.timer <= 0) respawn();
    } else if (P.phase === "stand") {
      P.timer -= dt;
      if (P.timer <= 0) respawn();
    }

    var fi = Math.floor((P.x - BAR_X0 - 40) / SPACING);
    if (fi > furthest) {
      if (furthest >= 0 && fi >= 0) {
        score += 50;
        addFloat(P.x, P.y - 50, "+50", "#86efac");
      }
      furthest = fi;
      saveBest();
    }
  }

  function limb(ax, ay, bx, by, cx, cy, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.stroke();
  }

  function drawFigure() {
    var t = P.tuck;
    if (P.phase === "hang" || P.phase === "stand") t = 0;

    var reach;
    if (P.phase === "hang") reach = L;
    else reach = lerp(REACH_OPEN, REACH_TUCK, t);

    var kneeX = lerp(5, 17, t);
    var kneeY = lerp(31, 21, t);
    var footX = lerp(7, 15, t);
    var footY = lerp(FOOT, 4, t);

    if (P.phase === "stand") {
      kneeX = 0; footX = 0; kneeY = 30; footY = FOOT;
    }
    if (P.phase === "hang") {
      kneeX = 8; footX = 15; kneeY = 32; footY = 57;
    }

    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(P.phi);
    ctx.globalAlpha = P.alpha;

    limb(0, 0, -kneeX, kneeY, -footX, footY, 7, "#0f172a");
    limb(0, 0, kneeX, kneeY, footX, footY, 7, "#0f172a");

    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(0, 0);
    ctx.stroke();

    limb(0, -30, -7, (-30 - reach) / 2, -4, -reach, 6, "#0f172a");
    limb(0, -30, 7, (-30 - reach) / 2, 4, -reach, 6, "#0f172a");

    ctx.fillStyle = "#fed7aa";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -52, HEAD_R, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawBar(i) {
    var bx = barX(i);
    ctx.fillStyle = "#475569";
    ctx.fillRect(bx - BAR_HALF - 6, BAR_Y, 8, GROUND - BAR_Y);
    ctx.fillRect(bx + BAR_HALF - 2, BAR_Y, 8, GROUND - BAR_Y);
    ctx.fillStyle = "#334155";
    ctx.fillRect(bx - BAR_HALF - 16, GROUND - 14, 34, 14);
    ctx.fillRect(bx + BAR_HALF - 18, GROUND - 14, 34, 14);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(bx - BAR_HALF - 14, BAR_Y - 5, BAR_HALF * 2 + 28, 10);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(bx - BAR_HALF - 14, BAR_Y - 5, BAR_HALF * 2 + 28, 4);
  }

  function draw() {
    updateView();

    var camTarget = P.x - visW * 0.38;
    if (camTarget < -70) camTarget = -70;
    var camYTarget = Math.min(baseCamY, P.y - visH * 0.4);
    if (!camInit) {
      camX = camTarget;
      camY = camYTarget;
      camInit = true;
    } else {
      camX += (camTarget - camX) * 0.12;
      camY += (camYTarget - camY) * 0.1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var sky = ctx.createLinearGradient(0, 0, 0, H * dpr);
    sky.addColorStop(0, "#38bdf8");
    sky.addColorStop(0.55, "#7dd3fc");
    sky.addColorStop(1, "#e0f2fe");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sunX = W * 0.82, sunY = H * 0.16;
    ctx.fillStyle = "rgba(255,241,150,0.9)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.min(W, H) * 0.07, 0, TAU);
    ctx.fill();

    for (var ci = 0; ci < clouds.length; ci++) {
      var c = clouds[ci];
      var sx = (c.x - camX * 0.5) * scale;
      var sy = (c.y - camY * 0.75) * scale;
      if (sx < -260 || sx > W + 260) continue;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      var cs = 26 * c.s * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, cs, 0, TAU);
      ctx.arc(sx + cs * 1.1, sy + cs * 0.2, cs * 0.8, 0, TAU);
      ctx.arc(sx - cs * 1.1, sy + cs * 0.25, cs * 0.7, 0, TAU);
      ctx.arc(sx + cs * 0.2, sy - cs * 0.6, cs * 0.75, 0, TAU);
      ctx.fill();
    }

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -camX * scale * dpr, -camY * scale * dpr);

    ctx.fillStyle = "#4ade80";
    ctx.fillRect(camX - 200, GROUND, visW + 400, 26);
    ctx.fillStyle = "#15803d";
    ctx.fillRect(camX - 200, GROUND + 26, visW + 400, 400);
    ctx.fillStyle = "#166534";
    for (var gx = Math.floor((camX - 200) / 60) * 60; gx < camX + visW + 200; gx += 60) {
      ctx.fillRect(gx, GROUND + 40, 30, 8);
    }

    var i0 = Math.floor((camX - BAR_X0 - BAR_HALF) / SPACING) - 1;
    var i1 = Math.ceil((camX + visW - BAR_X0 + BAR_HALF) / SPACING) + 1;
    if (i0 < 0) i0 = 0;
    for (var i = i0; i <= i1; i++) drawBar(i);

    var shadowA = clamp(1 - (GROUND - P.y) / 700, 0, 0.35);
    ctx.fillStyle = "rgba(2,20,10," + shadowA + ")";
    ctx.beginPath();
    ctx.ellipse(P.x, GROUND + 8, 34, 8, 0, 0, TAU);
    ctx.fill();

    drawFigure();

    for (var pi = 0; pi < parts.length; pi++) {
      var pp = parts[pi];
      ctx.globalAlpha = clamp(pp.life * 2, 0, 1);
      ctx.fillStyle = pp.color;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, pp.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.font = "700 26px system-ui, sans-serif";
    for (var fi = 0; fi < floats.length; fi++) {
      var f = floats[fi];
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = f.color;
      ctx.strokeStyle = "rgba(2,6,23,0.65)";
      ctx.lineWidth = 5;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function updateHud() {
    elScore.textContent = String(score);
    elBest.textContent = "Рекорд: " + best;
    if (combo >= 2) {
      elCombo.style.display = "block";
      elCombo.textContent = "x" + combo;
    } else {
      elCombo.style.display = "none";
    }

    var hint = "";
    if (mode === "play") {
      if (P.phase === "hang") {
        hint = Math.abs(P.omega) < 1.6
          ? "Держи ТЯНИ, чтобы раскачаться"
          : "Жми ОТПУСТИ в нужный момент";
      } else if (P.phase === "fly") {
        hint = "ТЯНИ — сальто · ↺ ↻ — докрутка · лови турник или приземляйся";
      } else if (P.phase === "stand") {
        hint = "Чисто!";
      } else if (P.phase === "crash") {
        hint = "Упс... возрождение";
      }
    }
    if (elHint.textContent !== hint) elHint.textContent = hint;
    elMenuBest.textContent = "Рекорд: " + best;
  }

  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    var steps = dt > 0.025 ? 2 : 1;
    for (var s = 0; s < steps; s++) update(dt / steps);
    draw();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function setKey(k, down) {
    if (k in input) input[k] = down;
  }

  function bindHold(el, k) {
    if (!el) return;
    var on = function (e) { e.preventDefault(); setKey(k, true); el.classList.add("on"); };
    var off = function (e) {
      if (e) e.preventDefault();
      setKey(k, false);
      el.classList.remove("on");
    };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("pointerleave", off);
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  bindHold(document.getElementById("btnPull"), "pull");
  bindHold(document.getElementById("btnL"), "twistL");
  bindHold(document.getElementById("btnR"), "twistR");

  var btnRel = document.getElementById("btnRel");
  btnRel.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    doRelease();
    btnRel.classList.add("on");
  });
  btnRel.addEventListener("pointerup", function () { btnRel.classList.remove("on"); });
  btnRel.addEventListener("pointercancel", function () { btnRel.classList.remove("on"); });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
    }
    if (e.repeat) return;
    switch (e.code) {
      case "Space":
      case "KeyW":
      case "ArrowUp":
        setKey("pull", true); break;
      case "KeyS":
      case "ArrowDown":
      case "Enter":
        doRelease(); break;
      case "ArrowLeft":
      case "KeyA":
        setKey("twistL", true); break;
      case "ArrowRight":
      case "KeyD":
        setKey("twistR", true); break;
      case "KeyR":
        manualRespawn(); break;
    }
  });

  window.addEventListener("keyup", function (e) {
    switch (e.code) {
      case "Space":
      case "KeyW":
      case "ArrowUp":
        setKey("pull", false); break;
      case "ArrowLeft":
      case "KeyA":
        setKey("twistL", false); break;
      case "ArrowRight":
      case "KeyD":
        setKey("twistR", false); break;
    }
  });

  window.addEventListener("blur", function () {
    input.pull = false;
    input.twistL = false;
    input.twistR = false;
  });

  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  document.getElementById("btnStart").addEventListener("click", function () {
    overlay.classList.add("hidden");
    mode = "play";
    reset();
    last = performance.now();
  });

  startHang(0);
  updateView();
  camX = 0;
})();
