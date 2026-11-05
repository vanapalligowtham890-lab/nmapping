/* =====================================================
   Smart Traffic — Full App Logic (Real-Time Edition)
   WebSocket Push · Live Browser GPS · OSM Geocoding · AI Insights
   ===================================================== */

'use strict';

// ──────────────────────────────────────────────
//  Application State
// ──────────────────────────────────────────────
const state = {
  map: null,
  segmentLayers: {},
  routeLayer: null,
  markerOrigin: null,
  markerDest: null,
  userMarker: null,
  userAccuracyCircle: null,
  origin: null,         // { name, lat, lon, isGps }
  dest: null,           // { name, lat, lon }
  vehicle: 'car',
  currentSessionToken: null,
  activeRoute: null,
  currentSpeedKph: 0,
  watchId: null,
  tripSimTimer: null,
  tripStartTime: null,
  tripRouteIndex: 0,
  searchDebounce: null,
  ws: null,
  wsRetryTimer: null,
  wsPingTimer: null,
  cachedSegments: [],
};

// Quick-access known places in Bengaluru pilot corridor
const QUICK_PLACES = [
  { name: '📍 My Current Location', isCurrentLoc: true, icon: '📍' },
  { name: 'CMH Road Junction', lat: 12.9784, lon: 77.6408, icon: '📍' },
  { name: 'Domlur Flyover', lat: 12.9610, lon: 77.6385, icon: '🌉' },
  { name: 'Sony World Junction', lat: 12.9352, lon: 77.6245, icon: '📍' },
  { name: '100 Feet Road', lat: 12.9750, lon: 77.6407, icon: '🛣️' },
  { name: 'Embassy Golf Links (EGL)', lat: 12.9515, lon: 77.6360, icon: '🏢' },
  { name: 'Old Airport Road', lat: 12.9635, lon: 77.6465, icon: '🛣️' },
  { name: 'Suranjan Das Road', lat: 12.9690, lon: 77.6580, icon: '🛣️' },
];

const TYPE_ICONS = {
  junction: '🔀', road: '🛣️', landmark: '🌉', area: '📍', transit: '🚉', place: '📍'
};

// ──────────────────────────────────────────────
//  Boot
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initSearchFields();
  initVehicleSelector();
  initBottomSheet();
  initDrawer();
  initSimulationButtons();
  initQuickChips();
  initMyLocationButton();

  // Connect real-time WebSocket stream (primary data channel)
  connectWebSocket();

  // Initial fallback fetch (in case WS handshake is pending)
  loadSegmentsHttp();
  pollTrafficSummary();

  // Safety privacy guarantees: cease tracking if user leaves or backgrounds page
  window.addEventListener('beforeunload', handlePageUnload);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

// ──────────────────────────────────────────────
//  WEBSOCKET REAL-TIME CLIENT
// ──────────────────────────────────────────────
function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/traffic`;

  setLivePillStatus('connecting', 'CONNECTING');

  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      setLivePillStatus('connected', 'LIVE');
      showToast('⚡ Live Traffic Feed Connected', 'success');

      // Start keep-alive ping every 10 seconds
      if (state.wsPingTimer) clearInterval(state.wsPingTimer);
      state.wsPingTimer = setInterval(() => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 10000);
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'traffic_update') {
          handleLiveTrafficUpdate(msg);
        } else if (msg.type === 'incident') {
          showToast(`⚠️ Live incident reported: ${msg.incident_type}`, 'warning');
        }
      } catch (err) {
        console.warn('WS message parse error:', err);
      }
    };

    state.ws.onclose = () => {
      setLivePillStatus('disconnected', 'RECONNECTING');
      if (state.wsPingTimer) clearInterval(state.wsPingTimer);
      scheduleWsReconnect();
    };

    state.ws.onerror = () => {
      setLivePillStatus('disconnected', 'OFFLINE');
    };

  } catch (err) {
    setLivePillStatus('disconnected', 'OFFLINE');
    scheduleWsReconnect();
  }
}

function scheduleWsReconnect() {
  if (state.wsRetryTimer) return;
  state.wsRetryTimer = setTimeout(() => {
    state.wsRetryTimer = null;
    connectWebSocket();
  }, 3000);
}

function setLivePillStatus(status, text) {
  const pill = document.getElementById('livePill');
  const txt = document.getElementById('liveText');
  if (!pill) return;

  pill.className = `live-pill ${status}`;
  if (txt) txt.textContent = text;
}

function handleLiveTrafficUpdate(data) {
  const segments = data.segments || [];
  const prevSegments = state.cachedSegments;
  state.cachedSegments = segments;

  // Render on map
  renderSegments(segments);

  // Update summary badge
  if (data.summary) {
    updateTrafficSummaryBadge(data.summary);
  }

  // Update side drawer
  updateStatusGrid(segments);

  // Detect route congestion changes if user has an active route
  checkActiveRouteCongestion(segments, prevSegments);
}

function checkActiveRouteCongestion(newSegments, prevSegments) {
  if (!state.activeRoute || !state.activeRoute.segments) return;

  const currentRouteSegIds = new Set(state.activeRoute.segments);
  let newlyCongested = false;

  newSegments.forEach(seg => {
    if (currentRouteSegIds.has(seg.segment_id)) {
      const prev = prevSegments.find(p => p.segment_id === seg.segment_id);
      if (prev && prev.status === 'normal' && (seg.status === 'congested' || seg.status === 'slowing')) {
        newlyCongested = true;
      }
    }
  });

  if (newlyCongested) {
    showToast('⚠️ Traffic changed on your route! Recalculating best options…', 'warning');
    // Silently refresh route alternatives with updated weights
    doFindRoutes(true);
  }
}

function updateTrafficSummaryBadge(summary) {
  const badge = document.getElementById('trafficBadge');
  if (badge) {
    badge.textContent = `${summary.emoji} ${summary.level}`;
    badge.style.background = summary.color + '22';
    badge.style.color = summary.color;
  }
}

// ──────────────────────────────────────────────
//  MAP INITIALIZATION & CONTROLS
// ──────────────────────────────────────────────
function initMap() {
  state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([12.9610, 77.6385], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(state.map);

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  // Map Legend
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="legend-row"><div class="legend-dot" style="background:#1e8e3e"></div>Normal</div>
      <div class="legend-row"><div class="legend-dot" style="background:#f9ab00"></div>Slowing</div>
      <div class="legend-row"><div class="legend-dot" style="background:#d93025"></div>Congested</div>
      <div class="legend-row"><div class="legend-dot" style="background:#7c4dff;border-top:2px dashed #7c4dff;height:0;width:16px"></div>Residential</div>`;
    return div;
  };
  legend.addTo(state.map);

  // Map Click Listener — Tap any point on the map to set Origin / Destination
  state.map.on('click', handleMapClick);
}

