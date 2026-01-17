// static/src/main.js
import { initThree, renderFromState, setInputHandlers, hitTestAtScreen } from "./render-3d.js";

const OFFLINE_MODE = true;

const TURN_SECONDS = 60;
const ACCUSE_WINDOW_SEC = 10;
const MAX_PENALTY = 3;

// ===== カーソル速度（遅め） =====
const CURSOR_SPEED = 420;

let myRole = "player";
let latestState = null;
let timerInterval = null;

// ===== DOM =====
function qs(id) { return document.getElementById(id); }

// ===== 2Dカーソル状態 =====
let cursor = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.8,
  visible: true,
};

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function showCursor(show) {
  const c = qs("kb-cursor");
  if (!c) return;
  c.style.display = show ? "block" : "none";
}

function setCursorLabel(text) {
  const el = qs("kb-cursor-label");
  if (el) el.textContent = text;
}

function updateCursorDOM() {
  const c = qs("kb-cursor");
  if (!c) return;
  c.style.left = `${cursor.x}px`;
  c.style.top = `${cursor.y}px`;
}

// ===== キー同時押し管理（斜め移動） =====
const keys = { up:false, down:false, left:false, right:false };

// 連射防止
let zDown = false;
let xDown = false;
let cDown = false;

let rafMove = null;
let lastTs = null;

