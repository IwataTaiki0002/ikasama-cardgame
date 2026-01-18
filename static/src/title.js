// タイトル画面の制御
document.addEventListener("DOMContentLoaded", () => {
  const titleScreen = document.getElementById("title-screen");
  const startButton = document.getElementById("start-button");
  const gameContainer = document.getElementById("game-3d-container");
  const centerPanel = document.querySelector(".center-panel");
  const helpOverlay = document.querySelector(".help-overlay");

  // 初期状態でゲーム画面を非表示
  if (gameContainer) {
    gameContainer.style.display = "none";
  }
  if (centerPanel) {
    centerPanel.style.display = "none";
  }
  if (helpOverlay) {
    helpOverlay.style.display = "none";
  }

  // スタートボタンが押されたらタイトル画面を非表示、ゲーム画面を表示
  startButton.addEventListener("click", () => {
    titleScreen.classList.add("hidden");
    setTimeout(() => {
      titleScreen.style.display = "none";
      if (gameContainer) {
        gameContainer.style.display = "block";
      }
      if (centerPanel) {
        centerPanel.style.display = "flex";
      }
      if (helpOverlay) {
        helpOverlay.style.display = "block";
      }
    }, 500); // CSSのtransition時間と同期
  });
});
