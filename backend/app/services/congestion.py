from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
import statistics
from app.models.traffic import TrafficStatus, ConfidenceLevel, RoadSegment
from app.services.road_network import road_network

class WindowSummary:
    def __init__(self, median_speed: float, contributors: int, timestamp: datetime):
        self.median_speed = median_speed
        self.contributors = contributors
        self.timestamp = timestamp

class SegmentTrafficState:
    def __init__(self, segment_id: str):
        self.segment_id = segment_id
        # In-memory rolling observations: list of (session_token, speed_kph, timestamp)
        # Note: Raw GPS coordinates are NEVER stored here to protect user privacy.
        self.recent_samples: List[Tuple[str, float, datetime]] = []
        self.window_history: List[WindowSummary] = []
        self.last_aggregated: Optional[datetime] = None

class CongestionEngine:
    def __init__(
        self,
        window_sec: int = 300, # 5-minute rolling window
        expiry_sec: int = 600, # 10-minute expiry to revert to 'unknown'
        min_contributors_for_alert: int = 3, # Evidence-based threshold (never 1 device)
    ):
        self.window_sec = window_sec
        self.expiry_sec = expiry_sec
        self.min_contributors = min_contributors_for_alert
        self.segment_states: Dict[str, SegmentTrafficState] = {}

    def _get_or_create_state(self, segment_id: str) -> SegmentTrafficState:
        if segment_id not in self.segment_states:
            self.segment_states[segment_id] = SegmentTrafficState(segment_id)
        return self.segment_states[segment_id]

    def add_observation(self, segment_id: str, session_token: str, speed_kph: float, timestamp: Optional[datetime] = None):
        """Adds a privacy-sanitized speed observation from an active trip session."""
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)
        elif timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)

        state = self._get_or_create_state(segment_id)
        state.recent_samples.append((session_token, speed_kph, timestamp))

    def evaluate_segment(self, segment_id: str, current_time: Optional[datetime] = None) -> RoadSegment:
        """Aggregates recent observations, enforces multi-contributor checks, and updates segment status."""
        if current_time is None:
            current_time = datetime.now(timezone.utc)
        elif current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)

        seg = road_network.get_segment(segment_id)
        if not seg:
            raise ValueError(f"Unknown segment ID: {segment_id}")

        state = self._get_or_create_state(segment_id)

        # 1. Prune samples outside rolling window
        cutoff_window = current_time - timedelta(seconds=self.window_sec)
        state.recent_samples = [s for s in state.recent_samples if s[2] >= cutoff_window]

        # 2. Check for data expiry
        if not state.recent_samples:
            # If no recent observations, check when last updated
            if seg.last_updated:
                last_up = seg.last_updated if seg.last_updated.tzinfo else seg.last_updated.replace(tzinfo=timezone.utc)
                if (current_time - last_up).total_seconds() > self.expiry_sec:
                    seg.status = TrafficStatus.unknown
                    seg.confidence = ConfidenceLevel.unknown
                    seg.sample_count = 0
            return seg

        # 3. Analyze independent contributors
        speeds = [s[1] for s in state.recent_samples]
        unique_sessions = set(s[0] for s in state.recent_samples)
        contributor_count = len(unique_sessions)
        median_speed = statistics.median(speeds)

        # Record window summary
        state.window_history.append(WindowSummary(median_speed, contributor_count, current_time))
        # Keep only last 5 window summaries
        if len(state.window_history) > 5:
            state.window_history = state.window_history[-5:]

        seg.current_speed_kph = round(median_speed, 1)
        seg.sample_count = contributor_count
        seg.last_updated = current_time

        # 4. Strict Evidence Rule: Do not declare slowdown/congestion if only 1 or 2 phones!
        if contributor_count < self.min_contributors:
            # Insufficient independent evidence!
            # Could be a single parked delivery scooter or GPS noise. Keep normal or low confidence.
            seg.status = TrafficStatus.normal
            seg.confidence = ConfidenceLevel.low
            return seg

        # 5. Speed comparison against baseline
        baseline = seg.baseline_speed_kph
        speed_ratio = median_speed / max(baseline, 5.0)

        # Check persistence across history windows
        persistent_drop = False
        if len(state.window_history) >= 2:
            prev_summary = state.window_history[-2]
            if prev_summary.contributors >= 2 and (prev_summary.median_speed / baseline) <= 0.70:
                persistent_drop = True

        if speed_ratio <= 0.45:
            # Severe slowdown (< 45% of baseline speed)
            if persistent_drop or contributor_count >= 5:
                seg.status = TrafficStatus.congested
                seg.confidence = ConfidenceLevel.high
            else:
                # Emerging slowdown
                seg.status = TrafficStatus.slowing
                seg.confidence = ConfidenceLevel.medium
        elif speed_ratio <= 0.70:
            # Moderate slowdown (45% - 70% of baseline)
            seg.status = TrafficStatus.slowing
            seg.confidence = ConfidenceLevel.high if contributor_count >= 5 else ConfidenceLevel.medium
        else:
            # Normal speed
            seg.status = TrafficStatus.normal
            seg.confidence = ConfidenceLevel.high if contributor_count >= 4 else ConfidenceLevel.medium

        return seg

    def evaluate_all(self, current_time: Optional[datetime] = None):
        """Evaluates all road segments in the network."""
        for seg_id in road_network.segments.keys():
            self.evaluate_segment(seg_id, current_time)

    def reset(self):
        self.segment_states.clear()

congestion_engine = CongestionEngine()
