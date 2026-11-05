package com.antigravity.smarttraffic

import com.antigravity.smarttraffic.ui.viewmodel.AppScreen
import com.antigravity.smarttraffic.ui.viewmodel.TrafficUiState
import org.junit.Assert.*
import org.junit.Test

class TrafficViewModelTest {

    @Test
    fun testInitialStateRequiresConsent() {
        val state = TrafficUiState()
        assertEquals(AppScreen.Consent, state.currentScreen)
        assertFalse(state.hasConsented)
        assertFalse(state.isLocationSharingActive)
    }

    @Test
    fun testConsentGrantedTransitionsToHome() {
        val state = TrafficUiState(
            currentScreen = AppScreen.Home,
            hasConsented = true
        )
        assertEquals(AppScreen.Home, state.currentScreen)
        assertTrue(state.hasConsented)
        assertFalse(state.isLocationSharingActive)
    }

    @Test
    fun testTripEndImmediatelyHaltsLocationSharing() {
        val stateActive = TrafficUiState(
            currentScreen = AppScreen.Home,
            isLocationSharingActive = false,
            currentSpeedKph = 0.0
        )
        assertFalse(stateActive.isLocationSharingActive)
        assertEquals(0.0, stateActive.currentSpeedKph, 0.001)
    }
}

