import math
from typing import Dict, List, Optional, Tuple
from app.models.traffic import RoadClass, TrafficStatus, ConfidenceLevel, RoadSegment

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c

def point_to_segment_distance_m(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    """Computes minimum distance in meters from point (px, py) to line segment (x1, y1)-(x2, y2).
       px, x1, x2 are lat; py, y1, y2 are lon."""
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return haversine_m(px, py, x1, y1)

    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    closest_lat = x1 + t * dx
    closest_lon = y1 + t * dy
    return haversine_m(px, py, closest_lat, closest_lon)

class RoadNetworkService:
    def __init__(self):
        self.segments: Dict[str, RoadSegment] = {}
        self.adjacency: Dict[str, List[Tuple[str, str]]] = {} # from_node -> [(to_node, segment_id)]
        self.nodes: Dict[str, Tuple[float, float]] = {} # node_id -> (lat, lon)
        self.initialize_pilot_network()

    def initialize_pilot_network(self):
        """Initializes Bengaluru Indiranagar - Koramangala Pilot Network"""
        self.nodes = {
            "N_CMH_100FT": (12.9784, 77.6408),
            "N_100FT_12TH": (12.9716, 77.6405),
            "N_DOMLUR_FLY": (12.9610, 77.6385),
            "N_IRR_EGL": (12.9515, 77.6360),
            "N_SONY_WORLD": (12.9352, 77.6245),
            "N_OLD_AIRPORT_RD": (12.9635, 77.6465),
            "N_SURANJAN_DAS": (12.9690, 77.6580),
            "N_RES_DEFENCE": (12.9740, 77.6470),
            "N_RES_DOMLUR_VIL": (12.9640, 77.6350),
            "N_KORAMANGALA_4TH": (12.9420, 77.6290),
            "N_INNER_RING_KORA": (12.9440, 77.6260),
        }

        # Definition of pilot segments
        segment_defs = [
            # Main Corridors (Primary/Secondary)
            {
                "segment_id": "seg_100ft_south",
                "name": "100 Feet Road (Southbound)",
                "road_class": RoadClass.primary,
                "coordinates": [
                    [12.9784, 77.6408],
                    [12.9716, 77.6405],
                    [12.9610, 77.6385]
                ],
                "from_node": "N_CMH_100FT",
                "to_node": "N_DOMLUR_FLY",
                "speed_limit_kph": 50.0,
                "baseline_speed_kph": 35.0,
                "width_m": 18.0,
                "width_confidence": ConfidenceLevel.high,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": True,
                "diversion_cap": 40
            },
            {
                "segment_id": "seg_100ft_north",
                "name": "100 Feet Road (Northbound)",
                "road_class": RoadClass.primary,
                "coordinates": [
                    [12.9610, 77.6385],
                    [12.9716, 77.6405],
                    [12.9784, 77.6408]
                ],
                "from_node": "N_DOMLUR_FLY",
                "to_node": "N_CMH_100FT",
                "speed_limit_kph": 50.0,
                "baseline_speed_kph": 35.0,
                "width_m": 18.0,
                "width_confidence": ConfidenceLevel.high,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": True,
                "diversion_cap": 40
            },
            {
                "segment_id": "seg_irr_south",
                "name": "Intermediate Ring Road (Southbound to EGL/Koramangala)",
                "road_class": RoadClass.primary,
                "coordinates": [
                    [12.9610, 77.6385],
                    [12.9515, 77.6360],
                    [12.9440, 77.6260],
                    [12.9352, 77.6245]
                ],
                "from_node": "N_DOMLUR_FLY",
                "to_node": "N_SONY_WORLD",
                "speed_limit_kph": 60.0,
                "baseline_speed_kph": 45.0,
                "width_m": 24.0,
                "width_confidence": ConfidenceLevel.high,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": True,
                "diversion_cap": 50
            },
            {
                "segment_id": "seg_irr_north",
                "name": "Intermediate Ring Road (Northbound to Domlur)",
                "road_class": RoadClass.primary,
                "coordinates": [
                    [12.9352, 77.6245],
                    [12.9440, 77.6260],
                    [12.9515, 77.6360],
                    [12.9610, 77.6385]
                ],
                "from_node": "N_SONY_WORLD",
                "to_node": "N_DOMLUR_FLY",
                "speed_limit_kph": 60.0,
                "baseline_speed_kph": 45.0,
                "width_m": 24.0,
                "width_confidence": ConfidenceLevel.high,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": True,
                "diversion_cap": 50
            },
            {
                "segment_id": "seg_old_airport_e",
                "name": "Old Airport Road Arterial (Eastbound)",
                "road_class": RoadClass.secondary,
                "coordinates": [
                    [12.9610, 77.6385],
                    [12.9635, 77.6465],
                    [12.9690, 77.6580]
                ],
                "from_node": "N_DOMLUR_FLY",
                "to_node": "N_SURANJAN_DAS",
                "speed_limit_kph": 50.0,
                "baseline_speed_kph": 32.0,
                "width_m": 16.0,
                "width_confidence": ConfidenceLevel.high,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": False,
                "diversion_cap": 25
            },
            {
                "segment_id": "seg_suranjan_conn",
                "name": "Suranjan Das Parallel Bypass",
                "road_class": RoadClass.secondary,
                "coordinates": [
                    [12.9784, 77.6408],
                    [12.9740, 77.6470],
                    [12.9690, 77.6580],
                    [12.9635, 77.6465],
                    [12.9610, 77.6385]
                ],
                "from_node": "N_CMH_100FT",
                "to_node": "N_DOMLUR_FLY",
                "speed_limit_kph": 45.0,
                "baseline_speed_kph": 30.0,
                "width_m": 14.0,
                "width_confidence": ConfidenceLevel.high,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": True,
                "diversion_cap": 20
            },
            {
                "segment_id": "seg_inner_ring_branch",
                "name": "Inner Ring Road Koramangala Link",
                "road_class": RoadClass.tertiary,
                "coordinates": [
                    [12.9440, 77.6260],
                    [12.9420, 77.6290],
                    [12.9352, 77.6245]
                ],
                "from_node": "N_INNER_RING_KORA",
                "to_node": "N_SONY_WORLD",
                "speed_limit_kph": 40.0,
                "baseline_speed_kph": 28.0,
                "width_m": 12.0,
                "width_confidence": ConfidenceLevel.medium,
                "vehicle_allowed": ["car", "two_wheeler", "auto_rickshaw"],
                "is_oneway": False,
                "diversion_cap": 15
            },
            # Residential Streets (Strict Constraints & Low Caps)
            {
                "segment_id": "seg_res_defence_cut",
                "name": "Defence Colony 6th Cross Shortcut",
                "road_class": RoadClass.residential,
                "coordinates": [
                    [12.9784, 77.6408],
                    [12.9740, 77.6470],
                    [12.9610, 77.6385]
                ],
                "from_node": "N_CMH_100FT",
                "to_node": "N_DOMLUR_FLY",
                "speed_limit_kph": 30.0,
                "baseline_speed_kph": 22.0,
                "width_m": 5.2,
                "width_confidence": ConfidenceLevel.low,
                "vehicle_allowed": ["two_wheeler"], # Unsuitable for cars!
                "is_oneway": False,
                "diversion_cap": 3 # Very low detour cap
            },
            {
                "segment_id": "seg_res_domlur_lane",
                "name": "Domlur Village Inner Alley",
                "road_class": RoadClass.residential,
                "coordinates": [
                    [12.9610, 77.6385],
                    [12.9640, 77.6350],
                    [12.9515, 77.6360]
                ],
                "from_node": "N_DOMLUR_FLY",
                "to_node": "N_IRR_EGL",
                "speed_limit_kph": 25.0,
                "baseline_speed_kph": 18.0,
                "width_m": 4.5,
                "width_confidence": ConfidenceLevel.unknown,
                "vehicle_allowed": ["two_wheeler"],
                "is_oneway": False,
                "diversion_cap": 2
            },
            {
                "segment_id": "seg_res_kora_shortcut",
                "name": "Koramangala 4th Block Residential Alley",
                "road_class": RoadClass.residential,
                "coordinates": [
                    [12.9515, 77.6360],
                    [12.9420, 77.6290],
                    [12.9352, 77.6245]
                ],
                "from_node": "N_IRR_EGL",
                "to_node": "N_SONY_WORLD",
                "speed_limit_kph": 25.0,
                "baseline_speed_kph": 20.0,
                "width_m": 5.5,
                "width_confidence": ConfidenceLevel.low,
                "vehicle_allowed": ["two_wheeler", "auto_rickshaw"],
                "is_oneway": False,
                "diversion_cap": 4
            }
        ]

        self.segments.clear()
        self.adjacency.clear()

        for s_def in segment_defs:
            coords = s_def["coordinates"]
            # calculate total length
            length_m = 0.0
            for i in range(len(coords) - 1):
                length_m += haversine_m(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1])

            seg = RoadSegment(
                segment_id=s_def["segment_id"],
                name=s_def["name"],
                road_class=s_def["road_class"],
                coordinates=coords,
                from_node=s_def["from_node"],
                to_node=s_def["to_node"],
                length_m=round(length_m, 1),
                speed_limit_kph=s_def["speed_limit_kph"],
                baseline_speed_kph=s_def["baseline_speed_kph"],
                width_m=s_def["width_m"],
                width_confidence=s_def["width_confidence"],
                vehicle_allowed=s_def["vehicle_allowed"],
                is_oneway=s_def["is_oneway"],
                diversion_cap=s_def["diversion_cap"],
                current_diversion_count=0,
                current_speed_kph=s_def["baseline_speed_kph"],
                sample_count=0,
                confidence=ConfidenceLevel.medium,
                status=TrafficStatus.normal,
                last_updated=None
            )
            self.segments[seg.segment_id] = seg

            # Add to adjacency
            self.adjacency.setdefault(seg.from_node, []).append((seg.to_node, seg.segment_id))
            if not seg.is_oneway:
                # also reverse direction if two-way
                self.adjacency.setdefault(seg.to_node, []).append((seg.from_node, seg.segment_id))

    def get_segment(self, segment_id: str) -> Optional[RoadSegment]:
        return self.segments.get(segment_id)

    def find_nearest_segment(self, lat: float, lon: float, max_radius_m: float = 40.0) -> Optional[Tuple[RoadSegment, float]]:
        """Map-matches point (lat, lon) to nearest segment within max_radius_m."""
        best_seg = None
        min_dist = float("inf")

        for seg in self.segments.values():
            coords = seg.coordinates
            for i in range(len(coords) - 1):
                dist = point_to_segment_distance_m(
                    lat, lon,
                    coords[i][0], coords[i][1],
                    coords[i+1][0], coords[i+1][1]
                )
                if dist < min_dist:
                    min_dist = dist
                    best_seg = seg

        if min_dist <= max_radius_m:
            return best_seg, min_dist
        return None

    def find_nearest_node(self, lat: float, lon: float) -> str:
        """Finds closest node in pilot network."""
        closest_node = ""
        min_dist = float("inf")
        for node_id, (nlat, nlon) in self.nodes.items():
            dist = haversine_m(lat, lon, nlat, nlon)
            if dist < min_dist:
                min_dist = dist
                closest_node = node_id
        return closest_node

    def get_segments_in_bbox(self, min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> List[RoadSegment]:
        result = []
        for seg in self.segments.values():
            # Check if any coordinate falls in bbox
            in_bbox = any(
                min_lat <= lat <= max_lat and min_lon <= lon <= max_lon
                for lat, lon in seg.coordinates
            )
            if in_bbox:
                result.append(seg)
        return result

    def reset_network(self):
        self.initialize_pilot_network()

# Global singleton
road_network = RoadNetworkService()
