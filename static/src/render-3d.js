// static/src/render-3d.js
let scene, camera, renderer, raycaster, mouse;
let rafId = null;

let input = {
  onPlayCard: null, // handIndex
  onOpenCheat: null, // x,y
  onAccuse: null,
  onCursorAction: null, // (hitInfo) -> main.jsが解釈する
};

let cardMeshes = [];
let oppCardMeshes = [];
let myFieldMeshes = [];
let oppFieldMeshes = [];

let tableGroup = null;
let deckGroupPlayer = null;
let deckGroupOpponent = null;

// ✅ 追加：山札は「枚数が変わった時だけ」作り直す
let lastDeckCountPlayer = null;
let lastDeckCountOpponent = null;

let chips = {
  player: { hp: null, mana: null },
  opponent: { hp: null, mana: null },
};

const MAX_HP_TOKENS = 20;
const MAX_MANA_TOKENS = 10;

// ✅ 追加：エリア枠線（ゾーン表示）
let zoneGroup = null;

// ✅ 追加：墓地表示（数枚だけ重ねる）
let graveGroupPlayer = null;
let graveGroupOpponent = null;
let lastGraveKeyPlayer = null;
let lastGraveKeyOpponent = null;
const GRAVE_SHOW_MAX = 5;

// ===== util =====
function clearMeshes(arr) {
  arr.forEach((m) => scene.remove(m));
  arr.length = 0;
}
function safeRemove(obj) {
  if (obj) scene.remove(obj);
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ===== カード描画（CanvasTexture） =====
function makeCardTexture(card, faceUp) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 716;
  const ctx = canvas.getContext("2d");

  if (!faceUp) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#888";
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

    ctx.fillStyle = "#888";
    ctx.font = "bold 70px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BACK", canvas.width / 2, canvas.height / 2);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#667eea");
    grad.addColorStop(1, "#000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 12;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

    ctx.fillStyle = "#ffff00";
    ctx.beginPath();
    ctx.arc(70, 80, 50, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#000";
    ctx.font = "bold 60px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(card?.cost ?? 0), 70, 80);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 52px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(card?.name ?? "CARD"), canvas.width / 2, 200);

    ctx.font = "bold 90px Arial";
    ctx.fillStyle = "#ff6b6b";
    ctx.textAlign = "left";
    ctx.fillText(String(card?.power ?? 0), 50, canvas.height - 60);

    ctx.fillStyle = "#4ecdc4";
    ctx.textAlign = "right";
    ctx.fillText(
      String(card?.toughness ?? 0),
      canvas.width - 50,
      canvas.height - 60,
    );
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createCardMesh(card, faceUp) {
  const geo = new THREE.PlaneGeometry(1.8, 2.5);
  const mat = new THREE.MeshStandardMaterial({
    map: makeCardTexture(card, faceUp),
    side: THREE.DoubleSide,
    emissive: 0x000000, // 通常時は黒
    emissiveIntensity: 0.5,
  });
  return new THREE.Mesh(geo, mat);
}

// ===== lights/table =====
function setupLights() {
  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(0, 25, 0);
  scene.add(dir);

  const point1 = new THREE.PointLight(0xffffcc, 0.35, 80);
  point1.position.set(-15, 15, -10);
  scene.add(point1);

  const point2 = new THREE.PointLight(0xffffcc, 0.35, 80);
  point2.position.set(15, 15, 10);
  scene.add(point2);
}

function createTable() {
  if (tableGroup) safeRemove(tableGroup);

  tableGroup = new THREE.Group();

  const tableGeo = new THREE.BoxGeometry(22, 0.5, 18);
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x2d5a2d,
    roughness: 0.85,
    metalness: 0.0,
  });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.position.y = -0.5;
  tableGroup.add(table);

  const edgeGeo = new THREE.BoxGeometry(23, 1, 19);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d2e,
    roughness: 0.6,
    metalness: 0.25,
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.y = -1;
  tableGroup.add(edge);

  scene.add(tableGroup);
}