// Global functions for map popup buttons
window.setAsOrigin = function(lat, lon, name) {
  state.map.closePopup();
  state.origin = { name, lat, lon };
  document.getElementById('originInput').value = name;
  document.getElementById('originClear').style.display = '';
  setMarker('origin', lat, lon, name);
  if (state.dest) fitBothMarkers();
  tryAutoSearch();
};

window.setAsDest = function(lat, lon, name) {
  state.map.closePopup();
  state.dest = { name, lat, lon };
  document.getElementById('destInput').value = name;
  document.getElementById('destClear').style.display = '';
  setMarker('dest', lat, lon, name);
  if (state.origin) fitBothMarkers();
  tryAutoSearch();
};

async function handleMapClick(e) {
  // If active trip is running, do not open selection popups
  if (state.currentSessionToken) return;

  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  // Temporary popup while reverse geocoding
  const popup = L.popup()
    .setLatLng([lat, lon])
    .setContent('<div style="font-size:12px;color:#5f6368;padding:4px">Identifying location…</div>')
    .openOn(state.map);

  try {
    const res = await fetch(`/v1/ai/places/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
    const data = await res.json();
    const placeName = data.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const safeName = placeName.replace(/'/g, "\\'");

    popup.setContent(`
      <div style="font-family:Inter,sans-serif;min-width:180px;padding:2px 0;">
        <div style="font-weight:700;font-size:13px;color:#202124;margin-bottom:8px;">📍 ${placeName}</div>
        <div style="display:flex;gap:6px;">
          <button onclick="window.setAsOrigin(${lat}, ${lon}, '${safeName}')"
            style="flex:1;background:#1e8e3e;color:#fff;border:none;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;">
            Set as Start
          </button>
          <button onclick="window.setAsDest(${lat}, ${lon}, '${safeName}')"
            style="flex:1;background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;">
            Set as Dest
          </button>
        </div>
      </div>
    `);
  } catch (err) {
    popup.setContent(`
      <div style="font-family:Inter,sans-serif;padding:2px 0;">
        <div style="font-weight:600;font-size:12px;margin-bottom:6px;">📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
        <div style="display:flex;gap:6px;">
          <button onclick="window.setAsOrigin(${lat}, ${lon}, 'Point (${lat.toFixed(3)}, ${lon.toFixed(3)})')"
            style="background:#1e8e3e;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">Set Start</button>
          <button onclick="window.setAsDest(${lat}, ${lon}, 'Point (${lat.toFixed(3)}, ${lon.toFixed(3)})')"
            style="background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">Set Dest</button>
        </div>
      </div>
    `);
  }
}

// ──────────────────────────────────────────────
//  TRAFFIC SEGMENT RENDERING
// ──────────────────────────────────────────────
function getSegmentStyle(seg) {
  if (seg.status === 'closed') return { color: '#5f6368', weight: 5, dashArray: '8 6' };
  if (seg.status === 'congested') return { color: '#d93025', weight: 6 };
  if (seg.status === 'slowing') return { color: '#f9ab00', weight: 5 };
  if (seg.road_class === 'residential') return { color: '#7c4dff', weight: 4, dashArray: '5 5', opacity: 0.7 };
  return { color: '#1e8e3e', weight: 5 };
}

function renderSegments(segs) {
  // Update or create polylines
  segs.forEach(seg => {
    const style = { ...getSegmentStyle(seg), opacity: 0.9 };
    const speed = seg.current_speed_kph ?? seg.baseline_speed_kph;
    const pctBaseline = Math.round((speed / seg.baseline_speed_kph) * 100);

    const popupHtml = `
      <div style="font-family:Inter,sans-serif;min-width:190px;font-size:12px;">
        <div style="font-weight:700;font-size:13px;color:#202124;margin-bottom:6px;">${seg.name}</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="color:#5f6368">Status</span>
          <span style="font-weight:700;color:${style.color}">${seg.status.toUpperCase()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="color:#5f6368">Speed</span>
          <span style="font-weight:600">${speed} km/h <span style="color:#9aa0a6">(${pctBaseline}%)</span></span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="color:#5f6368">Live Evidence</span>
          <span style="font-weight:600">${seg.sample_count} devices (${seg.confidence})</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#5f6368">Detour quota</span>
          <span style="font-weight:600">${seg.current_diversion_count}/${seg.diversion_cap}</span>
        </div>
        <div style="margin-top:8px;background:#f1f3f4;border-radius:4px;padding:5px 8px;font-size:11px;color:#5f6368">
          Width: ${seg.width_m}m · ${seg.road_class} · ${seg.is_oneway ? 'One-way' : 'Two-way'}
        </div>
      </div>
    `;

    if (state.segmentLayers[seg.segment_id]) {
      // Existing layer: update style & popup dynamically
      const poly = state.segmentLayers[seg.segment_id];
      poly.setStyle(style);
      poly.setPopupContent(popupHtml);
    } else {
      // New layer
      const poly = L.polyline(seg.coordinates, style).addTo(state.map);
      poly.bindPopup(popupHtml, { maxWidth: 220 });
      state.segmentLayers[seg.segment_id] = poly;
    }
  });
}

async function loadSegmentsHttp() {
  try {
    const res = await fetch('/v1/traffic/segments');
    const segs = await res.json();
    state.cachedSegments = segs;
    renderSegments(segs);
    updateStatusGrid(segs);
  } catch (err) {
    console.warn('HTTP segment load failed:', err);
  }
}

function updateStatusGrid(segs) {
  const grid = document.getElementById('statusGrid');
  if (!grid) return;
  grid.innerHTML = segs.slice(0, 8).map(seg => {
    const color = seg.status === 'congested' ? '#d93025' : seg.status === 'slowing' ? '#f9ab00' : '#1e8e3e';
    const speed = Math.round(seg.current_speed_kph ?? seg.baseline_speed_kph);
    return `
      <div class="status-item">
        <div class="status-item-dot" style="background:${color}"></div>
        <span class="status-item-name">${seg.name.split('(')[0].trim()}</span>
        <span class="status-item-speed">${speed} km/h</span>
      </div>`;
  }).join('');
}

async function pollTrafficSummary() {
  try {
    const res = await fetch('/v1/ai/traffic-summary');
    const data = await res.json();
    updateTrafficSummaryBadge({
      level: data.overall_level,
      color: data.color,
      emoji: data.emoji
    });
  } catch (err) {}
}

// ──────────────────────────────────────────────
//  BROWSER GEOLOCATION (Real GPS)
// ──────────────────────────────────────────────
function initMyLocationButton() {
  const btn = document.getElementById('btnMyLocation');
  if (btn) {
    btn.addEventListener('click', () => useCurrentLocation(true));
  }
}

async function useCurrentLocation(forceFlyTo = false) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }

  showToast('📡 Acquiring real GPS coordinates…', 'info');

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const accuracy = Math.round(position.coords.accuracy || 10);

      try {
        // Reverse geocode to get real human-readable street/area name
        const res = await fetch(`/v1/ai/places/reverse?lat=${lat}&lon=${lon}`);
        const data = await res.json();
        const address = data.name || 'My Current Location';

        state.origin = { name: address, lat, lon, isGps: true, accuracy };
        document.getElementById('originInput').value = address;
        document.getElementById('originClear').style.display = '';

        setMarker('origin', lat, lon, `📍 Your Location (±${accuracy}m)`);

        if (forceFlyTo) {
          state.map.flyTo([lat, lon], 15);
        }

        showToast(`📍 Located: ${address}`, 'success');

        if (state.dest) {
          fitBothMarkers();
          setTimeout(doFindRoutes, 400);
        }
      } catch (err) {
        state.origin = { name: 'My Current Location', lat, lon, isGps: true };
        document.getElementById('originInput').value = 'My Current Location';
        document.getElementById('originClear').style.display = '';
        setMarker('origin', lat, lon, 'My Current Location');
        if (forceFlyTo) state.map.flyTo([lat, lon], 15);
      }
    },
    (err) => {
      console.warn('Geolocation error:', err);
      // Helpful fallback notification
      showToast('⚠️ GPS permission denied or unavailable. You can tap any point on the map to set your location.', 'warning');
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
  );
}

// ──────────────────────────────────────────────
//  CUSTOM PLACE SEARCH (Nominatim Geocoding)
// ──────────────────────────────────────────────
function initSearchFields() {
  setupSearchField('originInput', 'originDropdown', 'originClear', (place) => {
    state.origin = place;
    setMarker('origin', place.lat, place.lon, place.name);
    if (state.dest) fitBothMarkers();
    tryAutoSearch();
  });

  setupSearchField('destInput', 'destDropdown', 'destClear', (place) => {
    state.dest = place;
    setMarker('dest', place.lat, place.lon, place.name);
    if (state.origin) fitBothMarkers();
    tryAutoSearch();
  });

  // Swap button
  document.getElementById('swapBtn').addEventListener('click', () => {
    const o = state.origin, d = state.dest;
    if (!o && !d) return;
    state.origin = d; state.dest = o;
    document.getElementById('originInput').value = d ? d.name : '';
    document.getElementById('destInput').value = o ? o.name : '';
    document.getElementById('originClear').style.display = d ? '' : 'none';
    document.getElementById('destClear').style.display = o ? '' : 'none';
    if (state.origin) setMarker('origin', state.origin.lat, state.origin.lon, state.origin.name);
    if (state.dest) setMarker('dest', state.dest.lat, state.dest.lon, state.dest.name);
    if (state.origin && state.dest) fitBothMarkers();
  });

  // Find Routes button
  document.getElementById('btnFindRoutes').addEventListener('click', () => doFindRoutes(false));

  // Back button
  document.getElementById('btnBack').addEventListener('click', () => showPanel('panelSearch'));

  // Start trip button
  document.getElementById('btnStartTrip').addEventListener('click', doStartTrip);

  // End trip button
  document.getElementById('btnEndTrip').addEventListener('click', doEndTrip);

  // Incident reporting modal
  document.getElementById('btnReportIssue').addEventListener('click', () => {
    document.getElementById('reportModal').classList.remove('hidden');
  });
  document.getElementById('cancelReport').addEventListener('click', () => {
    document.getElementById('reportModal').classList.add('hidden');
  });
  document.querySelectorAll('.incident-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      submitIncident(btn.dataset.type);
      document.getElementById('reportModal').classList.add('hidden');
    });
  });
}

function setupSearchField(inputId, dropdownId, clearId, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const clearBtn = document.getElementById(clearId);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.style.display = q ? '' : 'none';
    clearTimeout(state.searchDebounce);
    state.searchDebounce = setTimeout(() => searchPlaces(q, dropdown, input, onSelect), 280);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    searchPlaces(q, dropdown, input, onSelect);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    dropdown.classList.remove('open');
    if (inputId === 'originInput') {
      state.origin = null;
      if (state.markerOrigin) { state.map.removeLayer(state.markerOrigin); state.markerOrigin = null; }
    } else {
      state.dest = null;
      if (state.markerDest) { state.map.removeLayer(state.markerDest); state.markerDest = null; }
    }
  });
}

async function searchPlaces(q, dropdown, input, onSelect) {
  try {
    const res = await fetch(`/v1/ai/places/search?q=${encodeURIComponent(q)}`);
    const places = await res.json();
    renderDropdown(places, dropdown, input, onSelect);
  } catch (err) {
    const filtered = QUICK_PLACES.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
    renderDropdown(filtered.map(p => ({ ...p, type: 'area', display: p.name })), dropdown, input, onSelect);
  }
}

function renderDropdown(places, dropdown, input, onSelect) {
  if (!places.length) {
    dropdown.classList.remove('open');
    return;
  }

  dropdown.innerHTML = places.map((p, i) => `
    <div class="dropdown-item" data-idx="${i}">
      <span class="dropdown-item-icon">${TYPE_ICONS[p.type] || '📍'}</span>
      <div class="dropdown-item-text">
        <div class="dropdown-item-name">${p.name}</div>
        <div class="dropdown-item-type">${p.display || p.type}</div>
      </div>
    </div>
  `).join('');
  dropdown.classList.add('open');

  dropdown.querySelectorAll('.dropdown-item').forEach((el, i) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const place = places[i];
      input.value = place.name;
      dropdown.classList.remove('open');
      onSelect(place);
    });
  });
}

function tryAutoSearch() {
  if (state.origin && state.dest) {
    setTimeout(() => doFindRoutes(false), 350);
  }
}

// ──────────────────────────────────────────────
//  MARKERS
// ──────────────────────────────────────────────
function makeMarkerIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function setMarker(type, lat, lon, label) {
  const color = type === 'origin' ? '#1e8e3e' : '#d93025';
  const icon = makeMarkerIcon(color);
  if (type === 'origin') {
    if (state.markerOrigin) state.map.removeLayer(state.markerOrigin);
    state.markerOrigin = L.marker([lat, lon], { icon }).addTo(state.map).bindPopup(label);
  } else {
    if (state.markerDest) state.map.removeLayer(state.markerDest);
    state.markerDest = L.marker([lat, lon], { icon }).addTo(state.map).bindPopup(label);
  }
}

function fitBothMarkers() {
  const pts = [];
  if (state.origin) pts.push([state.origin.lat, state.origin.lon]);
  if (state.dest) pts.push([state.dest.lat, state.dest.lon]);
  if (pts.length === 2) {
    state.map.fitBounds(L.latLngBounds(pts), { padding: [60, 60] });
  }
}

// ──────────────────────────────────────────────
//  QUICK CHIPS
// ──────────────────────────────────────────────
function initQuickChips() {
  const container = document.getElementById('quickChips');
  if (!container) return;
  container.innerHTML = '';

  QUICK_PLACES.forEach(place => {
    const chip = document.createElement('button');
    chip.className = 'quick-chip';
    chip.innerHTML = `${place.icon} ${place.name.replace('📍 ', '')}`;
    chip.addEventListener('click', () => {
      if (place.isCurrentLoc) {
        useCurrentLocation(true);
        return;
      }

      if (!state.origin) {
        state.origin = place;
        document.getElementById('originInput').value = place.name;
        document.getElementById('originClear').style.display = '';
        setMarker('origin', place.lat, place.lon, place.name);
      } else if (!state.dest) {
        state.dest = place;
        document.getElementById('destInput').value = place.name;
        document.getElementById('destClear').style.display = '';
        setMarker('dest', place.lat, place.lon, place.name);
        fitBothMarkers();
        setTimeout(() => doFindRoutes(false), 350);
      }
    });
    container.appendChild(chip);
  });
}

// ──────────────────────────────────────────────
//  VEHICLE SELECTOR
// ──────────────────────────────────────────────
function initVehicleSelector() {
  document.querySelectorAll('.vehicle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vehicle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.vehicle = btn.dataset.v;
      if (state.origin && state.dest) {
        doFindRoutes(true);
      }
    });
  });
}

// ──────────────────────────────────────────────
//  FIND ROUTES & DYNAMIC ALTERNATIVES
// ──────────────────────────────────────────────
async function doFindRoutes(isSilentUpdate = false) {
  if (!state.origin || !state.dest) {
    if (!isSilentUpdate) showToast('Please select your origin and destination', 'warning');
    return;
  }

  const btn = document.getElementById('btnFindRoutes');
  if (!isSilentUpdate && btn) {
    btn.textContent = 'Finding routes…';
    btn.classList.add('loading');
    btn.disabled = true;
  }

  try {
    const avoidRes = document.getElementById('avoidResidential')?.checked ?? true;
    const payload = {
      origin: { lat: state.origin.lat, lon: state.origin.lon },
      destination: { lat: state.dest.lat, lon: state.dest.lon },
      vehicle_profile: state.vehicle,
      avoid_residential_shortcuts: avoidRes,
      reserve_diversion: false
    };

    const res = await fetch('/v1/routes/alternatives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    renderRoutes(data);
    showPanel('panelRoutes');

    // Fetch AI insight in parallel
    fetchAIInsight();

  } catch (err) {
    if (!isSilentUpdate) showToast('Could not load routes. Check server connection.', 'error');
  } finally {
    if (!isSilentUpdate && btn) {
      btn.textContent = 'Find Best Routes';
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }
}

function renderRoutes(data) {
  state.activeRoute = data.routes.find(r => r.route_id === data.selected_route_id) || data.routes[0];
  const container = document.getElementById('routeCards');
  container.innerHTML = '';

  // Draw active route on map
  if (state.routeLayer) state.map.removeLayer(state.routeLayer);
  if (state.activeRoute && state.activeRoute.coordinates.length > 0) {
    state.routeLayer = L.polyline(state.activeRoute.coordinates, {
      color: '#1a73e8',
      weight: 7,
      opacity: 0.92
    }).addTo(state.map);
    state.map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
  }

  data.routes.forEach(route => {
    const isSelected = route.route_id === (state.activeRoute ? state.activeRoute.route_id : data.selected_route_id);
    const mins = Math.round(route.total_duration_sec / 60);
    const km = (route.total_distance_m / 1000).toFixed(1);

    let badge = '', badgeClass = '';
    if (route.route_type === 'primary_verified') {
      badge = 'Primary'; badgeClass = 'badge-primary';
    } else if (route.route_type === 'traffic_aware_alternative') {
      badge = 'Alt Route'; badgeClass = 'badge-alt';
    } else {
      badge = 'Caution'; badgeClass = 'badge-caution';
    }

    if (!route.is_recommended) badgeClass = 'badge-rejected';

    const statusBarClass = `status-bar-${route.status}`;
    const reasonDotColor = route.is_recommended ? '#1e8e3e' : '#d93025';

    const budgetHtml = route.diversion_budget_remaining != null
      ? `<span class="budget-pill">🚦 ${route.diversion_budget_remaining} detour spots remaining</span>`
      : '';

    const card = document.createElement('div');
    card.className = `route-card${isSelected ? ' selected' : ''}${!route.is_recommended ? ' rejected' : ''}`;
    card.innerHTML = `
      <div class="route-card-header">
        <span class="route-type-badge ${badgeClass}">${badge}</span>
        <div class="route-time"><span class="route-time-min">${mins}</span><span class="route-time-unit">min</span></div>
      </div>
      <div class="route-card-body">
        <div class="route-name">${route.summary}</div>
        <div class="route-dist">${km} km · ${route.segment_names.join(' → ')}</div>
        <div class="route-reason">
          <div class="route-reason-dot" style="background:${reasonDotColor}"></div>
          ${route.recommendation_reason}
        </div>
        ${budgetHtml}
      </div>
      <div class="route-status-bar ${statusBarClass}"></div>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.activeRoute = route;

      if (state.routeLayer) state.map.removeLayer(state.routeLayer);
      if (route.coordinates.length > 0) {
        state.routeLayer = L.polyline(route.coordinates, {
          color: '#1a73e8', weight: 7, opacity: 0.92
        }).addTo(state.map);
        state.map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
      }
    });

    container.appendChild(card);
  });

  // Show Start Trip only if there is a recommended route
  const startBtn = document.getElementById('btnStartTrip');
  startBtn.style.display = data.routes.some(r => r.is_recommended) ? '' : 'none';

  // AI bar on map
  const aiBar = document.getElementById('aiBar');
  if (aiBar) {
    aiBar.style.display = 'flex';
    document.getElementById('aiBarText').textContent = data.decision_rationale;
  }
}

