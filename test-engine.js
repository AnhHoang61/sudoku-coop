// Test tạm cho engine: chạy `node test-engine.js`
global.window = global;
require('./js/sudoku.js');

let fail = 0;
const t0 = Date.now();

for (const diff of ['easy', 'medium', 'hard', 'expert']) {
  for (let k = 0; k < 3; k++) {
    const seed = (Math.random() * 4294967296) >>> 0;
    const g = Sudoku.generate(diff, seed);

    // 1. Nghiệm phải hợp luật và đầy đủ
    if (Sudoku.conflicts(g.solution).size !== 0) { console.log('FAIL conflict in solution', diff); fail++; }
    if (!Sudoku.isFull(g.solution)) { console.log('FAIL solution not full', diff); fail++; }

    // 2. Đề phải là tập con của nghiệm
    for (let i = 0; i < 81; i++) {
      if (g.puzzle[i] && g.puzzle[i] !== g.solution[i]) { console.log('FAIL puzzle mismatch', diff); fail++; break; }
    }

    // 3. Đề phải có đúng 1 nghiệm
    const solved = Sudoku.solve(g.puzzle);
    if (!solved) { console.log('FAIL unsolvable', diff); fail++; }
    else if (!Sudoku.isComplete(solved, g.solution)) { console.log('FAIL solver got different grid', diff); fail++; }

    // 4. Cùng seed -> cùng đề (điều kiện then chốt để 2 máy đồng bộ)
    const again = Sudoku.generate(diff, seed);
    for (let i = 0; i < 81; i++) {
      if (again.puzzle[i] !== g.puzzle[i] || again.solution[i] !== g.solution[i]) {
        console.log('FAIL seed not deterministic', diff); fail++; break;
      }
    }

    console.log(`${diff.padEnd(7)} seed=${String(seed).padStart(10)} clues=${g.clues}`);
  }
}

console.log(fail === 0 ? `\nOK — tất cả test pass (${Date.now() - t0}ms)` : `\n${fail} test FAIL`);
process.exit(fail ? 1 : 0);
