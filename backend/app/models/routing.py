import enum
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
from app.models.traffic import RoadClass, TrafficStatus

class VehicleProfile(str, enum.Enum):
    car = "car"
    two_wheeler = "two_wheeler"
    auto_rickshaw = "auto_rickshaw"

class Coordinate(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)

class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    vehicle_profile: VehicleProfile = VehicleProfile.car
    avoid_residential_shortcuts: bool = True
    reserve_diversion: bool = False
    session_token: Optional[str] = None

class RouteCandidate(BaseModel):
    route_id: str
    route_type: str # primary_verified, traffic_aware_alternative, caution_route
    segments: List[str]
    segment_names: List[str]
    coordinates: List[List[float]]
    total_distance_m: float
    total_duration_sec: float
    summary: str
    status: TrafficStatus
    is_recommended: bool
    recommendation_reason: str
    diversion_budget_remaining: Optional[int] = None
    suitability_notes: List[str] = []

class RouteResponse(BaseModel):
    origin: Coordinate
    destination: Coordinate
    vehicle_profile: VehicleProfile
    selected_route_id: str
    routes: List[RouteCandidate]
    decision_rationale: str
    active_diversions_summary: Dict[str, int]
