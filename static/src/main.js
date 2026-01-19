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
      // ...既存のオンライン処理...
      const roomId = "room-" + Math.random().toString(36).slice(2, 8);
      connectWebSocket(roomId, "create");
      const titleScreen = document.getElementById("title-screen");
      if (titleScreen) titleScreen.style.display = "none";
      const connectionPanel = document.getElementById("connection-panel");
      if (connectionPanel) connectionPanel.style.display = "block";
      const input = document.getElementById("room-id-input");
      const btn = document.getElementById("room-connect-btn");
      if (input) input.style.display = "none";
      if (btn) btn.style.display = "none";
      const roomIdLabel = document.getElementById("room-id-label");
      const roomIdRow = document.getElementById("room-id-row");
      if (roomIdLabel) roomIdLabel.textContent = roomId;
      if (roomIdRow) roomIdRow.style.display = "block";
      const statusEl = document.getElementById("connection-status");
      if (statusEl) statusEl.textContent = "接続待機中...";
    };
  }

  // === デバッグ用：通信なしで対戦画面に遷移 ===
  // タイトル画面に「オフライン対戦画面へ」ボタンを追加
  const debugBtn = document.createElement("button");
  debugBtn.textContent = "オフライン対戦画面へ";
  debugBtn.style.margin = "16px";
  debugBtn.onclick = () => {
    // タイトル画面を非表示、対戦画面を表示
    const titleScreen = document.getElementById("title-screen");
    const gameRoot = document.getElementById("game-root");
    if (titleScreen) titleScreen.style.display = "none";
    if (gameRoot) gameRoot.style.display = "block";
    // 3D初期化＋ダミーstate描画
    const container = document.getElementById("game-3d-container");
    if (container) {
      initThree(container);
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
    // カーソルも表示
    const kbCursor = document.getElementById("kb-cursor");
    if (kbCursor) {
      kbCursor.style.display = "block";
      if (gameRoot && kbCursor.parentNode !== gameRoot) {
        gameRoot.appendChild(kbCursor);
      }
    }
  };
  // タイトル画面のボタン群に追加
  const btnRow = document.querySelector(
    ".title-screen > div[style*='display: flex']",
  );
  if (btnRow) btnRow.appendChild(debugBtn);
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
  // 先攻後攻・マリガン・state管理用グローバル変数
  let latestState = null;
  let threeInitialized = false;
  let firstAttackOrder = null; // "player" または "opponent"
  let mulliganSelectedCards = []; // マリガンで選択されたカードIDの配列
  let mulliganDone = false;
  let attackOrderShown = false;
  let mulliganTimerInterval = null;
  let currentCardHovered = null; // 現在カーソルが当たっているカード

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
      // （グローバル変数に移動済み）

      // ...existing code...
      function transitionToBattle() {
        const connectionPanel = document.getElementById("connection-panel");
        const gameRoot = document.getElementById("game-root");
        if (connectionPanel) connectionPanel.style.display = "none";
        if (gameRoot) gameRoot.style.display = "block";

        // 対戦画面でキーボードカーソルを表示
        const kbCursor = document.getElementById("kb-cursor");
        if (kbCursor) {
          kbCursor.style.display = "block";
          // 対戦画面ではgame-root直下に移動（z-indexや重なりの問題を回避）
          const gameRoot = document.getElementById("game-root");
          if (gameRoot && kbCursor.parentNode !== gameRoot) {
            gameRoot.appendChild(kbCursor);
          }
        }
        // 対戦画面ではマウス操作を無効化（必要ならpointer-events: none等も追加可）
        // 3Dコンテナのマウスイベントを無効化したい場合は下記を有効化
        // const container = document.getElementById("game-3d-container");
        // if (container) container.style.pointerEvents = "none";
        const container = document.getElementById("game-3d-container");
        if (container && !threeInitialized) {
          initThree(container);
          threeInitialized = true;
        }
        // 画面遷移直後にも先攻・後攻を必ず表示
        if (firstAttackOrder) {
          updateAttackOrderDisplay();
        }
        // 以降はstate受信時にrenderFromStateのみ呼ぶ
      }
      function updateAttackOrderDisplay(state) {
        if (attackOrderShown) return; // 既に表示済みなら何もしない

        // 新しいゲーム開始時にマリガンメッセージ状態をリセット
        mulliganMessageShown = false;

        const playerOrderEl = document.getElementById("player-attack-order");
        const opponentOrderEl = document.getElementById(
          "opponent-attack-order",
        );
        if (playerOrderEl) playerOrderEl.style.display = "block";
        if (opponentOrderEl) opponentOrderEl.style.display = "block";
        if (playerOrderEl && opponentOrderEl && firstAttackOrder) {
          attackOrderShown = true; // フラグを設定
          // 自分のロールとfirstAttackRoleを比較して表示を分岐
          const isMeFirst = myRole === firstAttackOrder;
          if (isMeFirst) {
            playerOrderEl.textContent = "先攻";
            playerOrderEl.style.color = "#ff4444";
            opponentOrderEl.textContent = "後攻";
            opponentOrderEl.style.color = "#4466ff";
          } else {
            playerOrderEl.textContent = "後攻";
            playerOrderEl.style.color = "#4466ff";
            opponentOrderEl.textContent = "先攻";
            opponentOrderEl.style.color = "#ff4444";
          }
          // 3秒後に自動で非表示し、0.5秒後にマリガン吹き出しを表示
          setTimeout(() => {
            if (playerOrderEl) playerOrderEl.style.display = "none";
            if (opponentOrderEl) opponentOrderEl.style.display = "none";

            // 先攻後攻表示が消えてから0.5秒後にマリガンメッセージを表示開始
            setTimeout(() => {
              if (state && state.isMulliganPhase && state.mulliganTimer > 0) {
                showMulliganMessage(state);
              }
            }, 500);
          }, 3000);
          // マリガン用タイマー
          function startMulliganTimer() {
            // サーバーstateのmulliganTimerのみでUIを制御するため、ローカルタイマーは廃止
            // タイマー表示はupdateMulliganUIで行う
            // 必要なら自動でマリガン確定処理をここに追加可能
          }
        }
      }
      if (msg.type === "state" && msg.state) {
        latestState = msg.state;
        // サーバーstateから先攻・後攻を取得（初回のみ表示）
        if (msg.state.firstAttackRole && !attackOrderShown) {
          firstAttackOrder = msg.state.firstAttackRole;
          updateAttackOrderDisplay(msg.state);
        }
        // マリガンフェーズの処理
        if (msg.state.isMulliganPhase) {
          handleMulliganDisplay(msg.state);
        } else {
          hideMulliganMessage();
        }
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
          if (typeof showOpponentFoundUI === "function") showOpponentFoundUI();
        } else {
          // started: falseなら待機画面のまま
          // 必要なら「接続待機中」など表示
        }
      }
      if (msg.type === "realtime") {
        // リアルタイム情報（タイマー・カーソル）の処理
        if (msg.timer !== null && msg.timer !== undefined) {
          updateTimerDisplay(msg.timer);
        }
        if (msg.mulliganTimer !== null && msg.mulliganTimer !== undefined) {
          updateMulliganTimer(msg.mulliganTimer);
        }
        if (msg.cursors) {
          updateOpponentCursor(msg.cursors);
        }
      }
      if (msg.type === "realtime") {
        // リアルタイム情報（タイマー・カーソル）の処理
        if (msg.timer !== null && msg.timer !== undefined) {
          updateTimerDisplay(msg.timer);
        }
        if (msg.mulliganTimer !== null && msg.mulliganTimer !== undefined) {
          updateMulliganTimer(msg.mulliganTimer);
        }
        if (msg.cursors) {
          updateOpponentCursor(msg.cursors);
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

  // =========================
  // リアルタイム情報処理関数
  // =========================

  function updateTimerDisplay(seconds) {
    const timerEl = document.getElementById("timer");
    if (timerEl && !latestState?.isMulliganPhase) {
      timerEl.textContent = String(seconds);
      timerEl.classList.remove("warning", "danger");
      if (seconds <= 10) timerEl.classList.add("warning");
      if (seconds <= 3) timerEl.classList.add("danger");
    }
  }

  function updateOpponentCursor(cursors) {
    // 相手のカーソル表示処理
    const opponentRole = myRole === "player" ? "opponent" : "player";
    const opponentCursor = cursors[opponentRole];
    
    if (opponentCursor) {
      // 相手のカーソル表示を更新（必要に応じて実装）
      console.log("相手のカーソル:", opponentCursor);
    }
  }

  // カーソル位置をサーバーに送信（ハイライト情報は送信しない）
  function sendCursorUpdate(x, y, cardId = null) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // ハイライト情報は送信せず、位置情報のみ送信
      const payload = { x, y };
      // cardIdは送信しない（ローカルのハイライトのみ）
      
      ws.send(JSON.stringify({
        type: "action",
        action: "cursor",
        payload: payload
      }));
    }
  }

  // =========================
  // 新しいマリガンUI関数（シンプル版）
  // =========================

  let mulliganMessageShown = false; // マリガンメッセージが表示中かどうか

  function showMulliganMessage(state) {
    if (!state || !state.isMulliganPhase || mulliganMessageShown) return;

    const message = document.getElementById("mulligan-message");
    const timer = document.getElementById("timer");

    if (message) {
      message.style.display = "block";
      message.classList.add("show");
      message.classList.remove("hide");
      mulliganMessageShown = true;
      updateMulliganTimer(state.mulliganTimer);
    }

    // タイマー要素を表示してマリガン時間を表示
    if (timer) {
      timer.style.display = "block";
      timer.textContent = state.mulliganTimer;
    }
  }

  function hideMulliganMessage() {
    const message = document.getElementById("mulligan-message");
    const timer = document.getElementById("timer");

    if (message && mulliganMessageShown) {
      message.classList.add("hide");
      message.classList.remove("show");
      mulliganMessageShown = false;
      // アニメーション完了後に完全に非表示
      setTimeout(() => {
        message.style.display = "none";
      }, 300);
    }

    // タイマー要素も非表示
    if (timer) {
      timer.style.display = "none";
    }
  }

  function updateMulliganTimer(seconds) {
    const timer = document.getElementById("timer");
    if (timer && mulliganMessageShown) {
      timer.textContent = seconds;
      // タイマーの色を変更
      if (seconds <= 3) {
        timer.style.color = "#ff0000";
        timer.classList.add("danger");
      } else if (seconds <= 5) {
        timer.style.color = "#ff8800";
        timer.classList.add("warning");
      } else {
        timer.style.color = "#fff";
        timer.classList.remove("warning", "danger");
      }
    }
  }

  // マリガンメッセージの表示タイミング制御
  function handleMulliganDisplay(state) {
    // マリガンフェーズ終了時は即座に非表示
    if (!state.isMulliganPhase || state.mulliganTimer <= 0) {
      hideMulliganMessage();
      return;
    }

    // マリガンタイマーの更新のみ（表示/非表示は先攻後攻表示後に制御）
    if (mulliganMessageShown) {
      updateMulliganTimer(state.mulliganTimer);
    }
  }

  // =========================
  // マリガンカード選択関数
  // =========================

  // カードの選択状態を切り替える
  function toggleMulliganCardSelection(cardId) {
    if (!latestState || !latestState.isMulliganPhase) return;

    const index = mulliganSelectedCards.indexOf(cardId);
    if (index >= 0) {
      // 選択解除
      mulliganSelectedCards.splice(index, 1);
    } else {
      // 選択
      mulliganSelectedCards.push(cardId);
    }

    // カードのハイライト表示を更新（Three.jsで処理）
    updateMulliganCardHighlights();

    console.log("選択されたカード:", mulliganSelectedCards);
  }

  // カードのハイライト表示を更新（Three.js用に修正）
  function updateMulliganCardHighlights() {
    // Three.jsでハイライト処理する場合は、render-3d.jsの関数を呼び出し
    if (typeof updateCardSelectionHighlights === "function") {
      updateCardSelectionHighlights(mulliganSelectedCards);
    }
  }

  // カーソル位置にあるカードを取得（Three.js Raycaster使用）
  function getCardAtCursor() {
    if (!latestState || !latestState.player || !latestState.player.hand)
      return null;

    // render-3d.jsのgetCardUnderCursor関数を使用
    if (typeof getCardUnderCursor === "function") {
      const kbCursor = document.getElementById("kb-cursor");
      if (!kbCursor) return null;

      const cursorRect = kbCursor.getBoundingClientRect();
      const x = cursorRect.left + cursorRect.width / 2;
      const y = cursorRect.top + cursorRect.height / 2;

      return getCardUnderCursor(x, y);
    }

    return null;
  }

  // カードホバー状態を更新（Three.js用に修正）
  function updateCardHover() {
    const hoveredCard = getCardAtCursor();

    // カーソルが合い続けている間は常にハイライトを維持
    if (typeof updateCardHover3D === "function") {
      updateCardHover3D(hoveredCard, currentCardHovered);
    }

    currentCardHovered = hoveredCard;

    // カーソルラベルを更新
    const kbCursorLabel = document.getElementById("kb-cursor-label");
    if (kbCursorLabel) {
      if (currentCardHovered && latestState && latestState.isMulliganPhase) {
        const isSelected = mulliganSelectedCards.includes(currentCardHovered);
        kbCursorLabel.textContent = isSelected ? "選択解除" : "選択";
      } else {
        kbCursorLabel.textContent = "";
      }
    }
  }

  // =========================
  // カーソル移動・UI操作関数
  // =========================

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

        // 対戦画面でのカードホバー更新
        const isBattle = gameRoot && gameRoot.style.display !== "none";
        if (isBattle) {
          updateCardHover();
          // カーソル位置をサーバーに送信（ハイライト情報は送信しない）
          sendCursorUpdate(titleCursorX, titleCursorY);
        }
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

  // タイトル画面・対戦画面のキーボード操作
  document.addEventListener("keydown", (e) => {
    const k = e.key;
    // タイトル画面 or 対戦画面が表示中のみカーソル移動
    const isTitle = titleScreen && titleScreen.style.display !== "none";
    const isBattle = gameRoot && gameRoot.style.display !== "none";
    if (isTitle || isBattle) {
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
      // Z/Enter/Spaceで決定
      if (k.toLowerCase() === "z" || k === "Enter" || k === " ") {
        e.preventDefault();
        if (isTitle) {
          // タイトル画面：カーソルがボタン上なら遷移
          if (!startButton) {
            console.error("startButton not found");
            return;
          }
          const rect = startButton.getBoundingClientRect();
          if (
            titleCursorX >= rect.left &&
            titleCursorX <= rect.right &&
            titleCursorY >= rect.top &&
            titleCursorY <= rect.bottom
          ) {
            beginTransition();
          } else {
            beginTransition();
          }
        } else if (isBattle) {
          // 対戦画面：マリガンフェーズ中の場合、カード選択
          if (
            latestState &&
            latestState.isMulliganPhase &&
            currentCardHovered
          ) {
            toggleMulliganCardSelection(currentCardHovered);
          }
          // console.log("Battle Z/Enter pressed");
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
  // タイトル画面に戻るときはカーソルを非表示にする
  function showTitleScreen() {
    if (titleScreen) titleScreen.style.display = "flex";
    if (gameRoot) gameRoot.style.display = "none";
    const kbCursor = document.getElementById("kb-cursor");
    if (kbCursor) kbCursor.style.display = "block";
  }
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
