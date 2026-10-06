const fs = require("fs");
const path = require("path");

const gamePath = process.argv[2] || path.join(__dirname, "web", "game.js");
if (!fs.existsSync(gamePath)) {
  console.log("FAIL: game.js not found: " + gamePath);
  process.exit(1);
}

const noop = () => {};
const ctxStub = new Proxy({}, {
  get(t, prop) {
    if (prop === "createLinearGradient") return () => ({ addColorStop: noop });
    if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray([1, 2, 3, 4]) });
    if (typeof prop === "string" && !(prop in t)) return noop;
    return t[prop];
  },
  set(t, prop, v) { t[prop] = v; return true; }
});

function makeEl(id) {
  const handlers = {};
  return {
    id,
    handlers,
    style: {},
    textContent: "",
    classList: { add: noop, remove: noop },
    addEventListener(type, fn) { handlers[type] = fn; },
    removeEventListener: noop,
    getContext: () => ctxStub,
    width: 0,
    height: 0
  };
}

const els = {};
["score", "best", "combo", "hint", "menuBest", "overlay", "btnPull", "btnL", "btnR", "btnRel", "btnStart", "game"]
  .forEach((id) => { els[id] = makeEl(id); });

let rafCb = null;
let virtualTime = 0;

global.window = {
  innerWidth: 800,
  innerHeight: 400,
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop
};
global.document = {
  getElementById: (id) => els[id] || makeEl(id),
  addEventListener: noop,
  body: {}
};
global.localStorage = { getItem: () => null, setItem: noop };
global.performance = { now: () => virtualTime };
global.requestAnimationFrame = (cb) => { rafCb = cb; };

let src = fs.readFileSync(gamePath, "utf8");
src = src.replace(
  /\}\)\(\);\s*$/,
  "global.__state = { P: P, input: input, get score() { return score; }, get combo() { return combo; }, get mode() { return mode; }, get best() { return best; }, bars: { x: barX, Y: BAR_Y, L: L } };\n})();"
);
eval(src);

const S = global.__state;
const P = S.P;
const GROUND = 1000;
const FOOT = 60;

function fire(el, type) {
  const fn = el.handlers[type];
  if (!fn) throw new Error("no handler " + el.id + "." + type);
  fn({ preventDefault: noop, type });
}

function run(n, dt) {
  dt = dt || 16.7;
  for (let i = 0; i < n; i++) {
    virtualTime += dt;
    const cb = rafCb;
    rafCb = null;
    if (cb) cb(virtualTime);
  }
}

function maxTheta(n) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    run(1);
    m = Math.max(m, Math.abs(P.theta));
  }
  return m;
}

const results = [];
function check(name, cond, info) {
  results.push((cond ? "PASS" : "FAIL") + ": " + name + (info ? " [" + info + "]" : ""));
}

check("menu mode", S.mode === "menu");
fire(els.btnStart, "click");
check("play mode", S.mode === "play");
check("start hang pos", P.phase === "hang" && P.x === 200 && Math.round(P.y) === 820,
  P.phase + " " + Math.round(P.x) + "," + Math.round(P.y));

run(30);
check("pendulum swings", Math.abs(P.theta) > 0.05 || Math.abs(P.omega) !== 1.1,
  "theta=" + P.theta.toFixed(3) + " omega=" + P.omega.toFixed(3));

const idleAmp = maxTheta(60);
fire(els.btnPull, "pointerdown");
const pumpAmp = maxTheta(300);
fire(els.btnPull, "pointerup");
check("pump builds amplitude", pumpAmp > Math.max(idleAmp * 1.6, 1.0),
  "idle=" + idleAmp.toFixed(2) + " pumped=" + pumpAmp.toFixed(2));

const omegaBefore = P.omega;
fire(els.btnRel, "pointerdown");
check("release -> fly", P.phase === "fly", "phase=" + P.phase + " omega=" + omegaBefore.toFixed(2));
check("release velocity", Math.abs(P.vx) > 50 || Math.abs(P.vy) > 50,
  "v=" + Math.round(P.vx) + "," + Math.round(P.vy));
check("release is not hanging", P.phase !== "hang");

fire(els.btnPull, "pointerdown");
const phi0 = P.phi;
run(90);
check("tuck spins", Math.abs(P.phi - phi0) > 2, "dphi=" + (P.phi - phi0).toFixed(2));
check("flip counted", Math.abs(P.rotAccum) > Math.PI * 2, "rotAccum=" + P.rotAccum.toFixed(2));
fire(els.btnPull, "pointerup");

let landed = "none";
for (let i = 0; i < 600; i++) {
  run(1);
  if (P.phase === "stand" || P.phase === "crash") { landed = P.phase; break; }
}
check("falls to ground", landed !== "none", landed);

let backHang = false;
for (let i = 0; i < 400; i++) {
  run(1);
  if (P.phase === "hang") { backHang = true; break; }
}
check("respawns hanging", backHang, "phase=" + P.phase);

const scoreBefore = S.score;
P.phase = "fly";
P.x = 300;
P.y = GROUND - FOOT - 120;
P.vx = 0;
P.vy = 300;
P.phi = 0.05;
P.spin = 1;
P.tuck = 0;
P.rotAccum = 0;
P.grabCd = 0;
run(60);
check("clean landing sticks", P.phase === "stand", "phase=" + P.phase);
check("clean landing scores", S.score >= scoreBefore + 150, "score=" + S.score);

P.phase = "fly";
P.x = 320;
P.y = GROUND - FOOT - 150;
P.vx = 400;
P.vy = 300;
P.phi = 1.6;
P.spin = 12;
P.tuck = 1;
P.grabCd = 0;
run(60);
check("bad landing crashes", P.phase === "crash", "phase=" + P.phase);
check("crash resets combo", S.combo === 0, "combo=" + S.combo);

for (let i = 0; i < 400 && P.phase !== "hang"; i++) run(1);
check("respawns after crash", P.phase === "hang", "phase=" + P.phase);

const scoreBeforeGrab = S.score;
P.phase = "fly";
P.x = S.bars.x(1);
P.y = S.bars.Y + S.bars.L;
P.phi = 0;
P.vx = 0;
P.vy = 0;
P.grabCd = 0;
P.tuck = 0;
P.rotAccum = Math.PI * 4;
run(3);
check("regrab next bar", P.phase === "hang" && P.barIdx === 1, "phase=" + P.phase + " bar=" + P.barIdx);
check("regrab scores flips", S.score > scoreBeforeGrab, "score=" + S.score + " combo=" + S.combo);

P.phase = "fly";
P.x = S.bars.x(3);
P.y = S.bars.Y + S.bars.L - 5;
P.phi = 0.4;
P.vx = 0;
P.vy = 0;
P.grabCd = 0;
P.tuck = 0;
run(3);
check("regrab while tilted", P.phase === "hang" && P.barIdx === 3, "phase=" + P.phase + " bar=" + P.barIdx);

console.log(results.join("\n"));
console.log(results.some((r) => r.startsWith("FAIL")) ? "RESULT: FAIL" : "RESULT: ALL PASS");
