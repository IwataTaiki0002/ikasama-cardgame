from __future__ import annotations

import asyncio
import json
import secrets
import time
from dataclasses import dataclass, asdict, field
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


# =========================
# 設定
# =========================
TURN_SECONDS = 60
ACCUSATION_WINDOW_SEC = 10
MAX_PENALTY = 3
DEFAULT_DECK = 10


# =========================
# データモデル
# =========================
@dataclass
class Card:
    id: int
    name: str
    cost: int
    power: int
    toughness: int


CARD_DB: List[Card] = [
    Card(0, "フォロワーA", 2, 3, 2),
    Card(1, "フォロワーB", 3, 4, 3),
    Card(2, "フォロワーC", 1, 1, 1),
    Card(3, "フォロワーD", 4, 5, 4),
    Card(4, "フォロワーE", 2, 2, 3),
]


@dataclass
class PlayerState:
    hp: int = 20
    mana: int = 3
    maxMana: int = 3
    hand: List[int] = field(default_factory=list)      # card ids
    field: List[int] = field(default_factory=list)     # card ids
    deck: int = DEFAULT_DECK
    penalty: int = 0


@dataclass
class CheatLogItem:
    ts: float
    by: str                 # "player" or "opponent"
    action: str             # cheat action type
    payload: Dict[str, Any]


@dataclass
class GameState:
    currentTurn: str = "player"   # "player" or "opponent"
    isGameOver: bool = False
    winner: Optional[str] = None  # "player"/"opponent"/None
    timer: int = TURN_SECONDS
    
    # マリガンフェーズ
    isMulliganPhase: bool = False
    mulliganTimer: int = 10
    playerMulliganDone: bool = False
    opponentMulliganDone: bool = False
    playerMulliganCards: List[int] = field(default_factory=list)  # 戻すカードのインデックス
    opponentMulliganCards: List[int] = field(default_factory=list)

    player: PlayerState = field(default_factory=PlayerState)
    opponent: PlayerState = field(default_factory=PlayerState)

    cheatLog: List[CheatLogItem] = field(default_factory=list)


