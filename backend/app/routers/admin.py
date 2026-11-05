from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.models.traffic import RoadSegment, TrafficStatus
from app.services.road_network import road_network
from app.services.congestion import congestion_engine
from app.services.session_manager import session_manager

router = APIRouter(prefix="/v1/admin", tags=["admin"])

class OverrideRequest(BaseModel):
    status: Optional[TrafficStatus] = None
    diversion_cap: Optional[int] = None
    reset_diversion_count: Optional[bool] = None

@router.get("/segments", response_model=List[RoadSegment])
async def list_admin_segments():
    """Operations / Admin view of all segments, current diversion counts, and sample evidence."""
    return list(road_network.segments.values())

@router.post("/segments/{segment_id}/override", response_model=RoadSegment)
async def override_segment_status(segment_id: str, req: OverrideRequest):
    """Allows operations to mark a road closed (e.g. fallen tree, flooding) or adjust detour caps."""
    seg = road_network.get_segment(segment_id)
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found")

    if req.status is not None:
        seg.status = req.status
    if req.diversion_cap is not None:
        seg.diversion_cap = req.diversion_cap
    if req.reset_diversion_count:
        seg.current_diversion_count = 0

    return seg

@router.post("/reset")
async def reset_system():
    """Resets road network, congestion engine states, and active sessions for testing."""
    road_network.reset_network()
    congestion_engine.reset()
    session_manager.clear()
    return {"status": "ok", "message": "Pilot road network and congestion states reset to baseline."}