/* =========================
   ✅ ゾーン枠線
   ========================= */

// 机の天面に重ならないよう少し浮かせる
const ZONE_Y = -0.24 + 0.03; // テーブル上の少し上（Z-fighting回避）

function makeRectLine(w, h, color = 0xffffff) {
  const mat = new THREE.LineBasicMaterial({ color });

  const hw = w / 2;
  const hh = h / 2;

  const pts = [
    new THREE.Vector3(-hw, 0, -hh),
    new THREE.Vector3(+hw, 0, -hh),

    new THREE.Vector3(+hw, 0, -hh),
    new THREE.Vector3(+hw, 0, +hh),

    new THREE.Vector3(+hw, 0, +hh),
    new THREE.Vector3(-hw, 0, +hh),

    new THREE.Vector3(-hw, 0, +hh),
    new THREE.Vector3(-hw, 0, -hh),
  ];

  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineSegments(geo, mat);
}

function addZoneRect(name, center, w, h, color = 0xffffff) {
  const rect = makeRectLine(w, h, color);
  rect.position.set(center.x, center.y, center.z);
  rect.userData = { kind: "zone", name };
  zoneGroup.add(rect);
}

// 現在のチップ/山札の配置に合わせて枠を置く
function createZones() {
  safeRemove(zoneGroup);
  zoneGroup = new THREE.Group();

  // ===== プレイヤー側 =====
  addZoneRect(
    "P_MANA",
    new THREE.Vector3(0.1, ZONE_Y, 5.39),
    11.7,
    1.52,
    0xffffff,
  );
  addZoneRect("P_HP", new THREE.Vector3(0.1, ZONE_Y, 7.4), 11.7, 2.5, 0xffffff);

  // ※ここはあなたの現状コードのまま（枠の場所）
  addZoneRect(
    "P_DECK",
    new THREE.Vector3(8.4, ZONE_Y, 4.7),
    2.6,
    3.5,
    0xffffff,
  );
  addZoneRect(
    "P_GRAVE",
    new THREE.Vector3(-8.25, ZONE_Y, 4.7),
    2.6,
    3.5,
    0xffffff,
  );

  // ===== 相手側 =====
  addZoneRect(
    "O_MANA",
    new THREE.Vector3(0.1, ZONE_Y, -4.7),
    12.2,
    1.6,
    0xffffff,
  );
  addZoneRect(
    "O_HP",
    new THREE.Vector3(0.1, ZONE_Y, -6.8),
    12.2,
    2.6,
    0xffffff,
  );

  addZoneRect(
    "O_DECK",
    new THREE.Vector3(-8.25, ZONE_Y, -4.0), // 相手の山札の中心座標に移動
    2.6,
    3.8,
    0xffffff,
  );
  addZoneRect(
    "O_GRAVE",
    new THREE.Vector3(8.4, ZONE_Y, -4.0),
    2.6, //縦
    3.8, //横
    0xffffff,
  );

  scene.add(zoneGroup);
}

/* =========================
   ✅ 墓地（捨て札）表示：数枚だけ重ねて置く
   ========================= */

function graveKeyFromArray(arr) {
  if (!arr || !arr.length) return "";
  // 重いハッシュは不要。末尾10枚ぐらいでキー化（表示も最大5枚なので十分）
  const tail = arr.slice(-10);
  return tail.join(",");
}

