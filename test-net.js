// Test 2 client noi duoc nhau qua broker that: node test-net.js
// Can: npm i mqtt
const mqtt = require('mqtt');

const NS = 'sudokucoop/v2';
const CODE = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
const URL = 'wss://broker.emqx.io:8084/mqtt';
const T_MSG = `${NS}/${CODE}/msg`;
const T_HOST = `${NS}/${CODE}/host`;

let fail = 0;
const log = (m) => console.log(m);

function mk(id) {
  return new Promise((res, rej) => {
    const c = mqtt.connect(URL, { clientId: 'test_' + id + Date.now(), clean: true, connectTimeout: 10000 });
    const t = setTimeout(() => rej(new Error(id + ': connect timeout')), 12000);
    c.on('connect', () => { clearTimeout(t); res(c); });
    c.on('error', e => { clearTimeout(t); rej(e); });
  });
}

(async () => {
  log(`Phong test: ${CODE}`);

  // --- HOST vao truoc, dat retained flag ---
  const host = await mk('host');
  await new Promise(r => host.subscribe([T_MSG, T_HOST], { qos: 1 }, r));
  host.publish(T_HOST, JSON.stringify({ name: 'host', at: Date.now() }), { retain: true, qos: 1 });
  log('1. Host da tao phong');

  const hostGot = [];
  host.on('message', (t, b) => { try { hostGot.push(JSON.parse(b.toString())); } catch {} });

  await new Promise(r => setTimeout(r, 1200));

  // --- GUEST vao sau, phai nhan duoc tin retained ---
  const guest = await mk('guest');
  const guestGot = [];
  let sawRetained = false;
  guest.on('message', (t, b) => {
    let m; try { m = JSON.parse(b.toString()); } catch { return; }
    if (t === T_HOST && m.at) { sawRetained = true; return; }
    guestGot.push(m);
  });
  await new Promise(r => guest.subscribe([T_MSG, T_HOST], { qos: 1 }, r));
  await new Promise(r => setTimeout(r, 2500));

  if (sawRetained) log('2. Guest thay phong ton tai (tin retained) OK');
  else { log('2. FAIL: guest KHONG nhan duoc tin retained'); fail++; }

  // --- Guest chao, host phai nhan ---
  guest.publish(T_MSG, JSON.stringify({ from: 'guest', type: 'hello', payload: { name: 'Tablet' } }), { qos: 1 });
  await new Promise(r => setTimeout(r, 2000));
  if (hostGot.some(m => m.type === 'hello' && m.payload?.name === 'Tablet')) log('3. Host nhan duoc loi chao OK');
  else { log('3. FAIL: host khong nhan duoc hello. Nhan duoc: ' + JSON.stringify(hostGot)); fail++; }

  // --- Host gui nuoc di, guest phai nhan ---
  host.publish(T_MSG, JSON.stringify({ from: 'host', type: 'move', payload: { idx: 40, val: 7, notes: [] } }), { qos: 1 });
  await new Promise(r => setTimeout(r, 2000));
  const mv = guestGot.find(m => m.type === 'move');
  if (mv && mv.payload.idx === 40 && mv.payload.val === 7) log('4. Guest nhan duoc nuoc di OK');
  else { log('4. FAIL: guest khong nhan duoc move. Nhan duoc: ' + JSON.stringify(guestGot)); fail++; }

  // --- Host dong tab: don retained -> phong khong con "song" ---
  host.publish(T_HOST, '', { retain: true, qos: 1 });
  await new Promise(r => setTimeout(r, 1000));
  const late = await mk('late');
  let lateSaw = false;
  late.on('message', (t, b) => { try { if (t === T_HOST && JSON.parse(b.toString())?.at) lateSaw = true; } catch {} });
  await new Promise(r => late.subscribe([T_MSG, T_HOST], { qos: 1 }, r));
  await new Promise(r => setTimeout(r, 2500));
  if (!lateSaw) log('5. Sau khi host dong, phong khong con OK');
  else { log('5. FAIL: phong van "song" du host da dong'); fail++; }

  [host, guest, late].forEach(c => { try { c.end(true); } catch {} });
  log(fail === 0 ? '\nOK — 2 may noi duoc nhau qua broker' : `\n${fail} test FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('LOI:', e.message); process.exit(1); });