function startMoveLoop() {
  if (rafMove) return;

  const tick = (ts) => {
    rafMove = requestAnimationFrame(tick);
    if (lastTs == null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    // モーダル中は移動停止
    if (isModalOpen()) {
      applyRender();
      return;
    }

    let dx = 0, dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;

    if (dx === 0 && dy === 0) {
      applyRender();
      return;
    }

    // 斜め正規化
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;

    cursor.x += dx * CURSOR_SPEED * dt;
    cursor.y += dy * CURSOR_SPEED * dt;

    cursor.x = clamp(cursor.x, 8, window.innerWidth - 8);
    cursor.y = clamp(cursor.y, 8, window.innerHeight - 8);

    applyRender();
  };

  rafMove = requestAnimationFrame(tick);
}

function stopMoveLoop() {
  if (rafMove) cancelAnimationFrame(rafMove);
  rafMove = null;
  lastTs = null;
}

// ===== カードDB =====
const CARD_DB = [
  { id: 0, name: "フォロワーA", cost: 2, power: 3, toughness: 2 },
  { id: 1, name: "フォロワーB", cost: 3, power: 4, toughness: 3 },
  { id: 2, name: "フォロワーC", cost: 1, power: 1, toughness: 1 },
  { id: 3, name: "フォロワーD", cost: 4, power: 5, toughness: 4 },
  { id: 4, name: "フォロワーE", cost: 2, power: 2, toughness: 3 },
];

function newInitialState() {
  return {
    roomId: "offline",
    started: false,
    currentTurn: "player",
    timer: TURN_SECONDS,
    isGameOver: false,
    winner: null,
    player: { hp: 20, mana: 3, maxMana: 3, hand: [], field: [], deck: 10, penalty: 0, grave: [] },
    opponent: { hp: 20, mana: 3, maxMana: 3, hand: [], field: [], deck: 10, penalty: 0, grave: [] },
    cards: CARD_DB,
    cheatLog: [],
  };
}

// ===== UI更新 =====
function updateTurnLabels(state) {
  const playerLabel = qs("player-turn-label");
  const oppLabel = qs("opponent-turn-label");
  if (!playerLabel || !oppLabel) return;
  playerLabel.style.opacity = state.currentTurn === "player" ? "1" : "0.35";
  oppLabel.style.opacity = state.currentTurn === "player" ? "0.35" : "1";
}

function updatePenalty(state) {
  const setRow = (id, n) => {
    const row = qs(id);
    if (!row) return;
    const cards = row.querySelectorAll(".penalty-card");
    cards.forEach((c, i) => i < n ? c.classList.add("active") : c.classList.remove("active"));
  };
  setRow("penalty-player", state.player.penalty || 0);
  setRow("penalty-opponent", state.opponent.penalty || 0);
}

function updateTimerUI(state) {
  const timerEl = qs("timer");
  if (!timerEl) return;
  timerEl.textContent = String(state.timer);
  timerEl.classList.remove("warning", "danger");
  if (state.timer <= 10) timerEl.classList.add("warning");
  if (state.timer <= 3) timerEl.classList.add("danger");
}

function updateGameOver(state) {
  const over = qs("game-over");
  if (!over) return;
  if (!state.isGameOver) { over.style.display = "none"; return; }
  qs("game-over-title").textContent = "ゲーム終了";
  qs("game-over-message").textContent =
    state.winner === "player" ? "あなたの勝ち！" :
    state.winner === "opponent" ? "あなたの負け…" : "終了";
  over.style.display = "flex";
}

function applyRender() {
  if (!latestState) return;

  updateTurnLabels(latestState);
  updatePenalty(latestState);
  updateTimerUI(latestState);
  updateGameOver(latestState);

  renderFromState(latestState, myRole);

  // カーソル直下の対象ラベル
  const hit = hitTestAtScreen(cursor.x, cursor.y);
  if (!hit) setCursorLabel("—");
  else setCursorLabel(`${hit.kind}:${hit.index ?? "?"}`);

  // アクションメニュー追従
  if (isActionMenuOpen()) {
    positionActionMenu(cursor.x, cursor.y);
  }

  updateCursorDOM();
}

function isActionMenuOpen() {
  const m = qs("action-menu");
  return m && m.style.display === "block";
}

function isModalOpen() {
  const accuse = qs("accuse-ui");
  const over = qs("game-over");
  const cheat = qs("cheat-menu");
  const action = qs("action-menu");
  return (accuse && accuse.style.display === "flex")
      || (over && over.style.display === "flex")
      || (cheat && cheat.style.display === "block")
      || (action && action.style.display === "block");
}

// ===== ゲームロジック =====
function endGameIfNeeded() {
  const s = latestState;
  if (!s || s.isGameOver) return;
  if (s.player.hp <= 0) { s.isGameOver = true; s.winner = "opponent"; }
  else if (s.opponent.hp <= 0) { s.isGameOver = true; s.winner = "player"; }
  if (s.player.penalty >= MAX_PENALTY) { s.isGameOver = true; s.winner = "opponent"; }
  else if (s.opponent.penalty >= MAX_PENALTY) { s.isGameOver = true; s.winner = "player"; }
}

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    if (!latestState || !latestState.started || latestState.isGameOver) return;
    latestState.timer--;
    if (latestState.timer <= 0) switchTurn();
    applyRender();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function simulateOpponentTurn() {
  const s = latestState;
  if (!s || s.isGameOver) return;

  const opp = s.opponent;

  // 可能なら召喚
  if (opp.hand.length && Math.random() < 0.5) {
    const idx = 0;
    const cid = opp.hand[idx];
    const card = CARD_DB.find(c => c.id === cid);
    if (card && opp.mana >= card.cost) {
      opp.mana -= card.cost;
      opp.hand.splice(idx, 1);
      opp.field.push(cid);
    }
  }

  // たまにイカサマ（指摘用）
  if (Math.random() < 0.35) {
    const kind = ["modify-hp", "modify-mana"][Math.floor(Math.random() * 2)];
    if (kind === "modify-hp") {
      s.player.hp += -1;
      s.cheatLog.push({ ts: Date.now() / 1000, by: "opponent", action: kind, payload: { target: "opponent", delta: -1 } });
    } else {
      s.player.mana = Math.max(0, s.player.mana - 1);
      s.cheatLog.push({ ts: Date.now() / 1000, by: "opponent", action: kind, payload: { target: "opponent", delta: -1 } });
    }
    if (s.cheatLog.length > 100) s.cheatLog = s.cheatLog.slice(-100);
  }

  endGameIfNeeded();
}

function switchTurn() {
  if (!latestState || latestState.isGameOver) return;
  latestState.currentTurn = latestState.currentTurn === "player" ? "opponent" : "player";
  latestState.timer = TURN_SECONDS;

  if (latestState.currentTurn === "opponent") {
    simulateOpponentTurn();
    latestState.currentTurn = "player";
    latestState.timer = TURN_SECONDS;
  }

  applyRender();
}

function startGameOffline() {
  latestState = newInitialState();
  latestState.started = true;
  latestState.player.hand = CARD_DB.slice(0, 3).map(c => c.id);
  latestState.opponent.hand = CARD_DB.slice(0, 3).map(c => c.id);
  latestState.currentTurn = "player";
  latestState.timer = TURN_SECONDS;

  cursor.x = window.innerWidth * 0.5;
  cursor.y = window.innerHeight * 0.8;

  applyRender();
  startTimer();

  const panel = qs("connection-panel");
  if (panel) panel.style.display = "none";
}

// ===== 手札通常：場に出す =====
function playCardOffline(handIndex) {
  const s = latestState;
  if (!s || !s.started || s.isGameOver) return;
  if (s.currentTurn !== "player") return;

  const ps = s.player;
  const cid = ps.hand[handIndex];
  if (cid == null) return;

  const card = CARD_DB.find(c => c.id === cid);
  if (!card) return;
  if (ps.mana < card.cost) return;

  ps.mana -= card.cost;
  ps.hand.splice(handIndex, 1);
  ps.field.push(cid);

  endGameIfNeeded();
  applyRender();
}

// ===== 手札イカサマ：こっそり墓地 =====
function sneakToGraveFromHand(handIndex) {
  const s = latestState;
  if (!s || !s.started || s.isGameOver) return;

  const ps = s.player;
  const cid = ps.hand[handIndex];
  if (cid == null) return;

  ps.hand.splice(handIndex, 1);
  ps.grave = ps.grave || [];
  ps.grave.push(cid);

  s.cheatLog.push({ ts: Date.now() / 1000, by: "player", action: "sneak-grave", payload: { from: "hand", handIndex } });

  endGameIfNeeded();
  applyRender();
}

// ===== 手札イカサマ：こっそり捨てる（消滅） =====
function sneakDiscardFromHand(handIndex) {
  const s = latestState;
  if (!s || !s.started || s.isGameOver) return;

  const ps = s.player;
  const cid = ps.hand[handIndex];
  if (cid == null) return;

  ps.hand.splice(handIndex, 1);

  s.cheatLog.push({ ts: Date.now() / 1000, by: "player", action: "sneak-discard", payload: { from: "hand", handIndex } });

  endGameIfNeeded();
  applyRender();
}

// ===== 相手場を壊すデモ =====
function destroyOpponentField(fieldIndex) {
  const s = latestState;
  if (!s || !s.started || s.isGameOver) return;
  if (fieldIndex == null) return;
  if (fieldIndex < 0 || fieldIndex >= s.opponent.field.length) return;

  s.opponent.field.splice(fieldIndex, 1);
  s.cheatLog.push({ ts: Date.now() / 1000, by: "player", action: "destroy-opponent-demo", payload: { fieldIndex } });

  endGameIfNeeded();
  applyRender();
}

/* =========================
   ✅ 十字型アクションメニュー
   ========================= */
let actionMenu = {
  open: false,
  kind: null,         // 今回は "hand" だけ
  index: null,        // handIndex
  selected: "up",     // "up" | "left" | "down" | "right"
  slots: {
    up:   null,       // { label, type, onConfirm }
    left: null,
    down: null,
    right:null,
  },
};

function positionActionMenu(x, y) {
  const m = qs("action-menu");
  if (!m) return;
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
}

function setActionSlot(dir, slot) {
  actionMenu.slots[dir] = slot;

  const box = qs(`action-${dir}`);
  const text = qs(`action-${dir}-text`);
  if (!box || !text) return;

  box.classList.remove("action-normal", "action-cheat", "action-empty", "action-selected");

  if (!slot || !slot.label) {
    box.classList.add("action-empty");
    text.textContent = "";
  } else {
    text.textContent = slot.label;
    if (slot.type === "normal") box.classList.add("action-normal");
    else if (slot.type === "cheat") box.classList.add("action-cheat");
    else box.classList.add("action-empty");
  }
}

function refreshActionSelectionUI() {
  ["up","left","down","right"].forEach(d => {
    const box = qs(`action-${d}`);
    if (!box) return;
    box.classList.remove("action-selected");
  });
  const sel = qs(`action-${actionMenu.selected}`);
  if (sel) sel.classList.add("action-selected");
}

function openActionMenuForHand(handIndex) {
  const s = latestState;
  if (!s || !s.started || s.isGameOver) return;
  const ps = s.player;
  if (handIndex == null || handIndex < 0 || handIndex >= ps.hand.length) return;

  const cid = ps.hand[handIndex];
  const card = CARD_DB.find(c => c.id === cid) || { name: "?", cost: 0 };

  actionMenu.open = true;
  actionMenu.kind = "hand";
  actionMenu.index = handIndex;
  actionMenu.selected = "up";

  // センター表示
  const center = qs("action-menu-center");
  if (center) center.textContent = `手札：${card.name}（cost:${card.cost}）`;

  // スロットを仕様通りにセット
  // 上：通常（青）「場に出す」
  setActionSlot("up", {
    label: "場に出す",
    type: "normal",
    onConfirm: () => playCardOffline(handIndex),
  });

  // 左：イカサマ（赤）「こっそり墓地に置く」
  setActionSlot("left", {
    label: "こっそり墓地に置く",
    type: "cheat",
    onConfirm: () => sneakToGraveFromHand(handIndex),
  });

  // 下：イカサマ（赤）「こっそり捨てる」
  setActionSlot("down", {
    label: "こっそり捨てる",
    type: "cheat",
    onConfirm: () => sneakDiscardFromHand(handIndex),
  });

  // 右：枠だけ（黒）＝空
  setActionSlot("right", null);

  const m = qs("action-menu");
  if (m) {
    m.style.display = "block";
    positionActionMenu(cursor.x, cursor.y);
  }
  refreshActionSelectionUI();
  applyRender();
}

function closeActionMenu() {
  actionMenu.open = false;
  actionMenu.kind = null;
  actionMenu.index = null;
  actionMenu.selected = "up";
  actionMenu.slots = { up:null, left:null, down:null, right:null };

  const m = qs("action-menu");
  if (m) m.style.display = "none";

  applyRender();
}

function moveActionSelection(dirKey) {
  // 十字キー入力 → その方向を選択（空でも選べる仕様はOK）
  if (dirKey === "ArrowUp") actionMenu.selected = "up";
  if (dirKey === "ArrowLeft") actionMenu.selected = "left";
  if (dirKey === "ArrowDown") actionMenu.selected = "down";
  if (dirKey === "ArrowRight") actionMenu.selected = "right";
  refreshActionSelectionUI();
}

function confirmActionSelection() {
  const slot = actionMenu.slots[actionMenu.selected];
  if (!slot || typeof slot.onConfirm !== "function") {
    // 空枠は何もしない（必要ならブザー音など追加できる）
    return;
  }
  // 実行して閉じる
  slot.onConfirm();
  closeActionMenu();
}

/* =========================
   Z：対象に応じて動く
   - 手札ならメニューを開く
   - それ以外は今まで通りデモ
   ========================= */
function doActionAtCursor() {
  if (!latestState || !latestState.started || latestState.isGameOver) return;

  const hit = hitTestAtScreen(cursor.x, cursor.y);
  if (!hit) return;

  // ✅ 手札：Zでメニュー表示
  if (hit.kind === "hand") {
    openActionMenuForHand(hit.index);
    return;
  }

  // それ以外：今はデモ（相手場なら破壊）
  if (hit.kind === "oppField") {
    destroyOpponentField(hit.index);
    return;
  }
}

// ===== 指摘UI（Cキー） =====
function openAccuseUI() {
  const ui = qs("accuse-ui");
  if (!ui) return;
  ui.style.display = "flex";

  let t = 10;
  const el = qs("accuse-timer");
  el.textContent = String(t);

  const timer = setInterval(() => {
    t--;
    el.textContent = String(t);
    if (t <= 0) { clearInterval(timer); closeAccuseUI(); }
  }, 1000);
  ui.dataset.timerId = String(timer);

  const opts = qs("cheat-options");
  opts.innerHTML = "";

  const now = Date.now() / 1000;
  const recent = (latestState.cheatLog || [])
    .filter(x => x.by === "opponent" && (now - x.ts) <= ACCUSE_WINDOW_SEC)
    .slice(-10)
    .reverse();

  if (recent.length === 0) {
    const div = document.createElement("div");
    div.className = "accuse-option";
    div.textContent = "直近10秒の相手イカサマはありません（押すと失敗扱い）";
    div.addEventListener("click", () => {
      latestState.player.penalty += 1;
      endGameIfNeeded();
      applyRender();
      closeAccuseUI();
    });
    opts.appendChild(div);
    return;
  }

  recent.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "accuse-option";
    div.textContent = `[${i}] ${item.action} (ts=${item.ts.toFixed(2)})`;
    div.addEventListener("click", () => {
      latestState.opponent.penalty += 1;
      latestState.cheatLog.push({ ts: Date.now() / 1000, by: "player", action: "accuse", payload: { targetTs: item.ts, targetAction: item.action } });
      endGameIfNeeded();
      applyRender();
      closeAccuseUI();
    });
    opts.appendChild(div);
  });
}