function buildGraveStack(cardIds, cardsById, centerPos, faceUp = true) {
  const group = new THREE.Group();

  // 末尾から最大GRAVE_SHOW_MAX枚を表示（新しいカードが上）
  const list = (cardIds || []).slice(-GRAVE_SHOW_MAX);

  // 机の上に置く（deckと同じぐらいの高さ）
  const baseY = 0.12;

  for (let i = 0; i < list.length; i++) {
    const cid = list[i];
    const card = cardsById.get(cid) || {
      name: "?",
      cost: 0,
      power: 0,
      toughness: 0,
    };

    const mesh = createCardMesh(card, faceUp);

    // 平置き
    mesh.rotation.x = -Math.PI / 2;

    // ✅ “重ねてる感”のために少しずつズラす（ランダム無しで固定）
    // 下→上に向けて、わずかに右上へ
    const dx = i * 0.07;
    const dz = i * 0.05;
    const dy = i * 0.012;

    mesh.position.set(centerPos.x + dx, baseY + dy, centerPos.z + dz);

    // 少し回転させる（固定パターンで揺れない）
    const rot = i % 2 === 0 ? 0.03 : -0.03;
    mesh.rotation.z = rot;

    mesh.userData = {
      kind: "grave",
      index: cardIds.length - list.length + i,
      cardId: cid,
    };
    group.add(mesh);
  }

  return group;
}

function updateGraves(state, cardsById) {
  // main.js の state には player.grave / opponent.grave がある想定
  const pGrave = state.player?.grave || [];
  const oGrave = state.opponent?.grave || [];

  const pKey = graveKeyFromArray(pGrave);
  const oKey = graveKeyFromArray(oGrave);

  // 変化がなければ作り直さない（チラつき防止）
  if (pKey === lastGraveKeyPlayer && oKey === lastGraveKeyOpponent) return;

  lastGraveKeyPlayer = pKey;
  lastGraveKeyOpponent = oKey;

  safeRemove(graveGroupPlayer);
  safeRemove(graveGroupOpponent);

  // ✅ 墓地の表示位置：createZones() の枠中心に合わせる
  // （枠線と実体がズレないように）
  const P_GRAVE_POS = new THREE.Vector3(-8.25, 1.0, 5.2);
  const O_GRAVE_POS = new THREE.Vector3(8.4, 1.0, -2.8);

  graveGroupPlayer = buildGraveStack(pGrave, cardsById, P_GRAVE_POS, true);
  graveGroupOpponent = buildGraveStack(oGrave, cardsById, O_GRAVE_POS, true);

  scene.add(graveGroupPlayer);
  scene.add(graveGroupOpponent);
}

// ===== deck =====
function buildDeckStack(count, position) {
  const group = new THREE.Group();
  group.position.copy(position);

  const showCount = Math.min(count, 8);
  for (let i = 0; i < showCount; i++) {
    const geo = new THREE.BoxGeometry(2.0, 0.05, 2.8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1a4d,
      metalness: 0.25,
      roughness: 0.65,
    });

    const card = new THREE.Mesh(geo, mat);

    // ✅ ばらつき完全撤廃：固定配置
    card.position.set(0, i * 0.05, 0);
    card.rotation.set(0, 0, 0);

    group.add(card);
  }
  return group;
}

function updateDecks(playerDeckCount, opponentDeckCount) {
  const pCount = playerDeckCount ?? 10;
  const oCount = opponentDeckCount ?? 10;

  // ✅ 枚数が変わらないなら再生成しない（見た目が揺れない）
  if (lastDeckCountPlayer === pCount && lastDeckCountOpponent === oCount)
    return;

  lastDeckCountPlayer = pCount;
  lastDeckCountOpponent = oCount;

  safeRemove(deckGroupPlayer);
  safeRemove(deckGroupOpponent);

  // ※あなたの現状座標（このまま）
  deckGroupPlayer = buildDeckStack(pCount, new THREE.Vector3(7.7, 1.0, 5.2));
  // 左上＋微調整: x=-7.5, z=-3.5
  deckGroupOpponent = buildDeckStack(
    oCount,
    new THREE.Vector3(-7.6, 1.0, -2.8),
  );

  scene.add(deckGroupPlayer);
  scene.add(deckGroupOpponent);
}

