from datetime import datetime, timezone, timedelta
from app.services.congestion import CongestionEngine
from app.services.road_network import road_network
from app.models.traffic import TrafficStatus, ConfidenceLevel

def test_single_slow_device_does_not_trigger_congestion():
    """Requirement: Use evidence, not one phone. A single slow device must NOT declare slowdown."""
    road_network.reset_network()
    engine = CongestionEngine(window_sec=300, min_contributors_for_alert=3)

    seg_id = "seg_100ft_south"
    now = datetime.now(timezone.utc)

    # 1 device reporting severe crawl (3 km/h on a 35 km/h baseline road)
    engine.add_observation(seg_id, session_token="sess_device_1", speed_kph=3.0, timestamp=now)

    seg = engine.evaluate_segment(seg_id, current_time=now)

    # Must remain normal with low confidence (single phone anomaly filtered)
    assert seg.status == TrafficStatus.normal
    assert seg.confidence == ConfidenceLevel.low
    assert seg.sample_count == 1

def test_multi_device_slowdown_triggers_congestion():
    """Requirement: Minimum independent contributors (>=3) triggers verified slowdown/congestion."""
    road_network.reset_network()
    engine = CongestionEngine(window_sec=300, min_contributors_for_alert=3)

    seg_id = "seg_100ft_south"
    now = datetime.now(timezone.utc)

    # 4 distinct devices reporting low speed (10 km/h on a 35 km/h baseline road -> ~28% of baseline)
    for i in range(1, 5):
        engine.add_observation(
            seg_id,
            session_token=f"sess_driver_{i}",
            speed_kph=10.0 + (i * 0.5),
            timestamp=now
        )

    seg = engine.evaluate_segment(seg_id, current_time=now)

    # Must be recognized as slowing or congested with medium/high confidence
    assert seg.status in [TrafficStatus.slowing, TrafficStatus.congested]
    assert seg.confidence in [ConfidenceLevel.medium, ConfidenceLevel.high]
    assert seg.sample_count == 4
    assert seg.current_speed_kph < 15.0

def test_persistent_slowdown_escalates_to_congested():
    """Requirement: Speed reduction persisting across more than one window escalates to congested."""
    road_network.reset_network()
    engine = CongestionEngine(window_sec=300, min_contributors_for_alert=3)
    seg_id = "seg_100ft_south"

    t1 = datetime.now(timezone.utc) - timedelta(minutes=6)
    t2 = datetime.now(timezone.utc)

    # Window 1: 3 devices reporting 12 km/h
    for i in range(3):
        engine.add_observation(seg_id, f"sess_w1_{i}", 12.0, timestamp=t1)
    engine.evaluate_segment(seg_id, current_time=t1)

    # Window 2: 3 devices reporting 11 km/h
    for i in range(3):
        engine.add_observation(seg_id, f"sess_w2_{i}", 11.0, timestamp=t2)
    seg = engine.evaluate_segment(seg_id, current_time=t2)

    assert seg.status == TrafficStatus.congested
    assert seg.confidence == ConfidenceLevel.high

