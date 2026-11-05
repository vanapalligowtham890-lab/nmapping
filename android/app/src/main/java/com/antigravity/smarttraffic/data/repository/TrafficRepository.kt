package com.antigravity.smarttraffic.data.repository

import com.antigravity.smarttraffic.data.api.TrafficApiService
import com.antigravity.smarttraffic.data.model.*
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class TrafficRepository(
    baseUrl: String = "http://10.0.2.2:8000/" // Android Emulator localhost bridge
) {
    private val api: TrafficApiService

    // Ephemeral in-memory session token. Never saved to persistent disk!
    var currentSessionToken: String? = null
        private set

    init {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        api = retrofit.create(TrafficApiService::class.java)
    }

    suspend fun startTripSession(vehicleProfile: String): Result<TripStartResponseDto> {
        return try {
            val response = api.startTrip(TripStartRequestDto(vehicleProfile = vehicleProfile))
            if (response.isSuccessful && response.body() != null) {
                val body = response.body()!!
                currentSessionToken = body.sessionToken
                Result.success(body)
            } else {
                Result.failure(Exception("Failed to start session: ${response.code()}"))
            }
        } catch (e: Exception) {
            // Offline prototype fallback
            val mockToken = "sess_mock_${System.currentTimeMillis()}"
            currentSessionToken = mockToken
            Result.success(
                TripStartResponseDto(
                    sessionToken = mockToken,
                    expiresAt = "2026-11-05T14:00:00Z",
                    consentAck = true,
                    notice = "Offline prototype fallback active."
                )
            )
        }
    }

    suspend fun endTripSession(): Result<TripEndResponseDto> {
        val token = currentSessionToken ?: return Result.success(TripEndResponseDto("ended", "No active session"))
        currentSessionToken = null // Immediately clear in-memory token

        return try {
            val response = api.endTrip(TripEndRequestDto(sessionToken = token))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                Result.success(TripEndResponseDto("terminated", "Session closed locally"))
            }
        } catch (e: Exception) {
            Result.success(TripEndResponseDto("terminated", "Session closed locally offline"))
        }
    }

    suspend fun submitObservations(points: List<ObservationPointDto>): Result<ObservationBatchResponseDto> {
        val token = currentSessionToken ?: return Result.failure(IllegalStateException("No active session"))
        return try {
            val req = ObservationBatchRequestDto(sessionToken = token, observations = points)
            val res = api.submitObservations(req)
            if (res.isSuccessful && res.body() != null) {
                Result.success(res.body()!!)
            } else {
                Result.failure(Exception("Failed to upload observations: ${res.code()}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getTrafficSegments(): Result<List<RoadSegmentDto>> {
        return try {
            val res = api.getTrafficSegments()
            if (res.isSuccessful && res.body() != null) {
                Result.success(res.body()!!)
            } else {
                Result.success(getMockSegments())
            }
        } catch (e: Exception) {
            Result.success(getMockSegments())
        }
    }

    suspend fun getRouteAlternatives(
        origin: CoordinateDto,
        dest: CoordinateDto,
        vehicle: String,
        avoidResidential: Boolean
    ): Result<RouteResponseDto> {
        return try {
            val req = RouteRequestDto(
                origin = origin,
                destination = dest,
                vehicleProfile = vehicle,
                avoidResidentialShortcuts = avoidResidential,
                sessionToken = currentSessionToken
            )
            val res = api.getRouteAlternatives(req)
            if (res.isSuccessful && res.body() != null) {
                Result.success(res.body()!!)
            } else {
                Result.success(getMockRouteResponse(origin, dest, vehicle))
            }
        } catch (e: Exception) {
            Result.success(getMockRouteResponse(origin, dest, vehicle))
        }
    }

    private fun getMockSegments(): List<RoadSegmentDto> {
        return listOf(
            RoadSegmentDto(
                segmentId = "seg_100ft_south",
                name = "100 Feet Road (Southbound)",
                roadClass = "primary",
                coordinates = listOf(listOf(12.9784, 77.6408), listOf(12.9610, 77.6385)),
                lengthM = 2100.0,
                speedLimitKph = 50.0,
                baselineSpeedKph = 35.0,
                widthM = 18.0,
                widthConfidence = "high",
                diversionCap = 40,
                currentDiversionCount = 0,
                currentSpeedKph = 34.0,
                sampleCount = 4,
                confidence = "high",
                status = "normal",
                lastUpdated = "2026-11-05T07:15:00Z"
            )
        )
    }

    private fun getMockRouteResponse(origin: CoordinateDto, dest: CoordinateDto, vehicle: String): RouteResponseDto {
        val primary = RouteCandidateDto(
            routeId = "route_primary",
            routeType = "primary_verified",
            segments = listOf("seg_100ft_south", "seg_irr_south"),
            segmentNames = listOf("100 Feet Road", "Intermediate Ring Road"),
            coordinates = listOf(
                listOf(origin.lat, origin.lon),
                listOf(12.9610, 77.6385),
                listOf(dest.lat, dest.lon)
            ),
            totalDistanceM = 4800.0,
            totalDurationSec = 840.0,
            summary = "Via 100 Feet Road",
            status = "normal",
            isRecommended = true,
            recommendationReason = "Standard verified primary arterial corridor.",
            diversionBudgetRemaining = null,
            suitabilityNotes = emptyList()
        )
        return RouteResponseDto(
            origin = origin,
            destination = dest,
            vehicleProfile = vehicle,
            selectedRouteId = "route_primary",
            routes = listOf(primary),
            decisionRationale = "Verified arterial road selected. Safe for $vehicle.",
            activeDiversionsSummary = emptyMap()
        )
    }
}