# =========================
# ルーム管理
# =========================
class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.state = GameState()
        self.clients: Dict[WebSocket, str] = {}  # ws -> role ("player"/"opponent"/"spectator")
        self.lock = asyncio.Lock()
        self.loop_task: Optional[asyncio.Task] = None
        self.started = False
        self.first_attack_role: Optional[str] = None  # "player" or "opponent"

    def roles_in_use(self) -> Set[str]:
        return set(self.clients.values())

    def assign_role(self) -> str:
        used = self.roles_in_use()
        if "player" not in used:
            return "player"
        if "opponent" not in used:
            return "opponent"
        return "spectator"

    def snapshot(self) -> Dict[str, Any]:
        s = self.state

        def player_view(ps: PlayerState) -> Dict[str, Any]:
            return {
                "hp": ps.hp,
                "mana": ps.mana,
                "maxMana": ps.maxMana,
                "hand": ps.hand,
                "field": ps.field,
                "deck": ps.deck,
                "penalty": ps.penalty,
            }

        # cheatLog は“内容”は見せる（ゲーム仕様）想定。ただしpayloadは必要最小限
        cheat_log = [
            {"ts": item.ts, "by": item.by, "action": item.action, "payload": item.payload}
            for item in s.cheatLog[-50:]
        ]

        return {
            "roomId": self.room_id,
            "started": self.started,
            "currentTurn": s.currentTurn,
            "timer": s.timer,
            "isGameOver": s.isGameOver,
            "winner": s.winner,
            "isMulliganPhase": s.isMulliganPhase,
            "mulliganTimer": s.mulliganTimer,
            "playerMulliganDone": s.playerMulliganDone,
            "opponentMulliganDone": s.opponentMulliganDone,
            "player": player_view(s.player),
            "opponent": player_view(s.opponent),
            "cards": [asdict(c) for c in CARD_DB],
            "cheatLog": cheat_log,
            "firstAttackRole": self.first_attack_role,
        }

    async def broadcast(self, data: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        for ws in list(self.clients.keys()):
            try:
                await ws.send_text(json.dumps(data, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.pop(ws, None)

    async def ensure_loop(self) -> None:
        if self.loop_task and not self.loop_task.done():
            return
        self.loop_task = asyncio.create_task(self._game_loop())

    async def _game_loop(self) -> None:
        # ターンタイマー（サーバー権威）
        try:
            while True:
                await asyncio.sleep(1)
                async with self.lock:
                    if not self.started:
                        continue
                    if self.state.isGameOver:
                        continue

                    # マリガンフェーズの処理
                    if self.state.isMulliganPhase:
                        self.state.mulliganTimer -= 1
                        if self.state.mulliganTimer <= 0:
                            await self._execute_mulligan_locked()
                        elif self.state.playerMulliganDone and self.state.opponentMulliganDone:
                            await self._execute_mulligan_locked()
                    else:
                        # 通常のターンタイマー
                        self.state.timer -= 1
                        if self.state.timer <= 0:
                            await self._switch_turn_locked()

                    snap = self.snapshot()

                await self.broadcast({"type": "state", "state": snap})
        except asyncio.CancelledError:
            return

    async def start_game_locked(self) -> None:
        if self.started:
            return
        import random
        self.started = True
        self.state.isGameOver = False
        self.state.winner = None
        self.state.currentTurn = "player"
        self.state.timer = TURN_SECONDS
        self.state.cheatLog.clear()

        # 先攻・後攻は部屋作成者（player1）が決定し、既に決まっていれば再利用
        if self.first_attack_role is None:
            self.first_attack_role = random.choice(["player", "opponent"])

        # 初期手札（3枚）
        self.state.player.hand = [c.id for c in CARD_DB[:3]]
        self.state.opponent.hand = [c.id for c in CARD_DB[:3]]
        
        # マリガンフェーズを開始
        self.state.isMulliganPhase = True
        self.state.mulliganTimer = 10
        self.state.playerMulliganDone = False
        self.state.opponentMulliganDone = False
        self.state.playerMulliganCards.clear()
        self.state.opponentMulliganCards.clear()

    async def _switch_turn_locked(self) -> None:
        s = self.state
        s.currentTurn = "opponent" if s.currentTurn == "player" else "player"
        s.timer = TURN_SECONDS

    def _get_ps(self, role: str) -> PlayerState:
        return self.state.player if role == "player" else self.state.opponent

    def _get_enemy_ps(self, role: str) -> PlayerState:
        return self.state.opponent if role == "player" else self.state.player

    def _end_game_if_needed_locked(self) -> None:
        s = self.state
        if s.isGameOver:
            return

        if s.player.hp <= 0:
            s.isGameOver = True
            s.winner = "opponent"
        elif s.opponent.hp <= 0:
            s.isGameOver = True
            s.winner = "player"

        if s.player.penalty >= MAX_PENALTY:
            s.isGameOver = True
            s.winner = "opponent"
        elif s.opponent.penalty >= MAX_PENALTY:
            s.isGameOver = True
            s.winner = "player"

    # =========================
    # アクション処理
    # =========================
    async def handle_action(self, role: str, action: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
        # spectator は操作不可
        if role not in ("player", "opponent"):
            return False, "spectator は操作できません"

        async with self.lock:
            if action == "start":
                # 2人揃ってなくても開始はできるが、通常は2人推奨
                await self.start_game_locked()
                await self.ensure_loop()
                return True, "started"

            if not self.started:
                return False, "ゲームが開始されていません（start を実行してください）"

            if self.state.isGameOver:
                return False, "ゲームは終了しています"

            # 通常行動
            if action == "play-card":
                return self._action_play_card_locked(role, payload)

            if action == "end-turn":
                if self.state.currentTurn != role:
                    return False, "自分のターンではありません"
                await self._switch_turn_locked()
                return True, "turn switched"

            # イカサマ（ゲーム内で許可された「ズル」）
            if action == "cheat":
                return self._action_cheat_locked(role, payload)

            # 指摘
            if action == "accuse":
                return self._action_accuse_locked(role, payload)

            # マリガン
            if action == "mulligan":
                return self._action_mulligan_locked(role, payload)

            return False, f"不明なaction: {action}"

    def _action_play_card_locked(self, role: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
        if self.state.currentTurn != role:
            return False, "自分のターンではありません"

        hand_index = int(payload.get("handIndex", -1))
        ps = self._get_ps(role)

        if hand_index < 0 or hand_index >= len(ps.hand):
            return False, "handIndexが不正です"

        card_id = ps.hand[hand_index]
        card = next((c for c in CARD_DB if c.id == card_id), None)
        if not card:
            return False, "カードが存在しません"

        if ps.mana < card.cost:
            return False, "マナが足りません"

        # 状態更新
        ps.mana -= card.cost
        ps.hand.pop(hand_index)
        ps.field.append(card_id)

        self._end_game_if_needed_locked()
        return True, "played"

    def _log_cheat_locked(self, by: str, action: str, payload: Dict[str, Any]) -> None:
        self.state.cheatLog.append(
            CheatLogItem(ts=time.time(), by=by, action=action, payload=payload)
        )

    def _action_cheat_locked(self, role: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
        """
        フロントのメニューに合わせる（index.html）
        - summon-own: 自分の手札から召喚（= 手札1枚を場に出す。マナ無視）
        - destroy-opponent: 相手フォロワー破壊（相手fieldから1体消す）
        - steal-opponent: 相手フォロワー奪う（相手fieldから1体→自分fieldへ）
        - add-own-hand / remove-own-hand
        - add-opponent-hand / remove-opponent-hand
        - modify-hp / modify-mana
        """
        cheat_type = str(payload.get("cheatType", ""))
        data = payload.get("data", {}) or {}

        ps = self._get_ps(role)
        enemy = self._get_enemy_ps(role)

        # ここで“許可されたイカサマ”を適用する（＝ゲーム仕様）
        if cheat_type == "summon-own":
            idx = int(data.get("handIndex", 0))
            if ps.hand and 0 <= idx < len(ps.hand):
                card_id = ps.hand.pop(idx)
                ps.field.append(card_id)
            self._log_cheat_locked(role, cheat_type, {"handIndex": idx})

        elif cheat_type == "destroy-opponent":
            idx = int(data.get("fieldIndex", 0))
            if enemy.field and 0 <= idx < len(enemy.field):
                enemy.field.pop(idx)
            self._log_cheat_locked(role, cheat_type, {"fieldIndex": idx})

        elif cheat_type == "steal-opponent":
            idx = int(data.get("fieldIndex", 0))
            if enemy.field and 0 <= idx < len(enemy.field):
                card_id = enemy.field.pop(idx)
                ps.field.append(card_id)
            self._log_cheat_locked(role, cheat_type, {"fieldIndex": idx})

        elif cheat_type == "add-own-hand":
            # カードを1枚増やす（DBからランダム風）
            ps.hand.append(CARD_DB[int(time.time()) % len(CARD_DB)].id)
            self._log_cheat_locked(role, cheat_type, {})

        elif cheat_type == "remove-own-hand":
            if ps.hand:
                ps.hand.pop()
            self._log_cheat_locked(role, cheat_type, {})

        elif cheat_type == "add-opponent-hand":
            enemy.hand.append(CARD_DB[int(time.time() * 1.7) % len(CARD_DB)].id)
            self._log_cheat_locked(role, cheat_type, {})

        elif cheat_type == "remove-opponent-hand":
            if enemy.hand:
                enemy.hand.pop()
            self._log_cheat_locked(role, cheat_type, {})

        elif cheat_type == "modify-hp":
            target = str(data.get("target", "self"))  # "self" or "opponent"
            delta = int(data.get("delta", 0))
            tps = ps if target == "self" else enemy
            tps.hp += delta
            self._log_cheat_locked(role, cheat_type, {"target": target, "delta": delta})

        elif cheat_type == "modify-mana":
            target = str(data.get("target", "self"))
            delta = int(data.get("delta", 0))
            tps = ps if target == "self" else enemy
            tps.mana = max(0, tps.mana + delta)
            tps.maxMana = max(tps.maxMana, tps.mana)
            self._log_cheat_locked(role, cheat_type, {"target": target, "delta": delta})

        else:
            return False, f"不明なcheatType: {cheat_type}"

        self._end_game_if_needed_locked()
        return True, "cheated"

    def _action_accuse_locked(self, role: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
        """
        指摘：直近10秒以内の相手のイカサマを当てる
        payload:
          - index: cheat候補のインデックス（cheatLogの末尾から数えるのでもOK）
          - ts: 指摘したログのts（安全のため）
        """
        now = time.time()
        idx = payload.get("index", None)
        ts = payload.get("ts", None)

        enemy_role = "opponent" if role == "player" else "player"

        # 直近window内の、相手のcheatだけ抽出
        recent = [
            item for item in self.state.cheatLog
            if item.by == enemy_role and (now - item.ts) <= ACCUSATION_WINDOW_SEC
        ]
        if not recent:
            # 何もないのに指摘：自分にペナルティ
            self._get_ps(role).penalty += 1
            self._end_game_if_needed_locked()
            return False, "直近10秒の相手のイカサマはありません（指摘失敗：自分にペナルティ）"

        chosen: Optional[CheatLogItem] = None

        if ts is not None:
            try:
                ts_f = float(ts)
                for item in recent:
                    if abs(item.ts - ts_f) < 0.0001:
                        chosen = item
                        break
            except Exception:
                chosen = None

        if chosen is None and idx is not None:
            try:
                i = int(idx)
                if 0 <= i < len(recent):
                    chosen = recent[i]
            except Exception:
                chosen = None

        if chosen is None:
            # 指摘が成立しない：自分ペナルティ
            self._get_ps(role).penalty += 1
            self._end_game_if_needed_locked()
            return False, "指摘対象が不正です（指摘失敗：自分にペナルティ）"

        # 指摘成功：相手にペナルティ
        self._get_ps(enemy_role).penalty += 1

        # ログとして「accuse」も残す（任意）
        self.state.cheatLog.append(
            CheatLogItem(ts=now, by=role, action="accuse", payload={"targetTs": chosen.ts, "targetAction": chosen.action})
        )

        self._end_game_if_needed_locked()
        return True, "accuse success (enemy penalty +1)"

    def _action_mulligan_locked(self, role: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
        """マリガン選択を受け付ける"""
        if not self.state.isMulliganPhase:
            return False, "マリガンフェーズではありません"
            
        if (role == "player" and self.state.playerMulliganDone) or \
           (role == "opponent" and self.state.opponentMulliganDone):
            return False, "既にマリガンは完了しています"
            
        card_indices = payload.get("cardIndices", [])
        if not isinstance(card_indices, list):
            return False, "cardIndicesは配列である必要があります"
            
        ps = self._get_ps(role)
        # インデックスの有効性チェック
        for idx in card_indices:
            if not isinstance(idx, int) or idx < 0 or idx >= len(ps.hand):
                return False, f"無効なカードインデックス: {idx}"
                
        # マリガン情報を保存
        if role == "player":
            self.state.playerMulliganCards = card_indices[:]
            self.state.playerMulliganDone = True
        else:
            self.state.opponentMulliganCards = card_indices[:]
            self.state.opponentMulliganDone = True
            
        return True, f"マリガン選択完了: {len(card_indices)}枚"
        
    async def _execute_mulligan_locked(self) -> None:
        """マリガンを実行する"""
        if not self.state.isMulliganPhase:
            return
            
        # プレイヤーのマリガン実行
        if self.state.playerMulliganCards:
            # 降順でソートして後ろから削除（インデックスずれを防ぐ）
            for idx in sorted(self.state.playerMulliganCards, reverse=True):
                if 0 <= idx < len(self.state.player.hand):
                    self.state.player.hand.pop(idx)
            # 削除した枚数分ドロー
            draw_count = len(self.state.playerMulliganCards)
            for _ in range(draw_count):
                if len(CARD_DB) > 0:
                    new_card = CARD_DB[int(time.time() * 1.1) % len(CARD_DB)]
                    self.state.player.hand.append(new_card.id)
                    
        # 相手のマリガン実行
        if self.state.opponentMulliganCards:
            for idx in sorted(self.state.opponentMulliganCards, reverse=True):
                if 0 <= idx < len(self.state.opponent.hand):
                    self.state.opponent.hand.pop(idx)
            draw_count = len(self.state.opponentMulliganCards)
            for _ in range(draw_count):
                if len(CARD_DB) > 0:
                    new_card = CARD_DB[int(time.time() * 1.3) % len(CARD_DB)]
                    self.state.opponent.hand.append(new_card.id)
                    
        # マリガンフェーズ終了
        self.state.isMulliganPhase = False
        self.state.timer = TURN_SECONDS  # 通常ターンタイマーに戻す


ROOMS: Dict[str, Room] = {}


def get_room(room_id: str) -> Room:
    if room_id not in ROOMS:
        ROOMS[room_id] = Room(room_id)
    return ROOMS[room_id]


# =========================
# FastAPI
# =========================
app = FastAPI()

# 先攻・後攻ランダム決定API
@app.post("/api/first_attack")
async def decide_first_attack():
    import random
    first = random.choice(["player", "opponent"])
    return {"first": first}

# ルートパスでindex.htmlを返す
@app.get("/")
async def root():
    return FileResponse("static/index.html")

# 静的ファイル配信
app.mount("/static", StaticFiles(directory="static", html=True), name="static")


@app.websocket("/ws/{room_id}")
async def ws_room(websocket: WebSocket, room_id: str, mode: str = "create"):
    await websocket.accept()

    room_exists = room_id in ROOMS
    
    if mode == "join":
        # 「部屋を探す」モード：既存のルームにのみ接続可能
        if not room_exists:
            await websocket.send_text(json.dumps({"type": "error", "message": "部屋が見つかりませんでした"}, ensure_ascii=False))
            await websocket.close()
            return
        
        room = ROOMS[room_id]
        async with room.lock:
            if len(room.clients) >= 2:
                await websocket.send_text(json.dumps({"type": "error", "message": "このルームは既に満員です"}, ensure_ascii=False))
                await websocket.close()
                return
            
            role = room.assign_role()  # "opponent"または"spectator"
            room.clients[websocket] = role
    else:
        # 「部屋を作る」モード：新しいルームを作成または既存ルームに接続
        if not room_exists:
            room = Room(room_id)
            ROOMS[room_id] = room
        else:
            room = ROOMS[room_id]
        
        async with room.lock:
            if len(room.clients) >= 2:
                await websocket.send_text(json.dumps({"type": "error", "message": "このルームは既に満員です"}, ensure_ascii=False))
                await websocket.close()
                return
            
            role = room.assign_role()
            room.clients[websocket] = role

    # 参加通知
    await websocket.send_text(json.dumps({"type": "hello", "roomId": room_id, "role": role}, ensure_ascii=False))
    # 参加時のメッセージを役割で分岐
    if role == "player":
        await room.broadcast({"type": "system", "message": "接続待機中..."})
    elif role == "opponent":
        await room.broadcast({"type": "system", "message": "対戦相手が見つかりました"})

    # 2人揃ったら自動でゲーム開始
    if len(room.clients) == 2 and not room.started:
        await room.handle_action("player", "start", {})

    # すぐstateを送る
    await websocket.send_text(json.dumps({"type": "state", "state": room.snapshot()}, ensure_ascii=False))

    try:
        while True:
            msg = await websocket.receive_text()
            try:
                data = json.loads(msg)
            except Exception:
                await websocket.send_text(json.dumps({"type": "error", "message": "JSONが不正です"}, ensure_ascii=False))
                continue

            typ = str(data.get("type", ""))
            if typ == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}, ensure_ascii=False))
                continue

            if typ == "battle-ready":
                # 対戦準備完了を全員に通知
                await room.broadcast({"type": "battle-ready"})
                continue

            if typ == "action":
                action = str(data.get("action", ""))
                payload = data.get("payload", {}) or {}

                ok, reason = await room.handle_action(role, action, payload)

                # 反映後stateを全員へ
                await room.broadcast({"type": "state", "state": room.snapshot()})

                # 自分へ結果
                await websocket.send_text(json.dumps({"type": "ack", "ok": ok, "reason": reason}, ensure_ascii=False))
                continue

            await websocket.send_text(json.dumps({"type": "error", "message": f"不明type: {typ}"}, ensure_ascii=False))

    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            room.clients.pop(websocket, None)

        await room.broadcast({"type": "system", "message": f"{role} が退出しました"})
