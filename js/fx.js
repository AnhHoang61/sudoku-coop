/* Pháo hoa khi thắng. Tự vẽ bằng canvas, không phụ thuộc thư viện ngoài.
 *
 * Thiết kế: canvas chỉ tồn tại trong lúc bắn. Xong thì xoá khỏi DOM để không
 * có lớp phủ vô hình nằm trên bàn cờ chặn click. RAF cũng dừng luôn, tablet
 * không phải cắm sạc vì một cái đồng hồ chạy hoài.
 */
(function (global) {
  'use strict';

  const GRAVITY = 0.045;
  const DRAG = 0.986;
  const SHELL_MS = 2600;      // ngừng phóng quả mới sau mốc này
  const MAX_MS = 6000;        // chốt cứng: luôn dọn dẹp dù có gì xảy ra

  // Màu nóng, dễ nhìn trên nền tối của game.
  const HUES = [8, 42, 96, 170, 200, 280, 320];

  function reduceMotion() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  class Show {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'fx';
      this.canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.parts = [];
      this.t0 = performance.now();
      this.raf = 0;
      this.dead = false;
      this._onResize = () => this._size();
      global.addEventListener('resize', this._onResize);

      this._size();
      // Ba quả đầu bắn ngay, không để người chơi nhìn màn hình trống.
      this.launch(0.5);
      setTimeout(() => this.dead || this.launch(), 260);
      setTimeout(() => this.dead || this.launch(), 520);
      this.nextAt = this.t0 + 700;

      this.raf = requestAnimationFrame(() => this._tick());
    }

    _size() {
      // Giới hạn DPR ở 2: tablet có DPR 3 thì số pixel phải vẽ tăng 2.25 lần
      // mà mắt gần như không thấy khác.
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.w = global.innerWidth;
      this.h = global.innerHeight;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Nổ một quả. `x` là vị trí ngang 0..1, bỏ trống thì ngẫu nhiên. */
    launch(x) {
      const cx = (x == null ? 0.15 + Math.random() * 0.7 : x) * this.w;
      const cy = (0.18 + Math.random() * 0.34) * this.h;
      const hue = HUES[(Math.random() * HUES.length) | 0];
      const n = 46 + ((Math.random() * 34) | 0);
      const power = 2.6 + Math.random() * 2.2;
      const ring = Math.random() < 0.35;   // vài quả nổ thành vòng tròn gọn

      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.12;
        const sp = ring ? power : power * (0.35 + Math.random() * 0.65);
        this.parts.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.008 + Math.random() * 0.012,
          hue: hue + (Math.random() * 24 - 12),
          size: 1.4 + Math.random() * 1.8
        });
      }
    }

    _tick() {
      if (this.dead) return;
      const now = performance.now();
      const age = now - this.t0;

      if (age < SHELL_MS && now >= this.nextAt) {
        this.launch();
        this.nextAt = now + 340 + Math.random() * 420;
      }

      const ctx = this.ctx;
      // Xoá mờ thay vì xoá hẳn -> tự có vệt sáng đuôi hạt.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';

      const alive = [];
      for (const p of this.parts) {
        p.vx *= DRAG;
        p.vy = p.vy * DRAG + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0 || p.y > this.h + 40) continue;

        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 100%, ${55 + p.life * 25}%, ${Math.min(1, p.life)})`;
        ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.6), 0, Math.PI * 2);
        ctx.fill();
        alive.push(p);
      }
      this.parts = alive;

      if (age > MAX_MS || (age > SHELL_MS && !this.parts.length)) { this.stop(); return; }
      this.raf = requestAnimationFrame(() => this._tick());
    }

    stop() {
      if (this.dead) return;
      this.dead = true;
      cancelAnimationFrame(this.raf);
      global.removeEventListener('resize', this._onResize);
      this.canvas.classList.add('fx-out');
      setTimeout(() => this.canvas.remove(), 420);
    }
  }

  let current = null;

  /** Bắn pháo hoa. Gọi lại khi đang bắn thì thay bằng màn mới. */
  function fireworks() {
    if (reduceMotion()) return;      // tôn trọng cài đặt giảm hiệu ứng
    if (current) current.stop();
    current = new Show();
  }

  function stopFireworks() {
    if (current) { current.stop(); current = null; }
  }

  global.fireworks = fireworks;
  global.stopFireworks = stopFireworks;
})(window);