// ===== chips =====
function makeChipMaterial(kind) {
  if (kind === "hp") {
    return new THREE.MeshStandardMaterial({
      color: 0xff4444,
      metalness: 0.7,
      roughness: 0.2,
      emissive: 0x551111,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x22cc44,
    metalness: 0.7,
    roughness: 0.2,
    emissive: 0x115522,
  });
}

function buildChipRow(count, maxCount, kind, basePos, direction = 1) {
  const group = new THREE.Group();
  group.position.copy(basePos);

  const geo = new THREE.CylinderGeometry(
    0.36 * 0.91,
    0.36 * 0.91,
    0.15 * 0.91,
    24,
  );
  const mat = makeChipMaterial(kind);
  const c = clamp(count ?? 0, 0, maxCount);

  for (let i = 0; i < maxCount; i++) {
    const chip = new THREE.Mesh(geo, mat);
    chip.position.x = direction * (i * 1.0);
    chip.position.y = 0.08;
    chip.visible = i < c;
    group.add(chip);
  }
  return group;
}

function buildHpGrid(count, maxCount, basePos, direction = 1) {
  const group = new THREE.Group();
  group.position.copy(basePos);

  // ハート型を上下反転・1.5倍拡大
  const scale = 1.5;
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, 0.18 * scale);
  heartShape.bezierCurveTo(
    0.18 * scale,
    0.32 * scale,
    0.38 * scale,
    0.05 * scale,
    0,
    -0.22 * scale,
  );
  heartShape.bezierCurveTo(
    -0.38 * scale,
    0.05 * scale,
    -0.18 * scale,
    0.32 * scale,
    0,
    0.18 * scale,
  );

  const extrudeSettings = {
    depth: 0.12, // 厚みだけ元の値に戻す
    bevelEnabled: false,
  };
  const geo = new THREE.ExtrudeGeometry(heartShape, extrudeSettings);
  const mat = makeChipMaterial("hp");
  const c = clamp(count ?? 0, 0, maxCount);

  for (let i = 0; i < maxCount; i++) {
    const chip = new THREE.Mesh(geo, mat);
    const row = Math.floor(i / 10);
    const col = i % 10;
    const spacing = 0.95; // 間隔をやや短く
    chip.position.x = direction * (col * spacing + row * 0.5 * spacing);
    chip.position.z = direction === 1 ? row * spacing : -(row * spacing);
    chip.position.y = 0.06;
    chip.visible = i < c;
    // ハート型を正面に向けて回転
    chip.rotation.x = -Math.PI / 2;
    // 相手側（direction=-1）の場合は上下反転
    if (direction === -1) {
      chip.rotation.x += Math.PI;
    }
    group.add(chip);
  }
  return group;
}

function updateChips(player, opponent) {
  safeRemove(chips.player.mana);
  safeRemove(chips.player.hp);
  safeRemove(chips.opponent.mana);
  safeRemove(chips.opponent.hp);

  // 体力・マナの円柱チップも中央付近に寄せる
  // 体力の少し上、左揃え（x=-4.4, z=6.0）
  // 体力の少し上、左揃え（x=-4.4, z=5.8）
  // 体力の少し上、左揃え（x=-4.1, z=5.8）
  chips.player.mana = buildChipRow(
    player?.mana ?? 0,
    MAX_MANA_TOKENS,
    "mana",
    new THREE.Vector3(-4.4, 1.0, 5.9),
    +1,
  );
  // 手前の白線（P_HPゾーン: x=0.4, z=7.4）に合わせて配置
  chips.player.hp = buildHpGrid(
    player?.hp ?? 0,
    MAX_HP_TOKENS,
    new THREE.Vector3(-4.4, 1.0, 7.2),
    +1,
  );

  chips.opponent.mana = buildChipRow(
    opponent?.mana ?? 0,
    MAX_MANA_TOKENS,
    "mana",
    new THREE.Vector3(0.7, 1.0, -3.4),
    +1,
  );
  chips.opponent.hp = buildHpGrid(
    opponent?.hp ?? 0,
    MAX_HP_TOKENS,
    new THREE.Vector3(4.6, 1.0, -5.0),
    -1,
  );

  scene.add(chips.player.mana);
  scene.add(chips.player.hp);
  scene.add(chips.opponent.mana);
  scene.add(chips.opponent.hp);
}

