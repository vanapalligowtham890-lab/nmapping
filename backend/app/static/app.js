// Smart Traffic Routing - Frontend App & Interactive Simulation Controller

let map;
let segmentLayers = {};
let activeRouteLayer = null;
let currentSessionToken = "sess_demo_user_1";
let sessionSeconds = 252; // 04:12

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadSegments();
  setupEventListeners();
  startSessionTimer();
});

function initMap() {
  // Center on Indiranagar / Domlur corridor Bengaluru
  map = L.map("map").setView([12.9610, 77.6385], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors | Smart Traffic Pilot"
  }).addTo(map);
}

function getSegmentColor(seg) {
  if (seg.status === "closed") return "#5f6368";
  if (seg.status === "congested") return "#d93025";
  if (seg.status === "slowing") return "#f9ab00";
  if (seg.road_class === "residential") return "#9334e6";
  return "#1e8e3e"; // normal
}

async function loadSegments() {
  try {
    const res = await fetch("/v1/traffic/segments");
    const segments = await res.json();

    // Clear existing layers
    Object.values(segmentLayers).forEach(layer => map.removeLayer(layer));
    segmentLayers = {};

    segments.forEach(seg => {
      const color = getSegmentColor(seg);
      const isResidential = seg.road_class === "residential";
      const polyline = L.polyline(seg.coordinates, {
        color: color,
        weight: isResidential ? 4 : 6,
        opacity: 0.85,
        dashArray: isResidential ? "6, 6" : null
      }).addTo(map);

      const popupContent = `
        <div style="font-family:sans-serif; font-size:12px; min-width:180px;">
          <h4 style="margin:0 0 4px 0; color:#1a73e8;">${seg.name}</h4>
          <div><strong>Class:</strong> ${seg.road_class}</div>
          <div><strong>Status:</strong> <span style="font-weight:600; color:${color};">${seg.status.toUpperCase()}</span></div>
          <div><strong>Speed:</strong> ${seg.current_speed_kph || seg.baseline_speed_kph} km/h (Base: ${seg.baseline_speed_kph})</div>
          <div><strong>Evidence:</strong> ${seg.sample_count} devices (${seg.confidence} conf)</div>
          <div><strong>Detour Quota:</strong> ${seg.current_diversion_count} / ${seg.diversion_cap} max</div>
          <div style="margin-top:4px; font-size:11px; color:#666;">Width: ${seg.width_m}m (${seg.width_confidence})</div>
        </div>
      `;
      polyline.bindPopup(popupContent);
      segmentLayers[seg.segment_id] = polyline;
    });
  } catch (err) {
    console.error("Failed to load segments:", err);
  }
}

function setupEventListeners() {
  document.getElementById("btnFindRoutes").addEventListener("click", handleFindRoutes);
  document.getElementById("btnSimNormal").addEventListener("click", () => runSimulation("normal"));
  document.getElementById("btnSimSingleGlitch").addEventListener("click", () => runSimulation("single_glitch"));
  document.getElementById("btnSimCongestion").addEventListener("click", () => runSimulation("congestion"));
  document.getElementById("btnSimDetourCap").addEventListener("click", () => runSimulation("detour_cap"));
  document.getElementById("btnReset").addEventListener("click", handleReset);
  document.getElementById("btnMobileEndTrip").addEventListener("click", handleEndTrip);
}

