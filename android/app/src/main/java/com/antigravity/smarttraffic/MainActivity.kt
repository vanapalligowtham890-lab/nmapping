package com.antigravity.smarttraffic

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.antigravity.smarttraffic.ui.screens.*
import com.antigravity.smarttraffic.ui.viewmodel.AppScreen
import com.antigravity.smarttraffic.ui.viewmodel.TrafficViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: TrafficViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    val state by viewModel.uiState.collectAsState()

                    when (val screen = state.currentScreen) {
                        is AppScreen.Consent -> {
                            ConsentScreen(
                                onConsentGranted = { viewModel.onConsentGranted() },
                                onConsentDeclined = { viewModel.onConsentDeclined() }
                            )
                        }
                        is AppScreen.Home -> {
                            HomeScreen(
                                onFindRoutes = { origin, dest, vehicle, avoidResidential ->
                                    viewModel.findRoutes(origin, dest, vehicle, avoidResidential)
                                }
                            )
                        }
                        is AppScreen.RouteComparison -> {
                            RouteComparisonSheet(
                                routeResponse = screen.response,
                                onStartTrip = { selectedRoute ->
                                    viewModel.startTrip(selectedRoute)
                                },
                                onBack = { viewModel.backToHome() }
                            )
                        }
                        is AppScreen.ActiveTrip -> {
                            ActiveTripScreen(
                                route = screen.selectedRoute,
                                currentSpeedKph = state.currentSpeedKph,
                                isLocationSharingActive = state.isLocationSharingActive,
                                onEndTrip = { viewModel.endTrip() },
                                onReportIncident = { /* Show Incident dialog */ }
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Strict Privacy Safeguard:
        // When app is stopped or dismissed, stop location collection to guarantee zero background tracking
        viewModel.endTrip()
    }

    override fun onDestroy() {
        super.onDestroy()
        viewModel.endTrip()
    }
}
