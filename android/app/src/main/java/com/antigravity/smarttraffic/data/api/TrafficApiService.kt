package com.antigravity.smarttraffic.data.api

import com.antigravity.smarttraffic.data.model.*
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface TrafficApiService {

    @POST("v1/trips/start")
    suspend fun startTrip(
        @Body request: TripStartRequestDto
    ): Response<TripStartResponseDto>

    @POST("v1/trips/end")
    suspend fun endTrip(
        @Body request: TripEndRequestDto
    ): Response<TripEndResponseDto>

    @POST("v1/traffic/observations")
    suspend fun submitObservations(
        @Body batch: ObservationBatchRequestDto
    ): Response<ObservationBatchResponseDto>

    @GET("v1/traffic/segments")
    suspend fun getTrafficSegments(
        @Query("bbox") bbox: String? = null
    ): Response<List<RoadSegmentDto>>

    @POST("v1/routes/alternatives")
    suspend fun getRouteAlternatives(
        @Body request: RouteRequestDto
    ): Response<RouteResponseDto>

    @POST("v1/traffic/report")
    suspend fun reportIncident(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("incident_type") incidentType: String,
        @Query("session_token") sessionToken: String,
        @Query("description") description: String? = null
    ): Response<Unit>
}

