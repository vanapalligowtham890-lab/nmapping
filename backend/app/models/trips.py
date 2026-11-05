from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from app.models.routing import VehicleProfile

class TripStartRequest(BaseModel):
    client_version: Optional[str] = "1.0.0"
    vehicle_profile: VehicleProfile = VehicleProfile.car

class TripStartResponse(BaseModel):
    session_token: str
    expires_at: datetime
    consent_ack: bool
    notice: str

class TripEndRequest(BaseModel):
    session_token: str
    feedback: Optional[str] = None

class TripEndResponse(BaseModel):
    status: str
    message: str