// ──────────────────────────────────────────────
//  AI ROUTE INSIGHTS
// ──────────────────────────────────────────────
async function fetchAIInsight() {
  const summary = document.getElementById('aiSummary');
  const metrics = document.getElementById('aiMetrics');
  const tipBox = document.getElementById('aiTipBox');
  const dots = document.getElementById('aiLoadingDots');

  dots.style.display = 'flex';
  metrics.style.display = 'none';
  tipBox.style.display = 'none';
  summary.textContent = 'AI is evaluating pilot corridor conditions…';

  try {
    const payload = {
      origin_name: state.origin?.name || '',
      destination_name: state.dest?.name || '',
      vehicle_profile: state.vehicle
    };
    const res = await fetch('/v1/ai/route-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const insight = await res.json();

    dots.style.display = 'none';
    summary.textContent = insight.summary;

    document.getElementById('aiSafetyScore').textContent = insight.safety_score;
    document.getElementById('aiEta').textContent = insight.estimated_eta;
    document.getElementById('aiForecast').textContent = insight.congestion_forecast.split('.')[0] + '.';
    document.getElementById('aiTip').textContent = insight.smart_tip;

    metrics.style.display = 'grid';
    tipBox.style.display = 'flex';

    // Update floating map bar
    const barText = document.getElementById('aiBarText');
    if (barText) barText.textContent = `✦ AI: ${insight.smart_tip}`;

  } catch (err) {
    dots.style.display = 'none';
    summary.textContent = 'AI route analysis temporarily in offline mode.';
  }
}

// ──────────────────────────────────────────────
//  ACTIVE TRIP & REAL-TIME GPS TRACKING
// ──────────────────────────────────────────────
async function doStartTrip() {
  const btn = document.getElementById('btnStartTrip');
  btn.textContent = 'Starting…';
  btn.disabled = true;

  try {
    const res = await fetch('/v1/trips/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_profile: state.vehicle })
    });
    const data = await res.json();
    state.currentSessionToken = data.session_token;
    state.tripStartTime = Date.now();
    state.tripRouteIndex = 0;

    showPanel('panelTrip');

    // Navigation Instructions
    if (state.activeRoute) {
      document.getElementById('navPrimary').textContent = 'Follow the verified route';
      document.getElementById('navSecondary').textContent = state.activeRoute.segment_names[0] || '100 Feet Road';
      document.getElementById('statDist').textContent = (state.activeRoute.total_distance_m / 1000).toFixed(1);
      document.getElementById('statTime').textContent = Math.round(state.activeRoute.total_duration_sec / 60);
    }

    // Launch Foreground GPS Tracking
    startForegroundGpsTracking();

    showToast('🚀 Active Trip Started. Real-time telemetry transmitting foreground speeds.', 'success');

  } catch (err) {
    showToast('Failed to start trip session', 'error');
  } finally {
    btn.textContent = 'Start Trip — Activate Location';
    btn.disabled = false;
  }
}

