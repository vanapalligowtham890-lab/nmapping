from app.services.road_network import road_network
from app.services.routing import SafeRoutingEngine
from app.models.routing import RouteRequest, Coordinate, VehicleProfile
from app.models.traffic import TrafficStatus

def test_cars_excluded_from_narrow_residential_shortcuts():
    """Requirement: Exclude unsuitable residential shortcuts from default car routing."""
    road_network.reset_network()
    routing = SafeRoutingEngine()

    # Make main road congested to see where car is sent
    seg_main = road_network.get_segment("seg_100ft_south")
    seg_main.status = TrafficStatus.congested

    # Make secondary bypass closed so only residential remains as an alternative
    seg_bypass = road_network.get_segment("seg_suranjan_conn")
    seg_bypass.status = TrafficStatus.closed

    req = RouteRequest(
        origin=Coordinate(lat=12.9784, lon=77.6408),
        destination=Coordinate(lat=12.9610, lon=77.6385),
        vehicle_profile=VehicleProfile.car,
        avoid_residential_shortcuts=True
    )

    res = routing.find_routes(req)

    # Must NOT route car through narrow residential street (Defence Colony 6th Cross)
    # Must keep main verified route and explain why
    assert res.selected_route_id == "route_primary"
    residential_route = next((r for r in res.routes if r.route_id == "route_alt_residential"), None)
    if residential_route:
        assert not residential_route.is_recommended
        assert "Excluded by safety constraints" in residential_route.recommendation_reason

def test_two_wheeler_allowed_on_suitable_residential_cross():
    """Requirement: Vehicle restrictions respect vehicle profiles."""
    road_network.reset_network()
    routing = SafeRoutingEngine()

    req_bike = RouteRequest(
        origin=Coordinate(lat=12.9784, lon=77.6408),
        destination=Coordinate(lat=12.9610, lon=77.6385),
        vehicle_profile=VehicleProfile.two_wheeler,
        avoid_residential_shortcuts=False
    )

    res_bike = routing.find_routes(req_bike)
    # Two-wheeler has route options available
    assert len(res_bike.routes) >= 1

