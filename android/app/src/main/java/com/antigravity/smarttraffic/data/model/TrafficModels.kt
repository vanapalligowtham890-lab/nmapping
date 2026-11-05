package com.antigravity.smarttraffic.data.model

import com.google.gson.annotations.SerializedName

data class CoordinateDto(
    @SerializedName("lat") val lat: Double,
    @SerializedName("lon") val lon: Double
)

data class ObservationPointDto(
    @SerializedName("timestamp") val timestamp: String,
    @SerializedName("lat") val lat: Double,
    @SerializedName("lon") val lon: Double,
    @SerializedName("speed_kph") val speedKph: Double,
    @SerializedName("accuracy_m") val accuracyM: Double,
    @SerializedName("heading_deg") val headingDeg: Double? = null
)

data class ObservationBatchRequestDto(
    @SerializedName("session_token") val sessionToken: String,
    @SerializedName("observations") val observations: List<ObservationPointDto>
)

data class ObservationBatchResponseDto(
    @SerializedName("received") val received: Int,
    @SerializedName("accepted") val accepted: Int,
    @SerializedName("rejected") val rejected: Int,
    @SerializedName("matched_segments") val matchedSegments: List<String>,
    @SerializedName("message") val message: String
)

data class RoadSegmentDto(
    @SerializedName("segment_id") val segmentId: String,
    @SerializedName("name") val name: String,
    @SerializedName("road_class") val roadClass: String,
    @SerializedName("coordinates") val coordinates: List<List<Double>>,
    @SerializedName("length_m") val lengthM: Double,
    @SerializedName("speed_limit_kph") val speedLimitKph: Double,
    @SerializedName("baseline_speed_kph") val baselineSpeedKph: Double,
    @SerializedName("width_m") val widthM: Double,
    @SerializedName("width_confidence") val widthConfidence: String,
    @SerializedName("diversion_cap") val diversionCap: Int,
    @SerializedName("current_diversion_count") val currentDiversionCount: Int,
    @SerializedName("current_speed_kph") val currentSpeedKph: Double?,
    @SerializedName("sample_count") val sampleCount: Int,
    @SerializedName("confidence") val confidence: String,
    @SerializedName("status") val status: String,
    @SerializedName("last_updated") val lastUpdated: String?
)

data class RouteRequestDto(
    @SerializedName("origin") val origin: CoordinateDto,
    @SerializedName("destination") val destination: CoordinateDto,
    @SerializedName("vehicle_profile") val vehicleProfile: String = "car",
    @SerializedName("avoid_residential_shortcuts") val avoidResidentialShortcuts: Boolean = true,
    @SerializedName("reserve_diversion") val reserveDiversion: Boolean = false,
    @SerializedName("session_token") val sessionToken: String? = null
)

data class RouteCandidateDto(
    @SerializedName("route_id") val routeId: String,
    @SerializedName("route_type") val routeType: String,
    @SerializedName("segments") val segments: List<String>,
    @SerializedName("segment_names") val segmentNames: List<String>,
    @SerializedName("coordinates") val coordinates: List<List<Double>>,
    @SerializedName("total_distance_m") val totalDistanceM: Double,
    @SerializedName("total_duration_sec") val totalDurationSec: Double,
    @SerializedName("summary") val summary: String,
    @SerializedName("status") val status: String,
    @SerializedName("is_recommended") val isRecommended: Boolean,
    @SerializedName("recommendation_reason") val recommendationReason: String,
    @SerializedName("diversion_budget_remaining") val diversionBudgetRemaining: Int?,
    @SerializedName("suitability_notes") val suitabilityNotes: List<String>
)

data class RouteResponseDto(
    @SerializedName("origin") val origin: CoordinateDto,
    @SerializedName("destination") val destination: CoordinateDto,
    @SerializedName("vehicle_profile") val vehicleProfile: String,
    @SerializedName("selected_route_id") val selectedRouteId: String,
    @SerializedName("routes") val routes: List<RouteCandidateDto>,
    @SerializedName("decision_rationale") val decisionRationale: String,
    @SerializedName("active_diversions_summary") val activeDiversionsSummary: Map<String, Int>
)

data class TripStartRequestDto(
    @SerializedName("client_version") val clientVersion: String = "1.0.0",
    @SerializedName("vehicle_profile") val vehicleProfile: String = "car"
)

data class TripStartResponseDto(
    @SerializedName("session_token") val sessionToken: String,
    @SerializedName("expires_at") val expiresAt: String,
    @SerializedName("consent_ack") val consentAck: Boolean,
    @SerializedName("notice") val notice: String
)

data class TripEndRequestDto(
    @SerializedName("session_token") val sessionToken: String,
    @SerializedName("feedback") val feedback: String? = null
)

data class TripEndResponseDto(
    @SerializedName("status") val status: String,
    @SerializedName("message") val message: String
)