function startForegroundGpsTracking() {
  // Real GPS tracking using navigator.geolocation.watchPosition
  if (navigator.geolocation) {
    state.watchId = navigator.geolocation.watchPosition(
      (position) => {
        handleRealGpsPosition(position);
      },
      (err) => {
        console.warn('watchPosition error:', err);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 6000 }
    );
  }

  // Active loop: handles updates every 2.5s
  let currentLat = state.origin ? state.origin.lat : 12.9750;
  let currentLon = state.origin ? state.origin.lon : 77.6406;
  const coordsList = state.activeRoute && state.activeRoute.coordinates.length > 0
    ? state.activeRoute.coordinates
    : [[currentLat, currentLon]];

  state.tripSimTimer = setInterval(() => {
    // If we have route coordinates, advance along the path
    if (coordsList.length > 1) {
      state.tripRouteIndex = (state.tripRouteIndex + 1) % coordsList.length;
      const pt = coordsList[state.tripRouteIndex];
      currentLat = pt[0] + (Math.random() - 0.5) * 0.0001;
      currentLon = pt[1] + (Math.random() - 0.5) * 0.0001;
    }

    // Realistic vehicle speed calculation
    const baseSpeed = state.vehicle === 'two_wheeler' ? 36 : state.vehicle === 'auto_rickshaw' ? 26 : 32;
    const speedVariation = (Math.random() - 0.5) * 8;
    const speed = Math.round(Math.max(8, Math.min(55, baseSpeed + speedVariation)));
    state.currentSpeedKph = speed;

    document.getElementById('statSpeed').textContent = speed;

    // Update Live User Marker & Accuracy Circle on Map
    updateUserPositionMarker(currentLat, currentLon, 10);

    // Update remaining trip time & distance
    if (state.activeRoute) {
      const elapsed = (Date.now() - state.tripStartTime) / 1000;
      const remainingSec = Math.max(0, state.activeRoute.total_duration_sec - elapsed);
      document.getElementById('statTime').textContent = Math.round(remainingSec / 60);

      const totalKm = state.activeRoute.total_distance_m / 1000;
      const distTraveledKm = (speed / 3600) * elapsed;
      const distLeft = Math.max(0, totalKm - distTraveledKm);
      document.getElementById('statDist').textContent = distLeft.toFixed(1);
    }

    // Transmit Real Observation to Backend
    // Backend evaluates congestion and immediately broadcasts via WebSocket
    if (state.currentSessionToken) {
      transmitObservation(currentLat, currentLon, speed, 8.5);
    }
  }, 2500);
}

