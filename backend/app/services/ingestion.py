from datetime import datetime, timezone
from typing import List, Tuple
from app.models.traffic import (
    ObservationPoint,
    ObservationBatchRequest,
    ObservationBatchResponse,
)
from app.services.road_network import road_network
from app.services.session_manager import session_manager
from app.services.congestion import congestion_engine

class TrafficIngestionService:
    def __init__(self, max_accuracy_m: float = 25.0, max_speed_kph: float = 140.0):
        self.max_accuracy_m = max_accuracy_m
        self.max_speed_kph = max_speed_kph

    def ingest_batch(self, request: ObservationBatchRequest) -> ObservationBatchResponse:
        # 1. Validate session token
        if not session_manager.is_valid_session(request.session_token):
            return ObservationBatchResponse(
                received=len(request.observations),
                accepted=0,
                rejected=len(request.observations),
                matched_segments=[],
                message="Rejected: Invalid or expired session token. Trip must be active."
            )

        accepted_count = 0
        rejected_count = 0
        matched_segment_ids: List[str] = []

        now = datetime.now(timezone.utc)

        for obs in request.observations:
            # 2. Filter low-accuracy GPS drift
            if obs.accuracy_m > self.max_accuracy_m:
                rejected_count += 1
                continue

            # 3. Filter implausible speed jumps
            if obs.speed_kph < 0.0 or obs.speed_kph > self.max_speed_kph:
                rejected_count += 1
                continue

            # 4. Map-match to road segment
            match_res = road_network.find_nearest_segment(obs.lat, obs.lon, max_radius_m=35.0)
            if not match_res:
                rejected_count += 1
                continue

            segment, dist = match_res

            # 5. Privacy guarantee: Discard raw (lat, lon) coordinates immediately!
            # Only record sanitized (session_token, speed_kph, timestamp) against the segment.
            obs_time = obs.timestamp if obs.timestamp.tzinfo else obs.timestamp.replace(tzinfo=timezone.utc)
            congestion_engine.add_observation(
                segment_id=segment.segment_id,
                session_token=request.session_token,
                speed_kph=obs.speed_kph,
                timestamp=obs_time
            )

            accepted_count += 1
            if segment.segment_id not in matched_segment_ids:
                matched_segment_ids.append(segment.segment_id)

        # Update activity in session manager
        session_manager.record_activity(request.session_token, sample_count=accepted_count)

        # Evaluate updated segments
        for seg_id in matched_segment_ids:
            congestion_engine.evaluate_segment(seg_id, current_time=now)

        return ObservationBatchResponse(
            received=len(request.observations),
            accepted=accepted_count,
            rejected=rejected_count,
            matched_segments=matched_segment_ids,
            message="Batch processed. Raw coordinates purged; segment state updated."
        )

ingestion_service = TrafficIngestionService()

