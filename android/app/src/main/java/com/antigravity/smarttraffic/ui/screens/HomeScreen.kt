package com.antigravity.smarttraffic.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.antigravity.smarttraffic.data.model.CoordinateDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onFindRoutes: (origin: CoordinateDto, dest: CoordinateDto, vehicle: String, avoidResidential: Boolean) -> Unit
) {
    var selectedVehicle by remember { mutableStateOf("car") }
    var avoidResidential by remember { mutableStateOf(true) }

    // Bengaluru pilot preset locations
    val origins = listOf(
        "CMH Rd / 100 Ft Junction (Indiranagar)" to CoordinateDto(12.9784, 77.6408),
        "Domlur Flyover" to CoordinateDto(12.9610, 77.6385)
    )
    val destinations = listOf(
        "Sony World Junction (Koramangala)" to CoordinateDto(12.9352, 77.6245),
        "Embassy Golf Links (EGL IRR)" to CoordinateDto(12.9515, 77.6360)
    )

    var originIdx by remember { mutableIntStateOf(0) }
    var destIdx by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Smart Traffic Routing", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text("Bengaluru Pilot Corridor", fontSize = 12.sp, color = Color.Gray)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {

                // Simulated Map Visualizer Canvas Banner
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F0FE))
                ) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Default.Navigation,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(42.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                "Live Pilot Map Area",
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Text(
                                "Indiranagar 100ft • Domlur • Koramangala",
                                fontSize = 12.sp,
                                color = Color(0xFF5F6368)
                            )
                        }
                    }
                }

                // Origin / Destination Selectors
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.LocationOn, contentDescription = null, tint = Color(0xFF1E8E3E))
                            Spacer(modifier = Modifier.width(8.dp))
                            Column {
                                Text("Origin", fontSize = 11.sp, color = Color.Gray)
                                Text(origins[originIdx].first, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            }
                        }

                        HorizontalDivider()

                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.LocationOn, contentDescription = null, tint = Color(0xFFD93025))
                            Spacer(modifier = Modifier.width(8.dp))
                            Column {
                                Text("Destination", fontSize = 11.sp, color = Color.Gray)
                                Text(destinations[destIdx].first, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            }
                        }
                    }
                }

                // Vehicle Profile Selector
                Text("Select Vehicle", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val vehicles = listOf("car" to "Car", "two_wheeler" to "2-Wheeler", "auto_rickshaw" to "Auto")
                    vehicles.forEach { (key, label) ->
                        val isSelected = selectedVehicle == key
                        Button(
                            onClick = { selectedVehicle = key },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (isSelected) MaterialTheme.colorScheme.primary else Color(0xFFE8EAED),
                                contentColor = if (isSelected) Color.white else Color(0xFF202124)
                            )
                        ) {
                            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }

                // Residential Cut-Through Protection Toggle
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Exclude narrow residential shortcuts", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        Text("Protects quiet residential lanes from detour floods", fontSize = 11.sp, color = Color.Gray)
                    }
                    Switch(
                        checked = avoidResidential,
                        onCheckedChange = { avoidResidential = it }
                    )
                }
            }

            // Find Routes Button
            Button(
                onClick = {
                    onFindRoutes(
                        origins[originIdx].second,
                        destinations[destIdx].second,
                        selectedVehicle,
                        avoidResidential
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(Icons.Default.DirectionsCar, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Find Safe Routes", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}

