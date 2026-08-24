/* Lớp mạng P2P dựa trên PeerJS (WebRTC DataChannel).
   Host giữ trạng thái gốc; guest gửi hành động lên host, host phát lại cho mọi người.
   Dùng signaling server công khai của PeerJS, dữ liệu game đi trực tiếp giữa 2 máy. */
(function (global) {
  'use strict';

  const PREFIX = 'sdkcoop-';                       // tránh trùng id với app khác
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I,O,0,1 cho dễ đọc

  function makeCode(len = 6) {
    let out = '';
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  }

  const PEER_OPTS = {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  };

  class Net {
    constructor() {
      this.peer = null;
      this.conns = new Map();   // peerId -> DataConnection
      this.isHost = false;
      this.roomCode = null;
      this.myId = null;
      this.handlers = {};       // type -> fn(payload, fromId)
      this._events = {};        // event -> [fn]
    }

    on(type, fn) { this.handlers[type] = fn; return this; }
    onEvent(name, fn) { (this._events[name] ||= []).push(fn); return this; }
    _emit(name, ...args) { (this._events[name] || []).forEach(fn => fn(...args)); }

    get connected() { return this.conns.size > 0; }

    host(code) {
      this.isHost = true;
      this.roomCode = code || makeCode();
      this.myId = 'host';

      return new Promise((resolve, reject) => {
        this.peer = new Peer(PREFIX + this.roomCode, PEER_OPTS);

        this.peer.on('open', () => resolve(this.roomCode));
        this.peer.on('connection', conn => this._wire(conn));
        this.peer.on('error', err => {
          // Mã phòng đã bị chiếm -> thử mã khác.
          if (err.type === 'unavailable-id' && !code) {
            this.peer.destroy();
            this.host().then(resolve, reject);
            return;
          }
          if (this.peer && this.peer.open) this._emit('error', err);
          else reject(err);
        });
        this.peer.on('disconnected', () => {
          if (this.peer && !this.peer.destroyed) this.peer.reconnect();
        });
      });
    }

    join(code) {
      this.isHost = false;
      this.roomCode = String(code || '').trim().toUpperCase();
      if (!/^[A-Z2-9]{4,8}$/.test(this.roomCode)) {
        return Promise.reject(new Error('Mã phòng không hợp lệ.'));
      }

      return new Promise((resolve, reject) => {
        this.peer = new Peer(PEER_OPTS);
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('Không tìm thấy phòng. Kiểm tra lại mã hoặc nhờ máy kia tạo phòng mới.'));
        }, 15000);

        this.peer.on('open', id => {
          this.myId = id;
          const conn = this.peer.connect(PREFIX + this.roomCode, { reliable: true });

          conn.on('open', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this._wire(conn, true);
            resolve(this.roomCode);
          });

          conn.on('error', err => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          });
        });

        this.peer.on('error', err => {
          if (settled) { this._emit('error', err); return; }
          settled = true;
          clearTimeout(timer);
          reject(err.type === 'peer-unavailable'
            ? new Error('Phòng không tồn tại hoặc đã đóng.')
            : err);
        });

        this.peer.on('disconnected', () => {
          if (this.peer && !this.peer.destroyed) this.peer.reconnect();
        });
      });
    }

    _wire(conn, alreadyOpen) {
      const attach = () => {
        this.conns.set(conn.peer, conn);
        this._emit('peer-join', conn.peer);
      };

      if (alreadyOpen) attach();
      else conn.on('open', attach);

      conn.on('data', raw => {
        let msg = raw;
        if (typeof raw === 'string') {
          try { msg = JSON.parse(raw); } catch { return; }
        }
        if (!msg || typeof msg.type !== 'string') return;

        // Host là trung gian: chuyển tiếp cho các peer còn lại.
        if (this.isHost && msg.relay) this._send(msg, conn.peer);

        const fn = this.handlers[msg.type];
        if (fn) fn(msg.payload, conn.peer);
      });

      const drop = () => {
        if (!this.conns.delete(conn.peer)) return;
        this._emit('peer-leave', conn.peer);
      };
      conn.on('close', drop);
      conn.on('error', drop);
    }

    _send(msg, exceptId) {
      const data = JSON.stringify(msg);
      for (const [id, conn] of this.conns) {
        if (id === exceptId) continue;
        if (conn.open) {
          try { conn.send(data); } catch { /* kênh đang đóng */ }
        }
      }
    }

    /** Gửi tới mọi peer. relay=true để host phát lại cho các peer khác. */
    send(type, payload, relay = true) {
      this._send({ type, payload, relay });
    }

    destroy() {
      for (const conn of this.conns.values()) {
        try { conn.close(); } catch { /* ignore */ }
      }
      this.conns.clear();
      if (this.peer) {
        try { this.peer.destroy(); } catch { /* ignore */ }
      }
      this.peer = null;
    }
  }

  global.Net = Net;
  global.makeRoomCode = makeCode;
})(window);
