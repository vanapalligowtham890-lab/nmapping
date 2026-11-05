import enum
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

class RoadClass(str, enum.Enum):
    primary = "primary"
    secondary = "secondary"
    tertiary = "tertiary"
    residential = "residential"

class TrafficStatus(str, enum.Enum):
    normal = "normal"
    slowing = "slowing"
    congested = "congested"
    unknown = "unknown"
    closed = "closed"

class ConfidenceLevel(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    unknown = "unknown"

class ObservationPoint(BaseModel):
    timestamp: datetime
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    speed_kph: float = Field(..., ge=0.0, le=160.0)
    accuracy_m: float = Field(..., ge=0.0)
    heading_deg: Optional[float] = Field(None, ge=0.0, le=360.0)

class ObservationBatchRequest(BaseModel):
    session_token: str
    observations: List[ObservationPoint]

class ObservationBatchResponse(BaseModel):
    received: int
    accepted: int
    rejected: int
    matched_segments: List[str]
    message: str

class RoadSegment(BaseModel):
    segment_id: str
    name: str
    road_class: RoadClass
    coordinates: List[List[float]] # [[lat, lon], ...]
    from_node: str
    to_node: str
    length_m: float
    speed_limit_kph: float
    baseline_speed_kph: float
    width_m: float
    width_confidence: ConfidenceLevel
    vehicle_allowed: List[str]
    is_oneway: bool = False
    diversion_cap: int = 20
    current_diversion_count: int = 0
    current_speed_kph: Optional[float] = None
    sample_count: int = 0
    confidence: ConfidenceLevel = ConfidenceLevel.unknown
    status: TrafficStatus = TrafficStatus.normal
    last_updated: Optional[datetime] = None

class IncidentReport(BaseModel):
    report_id: str
    session_token: str
    lat: float
    lon: float
    segment_id: Optional[str] = None
    incident_type: str # waterlogging, pothole, closure, accident, heavy_traffic
    description: Optional[str] = None
    timestamp: datetime
    status: str = "unverified" # unverified, verified, dismissed

