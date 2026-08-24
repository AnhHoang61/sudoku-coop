// Do do tin cay tung broker: node test-brokers.js
// Chay N lan moi broker, dem ty le thanh cong va do tre.
const mqtt = require('mqtt');

const CANDIDATES = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt'
];

const ROUNDS = 3;

function probe(url) {
  return new Promise(res => {
    const t0 = Date.now();
    const topic = 'sudokucoop/probe/' + Math.random().toString(36).slice(2, 8);
    let c;
    try {
      c = mqtt.connect(url, {
        clientId: 'p_' + Math.random().toString(36).slice(2, 10),
        clean: true, connectTimeout: 10000, reconnectPeriod: 0
      });
    } catch (e) { return res({ ok: false, why: 'throw' }); }

    const done = v => { try { c.end(true); } catch {} res(v); };
    const t = setTimeout(() => done({ ok: false, why: 'timeout' }), 13000);

    c.on('connect', () => {
      c.subscribe(topic, { qos: 1 }, err => {
        if (err) { clearTimeout(t); return done({ ok: false, why: 'sub' }); }
        c.publish(topic, 'x', { qos: 1 });
      });
    });
    // Phai nhan lai duoc tin moi tinh la dung duoc.
    c.on('message', () => { clearTimeout(t); done({ ok: true, ms: Date.now() - t0 }); });
    c.on('error', e => { clearTimeout(t); done({ ok: false, why: (e.code || e.message || '?').toString().slice(0, 24) }); });
  });
}

(async () => {
  console.log(`Do ${ROUNDS} lan moi broker\n`);
  const rows = [];
  for (const url of CANDIDATES) {
    const rs = [];
    for (let i = 0; i < ROUNDS; i++) rs.push(await probe(url));
    const ok = rs.filter(r => r.ok);
    const lat = ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : 0;
    const why = rs.filter(r => !r.ok).map(r => r.why).join(',');
    rows.push({ url, rate: `${ok.length}/${ROUNDS}`, lat, why });
    console.log(`${ok.length}/${ROUNDS}  ${String(lat || '-').padStart(5)}ms  ${url}${why ? '   (' + why + ')' : ''}`);
  }
  const good = rows.filter(r => r.rate === `${ROUNDS}/${ROUNDS}`);
  console.log(`\nBroker on dinh 100%: ${good.length ? good.map(r => r.url).join('\n                     ') : 'KHONG CO'}`);
})();
