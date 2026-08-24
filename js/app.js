/* Sudoku Co-op — điều phối UI, trạng thái ván đấu và đồng bộ P2P. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const boardEl = $('#board');
  const net = new Net();

  const S = {
    puzzle: new Uint8Array(81),     // đề gốc, 0 = ô trống
    solution: new Uint8Array(81),
    values: new Uint8Array(81),     // số người chơi đã điền
    notes: Array.from({ length: 81 }, () => new Set()),
    owner: new Array(81).fill(''),  // 'me' | 'mate' — ai điền ô này
    sel: -1,
    mateSel: -1,
    noteMode: false,
    seed: 0,
    difficulty: 'medium',
    startedAt: 0,
    solved: false,
    me: { name: 'Tôi', id: 'me' },
    mate: null
  };

  /* ---------------- Toasts ---------------- */
  function toast(msg, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /* ---------------- Board ---------------- */
  const cells = [];

  function buildBoard() {
    boardEl.innerHTML = '';
    cells.length = 0;
    for (let i = 0; i < 81; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.i = i;
      b.dataset.r = (i / 9) | 0;
      b.dataset.c = i % 9;
      b.setAttribute('role', 'gridcell');
      boardEl.appendChild(b);
      cells.push(b);
    }
  }

  function render() {
    const showConflict = $('#optConflict').checked;
    const showSame = $('#optSame').checked;
    const bad = showConflict ? Sudoku.conflicts(S.values) : new Set();
    const selVal = S.sel >= 0 ? S.values[S.sel] : 0;
    const peerSet = S.sel >= 0 ? Sudoku.peers(S.sel) : new Set();

    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      const given = S.puzzle[i] !== 0;
      const v = S.values[i];

      let cls = 'cell';
      if (given) cls += ' given';
      if (!given && S.owner[i] === 'mate') cls += ' by-mate';
      if (peerSet.has(i)) cls += ' peer';
      if (showSame && selVal && v === selVal && i !== S.sel) cls += ' same';
      if (bad.has(i)) cls += ' bad';
      if (i === S.sel) cls += ' sel';
      if (i === S.mateSel && i !== S.sel) cls += ' mate-sel';
      if (el.className !== cls) el.className = cls;

      const notes = S.notes[i];
      if (v) {
        if (el.firstChild?.nodeName === 'DIV') el.innerHTML = '';
        if (el.textContent !== String(v)) el.textContent = String(v);
      } else if (notes.size) {
        const html = Array.from({ length: 9 }, (_, k) =>
          `<span>${notes.has(k + 1) ? k + 1 : ''}</span>`).join('');
        const wrap = `<div class="notes">${html}</div>`;
        if (el.innerHTML !== wrap) el.innerHTML = wrap;
      } else if (el.textContent !== '') {
        el.textContent = '';
      }

      el.setAttribute('aria-label',
        `Hàng ${((i / 9) | 0) + 1} cột ${(i % 9) + 1}${v ? `, số ${v}` : ', trống'}`);
    }

    renderPad();
  }

  // Làm mờ những số đã dùng hết 9 lần.
  function renderPad() {
    const count = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) if (S.values[i]) count[S.values[i]]++;
    padButtons.forEach((btn, k) => {
      if (k > 8) return;
      btn.classList.toggle('done', count[k + 1] >= 9);
    });
  }

  /* ---------------- Number pad ---------------- */
  const padButtons = [];
  function buildPad() {
    const pad = $('#pad');
    pad.innerHTML = '';
    padButtons.length = 0;
    for (let n = 1; n <= 9; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(n);
      b.addEventListener('click', () => input(n));
      pad.appendChild(b);
      padButtons.push(b);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '⌫';
    del.addEventListener('click', () => input(0));
    pad.appendChild(del);
  }

  /* ---------------- Moves ---------------- */
  function input(n) {
    if (S.sel < 0 || S.solved) return;
    const idx = S.sel;
    if (S.puzzle[idx]) return;                        // ô đề, không sửa được

    if (S.noteMode && n !== 0) {
      if (S.values[idx]) return;                      // ô đã có số: xoá số trước rồi mới ghi chú
      const notes = new Set(S.notes[idx]);
      notes.has(n) ? notes.delete(n) : notes.add(n);
      commit({ idx, val: 0, notes: Array.from(notes) });
    } else {
      const val = S.values[idx] === n ? 0 : n;        // bấm lại số cũ = xoá
      commit({ idx, val, notes: [] });
    }
  }

  /** Áp dụng nước đi tại chỗ rồi phát cho peer. */
  function commit(move) {
    apply(move, 'me');
    net.send('move', move);
    checkDone();
  }

  function apply(move, by) {
    const { idx, val, notes } = move;
    if (idx < 0 || idx > 80 || S.puzzle[idx]) return;

    S.values[idx] = val || 0;
    S.notes[idx] = new Set(notes || []);
    S.owner[idx] = val ? by : '';

    // Điền số thì xoá ghi chú cùng số ở các ô liên quan.
    if (val) {
      for (const p of Sudoku.peers(idx)) S.notes[p].delete(val);
    }

    if (by === 'mate') {
      cells[idx].classList.add('flash');
      setTimeout(() => cells[idx]?.classList.remove('flash'), 500);
    }
    render();
  }

  function checkDone() {
    if (S.solved || !Sudoku.isFull(S.values)) return;
    if (!Sudoku.isComplete(S.values, S.solution)) {
      toast('Bảng đã đầy nhưng còn số sai.');
      return;
    }
    finish(Date.now() - S.startedAt);
    net.send('solved', { ms: Date.now() - S.startedAt });
  }

  function finish(ms) {
    if (S.solved) return;
    S.solved = true;
    stopTimer();
    const banner = $('#banner');
    banner.innerHTML = `🎉 Xong rồi!<small>Thời gian ${fmt(ms)} · ${labelOf(S.difficulty)}</small>`;
    banner.hidden = false;
    render();
  }

  function labelOf(d) {
    return { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó', expert: 'Cực khó' }[d] || d;
  }

  /* ---------------- Selection ---------------- */
  function select(idx) {
    if (idx === S.sel) return;
    S.sel = idx;
    render();
    net.send('sel', { idx });
  }

  boardEl.addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    select(Number(cell.dataset.i));
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;

    if (e.key >= '1' && e.key <= '9') { input(Number(e.key)); e.preventDefault(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { input(0); e.preventDefault(); return; }
    if (e.key.toLowerCase() === 'n') { toggleNote(); return; }

    const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const cur = S.sel < 0 ? 0 : S.sel;
    const r = (cur / 9) | 0, c = cur % 9;
    let next = cur;
    if (e.key === 'ArrowUp' && r > 0) next = cur - 9;
    if (e.key === 'ArrowDown' && r < 8) next = cur + 9;
    if (e.key === 'ArrowLeft' && c > 0) next = cur - 1;
    if (e.key === 'ArrowRight' && c < 8) next = cur + 1;
    select(next);
  });

  function toggleNote() {
    S.noteMode = !S.noteMode;
    $('#btnNote').setAttribute('aria-pressed', String(S.noteMode));
  }

  /* ---------------- Timer ---------------- */
  let timerId = null;
  function fmt(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const m = String(Math.floor(t / 60)).padStart(2, '0');
    return `${m}:${String(t % 60).padStart(2, '0')}`;
  }
  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      $('#timer').textContent = fmt(Date.now() - S.startedAt);
    }, 500);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  /* ---------------- Game lifecycle ---------------- */
  // `elapsed` (ms đã trôi) thay vì timestamp tuyệt đối — đồng hồ hai máy thường lệch nhau.
  function loadGame({ seed, difficulty, values, notes, owner, elapsed }) {
    const g = Sudoku.generate(difficulty, seed);
    S.seed = seed;
    S.difficulty = difficulty;
    S.puzzle = g.puzzle;
    S.solution = g.solution;
    S.values = values ? Uint8Array.from(values) : g.puzzle.slice();
    S.notes = Array.from({ length: 81 }, (_, i) => new Set(notes?.[i] || []));
    S.owner = owner ? owner.slice() : new Array(81).fill('');
    S.sel = -1;
    S.mateSel = -1;
    S.solved = false;
    S.startedAt = Date.now() - (Number(elapsed) || 0);
    $('#banner').hidden = true;
    $('#difficulty').value = difficulty;
    render();
    startTimer();
  }

  function newGame(difficulty) {
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0;
    loadGame({ seed, difficulty, elapsed: 0 });
    net.send('newgame', { seed, difficulty, elapsed: 0 });
  }

  function snapshot() {
    return {
      seed: S.seed,
      difficulty: S.difficulty,
      values: Array.from(S.values),
      notes: S.notes.map(s => Array.from(s)),
      // Đảo góc nhìn: ô "tôi" điền thì với người nhận là "mate".
      owner: S.owner.map(o => (o === 'me' ? 'mate' : o === 'mate' ? 'me' : '')),
      elapsed: Date.now() - S.startedAt
    };
  }

  window.__sudoku = { S, net, loadGame, newGame, snapshot, apply, render, toast, fmt, labelOf, buildBoard, buildPad, startTimer, select };
})();
