from datetime import datetime, timezone
import secrets
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
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
async def submit_observations(batch: ObservationBatchRequest):
    """
    Submit active-trip GPS observations.
    Validates accuracy and map-matches to road edges.
    Raw coordinates are discarded immediately after aggregation.
    """
    if not session_manager.is_valid_session(batch.session_token):
        raise HTTPException(status_code=403, detail="Invalid, expired, or terminated trip session token.")

    response = ingestion_service.ingest_batch(batch)
    return response

@router.get("/segments", response_model=List[RoadSegment])
async def get_traffic_segments(
    bbox: Optional[str] = Query(None, description="min_lon,min_lat,max_lon,max_lat")
):
    """
    Fetch aggregate traffic state for visible map area.
    Provides current speeds, congestion status, and confidence levels.
    """
    # Run lazy expiry evaluation
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
    description: Optional[str] = None
):
    """
    Submit user-reported incident (waterlogging, pothole, closure, accident).
    Treated as unverified until corroboration by other users or official feeds.
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
    return report

@router.get("/reports", response_model=List[IncidentReport])
async def list_incident_reports():
    return incident_reports
