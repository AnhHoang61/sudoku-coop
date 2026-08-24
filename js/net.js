/* Lop mang cho Sudoku Co-op — relay qua MQTT over WebSocket (WSS 443).
 *
 * Vi sao khong dung WebRTC/P2P: WebRTC phai "duc" NAT giua hai may. Tablet
 * dung 4G hoac WiFi nha mang chat la that bai, va that bai im lang. Muon chac
 * an thi phai co TURN server rieng.
 *
 * Cach nay: ca hai may deu mo ket noi RA NGOAI toi broker cong khai qua cong
 * 443 — giong nhu mo mot trang web https. Mang nao cung cho di. Chi can hai
 * may online la noi duoc nhau.
 *
 * Doi lai: tin nhan di qua broker cong cong. Ma phong la thu duy nhat bao ve
 * ban choi — nguoi ngoai biet ma thi doc duoc nuoc di. Voi Sudoku thi khong
 * sao, nhung dung dung co che nay cho du lieu rieng tu.
 */
(function (global) {
  'use strict';

  const NS = 'sudokucoop/v2';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bo I,O,0,1 cho de doc

  // Broker du phong: het cai nay thi thu cai ke tiep.
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

  const HEARTBEAT_MS = 6000;   // nhip bao "toi con day"
  const PEER_TIMEOUT_MS = 22000; // khong nghe gi qua nguong nay -> coi nhu roi phong
  const JOIN_TIMEOUT_MS = 20000;

  function makeCode(len = 6) {
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  }

  function randId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  class Net {
    constructor() {
      this.client = null;
      this.isHost = false;
      this.roomCode = null;
      this.myId = randId();
      this.handlers = {};
      this._events = {};
      this._peers = new Map();   // peerId -> { lastSeen }
      this._timers = [];
      this._brokerIdx = 0;
      this._closed = false;
    }

    on(type, fn) { this.handlers[type] = fn; return this; }
    onEvent(name, fn) { (this._events[name] ||= []).push(fn); return this; }
    _emit(name, ...args) { (this._events[name] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } }); }

    get connected() { return this._peers.size > 0; }
    get online() { return !!(this.client && this.client.connected); }

    get _tMsg() { return `${NS}/${this.roomCode}/msg`; }
    get _tHost() { return `${NS}/${this.roomCode}/host`; }

    host(code) {
      this.isHost = true;
      this.roomCode = code || makeCode();
      return this._connect().then(() => {
        // Retained: may vao sau se nhan duoc ngay, biet phong co that.
        this._pub(this._tHost, { name: 'host', at: Date.now() }, { retain: true, qos: 1 });
        this._startHeartbeat();
        return this.roomCode;
      });
    }

    join(code) {
      this.isHost = false;
      this.roomCode = String(code || '').trim().toUpperCase();
      if (!/^[A-Z2-9]{4,8}$/.test(this.roomCode)) {
        return Promise.reject(new Error('Mã phòng không hợp lệ. Mã gồm 6 ký tự chữ và số.'));
      }

      return this._connect().then(() => new Promise((resolve, reject) => {
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this._startHeartbeat();
          resolve(this.roomCode);
          // Guest phai chao truoc, khong thi deadlock: host doi 'hello',
          // guest doi host gui gi do. wire.js goi send('hello') ngay sau await.
        };

        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error('Không thấy phòng này. Kiểm tra lại mã, hoặc máy tạo phòng đã đóng tab.'));
        }, JOIN_TIMEOUT_MS);

        this._onHostSeen = finish;
        // Tin retained co the da toi truoc khi handler nay duoc gan.
        if (this._hostSeen) finish();
      }));
    }

    _connect() {
      return new Promise((resolve, reject) => {
        if (typeof mqtt === 'undefined') {
          reject(new Error('Chưa tải được thư viện mạng. Kiểm tra kết nối internet rồi tải lại trang.'));
          return;
        }

        const tryBroker = (idx) => {
          if (idx >= BROKERS.length) {
            reject(new Error('Không nối được tới server. Kiểm tra internet, hoặc mạng đang chặn WebSocket.'));
            return;
          }
          const url = BROKERS[idx];
          this._brokerIdx = idx;

          const client = mqtt.connect(url, {
            clientId: 'sdk_' + this.myId,
            clean: true,
            connectTimeout: 8000,
            reconnectPeriod: 3000,
            keepalive: 30,
            // Broker tu bao ho khi tab dong dot ngot.
            will: {
              topic: `${NS}/${this.roomCode}/msg`,
              payload: JSON.stringify({ from: this.myId, type: 'bye', payload: {} }),
              qos: 0
            }
          });

          let settled = false;

          const failover = () => {
            if (settled) return;
            settled = true;
            try { client.end(true); } catch { /* ignore */ }
            tryBroker(idx + 1);
          };

          const guard = setTimeout(failover, 9000);

          // Phai dang ky lai topic o MOI lan connect. clean:true nen sau khi
          // mang chop, broker khong nho subscription cu -> tin nhan im lang
          // khong toi nua neu chi subscribe o lan connect dau.
          client.on('connect', () => {
            clearTimeout(guard);
            this.client = client;
            const first = !settled;
            settled = true;

            client.subscribe([this._tMsg, this._tHost], { qos: 1 }, err => {
              if (err) {
                if (first) reject(new Error('Không vào được phòng: ' + err.message));
                return;
              }
              if (first) {
                resolve();
              } else {
                // Host phai dat lai co retained: co the da bi don khi mat ket noi.
                if (this.isHost) this._pub(this._tHost, { name: 'host', at: Date.now() }, { retain: true, qos: 1 });
                this._emit('reconnected');
              }
            });
          });

          client.on('error', err => {
            if (!settled) { clearTimeout(guard); failover(); return; }
            console.warn('[net] mqtt error', err);
            this._emit('error', { type: 'network', message: err?.message });
          });

          client.on('message', (topic, buf) => this._onMessage(topic, buf));

          client.on('reconnect', () => this._emit('reconnecting'));
          client.on('close', () => { if (!this._closed) this._emit('offline'); });

          client.on('offline', () => this._emit('offline'));
        };

        tryBroker(0);
      });
    }

    _onMessage(topic, buf) {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      // Tin retained cua host: xac nhan phong ton tai.
      // Payload rong = host da don retained flag khi dong tab -> phong khong con.
      if (topic === this._tHost) {
        if (!msg || !msg.at) return;
        this._hostSeen = true;
        if (!this.isHost && this._onHostSeen) this._onHostSeen();
        return;
      }

      const from = msg.from;
      if (!from || from === this.myId) return;   // bo qua tin cua chinh minh

      if (msg.type === 'bye') { this._dropPeer(from); return; }

      const known = this._peers.has(from);
      this._peers.set(from, { lastSeen: Date.now() });
      if (!known) this._emit('peer-join', from);

      if (msg.type === 'ping') return;           // chi de bao con song

      const fn = this.handlers[msg.type];
      if (fn) fn(msg.payload, from);
    }

    _dropPeer(id) {
      if (!this._peers.delete(id)) return;
      this._emit('peer-leave', id);
    }

    _startHeartbeat() {
      this._timers.push(setInterval(() => {
        if (this.online) this._pub(this._tMsg, {}, { qos: 0 }, 'ping');
      }, HEARTBEAT_MS));

      this._timers.push(setInterval(() => {
        const now = Date.now();
        for (const [id, p] of [...this._peers]) {
          if (now - p.lastSeen > PEER_TIMEOUT_MS) this._dropPeer(id);
        }
      }, 4000));
    }

    _pub(topic, payload, opts, type) {
      if (!this.client) return;
      const body = JSON.stringify({ from: this.myId, type: type || 'msg', payload });
      try { this.client.publish(topic, body, opts || { qos: 1 }); } catch (e) { console.warn('[net] publish', e); }
    }

    /** Gui tin tro choi toi may kia. `relay` giu lai cho tuong thich, khong dung. */
    send(type, payload) {
      // Con tro chuot gui lien tuc -> QoS 0, mat mot vai tin khong sao.
      const qos = (type === 'sel') ? 0 : 1;
      this._pub(this._tMsg, payload, { qos }, type);
    }

    destroy() {
      this._closed = true;
      this._timers.forEach(clearInterval);
      this._timers = [];
      if (this.client) {
        try {
          this._pub(this._tMsg, {}, { qos: 0 }, 'bye');
          // Host don retained flag de phong khong "song" mai.
          if (this.isHost) this.client.publish(this._tHost, '', { retain: true, qos: 1 });
          this.client.end(false);
        } catch { /* ignore */ }
      }
      this.client = null;
      this._peers.clear();
    }
  }

  global.Net = Net;
  global.makeRoomCode = makeCode;
})(window);
