import heapq
from typing import Dict, List, Optional, Set, Tuple
from app.models.traffic import RoadClass, TrafficStatus, RoadSegment, ConfidenceLevel
from app.models.routing import (
    RouteRequest,
    RouteResponse,
    RouteCandidate,
    Coordinate,
    VehicleProfile,
)
from app.services.road_network import road_network, haversine_m
from app.services.session_manager import session_manager

class SafeRoutingEngine:
    def __init__(self):
        pass

    def _calculate_segment_time(self, seg: RoadSegment, use_baseline: bool = False) -> float:
        """Calculates expected transit time in seconds based on current speed or baseline speed."""
        if use_baseline:
            speed_kph = seg.baseline_speed_kph
        else:
            speed_kph = seg.current_speed_kph if seg.current_speed_kph and seg.current_speed_kph > 2.0 else seg.baseline_speed_kph
        speed_mps = (speed_kph * 1000.0) / 3600.0
        return max(1.0, seg.length_m / speed_mps)

    def _check_road_suitability(
        self,
        seg: RoadSegment,
        vehicle_profile: VehicleProfile,
        avoid_residential: bool
    ) -> Tuple[bool, str]:
        """Validates road suitability against vehicle type, width confidence, and residential restrictions."""
        # 1. Closed segment check
        if seg.status == TrafficStatus.closed:
            return False, f"Segment '{seg.name}' is closed."

        # 2. Vehicle permission check
        if vehicle_profile.value not in seg.vehicle_allowed:
            return False, f"Vehicle '{vehicle_profile.value}' prohibited on '{seg.name}'."

        # 3. Residential cut-through protection for cars
        if vehicle_profile == VehicleProfile.car and seg.road_class == RoadClass.residential:
            if avoid_residential:
                return False, f"Residential street '{seg.name}' excluded from car routing to prevent neighborhood cut-through."
            if seg.width_m < 6.0 or seg.width_confidence in [ConfidenceLevel.low, ConfidenceLevel.unknown]:
                return False, f"Narrow or unverified residential road ({seg.width_m}m) unsuitable for cars."

        return True, "Suitable"

    def _check_diversion_budget(self, seg: RoadSegment) -> Tuple[bool, str]:
        """Checks if a segment has reached its maximum app detour diversion quota."""
        if seg.current_diversion_count >= seg.diversion_cap:
            return False, f"Detour cap reached on '{seg.name}' ({seg.current_diversion_count}/{seg.diversion_cap}). Detour paused to prevent new congestion."
        return True, "Diversion quota available"

    def find_routes(self, request: RouteRequest) -> RouteResponse:
        start_node = road_network.find_nearest_node(request.origin.lat, request.origin.lon)
        end_node = road_network.find_nearest_node(request.destination.lat, request.destination.lon)

        # 1. Generate primary verified corridor route (preferring primary & secondary roads)
        primary_candidate = self._build_primary_route(start_node, end_node, request.vehicle_profile)

        # 2. Generate candidate alternative detour routes
        detour_candidates = self._build_alternative_routes(start_node, end_node, request)

        all_candidates = []
        if primary_candidate:
            all_candidates.append(primary_candidate)
        all_candidates.extend(detour_candidates)

        if not all_candidates:
            # Fallback if graph unconnected
            fallback = self._build_direct_fallback(request)
            return RouteResponse(
                origin=request.origin,
                destination=request.destination,
                vehicle_profile=request.vehicle_profile,
                selected_route_id=fallback.route_id,
                routes=[fallback],
                decision_rationale="Direct corridor fallback: No multi-hop graph match for points.",
                active_diversions_summary={s.segment_id: s.current_diversion_count for s in road_network.segments.values()}
            )

        # 3. Decision Logic: Evaluate candidates
        selected_route = all_candidates[0]
        decision_rationale = ""

        # Check if primary has congestion
        primary_congested = primary_candidate and primary_candidate.status in [TrafficStatus.congested, TrafficStatus.slowing]

        if not primary_congested:
            selected_route = primary_candidate or all_candidates[0]
            selected_route.is_recommended = True
            selected_route.recommendation_reason = "Normal flow on primary corridor. No detour needed."
            decision_rationale = "Recommended standard primary route: Verified arterial road with normal traffic flow."
        else:
            # Congestion detected on primary. Look for safe, suitable, non-saturated alternative.
            found_safe_alt = False
            for alt in detour_candidates:
                if alt.is_recommended:
                    selected_route = alt
                    found_safe_alt = True
                    decision_rationale = (
                        f"Recommended safe traffic-aware detour ({alt.summary}): "
                        f"Bypasses congestion on main corridor. Road verified suitable for {request.vehicle_profile.value} "
                        f"with remaining detour capacity ({alt.diversion_budget_remaining} spots available)."
                    )
                    break

            if not found_safe_alt:
                # Keep verified main route even with congestion!
                selected_route = primary_candidate
                selected_route.is_recommended = True
                selected_route.recommendation_reason = "Retained main verified route despite slowdown."
                reasons = [alt.recommendation_reason for alt in detour_candidates if not alt.is_recommended]
                reason_summary = "; ".join(reasons) if reasons else "No viable alternatives"
                decision_rationale = (
                    f"Selected verified main corridor despite traffic slowdown. "
                    f"Alternative routes were excluded: {reason_summary}. "
                    f"Prioritizing road safety and neighborhood preservation over risky shortcuts."
                )

        # 4. Handle reservation if requested and active session exists
        if request.reserve_diversion and request.session_token and selected_route.route_type != "primary_verified":
            self._reserve_diversion(selected_route, request.session_token)

        diversion_summary = {
            s.segment_id: s.current_diversion_count
            for s in road_network.segments.values()
            if s.current_diversion_count > 0
        }

        return RouteResponse(
            origin=request.origin,
            destination=request.destination,
            vehicle_profile=request.vehicle_profile,
            selected_route_id=selected_route.route_id,
            routes=all_candidates,
            decision_rationale=decision_rationale,
            active_diversions_summary=diversion_summary
        )

    def _build_primary_route(self, start_node: str, end_node: str, vehicle_profile: VehicleProfile) -> Optional[RouteCandidate]:
        """Finds primary canonical route strictly using primary and secondary arterial segments at baseline free-flow."""
        path_segments = self._dijkstra(start_node, end_node, allow_residential=False, vehicle_profile=vehicle_profile, use_baseline=True)
        if not path_segments:
            return None

        return self._create_candidate_from_segments(
            route_id="route_primary",
            route_type="primary_verified",
            segment_ids=path_segments,
            vehicle_profile=vehicle_profile,
            is_alternative=False
        )

    def _build_alternative_routes(self, start_node: str, end_node: str, request: RouteRequest) -> List[RouteCandidate]:
        """Finds alternative routes and scores them with safety & diversion budgets."""
        candidates = []

        # Find bypass paths
        # Path A: via secondary bypass (Suranjan Das / Old Airport Rd corridor)
        path_bypass = self._dijkstra(start_node, end_node, exclude_segment="seg_100ft_south", vehicle_profile=request.vehicle_profile)
        if path_bypass:
            cand = self._create_candidate_from_segments(
                route_id="route_alt_bypass",
                route_type="traffic_aware_alternative",
                segment_ids=path_bypass,
                vehicle_profile=request.vehicle_profile,
                is_alternative=True,
                avoid_residential=request.avoid_residential_shortcuts
            )
            candidates.append(cand)

        # Path B: shortcut attempt through residential cross roads (e.g. Defence Colony / Domlur)
        # This will be evaluated and filtered by road suitability and diversion caps!
        path_res = self._dijkstra(start_node, end_node, allow_residential=True, vehicle_profile=request.vehicle_profile)
        if path_res and path_res != path_bypass:
            # Check if it actually contains residential
            has_res = any(road_network.get_segment(sid) and road_network.get_segment(sid).road_class == RoadClass.residential for sid in path_res)
            if has_res:
                cand_res = self._create_candidate_from_segments(
                    route_id="route_alt_residential",
                    route_type="caution_route",
                    segment_ids=path_res,
                    vehicle_profile=request.vehicle_profile,
                    is_alternative=True,
                    avoid_residential=request.avoid_residential_shortcuts
                )
                candidates.append(cand_res)

        return candidates

    def _create_candidate_from_segments(
        self,
        route_id: str,
        route_type: str,
        segment_ids: List[str],
        vehicle_profile: VehicleProfile,
        is_alternative: bool,
        avoid_residential: bool = True
    ) -> RouteCandidate:
        segments = [road_network.get_segment(sid) for sid in segment_ids if road_network.get_segment(sid)]
        total_dist = sum(s.length_m for s in segments)
        total_time = sum(self._calculate_segment_time(s) for s in segments)
        names = [s.name for s in segments]

        # Gather coordinates
        coords: List[List[float]] = []
        for s in segments:
            coords.extend(s.coordinates)

        # Overall traffic status
        has_congested = any(s.status == TrafficStatus.congested for s in segments)
        has_slowing = any(s.status == TrafficStatus.slowing for s in segments)
        overall_status = TrafficStatus.congested if has_congested else (TrafficStatus.slowing if has_slowing else TrafficStatus.normal)

        # Check suitability and diversion budget
        is_suitable = True
        suitability_notes = []
        min_budget_remaining = 999

        for s in segments:
            ok, note = self._check_road_suitability(s, vehicle_profile, avoid_residential)
            if not ok:
                is_suitable = False
                suitability_notes.append(note)

            if is_alternative:
                budget_ok, budget_note = self._check_diversion_budget(s)
                remaining = max(0, s.diversion_cap - s.current_diversion_count)
                min_budget_remaining = min(min_budget_remaining, remaining)
                if not budget_ok:
                    is_suitable = False
                    suitability_notes.append(budget_note)

        # Determine recommendation
        if not is_suitable:
            is_recommended = False
            recommendation_reason = "Excluded by safety constraints: " + "; ".join(suitability_notes)
        else:
            is_recommended = True
            recommendation_reason = f"Verified route suitable for {vehicle_profile.value}."

        summary_name = f"Via {segments[0].name.split('(')[0].strip()}" if segments else "Route"

        return RouteCandidate(
            route_id=route_id,
            route_type=route_type,
            segments=segment_ids,
            segment_names=names,
            coordinates=coords,
            total_distance_m=round(total_dist, 1),
            total_duration_sec=round(total_time, 1),
            summary=summary_name,
            status=overall_status,
            is_recommended=is_recommended,
            recommendation_reason=recommendation_reason,
            diversion_budget_remaining=min_budget_remaining if is_alternative else None,
            suitability_notes=suitability_notes
        )

    def _dijkstra(
        self,
        start_node: str,
        end_node: str,
        allow_residential: bool = False,
        exclude_segment: Optional[str] = None,
        vehicle_profile: VehicleProfile = VehicleProfile.car,
        use_baseline: bool = False
    ) -> List[str]:
        if start_node == end_node or not start_node or not end_node:
            return []

        # Priority queue: (cost, current_node, [segment_ids])
        heap = [(0.0, start_node, [])]
        visited: Set[str] = set()

        while heap:
            cost, u, path = heapq.heappop(heap)
            if u in visited:
                continue
            visited.add(u)

            if u == end_node:
                return path

            for v, seg_id in road_network.adjacency.get(u, []):
                if seg_id == exclude_segment:
                    continue
                seg = road_network.get_segment(seg_id)
                if not seg:
                    continue

                # Filter residential if not allowed
                if not allow_residential and seg.road_class == RoadClass.residential:
                    continue

                # Filter vehicle prohibitions
                if vehicle_profile.value not in seg.vehicle_allowed:
                    continue

                edge_cost = self._calculate_segment_time(seg, use_baseline=use_baseline)
                heapq.heappush(heap, (cost + edge_cost, v, path + [seg_id]))

        return []

    def _build_direct_fallback(self, request: RouteRequest) -> RouteCandidate:
        dist = haversine_m(request.origin.lat, request.origin.lon, request.destination.lat, request.destination.lon)
        duration = dist / (30.0 * 1000.0 / 3600.0) # 30 km/h baseline
        coords = [
            [request.origin.lat, request.origin.lon],
            [request.destination.lat, request.destination.lon]
        ]
        return RouteCandidate(
            route_id="route_fallback",
            route_type="primary_verified",
            segments=[],
            segment_names=["Main Arterial Corridor"],
            coordinates=coords,
            total_distance_m=round(dist, 1),
            total_duration_sec=round(duration, 1),
            summary="Direct Corridor",
            status=TrafficStatus.normal,
            is_recommended=True,
            recommendation_reason="Standard direct corridor path.",
            diversion_budget_remaining=None,
            suitability_notes=[]
        )

    def _reserve_diversion(self, route: RouteCandidate, session_token: str):
        session = session_manager.get_session(session_token)
        if not session:
            return
        for sid in route.segments:
            seg = road_network.get_segment(sid)
            if seg:
                seg.current_diversion_count += 1
                session.reserved_segments.add(sid)

    def release_diversion_for_session(self, session_token: str):
        session = session_manager.get_session(session_token)
        if not session:
            return
        for sid in session.reserved_segments:
            seg = road_network.get_segment(sid)
            if seg and seg.current_diversion_count > 0:
                seg.current_diversion_count -= 1
        session.reserved_segments.clear()

routing_engine = SafeRoutingEngine()
