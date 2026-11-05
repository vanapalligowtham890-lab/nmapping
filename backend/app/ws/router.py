"""WebSocket router — real-time traffic broadcast endpoint."""
import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.ws.manager import ws_manager, broadcast_traffic_update

router = APIRouter(tags=["websocket"])

@router.websocket("/ws/traffic")
async def traffic_ws(websocket: WebSocket):
    """
    WebSocket endpoint. Browser connects once and receives:
    - Immediate full snapshot on connect
    - Live push every time any device submits observations
    - Heartbeat ping every 15s to keep connection alive
    """
    await ws_manager.connect(websocket)
    try:
        # Send immediate full snapshot so client has data at once
        await broadcast_traffic_update()

        # Heartbeat + keep alive loop
        while True:
            try:
                # Wait for client ping or disconnect (10s timeout)
                data = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await websocket.send_text(json.dumps({
                            "type": "pong",
                            "connected_clients": ws_manager.client_count
                        }))
                except Exception:
                    pass
            except asyncio.TimeoutError:
                # Send server heartbeat
                try:
                    await websocket.send_text(json.dumps({
                        "type": "heartbeat",
                        "connected_clients": ws_manager.client_count
                    }))
                except Exception:
                    break
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

