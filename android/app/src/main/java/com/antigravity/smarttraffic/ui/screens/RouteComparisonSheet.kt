package com.antigravity.smarttraffic.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.antigravity.smarttraffic.data.model.RouteCandidateDto
import com.antigravity.smarttraffic.data.model.RouteResponseDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RouteComparisonSheet(
    routeResponse: RouteResponseDto,
    onStartTrip: (selectedRoute: RouteCandidateDto) -> Unit,
    onBack: () -> Unit
) {
    var selectedId by remember { mutableStateOf(routeResponse.selectedRouteId) }
    val chosenRoute = routeResponse.routes.find { it.routeId == selectedId } ?: routeResponse.routes.first()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Route Alternatives", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
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
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Decision Rationale Banner
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFF0F7FF)),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                            Icon(
                                Icons.Default.Info,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = routeResponse.decisionRationale,
                                fontSize = 12.sp,
                                lineHeight = 17.sp,
                                color = Color(0xFF1A426F)
                            )
                        }
                    }
                }

                // Route Candidates List
                items(routeResponse.routes) { route ->
                    val isSelected = route.routeId == selectedId
                    val distKm = String.format("%.1f", route.totalDistanceM / 1000.0)
                    val durationMin = Math.round(route.totalDurationSec / 60.0)

                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedId = route.routeId },
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) Color(0xFFE8F0FE) else MaterialTheme.colorScheme.surfaceVariant
                        ),
                        border = if (isSelected) CardDefaults.outlinedCardBorder().copy(width = 2.dp) else null
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = route.summary,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp
                                    )
                                    if (route.isRecommended) {
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Icon(
                                            Icons.Default.CheckCircle,
                                            contentDescription = "Recommended",
                                            tint = Color(0xFF1E8E3E),
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                }

                                Text(
                                    text = "$durationMin min ($distKm km)",
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp
                                )
                            }

                            Spacer(modifier = Modifier.height(6.dp))

                            Text(
                                text = route.recommendationReason,
                                fontSize = 12.sp,
                                color = if (route.isRecommended) Color(0xFF1E8E3E) else Color(0xFFD93025)
                            )

                            if (route.diversionBudgetRemaining != null) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "Detour capacity: ${route.diversionBudgetRemaining} slots remaining",
                                    fontSize = 11.sp,
                                    color = Color(0xFF5F6368)
                                )
                            }
                        }
                    }
                }
            }

            // Bottom Start Trip CTA
            Column {
                Button(
                    onClick = { onStartTrip(chosenRoute) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                ) {
                    Text("Start Trip (Activate Foreground Location)", fontWeight = FontWeight.Bold)
                }

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedButton(
                    onClick = onBack,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Back")
                }
            }
        }
    }
}
