import sys
import os
import time
from datetime import datetime, timezone, timedelta

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.road_network import road_network
from app.services.congestion import CongestionEngine
from app.services.routing import SafeRoutingEngine
from app.services.session_manager import session_manager
from app.services.ingestion import ingestion_service
from app.models.traffic import ObservationBatchRequest, ObservationPoint, TrafficStatus, ConfidenceLevel
from app.models.routing import RouteRequest, Coordinate, VehicleProfile

def print_header(title: str):
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def run_all_pilot_scenarios():
    print_header("SMART TRAFFIC ROUTING PILOT SIMULATION SUITE")
    print("Target Area: Bengaluru Pilot Corridor (Indiranagar - Domlur - Koramangala)")
    print("Running verification scenarios...\n")

    # -------------------------------------------------------------
    # Scenario 1: Normal Morning Traffic
    # -------------------------------------------------------------
    print_header("SCENARIO 1: Normal Flow Verification")
    road_network.reset_network()
    congestion = CongestionEngine(window_sec=300, min_contributors_for_alert=3)

    now = datetime.now(timezone.utc)
    # 4 distinct active drivers
    for i in range(1, 5):
        token = f"sess_normal_{i}"
        congestion.add_observation("seg_100ft_south", token, 34.0 + i, now)

    seg = congestion.evaluate_segment("seg_100ft_south", now)
    print(f"Segment: {seg.name}")
    print(f"Status: {seg.status.value.upper()} | Speed: {seg.current_speed_kph} km/h (Baseline: {seg.baseline_speed_kph})")
    print(f"Confidence: {seg.confidence.value} | Contributors: {seg.sample_count}")
    assert seg.status == TrafficStatus.normal
    print("[PASS] Result: Normal flow verified across corridor.")

    # -------------------------------------------------------------
    # Scenario 2: Single-Device Anomaly Filter
    # -------------------------------------------------------------
    print_header("SCENARIO 2: Single-Phone Glitch Filtering (Use evidence, not one phone)")
    road_network.reset_network()
    congestion = CongestionEngine(window_sec=300, min_contributors_for_alert=3)

    # Only 1 phone stopped (e.g. food delivery or parking)
    congestion.add_observation("seg_100ft_south", "sess_delivery_driver", 2.5, now)
    seg = congestion.evaluate_segment("seg_100ft_south", now)

    print(f"Speed reported by 1 phone: 2.5 km/h")
    print(f"Segment Status: {seg.status.value.upper()} (Confidence: {seg.confidence.value})")
    print(f"Sample count: {seg.sample_count} independent device")
    assert seg.status == TrafficStatus.normal
    print("[PASS] Result: Single-phone false alert successfully rejected!")

    # -------------------------------------------------------------
    # Scenario 3: Genuine Multi-Vehicle Congestion
    # -------------------------------------------------------------
    print_header("SCENARIO 3: Genuine Multi-Device Congestion Detection")
    road_network.reset_network()
    congestion = CongestionEngine(window_sec=300, min_contributors_for_alert=3)

    # 5 independent active trip drivers crawl at 9 km/h
    for i in range(1, 6):
        congestion.add_observation("seg_100ft_south", f"sess_stuck_driver_{i}", 9.0 + (i * 0.2), now)

    seg = congestion.evaluate_segment("seg_100ft_south", now)
    print(f"Segment: {seg.name}")
    print(f"Observed Median Speed: {seg.current_speed_kph} km/h (Baseline: {seg.baseline_speed_kph})")
    print(f"Independent Contributors: {seg.sample_count}")
    print(f"Calculated Status: {seg.status.value.upper()} (Confidence: {seg.confidence.value.upper()})")
    assert seg.status in [TrafficStatus.slowing, TrafficStatus.congested]
    print("[PASS] Result: Verified congestion declared from multi-contributor consensus.")

    # -------------------------------------------------------------
    # Scenario 4: Safe Detour Diversion Budget Capping
    # -------------------------------------------------------------
    print_header("SCENARIO 4: Detour Diversion Budget Capping (Prevent creating new jams)")
    road_network.reset_network()
    routing = SafeRoutingEngine()

    # Mark 100ft road as congested
    road_100ft = road_network.get_segment("seg_100ft_south")
    road_100ft.status = TrafficStatus.congested
    road_100ft.current_speed_kph = 9.0

    bypass = road_network.get_segment("seg_suranjan_conn")
    bypass.current_diversion_count = 0
    bypass.diversion_cap = 5

    req = RouteRequest(
        origin=Coordinate(lat=12.9784, lon=77.6408),
        destination=Coordinate(lat=12.9610, lon=77.6385),
        vehicle_profile=VehicleProfile.car,
        avoid_residential_shortcuts=True
    )

    # A: When quota available
    r1 = routing.find_routes(req)
    print(f"Detour quota: {bypass.current_diversion_count} / {bypass.diversion_cap}")
    print(f"Selected route: {r1.selected_route_id} ({r1.routes[1].summary})")
    assert r1.selected_route_id == "route_alt_bypass"

    # B: When quota is saturated
    bypass.current_diversion_count = 5
    r2 = routing.find_routes(req)
    print(f"\nAfter 5 vehicles diverted (Quota: {bypass.current_diversion_count}/{bypass.diversion_cap}):")
    print(f"Selected route: {r2.selected_route_id} ({r2.routes[0].summary})")
    print(f"Decision explanation: {r2.decision_rationale}")
    assert r2.selected_route_id == "route_primary"
    print("[PASS] Result: Detour capped. App stopped sending drivers onto detour.")

    # -------------------------------------------------------------
    # Scenario 5: Data Expiry Decay
    # -------------------------------------------------------------
    print_header("SCENARIO 5: Stale Traffic Decay & Expiry")
    road_network.reset_network()
    congestion = CongestionEngine(window_sec=300, expiry_sec=600, min_contributors_for_alert=3)

    t_old = now - timedelta(minutes=15)
    for i in range(4):
        congestion.add_observation("seg_100ft_south", f"sess_driver_{i}", 10.0, timestamp=t_old)
    congestion.evaluate_segment("seg_100ft_south", current_time=t_old)

    # Now evaluate 15 minutes later (no new observations)
    seg_decayed = congestion.evaluate_segment("seg_100ft_south", current_time=now)
    print(f"Segment status after 15 min inactivity: {seg_decayed.status.value.upper()}")
    print(f"Confidence: {seg_decayed.confidence.value.upper()}")
    assert seg_decayed.status == TrafficStatus.unknown
    print("[PASS] Result: Stale traffic decayed to UNKNOWN automatically.")

    # -------------------------------------------------------------
    # Scenario 6: Foreground Privacy & Session Invalidation
    # -------------------------------------------------------------
    print_header("SCENARIO 6: Privacy Lifecycle & Session Invalidation")
    session_manager.clear()
    session = session_manager.start_session(VehicleProfile.car)
    tok = session.session_token
    print(f"Active trip session established: {tok}")

    # End trip
    session_manager.end_session(tok)
    print("User clicked 'End Trip' / app dismissed -> Token invalidated immediately.")

    # Subsequent submission
    bad_req = ObservationBatchRequest(
        session_token=tok,
        observations=[ObservationPoint(timestamp=now, lat=12.9716, lon=77.6405, speed_kph=30.0, accuracy_m=10.0)]
    )
    res_bad = ingestion_service.ingest_batch(bad_req)
    print(f"Attempted upload with terminated token: accepted={res_bad.accepted}, rejected={res_bad.rejected}")
    print(f"Server response: {res_bad.message}")
    assert res_bad.accepted == 0
    print("[PASS] Result: Zero location collection after trip termination verified.")

    print_header("ALL 6 PILOT SCENARIOS PASSED WITH 100% SUCCESS")

if __name__ == "__main__":
    run_all_pilot_scenarios()
