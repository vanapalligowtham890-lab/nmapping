package com.antigravity.smarttraffic.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import com.antigravity.smarttraffic.data.model.ObservationPointDto
import com.google.android.gms.location.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import java.text.SimpleDateFormat
import java.util.*

/**
 * Foreground-Only Location Manager.
 * STRICT PRIVACY SAFEGUARD:
 * - Collects GPS updates ONLY during active trips.
 * - Requests are stopped immediately when trip ends or app is paused/closed.
 * - Discards inaccurate readings (> 25m).
 * - NEVER runs in a background service or background worker.
 */
class ForegroundLocationManager(private val context: Context) {

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)

    private var locationCallback: LocationCallback? = null
    var isCollecting: Boolean = false
        private set

    private val _locationFlow = MutableSharedFlow<ObservationPointDto>(extraBufferCapacity = 10)
    val locationFlow: SharedFlow<ObservationPointDto> = _locationFlow

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    @SuppressLint("MissingPermission")
    fun startLocationUpdates(
        intervalMs: Long = 4000L,
        minUpdateDistanceM: Float = 5.0f
    ) {
        if (isCollecting) return

        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(2000L)
            .setMinUpdateDistanceMeters(minUpdateDistanceM)
            .setGranularity(Granularity.GRANULARITY_FINE)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                if (!isCollecting) return

                for (location in result.locations) {
                    // Filter inaccurate GPS drift
                    if (location.hasAccuracy() && location.accuracy > 25.0f) {
                        continue
                    }

                    // Convert speed m/s to km/h
                    val speedKph = if (location.hasSpeed()) (location.speed * 3.6) else 0.0

                    val obs = ObservationPointDto(
                        timestamp = dateFormat.format(Date(location.time)),
                        lat = location.latitude,
                        lon = location.longitude,
                        speedKph = speedKph,
                        accuracyM = location.accuracy.toDouble(),
                        headingDeg = if (location.hasBearing()) location.bearing.toDouble() else null
                    )

                    _locationFlow.tryEmit(obs)
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback!!,
                Looper.getMainLooper()
            )
            isCollecting = true
        } catch (e: SecurityException) {
            isCollecting = false
        }
    }

    fun stopLocationUpdates() {
        if (!isCollecting) return
        isCollecting = false

        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
        }
        locationCallback = null
    }
}

