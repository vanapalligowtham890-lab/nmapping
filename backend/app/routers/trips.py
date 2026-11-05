from fastapi import APIRouter, HTTPException
from app.models.trips import (
    TripStartRequest,
    TripStartResponse,
    TripEndRequest,
    TripEndResponse,
)
from app.services.session_manager import session_manager
from app.services.routing import routing_engine

router = APIRouter(prefix="/v1/trips", tags=["trips"])

@router.post("/start", response_model=TripStartResponse)
async def start_trip(request: TripStartRequest):
    """
    Initializes a privacy-protected active trip session upon explicit user action.
    Returns a short-lived ephemeral session token for foreground speed observations.
    """
    session = session_manager.start_session(vehicle_profile=request.vehicle_profile)
    notice = (
        "Active trip started. Foreground location is used solely to compute anonymous "
        "road-level speed summaries. Ending the trip or dismissing the app stops collection immediately."
    )
    return TripStartResponse(
        session_token=session.session_token,
        expires_at=session.expires_at,
        consent_ack=True,
        notice=notice
    )

@router.post("/end", response_model=TripEndResponse)
async def end_trip(request: TripEndRequest):
    """
    Explicitly ends trip session.
    Immediately invalidates session token, releases any detour diversion budget held,
    and drops pending observation ingestion queues.
    """
    # Release any reserved detour capacity
    routing_engine.release_diversion_for_session(request.session_token)

    # Invalidate session
    closed = session_manager.end_session(request.session_token)
    if not closed:
        return TripEndResponse(
            status="already_ended",
            message="Session was already ended or expired."
        )

    return TripEndResponse(
        status="terminated",
        message="Trip session invalidated. Location collection stopped; diversion quota released."
    )
