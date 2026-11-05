from datetime import datetime, timezone, timedelta
from app.services.congestion import CongestionEngine
from app.services.road_network import road_network
from app.models.traffic import TrafficStatus, ConfidenceLevel

def test_stale_observations_expire_to_unknown():
    """Requirement: Old observations decay quickly and return to 'unknown' when evidence expires."""
    road_network.reset_network()
    # 10 minute expiry
    engine = CongestionEngine(window_sec=300, expiry_sec=600, min_contributors_for_alert=3)
    seg_id = "seg_100ft_south"

    t0 = datetime.now(timezone.utc) - timedelta(minutes=15)
    # Add observations 15 minutes ago
    for i in range(4):
        engine.add_observation(seg_id, f"sess_old_{i}", 10.0, timestamp=t0)

    # Initial evaluation at t0 marks it slowing/congested
    seg = engine.evaluate_segment(seg_id, current_time=t0)
    assert seg.status in [TrafficStatus.slowing, TrafficStatus.congested]

    # Evaluate at current time (15 mins later, > 10 mins expiry threshold)
    now = datetime.now(timezone.utc)
    seg_expired = engine.evaluate_segment(seg_id, current_time=now)

    assert seg_expired.status == TrafficStatus.unknown
    assert seg_expired.confidence == ConfidenceLevel.unknown