// ===== resize =====
function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ===== 2D座標(px) -> Raycastしてhit情報を返す =====
function hitTestAtScreen(screenX, screenY) {
  if (!renderer || !camera || !raycaster) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
  const ny = -((screenY - rect.top) / rect.height) * 2 + 1;

  mouse.x = nx;
  mouse.y = ny;
  raycaster.setFromCamera(mouse, camera);

  const targets = [
    ...cardMeshes,
    ...myFieldMeshes,
    ...oppFieldMeshes,
    ...oppCardMeshes,
  ];
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;

  let obj = hits[0].object;
  while (obj && !obj.userData) obj = obj.parent;

  const root = hits[0].object;
  return {
    hit: hits[0],
    object: root,
    kind: root.userData?.kind || null,
    index: root.userData?.index ?? null,
    worldPoint: hits[0].point.clone(),
  };
}

function initThree(container) {
  if (!container) throw new Error("container not found");
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  container.innerHTML = "";

  // ✅ 山札再生成キャッシュをリセット（リロードや再初期化対策）
  lastDeckCountPlayer = null;
  lastDeckCountOpponent = null;

  // ✅ 墓地キャッシュもリセット
  lastGraveKeyPlayer = null;
  lastGraveKeyOpponent = null;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 14.8, 11.4);
  camera.lookAt(0, 0, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  setupLights();
  createTable();

  // ✅ 追加：ゾーン枠線
  createZones();

  window.addEventListener("resize", onResize);

  const loop = () => {
    rafId = requestAnimationFrame(loop);
    renderer.render(scene, camera);
  };
  loop();
}

function setInputHandlers(handlers) {
  input = { ...input, ...handlers };
}

function renderFromState(state, myRole) {
  if (!scene) return;

  const cardsById = new Map();
  (state.cards || []).forEach((c) => cardsById.set(c.id, c));

  const me = myRole === "opponent" ? state.opponent : state.player;
  const enemy = myRole === "opponent" ? state.player : state.opponent;

  // ✅ 山札：毎フレーム再生成しない
  updateDecks(state.player?.deck ?? 10, state.opponent?.deck ?? 10);

  updateChips(state.player, state.opponent);

  // ✅ 墓地：末尾数枚だけ表示（変化時のみ再生成）
  updateGraves(state, cardsById);

  clearMeshes(cardMeshes);
  clearMeshes(oppCardMeshes);
  clearMeshes(myFieldMeshes);
  clearMeshes(oppFieldMeshes);

  const spacing = 2.2;

  // 自分手札
  const startX = -((me.hand.length - 1) * spacing) / 2;
  me.hand.forEach((cid, i) => {
    const card = cardsById.get(cid) || {
      name: "?",
      cost: 0,
      power: 0,
      toughness: 0,
    };
    const mesh = createCardMesh(card, true);
    mesh.position.set(startX + i * spacing, 0.5, 9.5);
    mesh.rotation.x = -Math.PI / 5;
    mesh.userData = { kind: "hand", index: i, cardId: cid };
    scene.add(mesh);
    cardMeshes.push(mesh);
  });

  // 相手手札（裏）
  const oStartX = -((enemy.hand.length - 1) * spacing) / 2;
  enemy.hand.forEach((cid, i) => {
    const card = cardsById.get(cid) || {
      name: "?",
      cost: 0,
      power: 0,
      toughness: 0,
    };
    const mesh = createCardMesh(card, false);
    mesh.position.set(oStartX + i * spacing, 0.5, -9.5);
    mesh.rotation.x = -Math.PI / 7;
    mesh.userData = { kind: "oppHand", index: i, cardId: cid };
    scene.add(mesh);
    oppCardMeshes.push(mesh);
  });

  // 自分場
  const fSpacing = 2.4;
  const fStartX = -((me.field.length - 1) * fSpacing) / 2;
  me.field.forEach((cid, i) => {
    const card = cardsById.get(cid) || {
      name: "?",
      cost: 0,
      power: 0,
      toughness: 0,
    };
    const mesh = createCardMesh(card, true);
    mesh.position.set(fStartX + i * fSpacing, 0.51, 3.0);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData = { kind: "myField", index: i, cardId: cid };
    scene.add(mesh);
    myFieldMeshes.push(mesh);
  });

  // 相手場
  const efStartX = -((enemy.field.length - 1) * fSpacing) / 2;
  enemy.field.forEach((cid, i) => {
    const card = cardsById.get(cid) || {
      name: "?",
      cost: 0,
      power: 0,
      toughness: 0,
    };
    const mesh = createCardMesh(card, true);
    mesh.position.set(efStartX + i * fSpacing, 0.51, -3.0);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI;
    mesh.userData = { kind: "oppField", index: i, cardId: cid };
    scene.add(mesh);
    oppFieldMeshes.push(mesh);
  });
}

