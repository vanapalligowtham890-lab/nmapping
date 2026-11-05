from datetime import datetime, timezone
import asyncio
import secrets
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from app.models.traffic import (
    ObservationBatchRequest,
    ObservationBatchResponse,
    RoadSegment,
    IncidentReport,
)
from app.services.ingestion import ingestion_service
from app.services.road_network import road_network
from app.services.congestion import congestion_engine
from app.services.session_manager import session_manager

router = APIRouter(prefix="/v1/traffic", tags=["traffic"])

# In-memory incident store
incident_reports: List[IncidentReport] = []

@router.post("/observations", response_model=ObservationBatchResponse)
async def submit_observations(batch: ObservationBatchRequest, background_tasks: BackgroundTasks):
    """
    Submit active-trip GPS observations.
    Validates accuracy and map-matches to road edges.
    Raw coordinates are discarded immediately after aggregation.
    After processing, broadcasts live update to all WebSocket clients.
    """
    if not session_manager.is_valid_session(batch.session_token):
        raise HTTPException(status_code=403, detail="Invalid, expired, or terminated trip session token.")

    response = ingestion_service.ingest_batch(batch)

    # Push live update to all connected browsers in background
    if response.accepted > 0:
        background_tasks.add_task(_broadcast_update)

    return response

async def _broadcast_update():
    from app.ws.manager import broadcast_traffic_update
    await broadcast_traffic_update()

@router.get("/segments", response_model=List[RoadSegment])
async def get_traffic_segments(
    bbox: Optional[str] = Query(None, description="min_lon,min_lat,max_lon,max_lat")
):
    """
    Fetch aggregate traffic state for visible map area.
    Provides current speeds, congestion status, and confidence levels.
    """
    congestion_engine.evaluate_all()

    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) == 4:
                min_lon, min_lat, max_lon, max_lat = parts
                return road_network.get_segments_in_bbox(min_lon, min_lat, max_lon, max_lat)
        except Exception:
            pass

    return list(road_network.segments.values())

@router.post("/report", response_model=IncidentReport)
async def submit_incident_report(
    lat: float,
    lon: float,
    incident_type: str,
    session_token: str,
    background_tasks: BackgroundTasks,
    description: Optional[str] = None
):
    """
    Submit user-reported incident (waterlogging, pothole, closure, accident).
    Treated as unverified until corroboration by other users or official feeds.
    Pushes real-time incident notification to all connected clients.
    """
    if not session_manager.is_valid_session(session_token):
        raise HTTPException(status_code=403, detail="Active trip session required to submit report.")

    nearest = road_network.find_nearest_segment(lat, lon, max_radius_m=50.0)
    seg_id = nearest[0].segment_id if nearest else None

    report = IncidentReport(
        report_id=f"rep_{secrets.token_hex(6)}",
        session_token=session_token,
        lat=lat,
        lon=lon,
        segment_id=seg_id,
        incident_type=incident_type,
        description=description,
        timestamp=datetime.now(timezone.utc),
        status="unverified"
    )
    incident_reports.append(report)

    # Broadcast incident to all clients
    background_tasks.add_task(_broadcast_incident, report)
    return report

async def _broadcast_incident(report: IncidentReport):
    from app.ws.manager import ws_manager
    await ws_manager.broadcast({
        "type": "incident",
        "report_id": report.report_id,
        "incident_type": report.incident_type,
        "lat": report.lat,
        "lon": report.lon,
        "segment_id": report.segment_id,
        "status": report.status,
        "ts": report.timestamp.isoformat()
    })

@router.get("/reports", response_model=List[IncidentReport])
async def list_incident_reports():
    return incident_reports
