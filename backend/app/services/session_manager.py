import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Set
from app.models.routing import VehicleProfile

class TripSession:
    def __init__(self, session_token: str, vehicle_profile: VehicleProfile):
        self.session_token = session_token
        self.vehicle_profile = vehicle_profile
        self.created_at = datetime.now(timezone.utc)
        self.expires_at = self.created_at + timedelta(hours=2)
        self.is_active = True
        self.last_active = self.created_at
        self.observation_count = 0
        self.reserved_segments: Set[str] = set()

class SessionManager:
    def __init__(self):
        self.active_sessions: Dict[str, TripSession] = {}
        self.invalidated_tokens: Set[str] = set()

    def start_session(self, vehicle_profile: VehicleProfile = VehicleProfile.car) -> TripSession:
        token = f"sess_{secrets.token_hex(12)}"
        session = TripSession(session_token=token, vehicle_profile=vehicle_profile)
        self.active_sessions[token] = session
        return session

    def is_valid_session(self, token: str) -> bool:
        if token in self.invalidated_tokens:
            return False
        session = self.active_sessions.get(token)
        if not session or not session.is_active:
            return False
        if datetime.now(timezone.utc) > session.expires_at:
            self.end_session(token)
            return False
        return True

    def get_session(self, token: str) -> Optional[TripSession]:
        if not self.is_valid_session(token):
            return None
        return self.active_sessions.get(token)

    def record_activity(self, token: str, sample_count: int = 1):
        session = self.get_session(token)
        if session:
            session.last_active = datetime.now(timezone.utc)
            session.observation_count += sample_count

    def end_session(self, token: str) -> bool:
        """Immediately invalidates the token and marks session as terminated."""
        self.invalidated_tokens.add(token)
        session = self.active_sessions.pop(token, None)
        if session:
            session.is_active = False
            # Return True indicating session was found and closed
            return True
        return False

    def clear(self):
        self.active_sessions.clear()
        self.invalidated_tokens.clear()

session_manager = SessionManager()

