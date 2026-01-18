"""
ゲームロジック管理モジュール (main.py)
main.jsのゲームロジック部分をPython化したもの
"""

from dataclasses import dataclass, field as dataclass_field
from typing import List, Optional, Dict, Any
import time
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# FastAPIアプリ作成
app = FastAPI()

# ルーム管理
rooms = {}

# WebSocketエンドポイントのみ
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    # ルーム管理
    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(websocket)
    role = "player" if len(rooms[room_id]) == 1 else "opponent"
    try:
        # 参加通知（helloメッセージ送信）
        await websocket.send_text(f'{{"type": "hello", "roomId": "{room_id}", "role": "{role}"}}')
        import json
        if len(rooms[room_id]) == 2:
            # 2人揃ったら両方にゲーム開始stateを送信（全WebSocketに送る）
            state = GameLogic.create_initial_state()
            state.started = True
            state_msg = {
                "type": "state",
                "state": {
                    "roomId": room_id,
                    "started": True,
                    "currentTurn": state.current_turn,
                    "timer": state.timer,
                    "isGameOver": state.is_game_over,
                    "winner": state.winner,
                    "player": state.player.__dict__,
                    "opponent": state.opponent.__dict__,
                    "cards": [c.__dict__ for c in state.cards],
                    "cheatLog": []
                }
            }
            # 1人目・2人目両方に送信
            for ws in rooms[room_id]:
                await ws.send_text(json.dumps(state_msg, ensure_ascii=False))
        else:
            # まだ1人ならstarted: false
            state_msg = {
                "type": "state",
                "state": {
                    "roomId": room_id,
                    "started": False,
                    "currentTurn": "player",
                    "timer": 60,
                    "isGameOver": False,
                    "winner": None,
                    "player": {
                        "hp": 20, "mana": 3, "maxMana": 3, "hand": [], "field": [], "deck": 10, "penalty": 0
                    },
                    "opponent": {
                        "hp": 20, "mana": 3, "maxMana": 3, "hand": [], "field": [], "deck": 10, "penalty": 0
                    },
                    "cards": [c.__dict__ for c in CARD_DB],
                    "cheatLog": []
                }
            }
            await websocket.send_text(json.dumps(state_msg, ensure_ascii=False))
        while True:
            data = await websocket.receive_text()
            # 必要に応じて処理
            await websocket.send_text(f"Echo: {data}")
    except WebSocketDisconnect:
        rooms[room_id].remove(websocket)
        if not rooms[room_id]:
            del rooms[room_id]


# 先攻・後攻決定API
@app.post("/api/first_attack")
async def decide_first_attack():
    import random
    first = random.choice(["player", "opponent"])
    return {"first": first}


# ルートパスでindex.htmlを返す
@app.get("/")
async def root():
    return FileResponse("static/index.html")

# 静的ファイル配信（/static のみ）
app.mount("/static", StaticFiles(directory="static", html=True), name="static")


# =========================
# 定数・設定
# =========================
TURN_SECONDS = 60
ACCUSE_WINDOW_SEC = 10
MAX_PENALTY = 3
DEFAULT_DECK = 10


# =========================
# カードDB
# =========================
@dataclass
class Card:
    id: int
    name: str
    cost: int
    power: int
    toughness: int


CARD_DB: List[Card] = [
    Card(id=0, name="フォロワーA", cost=2, power=3, toughness=2),
    Card(id=1, name="フォロワーB", cost=3, power=4, toughness=3),
    Card(id=2, name="フォロワーC", cost=1, power=1, toughness=1),
    Card(id=3, name="フォロワーD", cost=4, power=5, toughness=4),
    Card(id=4, name="フォロワーE", cost=2, power=2, toughness=3),
]


# =========================
# プレイヤー状態
# =========================
@dataclass
class PlayerState:
    hp: int = 20
    mana: int = 3
    maxMana: int = 3
    hand: List[int] = dataclass_field(default_factory=list)  # カードID
    field: List[int] = dataclass_field(default_factory=list)  # カードID
    deck: int = DEFAULT_DECK
    penalty: int = 0
    grave: List[int] = dataclass_field(default_factory=list)  # カードID


