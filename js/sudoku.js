/* Sudoku engine: seeded RNG, generator, solver, validation.
   Đề được sinh từ seed nên cả hai máy chỉ cần đồng bộ seed là ra cùng một bảng. */
(function (global) {
  'use strict';

  // mulberry32: PRNG 32-bit, cùng seed -> cùng dãy số trên mọi thiết bị.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function canPlace(g, idx, val) {
    const r = (idx / 9) | 0, c = idx % 9;
    const br = r - (r % 3), bc = c - (c % 3);
    for (let i = 0; i < 9; i++) {
      if (g[r * 9 + i] === val) return false;
      if (g[i * 9 + c] === val) return false;
      if (g[(br + ((i / 3) | 0)) * 9 + bc + (i % 3)] === val) return false;
    }
    return true;
  }

  // Backtracking trên ô có ít lựa chọn nhất; đếm tối đa `limit` nghiệm.
  function countSolutions(grid, limit, rand) {
    const g = grid.slice();
    let found = 0;

    (function step() {
      if (found >= limit) return;
      let best = -1, bestOpts = null;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const opts = [];
        for (let v = 1; v <= 9; v++) if (canPlace(g, i, v)) opts.push(v);
        if (opts.length === 0) return;            // nhánh chết
        if (opts.length === 1) { best = i; bestOpts = opts; break; }
        if (!bestOpts || opts.length < bestOpts.length) { best = i; bestOpts = opts; }
      }
      if (best === -1) { found++; return; }       // đầy bảng -> 1 nghiệm
      if (rand) shuffle(bestOpts, rand);
      for (const v of bestOpts) {
        g[best] = v;
        step();
        g[best] = 0;
        if (found >= limit) return;
      }
    })();

    return found;
  }

  function solve(grid) {
    const g = grid.slice();
    const ok = (function step() {
      let best = -1, bestOpts = null;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const opts = [];
        for (let v = 1; v <= 9; v++) if (canPlace(g, i, v)) opts.push(v);
        if (opts.length === 0) return false;
        if (!bestOpts || opts.length < bestOpts.length) {
          best = i; bestOpts = opts;
          if (opts.length === 1) break;
        }
      }
      if (best === -1) return true;
      for (const v of bestOpts) {
        g[best] = v;
        if (step()) return true;
        g[best] = 0;
      }
      return false;
    })();
    return ok ? g : null;
  }

  function fullGrid(rand) {
    const g = new Uint8Array(81);
    (function step() {
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const opts = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand)
          .filter(v => canPlace(g, i, v));
        for (const v of opts) {
          g[i] = v;
          if (step()) return true;
          g[i] = 0;
        }
        return false;
      }
      return true;
    })();
    return g;
  }

  // Số ô còn lại mục tiêu theo độ khó (giữ tính duy nhất của nghiệm).
  const TARGET_CLUES = { easy: 45, medium: 36, hard: 30, expert: 26 };

  function generate(difficulty, seed) {
    const level = TARGET_CLUES[difficulty] ? difficulty : 'medium';
    const rand = rng(seed);
    const solution = fullGrid(rand);
    const puzzle = solution.slice();

    const order = shuffle(Array.from({ length: 81 }, (_, i) => i), rand);
    let clues = 81;
    const target = TARGET_CLUES[level];

    for (const idx of order) {
      if (clues <= target) break;
      const backup = puzzle[idx];
      puzzle[idx] = 0;
      // Giữ lại nếu việc bỏ ô làm đề có nhiều hơn 1 nghiệm.
      if (countSolutions(puzzle, 2) !== 1) puzzle[idx] = backup;
      else clues--;
    }

    return { puzzle, solution, difficulty: level, seed, clues };
  }

  // Các ô vi phạm luật (trùng hàng/cột/khối) trong trạng thái hiện tại.
  function conflicts(values) {
    const bad = new Set();
    const groups = [];
    for (let i = 0; i < 9; i++) {
      const row = [], col = [], box = [];
      for (let j = 0; j < 9; j++) {
        row.push(i * 9 + j);
        col.push(j * 9 + i);
        const br = ((i / 3) | 0) * 3, bc = (i % 3) * 3;
        box.push((br + ((j / 3) | 0)) * 9 + bc + (j % 3));
      }
      groups.push(row, col, box);
    }
    for (const group of groups) {
      const seen = new Map();
      for (const idx of group) {
        const v = values[idx];
        if (!v) continue;
        if (seen.has(v)) { bad.add(idx); bad.add(seen.get(v)); }
        else seen.set(v, idx);
      }
    }
    return bad;
  }

  function isComplete(values, solution) {
    for (let i = 0; i < 81; i++) if (values[i] !== solution[i]) return false;
    return true;
  }

  function isFull(values) {
    for (let i = 0; i < 81; i++) if (!values[i]) return false;
    return true;
  }

  function peers(idx) {
    const r = (idx / 9) | 0, c = idx % 9;
    const br = r - (r % 3), bc = c - (c % 3);
    const s = new Set();
    for (let i = 0; i < 9; i++) {
      s.add(r * 9 + i);
      s.add(i * 9 + c);
      s.add((br + ((i / 3) | 0)) * 9 + bc + (i % 3));
    }
    s.delete(idx);
    return s;
  }

  global.Sudoku = { rng, generate, solve, conflicts, isComplete, isFull, peers, TARGET_CLUES };
})(window);