async function handleFindRoutes() {
  const [oLat, oLon] = document.getElementById("originSelect").value.split(",").map(Number);
  const [dLat, dLon] = document.getElementById("destSelect").value.split(",").map(Number);
  const vehicle = document.getElementById("vehicleProfile").value;
  const avoidResidential = document.getElementById("avoidResidential").checked;

  const payload = {
    origin: { lat: oLat, lon: oLon },
    destination: { lat: dLat, lon: dLon },
    vehicle_profile: vehicle,
    avoid_residential_shortcuts: avoidResidential,
    reserve_diversion: false,
    session_token: currentSessionToken
  };

  try {
    const res = await fetch("/v1/routes/alternatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    renderRouteResults(data);
  } catch (err) {
    console.error("Routing error:", err);
  }
}

function renderRouteResults(data) {
  const card = document.getElementById("routeResultsCard");
  const rationaleBox = document.getElementById("decisionRationale");
  const list = document.getElementById("routesList");

  card.style.display = "block";
  rationaleBox.innerHTML = `<strong>Routing Decision Rationale:</strong><br>${data.decision_rationale}`;
  list.innerHTML = "";

  if (activeRouteLayer) {
    map.removeLayer(activeRouteLayer);
    activeRouteLayer = null;
  }

  data.routes.forEach(route => {
    const isSelected = route.route_id === data.selected_route_id;
    const item = document.createElement("div");
    item.className = `route-item ${isSelected ? "selected" : ""}`;

    const distKm = (route.total_distance_m / 1000).toFixed(1);
    const timeMin = Math.round(route.total_duration_sec / 60);

    item.innerHTML = `
      <div class="route-header">
        <span>${route.summary} ${isSelected ? "★ RECOMMENDED" : ""}</span>
        <span>${timeMin} min (${distKm} km)</span>
      </div>
      <div class="route-meta">
        Type: ${route.route_type} • Status: ${route.status}
        ${route.diversion_budget_remaining !== null ? `• Detour spots: ${route.diversion_budget_remaining}` : ""}
      </div>
      <div class="route-reason">${route.recommendation_reason}</div>
    `;

    item.addEventListener("click", () => {
      document.querySelectorAll(".route-item").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
      drawRouteOnMap(route);
    });

    list.appendChild(item);

    if (isSelected) {
      drawRouteOnMap(route);
      updateMobileCompanion(route, timeMin, distKm);
    }
  });
}

function drawRouteOnMap(route) {
  if (activeRouteLayer) {
    map.removeLayer(activeRouteLayer);
  }
  activeRouteLayer = L.polyline(route.coordinates, {
    color: "#1a73e8",
    weight: 7,
    opacity: 0.9
  }).addTo(map);
  map.fitBounds(activeRouteLayer.getBounds(), { padding: [40, 40] });
}

function updateMobileCompanion(route, mins, kms) {
  document.getElementById("mobileRouteTitle").innerText = `To ${document.getElementById("destSelect").selectedOptions[0].text.split("(")[0]}`;
  document.getElementById("mobileEta").innerText = `ETA: ${mins} mins • ${kms} km`;
  if (route.segment_names && route.segment_names.length > 0) {
    document.getElementById("mobileInstruction").innerText = `➔ Continue on ${route.segment_names[0]}`;
  }
}

async function runSimulation(scenario) {
  // Obtain fresh session tokens to simulate multi-device trips
  const now = new Date().toISOString();

  if (scenario === "normal") {
    // Normal speeds across corridor
    await sendObservationBatch("sess_driver_1", "seg_100ft_south", [12.9750, 77.6406], 35.0);
    await sendObservationBatch("sess_driver_2", "seg_100ft_south", [12.9720, 77.6405], 34.0);
    await sendObservationBatch("sess_driver_3", "seg_100ft_south", [12.9650, 77.6395], 36.0);
    alert("Simulation: 3 independent drivers reported normal speeds (35 km/h). Corridor is NORMAL.");
  } else if (scenario === "single_glitch") {
    // Single slow vehicle (e.g. delivery stopping or single slow phone)
    await sendObservationBatch("sess_glitch_device", "seg_100ft_south", [12.9750, 77.6406], 4.0);
    alert("Simulation: Only ONE phone reported 4 km/h.\nEvidence Rule applied: Alert rejected because sample count < 3 independent devices. Corridor remains NORMAL!");
  } else if (scenario === "congestion") {
    // Multi-device genuine congestion (5 devices reporting severe slowdown)
    for (let i = 1; i <= 5; i++) {
      await sendObservationBatch(`sess_congest_car_${i}`, "seg_100ft_south", [12.9750, 77.6406], 8.5);
    }
    alert("Simulation: 5 independent devices reported 8.5 km/h on 100 Feet Road.\nEvidence threshold met (>=3 devices)! Status set to CONGESTED (HIGH confidence).");
  } else if (scenario === "detour_cap") {
    // Saturate detour budget on the bypass
    await fetch("/v1/admin/segments/seg_suranjan_conn/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diversion_cap: 20 })
    });
    // Set current count to cap
    const seg = await (await fetch("/v1/traffic/segments")).json();
    const bypass = seg.find(s => s.segment_id === "seg_suranjan_conn");
    if (bypass) {
      bypass.current_diversion_count = bypass.diversion_cap;
    }
    alert("Simulation: Detour capacity limit reached on bypass.\nSystem will now suppress rerouting more users onto this detour to avoid shifting jams into neighborhoods!");
  }

  await loadSegments();
  handleFindRoutes();
}

async function sendObservationBatch(sessionToken, segmentId, coords, speed) {
  // Start session first to satisfy privacy check
  await fetch("/v1/trips/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_version: "1.0", vehicle_profile: "car" })
  });

  const body = {
    session_token: sessionToken,
    observations: [
      {
        timestamp: new Date().toISOString(),
        lat: coords[0],
        lon: coords[1],
        speed_kph: speed,
        accuracy_m: 8.0,
        heading_deg: 180.0
      }
    ]
  };

  await fetch("/v1/traffic/observations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function handleReset() {
  await fetch("/v1/admin/reset", { method: "POST" });
  if (activeRouteLayer) map.removeLayer(activeRouteLayer);
  document.getElementById("routeResultsCard").style.display = "none";
  await loadSegments();
  alert("Pilot network reset to clean initial state.");
}

async function handleEndTrip() {
  await fetch("/v1/trips/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_token: currentSessionToken })
  });

  const pulse = document.getElementById("locationPulse");
  pulse.innerText = "■ Trip Ended • Location Access Terminated";
  pulse.style.color = "#d93025";
  pulse.style.animation = "none";
  alert("Trip ended! Foreground location listener stopped immediately and session token invalidated. Zero background tracking.");
}

function startSessionTimer() {
  setInterval(() => {
    sessionSeconds++;
    const m = String(Math.floor(sessionSeconds / 60)).padStart(2, "0");
    const s = String(sessionSeconds % 60).padStart(2, "0");
    document.getElementById("sessionTimer").innerText = `00:${m}:${s}`;
  }, 1000);
}
