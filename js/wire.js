/* Nối UI (lobby, nút bấm) với lớp mạng. Chạy sau app.js. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const G = window.__sudoku;
  const { S, net } = G;

  /* ---------------- Trạng thái kết nối ---------------- */
  function setConn(state, text) {
    const el = $('#conn');
    el.className = 'pill pill-' + state;
    $('#connText').textContent = text;
  }

  function renderPlayers() {
    const list = $('#players');
    list.innerHTML = '';
    const rows = [
      { name: S.me.name, color: 'var(--me)', tag: net.isHost ? 'chủ phòng' : 'bạn' }
    ];
    if (S.mate) rows.push({ name: S.mate.name, color: 'var(--mate)', tag: 'đang chơi' });
    else if (net.roomCode) rows.push({ name: 'Đang chờ…', color: '#6b7280', tag: '' });

    for (const r of rows) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="swatch" style="background:${r.color}"></span>
        <span>${escapeHtml(r.name)}</span><span class="tag">${r.tag}</span>`;
      list.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- Handler mạng ---------------- */
  net.on('hello', payload => {
    // Host nhận lời chào -> gửi lại trạng thái ván hiện tại.
    // Guest co the chao lai sau khi mang chop, nen luon tra loi.
    const isNew = !S.mate;
    S.mate = { name: (payload?.name || 'Người chơi 2').slice(0, 16) };
    renderPlayers();
    if (isNew) G.toast(`${S.mate.name} đã vào phòng.`);
    if (net.isHost) net.send('welcome', { name: S.me.name, state: G.snapshot() });
  });

  // Chi nap trang thai tu host MOT lan. Khong co co nay thi moi lan host tra loi
  // 'welcome' (vd sau khi mang chop) se ghi de sach tien do dang choi.
  let synced = false;

  net.on('welcome', payload => {
    S.mate = { name: (payload?.name || 'Chủ phòng').slice(0, 16) };
    renderPlayers();
    if (synced) return;
    synced = true;
    if (payload?.state) G.loadGame(payload.state);
    G.toast('Đã đồng bộ ván đấu.');
  });

  net.on('move', payload => {
    if (payload && typeof payload.idx === 'number') G.apply(payload, 'mate');
  });

  net.on('sel', payload => {
    S.mateSel = typeof payload?.idx === 'number' ? payload.idx : -1;
    G.render();
  });

  net.on('newgame', payload => {
    if (!payload?.seed) return;
    G.loadGame(payload);
    G.toast('Ván mới từ bạn cùng chơi.');
  });

  net.on('solved', () => {
    if (!S.solved) G.toast('Bạn cùng chơi báo đã xong!');
  });

  net.onEvent('peer-join', () => {
    setConn('on', 'Đã kết nối');
    $('#waiting')?.setAttribute('hidden', '');
    closeLobby();
    renderPlayers();
    // Khong gui 'hello' o day: doJoin() da chao ngay sau khi vao phong.
    // Gui lai se lam host tra 'welcome' lan hai va xoa sach tien do.
  });

  net.onEvent('peer-leave', () => {
    S.mate = null;
    S.mateSel = -1;
    setConn('wait', 'Mất kết nối');
    renderPlayers();
    G.render();
    G.toast('Bạn cùng chơi đã rời phòng.');
  });

  net.onEvent('error', err => {
    console.warn('[net]', err);
    const msg = err?.message
      ? 'Lỗi mạng: ' + err.message
      : 'Mất kết nối tới server. Đang thử lại…';
    G.toast(msg, 5000);
    if (!$('#lobby').hidden) lobbyError(msg);
  });

  net.onEvent('offline', () => {
    if (net.roomCode) setConn('wait', 'Đang kết nối lại…');
  });

  net.onEvent('reconnecting', () => {
    if (net.roomCode) setConn('wait', 'Đang kết nối lại…');
  });

  net.onEvent('reconnected', () => {
    setConn(net.connected ? 'on' : 'wait', net.connected ? 'Đã kết nối' : 'Chờ bạn cùng chơi');
    // Chao lai de dong bo: co the da lech nuoc di trong luc mat mang.
    if (!net.isHost) net.send('hello', { name: S.me.name });
    G.toast('Đã kết nối lại.');
  });

  /* ---------------- Lobby ---------------- */
  function openLobby() { $('#lobby').hidden = false; }
  function closeLobby() { $('#lobby').hidden = true; }

  function lobbyError(msg) {
    const el = $('#lobbyErr');
    el.textContent = msg;
    el.hidden = !msg;
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('.tabpane').forEach(p => {
        p.classList.toggle('is-active', p.id === 'tab-' + tab.dataset.tab);
      });
      lobbyError('');
    });
  });

  function myName() {
    const v = $('#nameInput').value.trim();
    return (v || (net.isHost ? 'Chủ phòng' : 'Người chơi')).slice(0, 16);
  }

  $('#btnCreate').addEventListener('click', async () => {
    lobbyError('');
    const btn = $('#btnCreate');
    btn.disabled = true;
    btn.textContent = 'Đang tạo…';
    try {
      // Dat ten TRUOC khi host(): net.myName duoc dung khi chao lai qua
      // broker moi ket noi duoc trong nen.
      S.me.name = myName();
      net.myName = S.me.name;
      const code = await net.host();
      $('#roomCode').textContent = code;
      $('#createResult').hidden = false;
      btn.hidden = true;
      setConn('wait', 'Chờ bạn cùng chơi');
      G.newGame($('#difficulty').value);
      renderPlayers();
      updateHostUI();
      history.replaceState(null, '', '#' + code);
    } catch (err) {
      lobbyError('Không tạo được phòng: ' + (err?.message || err?.type || 'lỗi mạng'));
      btn.disabled = false;
      btn.textContent = 'Tạo phòng mới';
    }
  });

  async function doJoin(code) {
    lobbyError('');
    const btn = $('#btnJoin');
    btn.disabled = true;
    btn.textContent = 'Đang vào…';
    S.me.name = myName();
    net.myName = S.me.name;
    try {
      await net.join(code);
      setConn('on', 'Đã kết nối');
      updateHostUI();
      closeLobby();
      // Chao host ngay de lay trang thai van, khong cho nhip heartbeat 6s.
      net.send('hello', { name: S.me.name });
      history.replaceState(null, '', '#' + net.roomCode);
    } catch (err) {
      lobbyError(err?.message || 'Không vào được phòng.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Vào phòng';
    }
  }

  $('#btnJoin').addEventListener('click', () => doJoin($('#joinInput').value));
  $('#joinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoin($('#joinInput').value);
  });

  $('#btnSolo').addEventListener('click', () => {
    closeLobby();
    setConn('off', 'Chơi một mình');
    G.newGame($('#difficulty').value);
    renderPlayers();
    updateHostUI();
  });

  $('#btnMenu').addEventListener('click', openLobby);

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      G.toast(label + ' đã copy.');
    } catch {
      G.toast('Không copy được, bạn tự chọn và copy nhé.');
    }
  }
  $('#btnCopyCode').addEventListener('click', () => copy($('#roomCode').textContent, 'Mã phòng'));
  $('#btnCopyLink').addEventListener('click', () => {
    const url = location.origin + location.pathname + '#' + $('#roomCode').textContent;
    copy(url, 'Link phòng');
  });

  /* ---------------- Nút trong game ---------------- */
  // Chỉ chủ phòng (hoặc người chơi solo) được đổi ván, tránh hai bên ghi đè nhau.
  function updateHostUI() {
    const canControl = net.isHost || !net.roomCode;
    $('#btnNew').disabled = !canControl;
    $('#difficulty').disabled = !canControl;
    $('#hostNote').hidden = canControl;
  }

  $('#btnNew').addEventListener('click', () => G.newGame($('#difficulty').value));
  $('#difficulty').addEventListener('change', () => G.newGame($('#difficulty').value));

  $('#btnCheck').addEventListener('click', () => {
    let wrong = 0, empty = 0;
    for (let i = 0; i < 81; i++) {
      if (!S.values[i]) empty++;
      else if (S.values[i] !== S.solution[i]) wrong++;
    }
    if (wrong === 0 && empty === 0) G.toast('Hoàn hảo, đã xong!');
    else if (wrong === 0) G.toast(`Đúng hết, còn ${empty} ô trống.`);
    else G.toast(`Có ${wrong} số sai và ${empty} ô trống.`);
  });

  $('#btnNote').addEventListener('click', () => {
    S.noteMode = !S.noteMode;
    $('#btnNote').setAttribute('aria-pressed', String(S.noteMode));
  });

  $('#btnErase').addEventListener('click', () => {
    if (S.sel < 0 || S.puzzle[S.sel]) return;
    G.S.noteMode = false;
    $('#btnNote').setAttribute('aria-pressed', 'false');
    const move = { idx: S.sel, val: 0, notes: [] };
    G.apply(move, 'me');
    net.send('move', move);
  });

  $('#optConflict').addEventListener('change', G.render);
  $('#optSame').addEventListener('change', G.render);

  window.addEventListener('beforeunload', () => net.destroy());

  /* ---------------- Khởi động ---------------- */
  G.buildBoard();
  G.buildPad();
  renderPlayers();

  // Link có #MÃ -> mở sẵn tab "Vào phòng" và điền mã.
  const hash = location.hash.replace('#', '').toUpperCase();
  if (/^[A-Z2-9]{4,8}$/.test(hash)) {
    document.querySelector('.tab[data-tab="join"]').click();
    $('#joinInput').value = hash;
    $('#lobbyTitle').textContent = 'Vào phòng ' + hash;
  }
  openLobby();
})();
