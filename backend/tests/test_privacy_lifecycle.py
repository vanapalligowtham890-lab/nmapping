from datetime import datetime, timezone
from app.services.session_manager import session_manager
from app.services.ingestion import ingestion_service
from app.services.road_network import road_network
from app.models.traffic import ObservationBatchRequest, ObservationPoint
from app.models.routing import VehicleProfile

def test_session_invalidation_stops_location_collection():
    """Requirement: Ending the trip immediately stops location collection & invalidates token."""
    session_manager.clear()
    session = session_manager.start_session(vehicle_profile=VehicleProfile.car)
    token = session.session_token

    assert session_manager.is_valid_session(token) is True

    # End trip
    closed = session_manager.end_session(token)
    assert closed is True

    # Token must now be strictly invalid
    assert session_manager.is_valid_session(token) is False

    # Ingestion attempt with ended session must be rejected
    req = ObservationBatchRequest(
        session_token=token,
        observations=[
            ObservationPoint(
                timestamp=datetime.now(timezone.utc),
                lat=12.9716,
                lon=77.6405,
                speed_kph=25.0,
                accuracy_m=10.0
            )
        ]
    )

    resp = ingestion_service.ingest_batch(req)
    assert resp.accepted == 0
    assert resp.rejected == 1
    assert "Invalid or expired session token" in resp.message

def test_raw_gps_coordinates_never_retained_in_state():
    """Requirement: Raw coordinates must expire immediately; keep road aggregates only."""
    session_manager.clear()
    road_network.reset_network()

    session = session_manager.start_session()
    token = session.session_token

    # Submit valid observation
    req = ObservationBatchRequest(
        session_token=token,
        observations=[
            ObservationPoint(
                timestamp=datetime.now(timezone.utc),
                lat=12.9716,
                lon=77.6405,
                speed_kph=32.0,
                accuracy_m=8.0
            )
        ]
    )
    resp = ingestion_service.ingest_batch(req)
    assert resp.accepted == 1

    # Verify road segment has aggregated values but NO personal coordinates list
    seg = road_network.get_segment(resp.matched_segments[0])
    assert seg is not None
    assert seg.current_speed_kph is not None
    # Check that segment model does not retain any user raw track or session trace
    assert not hasattr(seg, "user_traces")
    assert not hasattr(seg, "raw_gps_points")