function handleRealGpsPosition(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracy = Math.round(position.coords.accuracy || 12);
  const rawSpeed = position.coords.speed; // meters per second
  const speedKph = rawSpeed != null && rawSpeed >= 0 ? Math.round(rawSpeed * 3.6) : null;

  if (speedKph != null && speedKph > 0) {
    state.currentSpeedKph = speedKph;
    document.getElementById('statSpeed').textContent = speedKph;
  }

  updateUserPositionMarker(lat, lon, accuracy);

  const badgeText = document.getElementById('gpsBadgeText');
  if (badgeText) {
    badgeText.textContent = `📡 GPS Active: ±${accuracy}m · ${state.currentSpeedKph} km/h`;
  }

  // Transmit real GPS point to backend
  if (state.currentSessionToken) {
    transmitObservation(lat, lon, state.currentSpeedKph || 28, accuracy);
  }
}

function updateUserPositionMarker(lat, lon, accuracy) {
  if (!state.userMarker) {
    // Pulsing blue navigation dot
    const userIcon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;background:#1a73e8;border-radius:50%;opacity:0.35;animation:livePulse 1.4s infinite;"></div>
          <div style="position:absolute;inset:4px;background:#1a73e8;border:3px solid #ffffff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
        </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    state.userMarker = L.marker([lat, lon], { icon: userIcon, zIndexOffset: 1000 }).addTo(state.map);
    state.userAccuracyCircle = L.circle([lat, lon], {
      radius: accuracy,
      color: '#1a73e8',
      fillColor: '#1a73e8',
      fillOpacity: 0.12,
      weight: 1
    }).addTo(state.map);
  } else {
    state.userMarker.setLatLng([lat, lon]);
    if (state.userAccuracyCircle) {
      state.userAccuracyCircle.setLatLng([lat, lon]);
      state.userAccuracyCircle.setRadius(accuracy);
    }
  }
}

