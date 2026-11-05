package com.antigravity.smarttraffic.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.antigravity.smarttraffic.data.model.*
import com.antigravity.smarttraffic.data.repository.TrafficRepository
import com.antigravity.smarttraffic.location.ForegroundLocationManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class AppScreen {
    object Consent : AppScreen()
    object Home : AppScreen()
    data class RouteComparison(val response: RouteResponseDto) : AppScreen()
    data class ActiveTrip(val selectedRoute: RouteCandidateDto) : AppScreen()
}

data class TrafficUiState(
    val currentScreen: AppScreen = AppScreen.Consent,
    val hasConsented: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val currentSpeedKph: Double = 0.0,
    val isLocationSharingActive: Boolean = false,
    val sessionNotice: String? = null
)

class TrafficViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = TrafficRepository()
    private val locationManager = ForegroundLocationManager(application)

    private val _uiState = MutableStateFlow(TrafficUiState())
    val uiState: StateFlow<TrafficUiState> = _uiState.asStateFlow()

    private val observationBatch = mutableListOf<ObservationPointDto>()

    init {
        // Collect location updates ONLY when trip is active
        viewModelScope.launch {
            locationManager.locationFlow.collect { obs ->
                if (_uiState.value.isLocationSharingActive) {
                    _uiState.value = _uiState.value.copy(currentSpeedKph = obs.speedKph)
                    observationBatch.add(obs)

                    // Flush batch every 3 samples
                    if (observationBatch.size >= 3) {
                        val toSend = observationBatch.toList()
                        observationBatch.clear()
                        repository.submitObservations(toSend)
                    }
                }
            }
        }
    }

    fun onConsentGranted() {
        _uiState.value = _uiState.value.copy(
            hasConsented = true,
            currentScreen = AppScreen.Home
        )
    }

    fun onConsentDeclined() {
        _uiState.value = _uiState.value.copy(
            hasConsented = false,
            currentScreen = AppScreen.Home
        )
    }

    fun findRoutes(
        origin: CoordinateDto,
        dest: CoordinateDto,
        vehicle: String,
        avoidResidential: Boolean
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            val result = repository.getRouteAlternatives(origin, dest, vehicle, avoidResidential)
            result.onSuccess { response ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    currentScreen = AppScreen.RouteComparison(response)
                )
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = err.message ?: "Failed to find routes"
                )
            }
        }
    }

    fun startTrip(route: RouteCandidateDto) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            val res = repository.startTripSession(vehicleProfile = "car")
            res.onSuccess { startResp ->
                // Start Foreground Location collection ONLY now!
                locationManager.startLocationUpdates()
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    isLocationSharingActive = true,
                    sessionNotice = startResp.notice,
                    currentScreen = AppScreen.ActiveTrip(route)
                )
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(isLoading = false, errorMessage = err.message)
            }
        }
    }

    fun endTrip() {
        // 1. Immediately halt location updates locally
        locationManager.stopLocationUpdates()
        observationBatch.clear()

        _uiState.value = _uiState.value.copy(
            isLocationSharingActive = false,
            currentSpeedKph = 0.0,
            currentScreen = AppScreen.Home
        )

        // 2. Invalidate session token on backend
        viewModelScope.launch {
            repository.endTripSession()
        }
    }

    fun backToHome() {
        _uiState.value = _uiState.value.copy(currentScreen = AppScreen.Home)
    }

    override fun onCleared() {
        super.onCleared()
        // Strict privacy safeguard: ensure location listener is torn down on ViewModel teardown
        locationManager.stopLocationUpdates()
    }
}

