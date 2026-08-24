// Test fanout: hai may chi trung MOT broker van phai noi duoc nhau.
// Chay: node test-net.js
const mqtt = require('mqtt');

const NS = 'sudokucoop/v3';
const CODE = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
const T_MSG = `${NS}/${CODE}/msg`;
const T_HOST = `${NS}/${CODE}/host`;

const B = {
  emqx: 'wss://broker.emqx.io:8084/mqtt',
  hive: 'wss://broker.hivemq.com:8884/mqtt',
  cn:   'wss://broker-cn.emqx.io:8084/mqtt'
};

let fail = 0;
const log = m => console.log(m);

function mk(url, tag) {
  return new Promise((res, rej) => {
    const c = mqtt.connect(url, {
      clientId: 'test_' + tag + Date.now() + Math.random().toString(36).slice(2, 5),
      clean: true, connectTimeout: 12000, reconnectPeriod: 0
    });
    const t = setTimeout(() => rej(new Error(tag + ' timeout')), 14000);
    c.on('connect', () => {
      c.subscribe([T_MSG, T_HOST], { qos: 1 }, err => {
        clearTimeout(t);
        if (err) rej(err); else res(c);
      });
    });
    c.on('error', e => { clearTimeout(t); rej(e); });
  });
}

// Mot "may": nhieu client toi nhieu broker, gui ra TAT CA, loc trung lap.
class Machine {
  constructor(name) { this.name = name; this.clients = []; this.got = []; this.seen = new Set(); }

  async connect(urls) {
    const rs = await Promise.allSettled(urls.map((u, i) => mk(u, this.name + i)));
    rs.forEach(r => { if (r.status === 'fulfilled') this.clients.push(r.value); });
    this.clients.forEach(c => c.on('message', (t, b) => {
      let m; try { m = JSON.parse(b.toString()); } catch { return; }
      if (t === T_HOST) { if (m.at) this.hostSeen = true; return; }
      if (m.from === this.name) return;
      if (m.id && this.seen.has(m.id)) return;   // da nhan qua broker khac
      if (m.id) this.seen.add(m.id);
      this.got.push(m);
    }));
    return this.clients.length;
  }

  send(type, payload) {
    const id = this.name + '-' + Math.random().toString(36).slice(2, 8);
    const body = JSON.stringify({ from: this.name, type, payload, id });
    this.clients.forEach(c => { if (c.connected) { try { c.publish(T_MSG, body, { qos: 1 }); } catch {} } });
  }

  announce() {
    const body = JSON.stringify({ from: this.name, at: Date.now() });
    this.clients.forEach(c => { if (c.connected) { try { c.publish(T_HOST, body, { retain: true, qos: 1 }); } catch {} } });
  }

  end() { this.clients.forEach(c => { try { c.end(true); } catch {} }); }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  log(`Phong test: ${CODE}\n`);

  // PC o nha: vao duoc ca 3 broker.
  const pc = new Machine('PC');
  const n1 = await pc.connect([B.emqx, B.hive, B.mosq]);
  log(`1. PC noi duoc ${n1}/3 broker`);
  if (n1 === 0) { log('   FAIL: khong noi duoc broker nao'); process.exit(1); }
  pc.announce();
  await wait(1500);

  // Tablet mang khac: GIA LAP bi chan, chi vao duoc 1 broker (mosquitto).
  // Day chinh la ca that bai cua ban truoc day.
  const tablet = new Machine('TABLET');
  const n2 = await tablet.connect([B.cn]);
  log(`2. Tablet (gia lap bi chan) noi duoc ${n2}/1 broker`);
  if (n2 === 0) { log('   FAIL: tablet khong noi duoc'); fail++; }
  await wait(2500);

  if (tablet.hostSeen) log('3. Tablet THAY phong du chi trung 1 broker OK');
  else { log('3. FAIL: tablet khong thay phong'); fail++; }

  // Tablet chao -> PC phai nhan (qua mosquitto)
  tablet.send('hello', { name: 'Tablet 4G' });
  await wait(2500);
  if (pc.got.some(m => m.type === 'hello')) log('4. PC nhan duoc loi chao tu tablet OK');
  else { log('4. FAIL: PC khong nhan duoc hello'); fail++; }

  // PC gui nuoc di -> tablet phai nhan, va CHI MOT LAN (khong trung lap)
  pc.send('move', { idx: 40, val: 7, notes: [] });
  await wait(2500);
  const moves = tablet.got.filter(m => m.type === 'move');
  if (moves.length === 1 && moves[0].payload.idx === 40) log('5. Tablet nhan nuoc di, khong trung lap OK');
  else { log(`5. FAIL: nhan ${moves.length} ban tin move (mong doi 1)`); fail++; }

  // Don retained -> phong khong con
  pc.clients.forEach(c => { try { c.publish(T_HOST, '', { retain: true, qos: 1 }); } catch {} });
  await wait(1200);
  const late = new Machine('LATE');
  await late.connect([B.mosq, B.emqx]);
  await wait(2500);
  if (!late.hostSeen) log('6. Host dong tab -> phong het OK');
  else { log('6. FAIL: phong van song'); fail++; }

  [pc, tablet, late].forEach(m => m.end());
  log(fail === 0 ? '\nOK — hai may trung 1 broker van choi duoc' : `\n${fail} test FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('LOI:', e.message); process.exit(1); });
