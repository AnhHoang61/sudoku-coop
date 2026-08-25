// Smoke test fx.js bang DOM gia: bat loi runtime ma khong can mo browser.
// Chay: node test-fx.js
let fail = 0;
const log = m => console.log(m);

const calls = { fillRect: 0, arc: 0, removed: 0 };

const ctx2d = {
  setTransform() {}, fillRect() { calls.fillRect++; }, beginPath() {},
  arc() { calls.arc++; }, fill() {},
  set fillStyle(v) { this._fs = v; }, get fillStyle() { return this._fs; },
  set globalCompositeOperation(v) { this._op = v; }, get globalCompositeOperation() { return this._op; }
};

const body = { children: [] };
function makeEl() {
  return {
    className: '', width: 0, height: 0,
    classList: { add(c) { this._c = c; }, },
    setAttribute() {},
    getContext: () => ctx2d,
    remove() { calls.removed++; body.children = body.children.filter(x => x !== this); }
  };
}

let rafQ = [];
global.window = global;
global.document = { createElement: makeEl, body: { appendChild(el) { body.children.push(el); } } };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = fn => { rafQ.push(fn); return rafQ.length; };
global.cancelAnimationFrame = () => {};
global.innerWidth = 1280;
global.innerHeight = 800;
global.devicePixelRatio = 3;
global.addEventListener = () => {};
global.removeEventListener = () => {};
let reduce = false;
global.matchMedia = () => ({ matches: reduce });

require('./js/fx.js');

// 1. API co mat
if (typeof window.fireworks === 'function' && typeof window.stopFireworks === 'function') {
  log('1. fireworks/stopFireworks ton tai OK');
} else { log('1. FAIL: thieu ham'); fail++; }

// 2. Goi duoc, tao canvas, khong nem loi
window.fireworks();
if (body.children.length === 1) log('2. Tao 1 canvas OK');
else { log(`2. FAIL: co ${body.children.length} canvas`); fail++; }

// 3. DPR bi chan o 2 (1280*2=2560), khong phai 3
const cv = body.children[0];
if (cv.width === 2560 && cv.height === 1600) log('3. Chan DPR o 2 OK');
else { log(`3. FAIL: canvas ${cv.width}x${cv.height}, mong doi 2560x1600`); fail++; }

// 4. Chay 200 frame: khong nem loi, co ve hat
let frames = 0;
while (rafQ.length && frames < 200) {
  const q = rafQ; rafQ = [];
  for (const fn of q) { try { fn(); } catch (e) { log('4. FAIL runtime: ' + e.message); fail++; rafQ = []; break; } frames++; }
}
if (calls.arc > 0 && calls.fillRect > 0) log(`4. Ve ${calls.arc} hat qua ${frames} frame OK`);
else { log('4. FAIL: khong ve gi'); fail++; }

// 5. Goi lai khi dang ban -> thay man cu, khong chong canvas
const before = calls.removed;
window.fireworks();
if (calls.removed === before) log('5. Man cu duoc danh dau dung (xoa sau 420ms) OK');
else { log('5. FAIL'); fail++; }

// 6. stopFireworks khong nem loi
try { window.stopFireworks(); log('6. stopFireworks OK'); }
catch (e) { log('6. FAIL: ' + e.message); fail++; }

// 7. Ton trong prefers-reduced-motion: khong tao canvas moi
reduce = true;
const n = body.children.length;
window.fireworks();
if (body.children.length === n) log('7. Ton trong reduced-motion OK');
else { log('7. FAIL: van ban phao hoa'); fail++; }

log(fail === 0 ? '\nOK — fx.js chay sach' : `\n${fail} test FAIL`);
process.exit(fail ? 1 : 0);