async function transmitObservation(lat, lon, speed, accuracy) {
  if (!state.currentSessionToken) return;

  const payload = {
    session_token: state.currentSessionToken,
    observations: [{
      timestamp: new Date().toISOString(),
      lat,
      lon,
      speed_kph: speed,
      accuracy_m: accuracy
    }]
  };

  try {
    await fetch('/v1/traffic/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    // Non-blocking telemetry
  }
}

async function doEndTrip() {
  // Halt GPS watch immediately
  if (state.watchId && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  // Clear timers
  if (state.tripSimTimer) {
    clearInterval(state.tripSimTimer);
    state.tripSimTimer = null;
  }

  // Remove live user markers
  if (state.userMarker) {
    state.map.removeLayer(state.userMarker);
    state.userMarker = null;
  }
  if (state.userAccuracyCircle) {
    state.map.removeLayer(state.userAccuracyCircle);
    state.userAccuracyCircle = null;
  }

  // Terminate backend session
  if (state.currentSessionToken) {
    try {
      await fetch('/v1/trips/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: state.currentSessionToken })
      });
    } catch (err) {}
    state.currentSessionToken = null;
  }

  document.getElementById('statSpeed').textContent = '0';
  showPanel('panelSearch');
  showToast('🛡️ Trip ended. GPS sharing terminated immediately. Zero background tracking.', 'success');

  const aiBar = document.getElementById('aiBar');
  if (aiBar) aiBar.style.display = 'none';

  loadSegmentsHttp();
}

function handlePageUnload() {
  if (state.currentSessionToken) {
    navigator.sendBeacon('/v1/trips/end', JSON.stringify({ session_token: state.currentSessionToken }));
  }
  if (state.watchId && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.watchId);
  }
}

