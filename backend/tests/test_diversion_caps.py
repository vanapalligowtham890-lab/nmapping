from app.services.road_network import road_network
from app.services.routing import SafeRoutingEngine
from app.services.session_manager import session_manager
from app.models.routing import RouteRequest, Coordinate, VehicleProfile
from app.models.traffic import TrafficStatus

def test_detour_cap_prevents_new_jams():
    """Requirement: Stop recommending a detour when its budget is reached."""
    road_network.reset_network()
    session_manager.clear()
    routing = SafeRoutingEngine()

    # Artificially set 100ft road as congested
    road_100ft = road_network.get_segment("seg_100ft_south")
    road_100ft.status = TrafficStatus.congested
    road_100ft.current_speed_kph = 8.0

    # Test candidate detour (Suranjan Das bypass)
    bypass = road_network.get_segment("seg_suranjan_conn")
    bypass.current_diversion_count = 0
    bypass.diversion_cap = 5

    req = RouteRequest(
        origin=Coordinate(lat=12.9784, lon=77.6408), # Indiranagar
        destination=Coordinate(lat=12.9610, lon=77.6385), # Domlur
        vehicle_profile=VehicleProfile.car,
        avoid_residential_shortcuts=True
    )

    # 1. With quota available, alternative is recommended
    res1 = routing.find_routes(req)
    assert res1.selected_route_id == "route_alt_bypass"

    # 2. Saturate diversion cap
    bypass.current_diversion_count = 5

    # 3. Request route again: detour is now rejected and system falls back to verified main route
    res2 = routing.find_routes(req)
    assert res2.selected_route_id == "route_primary"
    assert "Excluded by safety constraints" in res2.routes[1].recommendation_reason or "Detour cap reached" in res2.routes[1].recommendation_reason
    assert "Selected verified main corridor despite traffic slowdown" in res2.decision_rationale

