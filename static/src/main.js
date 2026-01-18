// main.js: ゲーム進行・UI制御・タイトル画面→ゲーム画面遷移
import { initThree, renderFromState } from "/static/src/render-3d.js";

let gameStarted = false;
let currentTurn = "player";
let timer = 60;
let timerInterval = null;

// タイトル画面のカーソル制御用
let titleCursorX = window.innerWidth * 0.5;
let titleCursorY = window.innerHeight * 0.8;
const CURSOR_SPEED = 420;
let keys = { up: false, down: false, left: false, right: false };
let moveLoop = null;

document.addEventListener("DOMContentLoaded", () => {
  // タイトル画面の部屋ボタンイベント
  const createRoomBtn = document.getElementById("create-room-btn");
  const findRoomBtn = document.getElementById("find-room-btn");
  if (createRoomBtn) {
    createRoomBtn.onclick = () => {
      // ランダムなルームIDを生成して接続
      const roomId = "room-" + Math.random().toString(36).slice(2, 8);
      connectWebSocket(roomId, "create"); // 部屋作成モード
      // タイトル画面を非表示、接続パネルを表示
      const titleScreen = document.getElementById("title-screen");
      if (titleScreen) titleScreen.style.display = "none";
      const connectionPanel = document.getElementById("connection-panel");
      if (connectionPanel) connectionPanel.style.display = "block";
      // ルームID入力欄を非表示
      const input = document.getElementById("room-id-input");
      const btn = document.getElementById("room-connect-btn");
      if (input) input.style.display = "none";
      if (btn) btn.style.display = "none";
      // 生成したルームIDをラベルに表示
      const roomIdLabel = document.getElementById("room-id-label");
      const roomIdRow = document.getElementById("room-id-row");
      if (roomIdLabel) roomIdLabel.textContent = roomId;
      if (roomIdRow) roomIdRow.style.display = "block";
      // ステータスを「接続待機中...」に明示的に表示
      const statusEl = document.getElementById("connection-status");
      if (statusEl) statusEl.textContent = "接続待機中...";
    };
  }
  if (findRoomBtn) {
    findRoomBtn.onclick = () => {
      // タイトル画面を非表示、接続パネルを表示
      const titleScreen = document.getElementById("title-screen");
      if (titleScreen) titleScreen.style.display = "none";
      const connectionPanel = document.getElementById("connection-panel");
      if (connectionPanel) connectionPanel.style.display = "block";
      // ルームID入力欄と接続ボタンを表示
      const input = document.getElementById("room-id-input");
      const btn = document.getElementById("room-connect-btn");
      if (input) {
        input.style.display = "block";
        input.focus();
      }
      if (btn) btn.style.display = "block";
      // ルームIDラベルとその行を消す
      const roomIdLabel = document.getElementById("room-id-label");
      const roomIdRow = document.getElementById("room-id-row");
      if (roomIdLabel) roomIdLabel.textContent = "";
      if (roomIdRow) roomIdRow.style.display = "none";
    };
  }
  // 初期状態でルームIDラベルに「未入力」を表示
  const roomIdLabel = document.getElementById("room-id-label");
  if (roomIdLabel) roomIdLabel.textContent = "未入力";
  // ===== WebSocket通信機能 =====
  let ws = null;
  let myRole = "player";
  let currentRoomId = "";

  function connectWebSocket(roomId, mode = "create") {
    if (ws) ws.close();
    ws = new WebSocket(`ws://127.0.0.1:8000/ws/${roomId}?mode=${mode}`);
    const showRoomId = mode === "create";
    if (showRoomId) {
      document.getElementById("room-id-label").textContent = roomId;
    }
    ws.onopen = () => {
      // 部屋作成時は「接続待機中...」を表示
      document.getElementById("connection-status").textContent =
        "接続待機中...";
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log("受信msg:", JSON.stringify(msg, null, 2));
      if (msg.type === "hello") {
        myRole = msg.role;
        const myRoleEl = document.getElementById("my-role");
        if (myRoleEl) myRoleEl.textContent = myRole;
        if (showRoomId) {
          document.getElementById("room-id-label").textContent = roomId;
        }
        // 参加通知メッセージに応じてステータス表示
        if (msg.role === "player") {
          document.getElementById("connection-status").textContent =
            "接続待機中...";
        } else if (msg.role === "opponent") {
          document.getElementById("connection-status").textContent =
            "対戦相手が見つかりました";
        }
      }
      // 最新のstateを保持
      let latestState = null;
      let threeInitialized = false;
      function transitionToBattle() {
        const connectionPanel = document.getElementById("connection-panel");
        const gameRoot = document.getElementById("game-root");
        if (connectionPanel) connectionPanel.style.display = "none";
        if (gameRoot) gameRoot.style.display = "block";
        const container = document.getElementById("game-3d-container");
        if (container && !threeInitialized) {
          initThree(container);
          threeInitialized = true;
        }
        // 以降はstate受信時にrenderFromStateのみ呼ぶ
      }
      if (msg.type === "state" && msg.state) {
        latestState = msg.state;
        // デバッグ: 受信stateの中身を確認
        console.log("state.player", latestState.player);
        console.log("state.opponent", latestState.opponent);
        console.log("state.cards", latestState.cards);
        // 対戦画面に遷移済みなら描画
        const gameRoot = document.getElementById("game-root");
        const container = document.getElementById("game-3d-container");
        if (gameRoot && gameRoot.style.display === "block" && container) {
          renderFromState(latestState, myRole);
        }
        // 通信相手が見つかったらUI表示
        if (msg.state.started) {
          showOpponentFoundUI();
        } else {
          // started: falseなら待機画面のまま
          // 必要なら「接続待機中」など表示
        }
      }
      if (msg.type === "system" && msg.message) {
        document.getElementById("connection-status").textContent = msg.message;
        // 対戦相手が見つかったら1秒後に自動で対戦画面へ
        if (msg.message === "対戦相手が見つかりました") {
          // 入力欄と検索ボタンを非表示
          const input = document.getElementById("room-id-input");
          const btn = document.getElementById("room-connect-btn");
          if (input) input.style.display = "none";
          if (btn) btn.style.display = "none";
          // ルームIDを表示
          const roomIdLabel = document.getElementById("room-id-label");
          const roomIdRow = document.getElementById("room-id-row");
          if (roomIdLabel) roomIdLabel.textContent = currentRoomId;
          if (roomIdRow) roomIdRow.style.display = "block";
          // 1秒後に自動で対戦画面へ
          setTimeout(() => {
            transitionToBattle();
          }, 1000);
        }
      }
      if (msg.type === "ack") {
        // 操作結果
        document.getElementById("connection-status").textContent = msg.reason;
      }
      if (msg.type === "error") {
        // エラーメッセージを表示
        alert(msg.message || "エラーが発生しました");
        document.getElementById("connection-status").textContent =
          msg.message || "エラー";
        // 接続パネルを閉じてタイトル画面に戻る
        const connectionPanel = document.getElementById("connection-panel");
        const titleScreen = document.getElementById("title-screen");
        if (connectionPanel) connectionPanel.style.display = "none";
        if (titleScreen) titleScreen.style.display = "flex";
      }
    };
    ws.onclose = () => {
      document.getElementById("connection-status").textContent = "未接続";
    };
    currentRoomId = roomId;
  }

  // 接続パネルのルームID入力・接続ボタン
  const connectionPanel = document.getElementById("connection-panel");
  if (connectionPanel) {
    // ルームID入力欄とボタンを追加（初期は非表示）
    let input = document.createElement("input");
    input.type = "text";
    input.placeholder = "ルームIDを入力";
    input.id = "room-id-input";
    input.style.margin = "8px";
    input.style.display = "none"; // 初期非表示
    let btn = document.createElement("button");
    btn.textContent = "接続";
    btn.id = "room-connect-btn";
    btn.style.margin = "8px";
    btn.style.display = "none"; // 初期非表示
    btn.onclick = () => {
      const roomId = input.value.trim();
      if (!roomId) {
        alert("ルームIDを入力してください");
        input.focus();
        return;
      }
      connectWebSocket(roomId, "join"); // 部屋を探すモード
    };
    connectionPanel.appendChild(input);
    connectionPanel.appendChild(btn);
  }
  console.log("main.js loaded");

  // タイトル・ゲーム画面のDOM取得
  const titleScreen = document.getElementById("title-screen");
  const gameRoot = document.getElementById("game-root");
  const startButton = document.getElementById("start-button");
  const kbCursor = document.getElementById("kb-cursor");
  const kbCursorLabel = document.getElementById("kb-cursor-label");

  // 先攻・後攻表示用のDOM取得
  const indicator = document.getElementById("first-attack-indicator");
  const timerEl = document.getElementById("timer");
  const playerLabel = document.getElementById("player-turn-label");
  const opponentLabel = document.getElementById("opponent-turn-label");

  // タイトル画面のカーソル制御
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function getStartButtonCenter() {
    if (!startButton)
      return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.8 };
    const rect = startButton.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function updateTitleCursor() {
    if (!kbCursor) return;
    kbCursor.style.left = titleCursorX + "px";
    kbCursor.style.top = titleCursorY + "px";
    if (!startButton || !kbCursorLabel) return;
    const rect = startButton.getBoundingClientRect();
    if (
      titleCursorX >= rect.left &&
      titleCursorX <= rect.right &&
      titleCursorY >= rect.top &&
      titleCursorY <= rect.bottom
    ) {
      kbCursorLabel.textContent = "START";
    } else {
      kbCursorLabel.textContent = "";
    }
  }

  function startMoveLoop() {
    if (moveLoop) return;
    let lastT = performance.now();
    function loop(now) {
      const dt = (now - lastT) / 1000;
      lastT = now;
      let dx = 0,
        dy = 0;
      if (keys.left) dx -= 1;
      if (keys.right) dx += 1;
      if (keys.up) dy -= 1;
      if (keys.down) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        titleCursorX += dx * CURSOR_SPEED * dt;
        titleCursorY += dy * CURSOR_SPEED * dt;
        titleCursorX = clamp(titleCursorX, 8, window.innerWidth - 8);
        titleCursorY = clamp(titleCursorY, 8, window.innerHeight - 8);
        updateTitleCursor();
      }
      moveLoop = requestAnimationFrame(loop);
    }
    moveLoop = requestAnimationFrame(loop);
  }

  function stopMoveLoop() {
    if (moveLoop) cancelAnimationFrame(moveLoop);
    moveLoop = null;
  }

  // 初期位置をスタートボタン中央に
  const center = getStartButtonCenter();
  titleCursorX = center.x;
  titleCursorY = center.y;
  updateTitleCursor();

  // タイトル画面のキーボード操作
  document.addEventListener("keydown", (e) => {
    // タイトル画面が表示中のみカーソル移動
    if (titleScreen && titleScreen.style.display !== "none") {
      const k = e.key;
      if (k === "ArrowLeft") {
        e.preventDefault();
        keys.left = true;
        startMoveLoop();
      }
      if (k === "ArrowRight") {
        e.preventDefault();
        keys.right = true;
        startMoveLoop();
      }
      if (k === "ArrowUp") {
        e.preventDefault();
        keys.up = true;
        startMoveLoop();
      }
      if (k === "ArrowDown") {
        e.preventDefault();
        keys.down = true;
        startMoveLoop();
      }
      // Z/Enter/Spaceでスタート
      if (k.toLowerCase() === "z" || k === "Enter" || k === " ") {
        console.log("Start key pressed!");
        e.preventDefault();
        // カーソルがボタン上なら遷移
        if (!startButton) {
          console.error("startButton not found");
          return;
        }
        const rect = startButton.getBoundingClientRect();
        console.log("cursor:", titleCursorX, titleCursorY);
        console.log("button rect:", rect);
        if (
          titleCursorX >= rect.left &&
          titleCursorX <= rect.right &&
          titleCursorY >= rect.top &&
          titleCursorY <= rect.bottom
        ) {
          console.log("Starting transition!");
          beginTransition();
        } else {
          console.log("Cursor not on button - forcing transition anyway");
          beginTransition();
        }
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") keys.left = false;
    if (k === "ArrowRight") keys.right = false;
    if (k === "ArrowUp") keys.up = false;
    if (k === "ArrowDown") keys.down = false;
    if (!keys.left && !keys.right && !keys.up && !keys.down) stopMoveLoop();
  });

  window.addEventListener("resize", () => {
    if (titleScreen && titleScreen.style.display !== "none") {
      titleCursorX = clamp(titleCursorX, 8, window.innerWidth - 8);
      titleCursorY = clamp(titleCursorY, 8, window.innerHeight - 8);
      updateTitleCursor();
    }
  });

  // タイトル→ゲーム画面への遷移・暗転・ゲーム開始
  function beginTransition() {
    if (titleScreen) titleScreen.style.display = "none";
    if (gameRoot) gameRoot.style.display = "none";
    // 接続パネルのみ表示
    const connectionPanel = document.getElementById("connection-panel");
    if (connectionPanel) connectionPanel.style.display = "block";
    stopMoveLoop();
  }

  // ゲーム開始処理
  async function startGame() {
    console.log("startGame called");
    if (gameStarted) {
      console.log("game already started");
      return;
    }

    // 3D初期化
    const container = document.getElementById("game-3d-container");
    if (container) {
      initThree(container);
      // 初期状態（仮データ）を描画
      const initialState = {
        player: {
          hand: [1, 2, 3],
          field: [],
          deck: 10,
          hp: 20,
          mana: 5,
          grave: [],
        },
        opponent: {
          hand: [4, 5, 6],
          field: [],
          deck: 10,
          hp: 20,
          mana: 5,
          grave: [],
        },
        cards: [
          { id: 1, name: "カードA", cost: 1, power: 2, toughness: 2 },
          { id: 2, name: "カードB", cost: 2, power: 3, toughness: 3 },
          { id: 3, name: "カードC", cost: 3, power: 4, toughness: 4 },
          { id: 4, name: "カードD", cost: 1, power: 2, toughness: 2 },
          { id: 5, name: "カードE", cost: 2, power: 3, toughness: 3 },
          { id: 6, name: "カードF", cost: 3, power: 4, toughness: 4 },
        ],
      };
      renderFromState(initialState, "player");
    }

    if (!indicator) {
      console.error("first-attack-indicator not found");
      return;
    }

    try {
      console.log("fetching /api/first_attack");
      const res = await fetch("/api/first_attack", { method: "POST" });
      console.log("response:", res);
      const data = await res.json();
      console.log("data:", data);

      // 先攻を設定
      currentTurn = data.first;
      gameStarted = true;

      // 先攻・後攻表示
      if (data.first === "player") {
        indicator.textContent = "あなたが先攻";
      } else {
        indicator.textContent = "相手が先攻";
      }
      indicator.style.display = "block";
      console.log("indicator displayed");

      setTimeout(() => {
        indicator.style.display = "none";
        console.log("indicator hidden");
      }, 3000);

      // ターン表示更新
      updateTurnLabels();

      // タイマー開始
      startTimer();
    } catch (e) {
      console.error("Error:", e);
      if (indicator) {
        indicator.textContent = "ゲーム開始に失敗";
        indicator.style.display = "block";
        setTimeout(() => {
          indicator.style.display = "none";
        }, 3000);
      }
    }
  }

  // ターン表示更新
  function updateTurnLabels() {
    if (playerLabel && opponentLabel) {
      playerLabel.style.opacity = currentTurn === "player" ? "1" : "0.35";
      opponentLabel.style.opacity = currentTurn === "opponent" ? "1" : "0.35";
    }
  }

  // タイマー開始
  function startTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    timer = 60;
    if (timerEl) {
      timerEl.textContent = String(timer);
    }

    timerInterval = setInterval(() => {
      timer--;
      if (timerEl) {
        timerEl.textContent = String(timer);
        timerEl.classList.remove("warning", "danger");
        if (timer <= 10) timerEl.classList.add("warning");
        if (timer <= 3) timerEl.classList.add("danger");
      }

      if (timer <= 0) {
        switchTurn();
      }
    }, 1000);
  }

  // ターン切り替え
  function switchTurn() {
    currentTurn = currentTurn === "player" ? "opponent" : "player";
    updateTurnLabels();
    startTimer();
  }
});