// ===== マリガンカード選択とホバー処理 =====

// 画面座標からカーソルの下にあるカードを取得
function getCardUnderCursor(screenX, screenY) {
  if (!renderer || !camera || !raycaster) return null;

  // 画面座標を正規化座標に変換
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((screenX - rect.left) / rect.width) * 2 - 1;
  const y = -((screenY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera({ x, y }, camera);

  // 手札のカードのみをチェック
  const intersects = raycaster.intersectObjects(cardMeshes);

  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    if (mesh.userData && mesh.userData.kind === "hand") {
      return mesh.userData.cardId;
    }
  }

  return null;
}

// カードの選択状態ハイライトを更新
function updateCardSelectionHighlights(selectedCardIds) {
  cardMeshes.forEach((mesh) => {
    if (mesh.userData && mesh.userData.kind === "hand") {
      const isSelected = selectedCardIds.includes(mesh.userData.cardId);

      if (isSelected) {
        // 選択状態：赤い枠線効果
        mesh.material.emissive.setHex(0xffff00); // 選択も黄色
        mesh.material.emissiveIntensity = 0.5;
        mesh.scale.set(1.1, 1.1, 1.1);
      } else {
        // 通常状態
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0.5;
        mesh.scale.set(1, 1, 1);
      }
    }
  });
}

// カードのホバー状態を更新
function updateCardHover3D(hoveredCardId, previousCardId) {
  // 前のカードのホバー状態を削除
  // すべての手札カードのホバー状態をリセット
  cardMeshes.forEach((mesh) => {
    if (mesh.userData && mesh.userData.kind === "hand") {
      // 選択状態でなければリセット
      if (mesh.scale.x <= 1.05) {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0.5;
        mesh.scale.set(1, 1, 1);
      }
    }
  });

  // 新しいカードにホバー状態を追加
  if (hoveredCardId) {
    const newMesh = cardMeshes.find(
      (mesh) => mesh.userData && mesh.userData.cardId === hoveredCardId,
    );
    if (newMesh) {
      // 選択状態でない場合のみホバー効果
      const isSelected = newMesh.scale.x > 1.05;
      if (!isSelected) {
        newMesh.material.emissive.setHex(0xffff00); // ホバー時は黄色
        newMesh.material.emissiveIntensity = 0.5;
        newMesh.scale.set(1.08, 1.08, 1.08);
      }
    }
  }
}

// main.js で使用するためにグローバルに公開
window.getCardUnderCursor = getCardUnderCursor;
window.updateCardSelectionHighlights = updateCardSelectionHighlights;
window.updateCardHover3D = updateCardHover3D;

export {
  initThree,
  renderFromState,
  setInputHandlers,
  hitTestAtScreen,
  getCardUnderCursor,
  updateCardSelectionHighlights,
  updateCardHover3D,
};
