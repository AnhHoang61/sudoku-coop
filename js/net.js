/* Lop mang cho Sudoku Co-op — fanout qua nhieu broker MQTT/WebSocket.
 *
 * Bai toan: hai may o hai mang khac nhau. Mang nay chan cong 8084, mang kia
 * chan 8884, mang thu ba chan ca hai nhung cho 8081 di.
 *
 * Cach lam: KHONG chon mot broker. Noi toi TAT CA broker cung luc, gui tin ra
 * tat ca, va nhan tin tu tat ca. Hai may chi can trung DUNG MOT broker la noi
 * duoc nhau. May A vao duoc [emqx, mosquitto], may B chi vao duoc [mosquitto]
 * -> van choi duoc.
 *
 * Tin trung lap (den qua nhieu broker) duoc loc bang msgId.
 *
 * Doi lai: tin di qua broker cong cong. Ma phong la thu duy nhat bao ve van
 * choi — ai biet ma thi doc duoc nuoc di. Voi Sudoku thi khong sao.
 */
(function (global) {
  'use strict';

  const NS = 'sudokucoop/v3';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bo I,O,0,1 cho de doc

  // Nhieu broker tren nhieu cong. Da do: khong broker cong khai nao chay MQTT
  // tren 443, nen phai rai ra nhieu cong de vuot cac kieu firewall khac nhau.
  // Da do tin cay 3 lan/broker: emqx 3/3, hivemq 3/3, broker-cn.emqx 3/3,
  // mosquitto 2/3 (connack timeout), eclipseprojects 0/3 -> bo hai cai cuoi.
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker-cn.emqx.io:8084/mqtt'
  ];

  // Broker fail luc dau se duoc thu lai trong nen: phu rong dan de hai may
  // co co hoi trung nhau cao nhat.
  const RETRY_FAILED_MS = 15000;

  const CONNECT_TIMEOUT = 12000;
  const JOIN_TIMEOUT = 15000;
  const HEARTBEAT_MS = 5000;
  const PEER_TIMEOUT_MS = 20000;
  const SEEN_MAX = 600;

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
      this.clients = [];          // moi broker noi duoc = 1 client
      this.isHost = false;
      this.roomCode = null;
      this.myId = randId();
      this.handlers = {};
      this._events = {};
      this._peers = new Map();
      this._timers = [];
      this._seen = new Set();     // loc tin trung lap
      this._seenQ = [];
      this._seq = 0;
      this._closed = false;
      this._hostSeen = false;
      this.myName = '';           // wire.js dat truoc khi host()/join()
    }

    on(type, fn) { this.handlers[type] = fn; return this; }
    onEvent(name, fn) { (this._events[name] ||= []).push(fn); return this; }
    _emit(name, ...args) {
      (this._events[name] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });
    }

    get connected() { return this._peers.size > 0; }
    get online() { return this.clients.some(c => c && c.connected); }
    get brokerCount() { return this.clients.filter(c => c && c.connected).length; }

    get _tMsg() { return `${NS}/${this.roomCode}/msg`; }
    get _tHost() { return `${NS}/${this.roomCode}/host`; }

    host(code) {
      this.isHost = true;
      this.roomCode = code || makeCode();
      return this._connectAll().then(() => {
        this._announceHost();
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

      return this._connectAll().then(() => new Promise((resolve, reject) => {
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this._startHeartbeat();
          resolve(this.roomCode);
        };

        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error(
            'Không thấy phòng này. Có thể: mã sai, máy tạo phòng đã đóng tab, ' +
            'hoặc hai máy không vào được cùng một server. Thử tạo phòng mới từ máy còn lại.'
          ));
        }, JOIN_TIMEOUT);

        this._onHostSeen = finish;
        if (this._hostSeen) finish();   // tin retained co the da toi truoc
      }));
    }

    _announceHost() {
      this._pubRaw(this._tHost, JSON.stringify({ from: this.myId, at: Date.now() }),
                   { retain: true, qos: 1 });
    }

    /** Noi song song toi tat ca broker. Thanh cong neu it nhat MOT cai noi duoc. */
    _connectAll() {
      if (typeof mqtt === 'undefined') {
        return Promise.reject(new Error('Chưa tải được thư viện mạng. Kiểm tra internet rồi tải lại trang.'));
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        let failed = 0;
        const deadUrls = [];

        BROKERS.forEach(url => this._connectOne(url).then(() => {
          // Chot ngay khi co broker dau tien noi duoc — khong cho het.
          // Cac broker con lai noi xong se tu them vao this.clients.
          if (!settled) { settled = true; resolve(); }
        }, () => {
          deadUrls.push(url);
          if (++failed === BROKERS.length && !settled) {
            settled = true;
            reject(new Error('Không nối được tới server nào. Kiểm tra internet, hoặc mạng đang chặn WebSocket.'));
          }
        }));

        // Thu lai cac broker fail trong nen. Ly do: may kia co the chi vao duoc
        // dung cai broker mà may nay vua fail — phu cang rong thi co hoi trung
        // cang cao. Broker cong khai thuong fail tam thoi roi lai duoc.
        this._timers.push(setInterval(() => {
          if (this._closed || !deadUrls.length) return;
          const url = deadUrls.shift();
          this._connectOne(url).then(() => {
            if (this.isHost) this._announceHost();
            // Chao lai qua broker moi de may kia thay minh.
            this.send('hello', { name: this.myName || '' });
          }, () => deadUrls.push(url));
        }, RETRY_FAILED_MS));
      });
    }

    _connectOne(url) {
      return new Promise((resolve, reject) => {
        let client;
        try {
          client = mqtt.connect(url, {
            clientId: 'sdk_' + this.myId + '_' + Math.random().toString(36).slice(2, 6),
            clean: true,
            connectTimeout: CONNECT_TIMEOUT,
            reconnectPeriod: 4000,
            keepalive: 30,
            will: {
              topic: `${NS}/${this.roomCode}/msg`,
              // id phai rieng theo may: dung chung 'will' thi bo loc trung lap
              // se an tin roi phong cua tat ca may tru cai dau tien.
              payload: JSON.stringify({ from: this.myId, type: 'bye', payload: {}, id: 'will-' + this.myId }),
              qos: 0
            }
          });
        } catch (e) { reject(e); return; }

        let opened = false;
        const guard = setTimeout(() => {
          if (opened) return;
          try { client.end(true); } catch { /* ignore */ }
          reject(new Error('timeout ' + url));
        }, CONNECT_TIMEOUT + 1500);

        client.on('connect', () => {
          clearTimeout(guard);
          // Dang ky lai o MOI lan connect: clean:true nen broker khong nho
          // subscription cu sau khi mang chop -> tin se im lang khong toi.
          client.subscribe([this._tMsg, this._tHost], { qos: 1 }, err => {
            if (err) { if (!opened) reject(err); return; }
            if (!opened) {
              opened = true;
              client._sdkUrl = url;
              this.clients.push(client);
              resolve(client);
            } else {
              if (this.isHost) this._announceHost();
              this._emit('reconnected');
            }
          });
        });

        client.on('message', (topic, buf) => this._onMessage(topic, buf));

        client.on('error', err => {
          if (!opened) { clearTimeout(guard); try { client.end(true); } catch {} reject(err); return; }
          console.warn('[net]', url, err?.message);
        });

        client.on('close', () => {
          if (!this._closed && opened && !this.online) this._emit('offline');
        });
        client.on('reconnect', () => { if (!this.online) this._emit('reconnecting'); });
      });
    }

    _markSeen(id) {
      if (!id) return false;
      if (this._seen.has(id)) return true;
      this._seen.add(id);
      this._seenQ.push(id);
      if (this._seenQ.length > SEEN_MAX) this._seen.delete(this._seenQ.shift());
      return false;
    }

    _onMessage(topic, buf) {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (topic === this._tHost) {
        // Payload rong = host da don co retained khi dong tab -> phong het.
        if (!msg.at || msg.from === this.myId) return;
        this._hostSeen = true;
        if (!this.isHost && this._onHostSeen) this._onHostSeen();
        return;
      }

      const from = msg.from;
      if (!from || from === this.myId) return;
      if (this._markSeen(msg.id)) return;      // da nhan qua broker khac

      if (msg.type === 'bye') { this._dropPeer(from); return; }

      const known = this._peers.has(from);
      this._peers.set(from, { lastSeen: Date.now() });
      if (!known) this._emit('peer-join', from);

      if (msg.type === 'ping') return;

      const fn = this.handlers[msg.type];
      if (fn) fn(msg.payload, from);
    }

    _dropPeer(id) {
      if (!this._peers.delete(id)) return;
      this._emit('peer-leave', id);
    }

    _startHeartbeat() {
      this._timers.push(setInterval(() => {
        if (this.online) this.send('ping', {});
      }, HEARTBEAT_MS));

      this._timers.push(setInterval(() => {
        const now = Date.now();
        for (const [id, p] of [...this._peers]) {
          if (now - p.lastSeen > PEER_TIMEOUT_MS) this._dropPeer(id);
        }
      }, 4000));
    }

    _pubRaw(topic, body, opts) {
      let sent = 0;
      for (const c of this.clients) {
        if (!c || !c.connected) continue;
        try { c.publish(topic, body, opts); sent++; } catch { /* kenh dang dong */ }
      }
      return sent;
    }

    /** Gui tin ra TAT CA broker. Ben nhan loc trung lap bang id. */
    send(type, payload) {
      if (!this.roomCode) return;
      const id = this.myId + '-' + (++this._seq);
      const body = JSON.stringify({ from: this.myId, type, payload, id });
      const qos = (type === 'sel' || type === 'ping') ? 0 : 1;
      this._pubRaw(this._tMsg, body, { qos });
    }

    destroy() {
      this._closed = true;
      this._timers.forEach(clearInterval);
      this._timers = [];
      try {
        this.send('bye', {});
        if (this.isHost) this._pubRaw(this._tHost, '', { retain: true, qos: 1 });
      } catch { /* ignore */ }
      for (const c of this.clients) {
        try { c.end(false); } catch { /* ignore */ }
      }
      this.clients = [];
      this._peers.clear();
    }
  }

  global.Net = Net;
  global.makeRoomCode = makeCode;
})(window);