function closeAccuseUI() {
  const ui = qs("accuse-ui");
  if (!ui) return;
  const timerId = ui.dataset.timerId;
  if (timerId) clearInterval(Number(timerId));
  ui.style.display = "none";
  ui.dataset.timerId = "";
}

// ===== cheat menu（マウス） =====
function openCheatMenu(x, y) {
  const menu = qs("cheat-menu");
  if (!menu) return;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = "block";
}
function closeCheatMenu() {
  const menu = qs("cheat-menu");
  if (!menu) return;
  menu.style.display = "none";
}

function setupMenuEvents() {
  const menu = qs("cheat-menu");
  if (!menu) return;

  menu.querySelectorAll(".menu-item").forEach(item => {
    item.addEventListener("click", () => closeCheatMenu());
  });

  document.addEventListener("click", () => closeCheatMenu());
}

function setupButtons() {
  const startBtn = qs("btn-start");
  const endBtn = qs("btn-endturn");

  if (startBtn) startBtn.addEventListener("click", () => startGameOffline());
  if (endBtn) endBtn.addEventListener("click", () => {
    if (!latestState || !latestState.started) return;
    if (latestState.isGameOver) return;
    if (latestState.currentTurn !== "player") return;
    switchTurn();
  });

  const cancel = qs("accuse-cancel");
  if (cancel) cancel.addEventListener("click", () => closeAccuseUI());
}