# =========================
# イカサマログ
# =========================
@dataclass
class CheatLogItem:
    ts: float  # タイムスタンプ（秒）
    by: str  # "player" or "opponent"
    action: str  # アクション名
    payload: Dict[str, Any] = dataclass_field(default_factory=dict)


# =========================
# ゲーム状態
# =========================
@dataclass
class GameState:
    room_id: str = "offline"
    started: bool = False
    current_turn: str = "player"  # "player" or "opponent"
    timer: int = TURN_SECONDS
    is_game_over: bool = False
    winner: Optional[str] = None  # "player" or "opponent" or None
    
    player: PlayerState = dataclass_field(default_factory=PlayerState)
    opponent: PlayerState = dataclass_field(default_factory=PlayerState)
    cards: List[Card] = dataclass_field(default_factory=lambda: CARD_DB.copy())
    cheat_log: List[CheatLogItem] = dataclass_field(default_factory=list)


# =========================
# ゲームロジック
# =========================
class GameLogic:
    """ゲームのルールとロジックを管理するクラス"""
    
    @staticmethod
    def create_initial_state() -> GameState:
        """初期状態を生成"""
        return GameState(
            room_id="offline",
            started=False,
            current_turn="player",
            timer=TURN_SECONDS,
            is_game_over=False,
            winner=None,
            player=PlayerState(),
            opponent=PlayerState(),
            cards=CARD_DB.copy(),
            cheat_log=[]
        )
    
    @staticmethod
    def check_game_over(state: GameState) -> None:
        """勝敗判定"""
        if state.is_game_over:
            return
        
        # HP判定
        if state.player.hp <= 0:
            state.is_game_over = True
            state.winner = "opponent"
        elif state.opponent.hp <= 0:
            state.is_game_over = True
            state.winner = "player"
        
        # ペナルティ判定
        if state.player.penalty >= MAX_PENALTY:
            state.is_game_over = True
            state.winner = "opponent"
        elif state.opponent.penalty >= MAX_PENALTY:
            state.is_game_over = True
            state.winner = "player"
    
    @staticmethod
    def play_card(state: GameState, hand_index: int) -> bool:
        """手札からカードを場に出す（通常プレイ）"""
        if not state.started or state.is_game_over:
            return False
        if state.current_turn != "player":
            return False
        
        ps = state.player
        if hand_index < 0 or hand_index >= len(ps.hand):
            return False
        
        card_id = ps.hand[hand_index]
        card = next((c for c in CARD_DB if c.id == card_id), None)
        
        if not card:
            return False
        if ps.mana < card.cost:
            return False
        
        # カードを場に出す
        ps.mana -= card.cost
        ps.hand.pop(hand_index)
        ps.field.append(card_id)
        
        GameLogic.check_game_over(state)
        return True
    
    @staticmethod
    def sneak_to_grave_from_hand(state: GameState, hand_index: int) -> bool:
        """手札からこっそり墓地に置く（イカサマ）"""
        if not state.started or state.is_game_over:
            return False
        
        ps = state.player
        if hand_index < 0 or hand_index >= len(ps.hand):
            return False
        
        card_id = ps.hand.pop(hand_index)
        ps.grave.append(card_id)
        
        # イカサマログに記録
        state.cheat_log.append(CheatLogItem(
            ts=time.time(),
            by="player",
            action="sneak-grave",
            payload={"from": "hand", "handIndex": hand_index}
        ))
        
        GameLogic.check_game_over(state)
        return True
    
    @staticmethod
    def sneak_discard_from_hand(state: GameState, hand_index: int) -> bool:
        """手札からこっそり捨てる（イカサマ）"""
        if not state.started or state.is_game_over:
            return False
        
        ps = state.player
        if hand_index < 0 or hand_index >= len(ps.hand):
            return False
        
        ps.hand.pop(hand_index)
        
        # イカサマログに記録
        state.cheat_log.append(CheatLogItem(
            ts=time.time(),
            by="player",
            action="sneak-discard",
            payload={"from": "hand", "handIndex": hand_index}
        ))
        
        GameLogic.check_game_over(state)
        return True
    
    @staticmethod
    def destroy_opponent_field(state: GameState, field_index: int) -> bool:
        """相手の場のカードを破壊（イカサマ）"""
        if not state.started or state.is_game_over:
            return False
        if field_index < 0 or field_index >= len(state.opponent.field):
            return False
        
        state.opponent.field.pop(field_index)
        
        # イカサマログに記録
        state.cheat_log.append(CheatLogItem(
            ts=time.time(),
            by="player",
            action="destroy-opponent-demo",
            payload={"fieldIndex": field_index}
        ))
        
        GameLogic.check_game_over(state)
        return True
    
    @staticmethod
    def simulate_opponent_turn(state: GameState) -> None:
        """相手のターンをシミュレート（AI）"""
        if not state or state.is_game_over:
            return
        
        opp = state.opponent
        
        # 可能なら召喚
        if opp.hand and random.random() < 0.5:
            card_id = opp.hand[0]
            card = next((c for c in CARD_DB if c.id == card_id), None)
            if card and opp.mana >= card.cost:
                opp.mana -= card.cost
                opp.hand.pop(0)
                opp.field.append(card_id)
        
        # たまにイカサマ（指摘用）
        if random.random() < 0.35:
            kind = random.choice(["modify-hp", "modify-mana"])
            if kind == "modify-hp":
                state.player.hp -= 1
                state.cheat_log.append(CheatLogItem(
                    ts=time.time(),
                    by="opponent",
                    action=kind,
                    payload={"target": "opponent", "delta": -1}
                ))
            else:
                state.player.mana = max(0, state.player.mana - 1)
                state.cheat_log.append(CheatLogItem(
                    ts=time.time(),
                    by="opponent",
                    action=kind,
                    payload={"target": "opponent", "delta": -1}
                ))
            
            # ログが長くなりすぎないよう制限
            if len(state.cheat_log) > 100:
                state.cheat_log = state.cheat_log[-100:]
        
        GameLogic.check_game_over(state)
    
    @staticmethod
    def switch_turn(state: GameState) -> None:
        """ターン切り替え"""
        if not state or state.is_game_over:
            return
        
        state.current_turn = "opponent" if state.current_turn == "player" else "player"
        state.timer = TURN_SECONDS
        
        # 相手ターンならシミュレート
        if state.current_turn == "opponent":
            GameLogic.simulate_opponent_turn(state)
            state.current_turn = "player"
            state.timer = TURN_SECONDS
    
    @staticmethod
    def start_game_offline(state: GameState) -> None:
        """オフラインゲームを開始"""
        state.started = True
        state.player.hand = [c.id for c in CARD_DB[:3]]
        state.opponent.hand = [c.id for c in CARD_DB[:3]]
        state.current_turn = "player"
        state.timer = TURN_SECONDS
    
    @staticmethod
    def accuse_cheat(state: GameState, target_ts: float, target_action: str) -> bool:
        """イカサマを指摘"""
        now = time.time()
        
        # 直近の相手イカサマを探す
        recent_cheats = [
            log for log in state.cheat_log
            if log.by == "opponent" and now - log.ts <= ACCUSE_WINDOW_SEC
        ]
        
        # 指摘対象を検証
        target = next((log for log in recent_cheats if log.ts == target_ts and log.action == target_action), None)
        
        if target:
            # 指摘成功
            state.opponent.penalty += 1
            state.cheat_log.append(CheatLogItem(
                ts=now,
                by="player",
                action="accuse",
                payload={"targetTs": target_ts, "targetAction": target_action}
            ))
            GameLogic.check_game_over(state)
            return True
        else:
            # 指摘失敗
            state.player.penalty += 1
            GameLogic.check_game_over(state)
            return False


# =========================
# 使用例
# =========================
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