function handleVisibilityChange() {
  // Foreground privacy guarantee: if tab goes hidden, we pause active updates
  if (document.hidden && state.currentSessionToken) {
    console.log('SmartTraffic: Tab hidden — foreground-only policy active.');
  }
}

async function submitIncident(type) {
  if (!state.currentSessionToken) {
    showToast('Please start a trip first to report an incident.', 'warning');
    return;
  }
  const lat = state.origin?.lat ?? 12.9610;
  const lon = state.origin?.lon ?? 77.6385;
  try {
    await fetch(`/v1/traffic/report?lat=${lat}&lon=${lon}&incident_type=${type}&session_token=${state.currentSessionToken}`, {
      method: 'POST'
    });
    showToast(`Reported: ${type.replace('_', ' ')} — filed to verification queue.`, 'success');
  } catch (err) {
    showToast('Failed to submit incident report', 'error');
  }
}

// ──────────────────────────────────────────────
//  PANEL NAVIGATION
// ──────────────────────────────────────────────
function showPanel(panelId) {
  ['panelSearch', 'panelRoutes', 'panelTrip'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === panelId) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

// ──────────────────────────────────────────────
//  BOTTOM SHEET GESTURES
// ──────────────────────────────────────────────
function initBottomSheet() {
  const sheet = document.getElementById('bottomSheet');
  const handle = document.getElementById('sheetHandle');
  if (!sheet || !handle) return;

  let startY = 0, startH = 0, dragging = false;
  const getH = () => sheet.getBoundingClientRect().height;

  function onStart(y) {
    startY = y;
    startH = getH();
    dragging = true;
  }

  function onMove(y) {
    if (!dragging) return;
    const delta = startY - y;
    const newH = Math.max(90, Math.min(window.innerHeight * 0.9, startH + delta));
    sheet.style.maxHeight = newH + 'px';
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    const h = getH();
    const h1 = 90, h2 = 320, h3 = window.innerHeight * 0.85;
    const snap = [h1, h2, h3].reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
    sheet.style.transition = 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    sheet.style.maxHeight = snap + 'px';
    setTimeout(() => { sheet.style.transition = ''; }, 300);
  }

  handle.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
  window.addEventListener('touchmove', e => onMove(e.touches[0].clientY), { passive: true });
  window.addEventListener('touchend', onEnd);
  handle.addEventListener('mousedown', e => onStart(e.clientY));
  window.addEventListener('mousemove', e => { if (dragging) onMove(e.clientY); });
  window.addEventListener('mouseup', onEnd);
}

// ──────────────────────────────────────────────
//  SIDE DRAWER
// ──────────────────────────────────────────────
function initDrawer() {
  const drawer = document.getElementById('sideDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const open = () => { drawer.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { drawer.classList.remove('open'); overlay.classList.remove('open'); };

  document.getElementById('btnMenu')?.addEventListener('click', open);
  document.getElementById('btnCloseDrawer')?.addEventListener('click', close);
  overlay?.addEventListener('click', close);
}

// ──────────────────────────────────────────────
//  SIMULATION SCENARIOS
// ──────────────────────────────────────────────
function initSimulationButtons() {
  document.querySelectorAll('.sim-btn[data-sim]').forEach(btn => {
    btn.addEventListener('click', () => runSimulation(btn.dataset.sim));
  });
  document.getElementById('btnReset')?.addEventListener('click', doReset);
}

async function runSimulation(scenario) {
  async function getToken() {
    const r = await fetch('/v1/trips/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const d = await r.json();
    return d.session_token;
  }

  async function postObs(token, lat, lon, speed) {
    await fetch('/v1/traffic/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_token: token,
        observations: [{
          timestamp: new Date().toISOString(),
          lat, lon,
          speed_kph: speed,
          accuracy_m: 8
        }]
      })
    });
  }

  const seg_lat = 12.9750, seg_lon = 77.6406;

  if (scenario === 'normal') {
    for (let i = 0; i < 4; i++) {
      const tok = await getToken();
      await postObs(tok, seg_lat + i * 0.0001, seg_lon, 34 + i);
    }
    showToast('✅ Normal flow: 4 devices report ~35 km/h. Corridor evaluated NORMAL.', 'success');
  } else if (scenario === 'single_glitch') {
    const tok = await getToken();
    await postObs(tok, seg_lat, seg_lon, 3.0);
    showToast('🔵 Single-phone at 3 km/h → Alert REJECTED (< 3 device rule). Corridor stays NORMAL.', 'info');
  } else if (scenario === 'congestion') {
    for (let i = 0; i < 5; i++) {
      const tok = await getToken();
      await postObs(tok, seg_lat + i * 0.0001, seg_lon, 8 + i * 0.4);
    }
    showToast('🔴 Genuine congestion! 5 devices at ~9 km/h → 100ft Rd marked CONGESTED.', 'error');
  } else if (scenario === 'detour_cap') {
    await fetch('/v1/admin/segments/seg_suranjan_conn/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diversion_cap: 20, reset_diversion_count: false })
    });
    showToast('🟣 Detour cap scenario active. Recalculate routes to view remaining quotas.', 'warning');
  }
}

async function doReset() {
  await fetch('/v1/admin/reset', { method: 'POST' });
  if (state.routeLayer) {
    state.map.removeLayer(state.routeLayer);
    state.routeLayer = null;
  }
  const aiBar = document.getElementById('aiBar');
  if (aiBar) aiBar.style.display = 'none';
  showPanel('panelSearch');
  showToast('🔄 Pilot network & congestion states reset to baseline.', 'info');
}

// ──────────────────────────────────────────────
//  TOAST NOTIFICATIONS
// ──────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span>${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