// ===== 起動 =====
document.addEventListener("DOMContentLoaded", () => {
  setupMenuEvents();
  setupButtons();

  initThree(document.getElementById("game-3d-container"));

  setInputHandlers({
    onOpenCheat: (x, y) => openCheatMenu(x, y),
    onAccuse: () => openAccuseUI(),
  });

  latestState = newInitialState();
  showCursor(true);
  applyRender();

  const panel = qs("connection-panel");
  if (panel) panel.style.display = "none";

  window.addEventListener("resize", () => {
    cursor.x = clamp(cursor.x, 8, window.innerWidth - 8);
    cursor.y = clamp(cursor.y, 8, window.innerHeight - 8);
    applyRender();
  });

  // ===== キー押下 =====
  window.addEventListener("keydown", (e) => {
    const kRaw = e.key;
    const k = kRaw.toLowerCase();

    // ✅ アクションメニューが開いている時は「選択操作」優先
    if (isActionMenuOpen()) {
      if (kRaw === "ArrowUp" || kRaw === "ArrowDown" || kRaw === "ArrowLeft" || kRaw === "ArrowRight") {
        e.preventDefault();
        moveActionSelection(kRaw);
        applyRender();
        return;
      }
      if (k === "z") {
        e.preventDefault();
        if (!zDown && !e.repeat) {
          zDown = true;
          confirmActionSelection();
        }
        applyRender();
        return;
      }
      if (k === "x") {
        e.preventDefault();
        if (!xDown && !e.repeat) {
          xDown = true;
          closeActionMenu();
        }
        applyRender();
        return;
      }
      // メニュー中はその他キー無視
      return;
    }

    // ===== 通常時：カーソル移動 =====
    if (kRaw === "ArrowLeft") { e.preventDefault(); keys.left = true; startMoveLoop(); }
    if (kRaw === "ArrowRight") { e.preventDefault(); keys.right = true; startMoveLoop(); }
    if (kRaw === "ArrowUp") { e.preventDefault(); keys.up = true; startMoveLoop(); }
    if (kRaw === "ArrowDown") { e.preventDefault(); keys.down = true; startMoveLoop(); }

    // ===== Z：決定 =====
    if (k === "z") {
      e.preventDefault();
      if (!zDown && !e.repeat && !isModalOpen()) {
        zDown = true;
        doActionAtCursor();
      }
    }

    // ===== C：指摘 =====
    if (k === "c") {
      e.preventDefault();
      if (!cDown && !e.repeat && !isModalOpen()) {
        cDown = true;
        openAccuseUI();
      }
    }

    // ===== X：キャンセル =====
    if (k === "x") {
      e.preventDefault();
      if (!xDown && !e.repeat) {
        xDown = true;

        // 指摘UIが開いていれば閉じる
        const accuse = qs("accuse-ui");
        if (accuse && accuse.style.display === "flex") {
          closeAccuseUI();
          applyRender();
          return;
        }

        // cheatメニューが開いていれば閉じる
        const cheat = qs("cheat-menu");
        if (cheat && cheat.style.display === "block") {
          closeCheatMenu();
          applyRender();
          return;
        }
      }
    }

    applyRender();
  });

  // ===== キー離上 =====
  window.addEventListener("keyup", (e) => {
    const kRaw = e.key;
    const k = kRaw.toLowerCase();

    if (kRaw === "ArrowLeft") keys.left = false;
    if (kRaw === "ArrowRight") keys.right = false;
    if (kRaw === "ArrowUp") keys.up = false;
    if (kRaw === "ArrowDown") keys.down = false;

    if (k === "z") zDown = false;
    if (k === "x") xDown = false;
    if (k === "c") cDown = false;

    if (!keys.left && !keys.right && !keys.up && !keys.down) stopMoveLoop();

    applyRender();
  });

  window.addEventListener("blur", () => {
    keys.left = keys.right = keys.up = keys.down = false;
    zDown = false;
    xDown = false;
    cDown = false;
    stopMoveLoop();
    // 念のためメニューも閉じる
    closeActionMenu();
  });
});
