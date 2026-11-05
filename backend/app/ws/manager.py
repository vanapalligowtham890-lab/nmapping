"""
WebSocket connection manager for real-time traffic broadcast.
Every time segment states change, all connected browser clients receive live push.
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import WebSocket, WebSocketDisconnect

class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        """Push JSON message to ALL connected browser clients simultaneously."""
        dead = []
        payload = json.dumps(message, default=str)
        for ws in list(self.active):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self.active)

ws_manager = ConnectionManager()

async def broadcast_traffic_update():
    """
    Called by ingestion/admin every time traffic state changes.
    Sends full segment list snapshot so all clients refresh instantly.
    """
    from app.services.road_network import road_network
    from app.services.congestion import congestion_engine

    congestion_engine.evaluate_all()
    segments = [s.model_dump() for s in road_network.segments.values()]

    # Traffic summary
    total = len(segments)
    congested = sum(1 for s in segments if s["status"] == "congested")
    slowing = sum(1 for s in segments if s["status"] == "slowing")
    normal = total - congested - slowing

    if congested >= 2:
        level, color, emoji = "Heavy", "#d93025", "🔴"
    elif congested >= 1 or slowing >= 3:
        level, color, emoji = "Moderate", "#f9ab00", "🟡"
    else:
        level, color, emoji = "Light", "#1e8e3e", "🟢"

    await ws_manager.broadcast({
        "type": "traffic_update",
        "ts": datetime.now(timezone.utc).isoformat(),
        "segments": segments,
        "summary": {
            "level": level, "color": color, "emoji": emoji,
            "congested": congested, "slowing": slowing, "normal": normal,
            "pct_clear": round(normal / total * 100) if total else 100
        },
        "connected_clients": ws_manager.client_count
    })

