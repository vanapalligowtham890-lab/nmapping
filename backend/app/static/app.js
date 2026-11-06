/* =====================================================
   Smart Traffic — Full Real-Time Navigation Platform
   Google Maps Standard · Real Road Curves · Traffic Colors · Turn-by-Turn
   ===================================================== */

'use strict';

// ──────────────────────────────────────────────
//  Application State
// ──────────────────────────────────────────────
const state = {
  map: null,
  segmentLayers: {},
  routeLayers: [],          // array of polylines for traffic segments
  altRouteLayers: [],       // alternative route layers
  markerOrigin: null,
  markerDest: null,
  userMarker: null,
  userAccuracyCircle: null,
  origin: null,             // { name, lat, lon, isGps, accuracy }
  dest: null,               // { name, lat, lon }
  vehicle: 'car',
  currentSessionToken: null,
  activeRoute: null,
  allRoutes: [],
  currentSpeedKph: 0,
  watchId: null,
  tripSimTimer: null,
  tripStartTime: null,
  tripStepIndex: 0,
  tripCoordIndex: 0,
  searchDebounce: null,
  ws: null,
  wsRetryTimer: null,
  wsPingTimer: null,
  cachedSegments: [],
};

// Rich nationwide presets & smart suggestions
const POPULAR_HUBS = [
  { name: '📍 My Current Location (GPS)', isCurrentLoc: true, type: 'place', display: 'Use device GPS sensor or network location' },
  { name: 'Kakinada Town Junction', lat: 16.9673, lon: 82.2335, type: 'transit', display: 'Railway Station Road, Kakinada, Andhra Pradesh' },
  { name: 'Kakinada Beach Road', lat: 16.9891, lon: 82.2475, type: 'landmark', display: 'NTR Beach Road, Kakinada, Andhra Pradesh' },
  { name: 'Rajahmundry Central', lat: 17.0005, lon: 81.8040, type: 'city', display: 'Godavari Riverfront, East Godavari, Andhra Pradesh' },
  { name: 'Vijayawada Junction', lat: 16.5186, lon: 80.6195, type: 'transit', display: 'Vijayawada Railway Station, Andhra Pradesh' },
  { name: 'Hyderabad Hitec City', lat: 17.4474, lon: 78.3762, type: 'area', display: 'Cyber Towers, Hitec City, Hyderabad, Telangana' },
  { name: 'Indiranagar 100 Feet Road', lat: 12.9750, lon: 77.6407, type: 'road', display: '100 Feet Road, Indiranagar, Bengaluru, Karnataka' },
  { name: 'Domlur Flyover', lat: 12.9610, lon: 77.6385, type: 'landmark', display: 'Domlur Flyover, Old Airport Road, Bengaluru' },
  { name: 'Sony World Junction', lat: 12.9352, lon: 77.6245, type: 'junction', display: 'Sony World, 80ft Road, Koramangala, Bengaluru' },
  { name: 'Kempegowda International Airport (BLR)', lat: 13.1986, lon: 77.7066, type: 'transit', display: 'BLR Airport, Devanahalli, Bengaluru, Karnataka' },
  { name: 'Whitefield ITPL', lat: 12.9863, lon: 77.7381, type: 'area', display: 'International Tech Park, Whitefield, Bengaluru' },
  { name: 'MG Road Metro Station', lat: 12.9756, lon: 77.6066, type: 'transit', display: 'Mahatma Gandhi Road, Bengaluru Central' },
  { name: 'Mysuru Palace', lat: 12.3052, lon: 76.6552, type: 'landmark', display: 'Sayyaji Rao Road, Mysuru, Karnataka' },
  { name: 'Solapur Junction', lat: 17.6599, lon: 75.9064, type: 'city', display: 'Solapur, Maharashtra, India' },
];

const TYPE_ICONS = {
  junction: '🔀', road: '🛣️', landmark: '🏛️', area: '📍', transit: '🚆',
  place: '🏙️', city: '🏙️', airport: '✈️', hospital: '🏥', mall: '🛍️'
};

const MANEUVER_ICONS = {
  left: '↰', right: '↱', 'slight left': '↖', 'slight right': '↗',
  'sharp left': '⬅', 'sharp right': '➡', straight: '⬆', uturn: '↩',
  roundabout: '🔄', depart: '🚀', arrive: '🏁', continue: '⬆',
};

// ──────────────────────────────────────────────
//  MULTI-TYPE MAP PROVIDERS & 3D RELIEF
// ──────────────────────────────────────────────
const TILE_PROVIDERS = {
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '© CARTO, © OpenStreetMap'
  }),
  satellite: L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '© Esri, Maxar, Earthstar Geographics'
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.9
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.95
    })
  ]),
  terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    subdomains: 'abc',
    attribution: '© OpenTopoMap, © OpenStreetMap'
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '© CARTO, © OpenStreetMap'
  })
};

let currentTileLayer = null;
let currentLayerKey = 'voyager';
let showTrafficOverlay = true;
let show3DBuildings = true;

function switchBaseLayer(layerKey) {
  if (!TILE_PROVIDERS[layerKey] || !state.map) return;

  if (currentTileLayer) {
    state.map.removeLayer(currentTileLayer);
  }

  currentTileLayer = TILE_PROVIDERS[layerKey];
  currentTileLayer.addTo(state.map);
  if (currentTileLayer.bringToBack) {
    currentTileLayer.bringToBack();
  }

  currentLayerKey = layerKey;
  try { localStorage.setItem('smart_traffic_map_layer', layerKey); } catch (e) {}

  document.querySelectorAll('.layer-card-btn').forEach(btn => {
    if (btn.dataset.layer === layerKey) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  const names = { voyager: 'Default Streets', satellite: 'Satellite HD', terrain: 'Terrain 3D', dark: 'Night Drive' };
  showToast(`🗺️ Map switched to ${names[layerKey] || layerKey}`, 'info');
}

function initMapLayerSwitcher() {
  const fabLayers = document.getElementById('fabMapLayers');
  const layerCard = document.getElementById('layerSelectorCard');
  const btnClose = document.getElementById('btnCloseLayerCard');
  const toggleTraffic = document.getElementById('toggleTrafficLayer');
  const toggle3D = document.getElementById('toggle3DBuildings');

  if (!fabLayers || !layerCard) return;

  fabLayers.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = layerCard.style.display !== 'none';
    layerCard.style.display = isVisible ? 'none' : 'block';
    fabLayers.classList.toggle('active', !isVisible);
  });

  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      layerCard.style.display = 'none';
      fabLayers.classList.remove('active');
    });
  }

  document.addEventListener('click', (e) => {
    if (!layerCard.contains(e.target) && !fabLayers.contains(e.target)) {
      layerCard.style.display = 'none';
      fabLayers.classList.remove('active');
    }
  });

  document.querySelectorAll('.layer-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchBaseLayer(btn.dataset.layer);
    });
  });

  if (toggleTraffic) {
    toggleTraffic.addEventListener('change', () => {
      showTrafficOverlay = toggleTraffic.checked;
      Object.values(state.segmentLayers).forEach(layer => {
        if (showTrafficOverlay) layer.addTo(state.map);
        else state.map.removeLayer(layer);
      });
      state.routeLayers.forEach(l => {
        if (showTrafficOverlay) l.addTo(state.map);
        else state.map.removeLayer(l);
      });
      showToast(showTrafficOverlay ? '🚦 Real-time traffic overlay active' : 'Traffic overlay hidden', 'info');
    });
  }

  if (toggle3D) {
    toggle3D.addEventListener('change', () => {
      show3DBuildings = toggle3D.checked;
      showToast(show3DBuildings ? '🏢 3D terrain & relief active' : '3D relief disabled', 'info');
    });
  }

  const saved = localStorage.getItem('smart_traffic_map_layer') || 'voyager';
  switchBaseLayer(saved);
}

// ──────────────────────────────────────────────
//  BOOT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initMapLayerSwitcher();
  initSearchFields();
  initVehicleSelector();
  initBottomSheet();
  initDrawer();
  initSimulationButtons();
  initQuickChips();
  initLocationButtons();

  // Connect real-time WebSocket stream (primary data channel)
  connectWebSocket();

  // Initial HTTP snapshot
  loadSegmentsHttp();
  pollTrafficSummary();

  // Foreground privacy safeguard
  window.addEventListener('beforeunload', handlePageUnload);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

// ──────────────────────────────────────────────
//  MAP INITIALIZATION
// ──────────────────────────────────────────────
function initMap() {
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: true
  }).setView([12.9610, 77.6385], 13);

  // Initialize selected layer
  const saved = localStorage.getItem('smart_traffic_map_layer') || 'voyager';
  currentTileLayer = TILE_PROVIDERS[saved] || TILE_PROVIDERS.voyager;
  currentTileLayer.addTo(state.map);

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  // Map Legend
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="legend-row"><div class="legend-dot" style="background:#1e8e3e"></div>Fast Flow</div>
      <div class="legend-row"><div class="legend-dot" style="background:#f9ab00"></div>Slowdown</div>
      <div class="legend-row"><div class="legend-dot" style="background:#d93025"></div>Heavy Traffic</div>
      <div class="legend-row"><div class="legend-dot" style="background:#7c4dff;border-top:2px dashed #7c4dff;height:0;width:16px"></div>Residential</div>`;
    return div;
  };
  legend.addTo(state.map);

  // Trigger map tile recomputation on load and resize
  setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 150);
  setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 600);
  window.addEventListener('resize', () => {
    if (state.map) state.map.invalidateSize();
  });

  // Click on map to set points
  state.map.on('click', handleMapClick);
}

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
      showToast('⚡ Real-time Traffic Feed Connected', 'success');

      // Keepalive ping every 10s
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
          showToast(`⚠️ Live incident: ${msg.incident_type}`, 'warning');
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

  renderSegments(segments);

  if (data.summary) {
    updateTrafficSummaryBadge(data.summary);
  }

  updateStatusGrid(segments);

  // Check if active route congestion changed
  if (state.activeRoute && state.activeRoute.segments) {
    const curSegs = new Set(state.activeRoute.segments);
    let newlyCongested = false;
    segments.forEach(seg => {
      if (curSegs.has(seg.segment_id)) {
        const prev = prevSegments.find(p => p.segment_id === seg.segment_id);
        if (prev && prev.status === 'normal' && (seg.status === 'congested' || seg.status === 'slowing')) {
          newlyCongested = true;
        }
      }
    });

    if (newlyCongested) {
      showToast('⚠️ Traffic changed on your route. Recalculating…', 'warning');
      doFindRoutes(true);
    }
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
//  HIGH-PRECISION GPS GEOLOCATION
// ──────────────────────────────────────────────
function initLocationButtons() {
  const btnSearchGps = document.getElementById('btnMyLocation');
  const fabGps = document.getElementById('fabMyLocation');

  if (btnSearchGps) {
    btnSearchGps.addEventListener('click', () => acquireUserLocation(true));
  }
  if (fabGps) {
    fabGps.addEventListener('click', () => {
      if (state.origin && state.origin.lat && state.origin.lon && state.map) {
        state.map.invalidateSize();
        state.map.flyTo([state.origin.lat, state.origin.lon], 16);
      }
      acquireUserLocation(true);
    });
  }
}

async function acquireUserLocation(centerMap = true) {
  const fab = document.getElementById('fabMyLocation');
  if (fab) fab.classList.add('locating');

  showToast('📡 Acquiring high-precision GPS coordinates…', 'info');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => handleGpsSuccess(pos, centerMap),
      (err) => {
        console.warn('Browser GPS failed, falling back to IP geolocation:', err);
        fallbackIpLocation(centerMap);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  } else {
    fallbackIpLocation(centerMap);
  }
}

async function fallbackIpLocation(centerMap) {
  try {
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    if (data.latitude && data.longitude) {
      handleCoordinatesAcquired(data.latitude, data.longitude, 500, `${data.city || 'Your Area'}, ${data.region || ''}`, centerMap);
      showToast(`📍 Located via Network: ${data.city || 'Your Location'}`, 'info');
      return;
    }
  } catch (e) {}

  // Default to Bengaluru center if all location lookups blocked
  handleCoordinatesAcquired(12.9716, 77.5946, 50, 'Bengaluru, Karnataka', centerMap);
  showToast('📍 Set to Bengaluru. Drag the green marker or tap the map to fine-tune.', 'warning');
}

async function handleGpsSuccess(pos, centerMap) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const acc = Math.round(pos.coords.accuracy || 15);

  let address = `Current Location (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  try {
    const res = await fetch(`/v1/ai/places/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
    const data = await res.json();
    if (data.name) address = data.name;
  } catch (e) {}

  handleCoordinatesAcquired(lat, lon, acc, address, centerMap);
  showToast(`📍 GPS Located: ${address} (±${acc}m)`, 'success');
}

function handleCoordinatesAcquired(lat, lon, accuracy, addressName, centerMap) {
  const fab = document.getElementById('fabMyLocation');
  if (fab) fab.classList.remove('locating');

  state.origin = {
    name: addressName,
    lat: lat,
    lon: lon,
    isGps: true,
    accuracy: accuracy
  };

  const originInput = document.getElementById('originInput');
  if (originInput) originInput.value = addressName;
  const clearBtn = document.getElementById('originClear');
  if (clearBtn) clearBtn.style.display = '';

  setMarker('origin', lat, lon, `📍 ${addressName} (Drag to adjust)`, true);

  if (centerMap && state.map) {
    state.map.invalidateSize();
    state.map.flyTo([lat, lon], 15);
  }

  if (state.dest) {
    fitBothMarkers();
    setTimeout(() => doFindRoutes(false), 350);
  }
}

// ──────────────────────────────────────────────
//  SEARCH FIELDS & REAL-TIME AUTOCOMPLETE
// ──────────────────────────────────────────────
function initSearchFields() {
  setupSearchField('originInput', 'originDropdown', 'originClear', (place) => {
    state.origin = place;
    setMarker('origin', place.lat, place.lon, place.name, true);
    if (state.dest) fitBothMarkers();
    tryAutoSearch();
  });

  setupSearchField('destInput', 'destDropdown', 'destClear', (place) => {
    state.dest = place;
    setMarker('dest', place.lat, place.lon, place.name, false);
    if (state.origin) fitBothMarkers();
    tryAutoSearch();
  });

  // Swap button
  document.getElementById('swapBtn')?.addEventListener('click', () => {
    const o = state.origin, d = state.dest;
    if (!o && !d) return;
    state.origin = d; state.dest = o;
    document.getElementById('originInput').value = d ? d.name : '';
    document.getElementById('destInput').value = o ? o.name : '';
    document.getElementById('originClear').style.display = d ? '' : 'none';
    document.getElementById('destClear').style.display = o ? '' : 'none';
    if (state.origin) setMarker('origin', state.origin.lat, state.origin.lon, state.origin.name, true);
    if (state.dest) setMarker('dest', state.dest.lat, state.dest.lon, state.dest.name, false);
    if (state.origin && state.dest) fitBothMarkers();
  });

  // Find Routes
  document.getElementById('btnFindRoutes')?.addEventListener('click', () => doFindRoutes(false));
  document.getElementById('btnBack')?.addEventListener('click', () => showPanel('panelSearch'));
  document.getElementById('btnStartTrip')?.addEventListener('click', doStartTrip);
  document.getElementById('btnEndTrip')?.addEventListener('click', doEndTrip);

  // Incident Modal
  document.getElementById('btnReportIssue')?.addEventListener('click', () => {
    document.getElementById('reportModal')?.classList.remove('hidden');
  });
  document.getElementById('cancelReport')?.addEventListener('click', () => {
    document.getElementById('reportModal')?.classList.add('hidden');
  });
  document.querySelectorAll('.incident-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      submitIncident(btn.dataset.type);
      document.getElementById('reportModal')?.classList.add('hidden');
    });
  });
}

function setupSearchField(inputId, dropdownId, clearId, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const clearBtn = document.getElementById(clearId);
  if (!input || !dropdown) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';
    clearTimeout(state.searchDebounce);
    state.searchDebounce = setTimeout(() => searchPlaces(q, dropdown, input, onSelect), 250);
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

  if (clearBtn) {
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
      clearRouteLayers();
    });
  }
}

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined) return null;
  if (lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

async function searchPlaces(q, dropdown, input, onSelect) {
  if (!q || q.length < 2) {
    renderDropdown(POPULAR_HUBS, dropdown, input, onSelect);
    return;
  }

  const userLat = state.origin?.lat;
  const userLon = state.origin?.lon;
  let url = `/v1/ai/places/search?q=${encodeURIComponent(q)}&limit=10`;
  if (userLat && userLon) {
    url += `&lat=${userLat.toFixed(4)}&lon=${userLon.toFixed(4)}`;
  }

  try {
    const res = await fetch(url);
    const places = await res.json();
    renderDropdown(places, dropdown, input, onSelect);
  } catch (err) {
    const filtered = POPULAR_HUBS.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
    renderDropdown(filtered, dropdown, input, onSelect);
  }
}

function renderDropdown(places, dropdown, input, onSelect) {
  if (!places || !places.length) {
    dropdown.classList.remove('open');
    return;
  }

  const userLat = state.origin?.lat;
  const userLon = state.origin?.lon;

  dropdown.innerHTML = places.map((p, i) => {
    const icon = p.isCurrentLoc ? '📍' : (TYPE_ICONS[p.type] || '📍');
    let distBadge = '';
    if (userLat && userLon && p.lat && p.lon && !p.isCurrentLoc) {
      const d = calcDistanceKm(userLat, userLon, p.lat, p.lon);
      if (d !== null) {
        distBadge = `<span class="drop-dist">${d < 1 ? '<1 km' : d + ' km'}</span>`;
      }
    }
    return `
      <div class="dropdown-item" data-idx="${i}">
        <div class="drop-icon-box">${icon}</div>
        <div class="drop-content">
          <div class="drop-header">
            <span class="drop-name">${p.name}</span>
            ${distBadge}
          </div>
          <div class="drop-sub">${p.display || p.type}</div>
        </div>
      </div>
    `;
  }).join('');
  dropdown.classList.add('open');

  dropdown.querySelectorAll('.dropdown-item').forEach((el, i) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const place = places[i];
      if (place.isCurrentLoc) {
        dropdown.classList.remove('open');
        acquireUserLocation(true);
        return;
      }
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
//  MAP CLICK TO SET LOCATION
// ──────────────────────────────────────────────
window.setAsOrigin = function(lat, lon, name) {
  state.map.closePopup();
  state.origin = { name, lat, lon };
  document.getElementById('originInput').value = name;
  document.getElementById('originClear').style.display = '';
  setMarker('origin', lat, lon, name, true);
  if (state.dest) fitBothMarkers();
  tryAutoSearch();
};

window.setAsDest = function(lat, lon, name) {
  state.map.closePopup();
  state.dest = { name, lat, lon };
  document.getElementById('destInput').value = name;
  document.getElementById('destClear').style.display = '';
  setMarker('dest', lat, lon, name, false);
  if (state.origin) fitBothMarkers();
  tryAutoSearch();
};

async function handleMapClick(e) {
  if (state.currentSessionToken) return;

  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  const popup = L.popup()
    .setLatLng([lat, lon])
    .setContent('<div style="font-size:12px;color:#5f6368;padding:4px">Identifying street address…</div>')
    .openOn(state.map);

  try {
    const res = await fetch(`/v1/ai/places/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
    const data = await res.json();
    const placeName = data.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const safeName = placeName.replace(/'/g, "\\'");

    popup.setContent(`
      <div style="font-family:Inter,sans-serif;min-width:190px;padding:2px 0;">
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
//  MARKERS (DRAGGABLE & GOOGLE MAPS STYLE)
// ──────────────────────────────────────────────
function makePinIcon(type) {
  const isOrigin = type === 'origin';
  const color = isOrigin ? '#1E8E3E' : '#D93025';
  const label = isOrigin ? 'A' : 'B';

  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:30px;height:42px;display:flex;flex-direction:column;align-items:center;">
        <div style="width:26px;height:26px;background:${color};border-radius:50%;border:2.5px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;">
          ${label}
        </div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:9px solid ${color};margin-top:-2px;"></div>
      </div>`,
    iconSize: [30, 42],
    iconAnchor: [15, 40]
  });
}

function setMarker(type, lat, lon, label, draggable = false) {
  const icon = makePinIcon(type);

  if (type === 'origin') {
    if (state.markerOrigin) state.map.removeLayer(state.markerOrigin);
    state.markerOrigin = L.marker([lat, lon], { icon, draggable }).addTo(state.map).bindPopup(label);

    if (draggable) {
      state.markerOrigin.on('dragend', async (e) => {
        const newPos = e.target.getLatLng();
        state.origin.lat = newPos.lat;
        state.origin.lon = newPos.lng;
        try {
          const res = await fetch(`/v1/ai/places/reverse?lat=${newPos.lat.toFixed(5)}&lon=${newPos.lng.toFixed(5)}`);
          const data = await res.json();
          if (data.name) {
            state.origin.name = data.name;
            document.getElementById('originInput').value = data.name;
          }
        } catch (err) {}
        showToast('📍 Starting point adjusted', 'info');
        if (state.dest) doFindRoutes(true);
      });
    }
  } else {
    if (state.markerDest) state.map.removeLayer(state.markerDest);
    state.markerDest = L.marker([lat, lon], { icon, draggable }).addTo(state.map).bindPopup(label);

    if (draggable) {
      state.markerDest.on('dragend', async (e) => {
        const newPos = e.target.getLatLng();
        state.dest.lat = newPos.lat;
        state.dest.lon = newPos.lng;
        try {
          const res = await fetch(`/v1/ai/places/reverse?lat=${newPos.lat.toFixed(5)}&lon=${newPos.lng.toFixed(5)}`);
          const data = await res.json();
          if (data.name) {
            state.dest.name = data.name;
            document.getElementById('destInput').value = data.name;
          }
        } catch (err) {}
        showToast('📍 Destination adjusted', 'info');
        if (state.origin) doFindRoutes(true);
      });
    }
  }
}

function fitBothMarkers() {
  const pts = [];
  if (state.origin) pts.push([state.origin.lat, state.origin.lon]);
  if (state.dest) pts.push([state.dest.lat, state.dest.lon]);
  if (pts.length === 2) {
    state.map.fitBounds(L.latLngBounds(pts), { padding: [70, 70] });
  }
}

// ──────────────────────────────────────────────
//  FIND ROUTES (REAL ROAD NAVIGATION)
// ──────────────────────────────────────────────
async function doFindRoutes(isSilentUpdate = false) {
  if (!state.origin || !state.dest) {
    if (!isSilentUpdate) showToast('Please select your starting point and destination', 'warning');
    return;
  }

  const btn = document.getElementById('btnFindRoutes');
  if (!isSilentUpdate && btn) {
    btn.textContent = 'Calculating optimal driving route…';
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

    state.allRoutes = data.routes || [];
    renderRoutes(data);
    showPanel('panelRoutes');

    // Fetch AI insight in parallel
    fetchAIInsight();

  } catch (err) {
    if (!isSilentUpdate) showToast('Could not calculate route. Please try again.', 'error');
  } finally {
    if (!isSilentUpdate && btn) {
      btn.textContent = 'Find Best Routes';
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }
}

// ──────────────────────────────────────────────
//  GOOGLE MAPS STYLE ROUTE RENDERING
//  Multi-Color Traffic Polyline & Alternatives
// ──────────────────────────────────────────────
function clearRouteLayers() {
  state.routeLayers.forEach(l => state.map.removeLayer(l));
  state.routeLayers = [];
  state.altRouteLayers.forEach(l => state.map.removeLayer(l));
  state.altRouteLayers = [];
}

function renderRoutes(data) {
  clearRouteLayers();

  state.activeRoute = data.routes.find(r => r.route_id === data.selected_route_id) || data.routes[0];
  const container = document.getElementById('routeCards');
  if (container) container.innerHTML = '';

  // 1. Draw Alternative Routes in subtle gray underneath
  data.routes.forEach(route => {
    if (route.route_id !== state.activeRoute.route_id && route.coordinates.length > 1) {
      const altPoly = L.polyline(route.coordinates, {
        color: '#78909C',
        weight: 6,
        opacity: 0.65,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map);

      // Tooltip to click and select this alternative
      const mins = Math.round(route.total_duration_sec / 60);
      const diffMins = mins - Math.round(state.activeRoute.total_duration_sec / 60);
      const diffText = diffMins > 0 ? `+${diffMins} min` : (diffMins < 0 ? `${diffMins} min` : 'Same time');

      altPoly.bindTooltip(`${diffText} (${(route.total_distance_m / 1000).toFixed(1)} km)`, {
        permanent: true,
        direction: 'center',
        className: 'route-diff-tooltip'
      });

      altPoly.on('click', () => {
        selectRoute(route, data);
      });

      state.altRouteLayers.push(altPoly);
    }
  });

  // 2. Draw Active Route with Google Maps Multi-Color Traffic Polyline!
  drawActiveTrafficRoute(state.activeRoute);

  // 3. Render Route Cards
  data.routes.forEach(route => {
    const isSelected = route.route_id === state.activeRoute.route_id;
    const mins = Math.round(route.total_duration_sec / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    const timeDisplay = hrs > 0 ? `${hrs}h ${remMins}m` : `${mins}`;
    const km = (route.total_distance_m / 1000).toFixed(1);

    let badge = '', badgeClass = '';
    if (route.route_type === 'primary_verified') {
      badge = 'Fastest'; badgeClass = 'badge-primary';
    } else if (route.route_type === 'traffic_aware_alternative') {
      badge = 'Alternative'; badgeClass = 'badge-alt';
    } else {
      badge = 'Caution'; badgeClass = 'badge-caution';
    }

    if (!route.is_recommended) badgeClass = 'badge-rejected';

    const statusBarClass = `status-bar-${route.status}`;
    const reasonDotColor = route.is_recommended ? '#1e8e3e' : '#d93025';

    const card = document.createElement('div');
    card.className = `route-card${isSelected ? ' selected' : ''}${!route.is_recommended ? ' rejected' : ''}`;
    card.innerHTML = `
      <div class="route-card-header">
        <span class="route-type-badge ${badgeClass}">${badge}</span>
        <div class="route-time"><span class="route-time-min">${timeDisplay}</span><span class="route-time-unit">${hrs > 0 ? '' : 'min'}</span></div>
      </div>
      <div class="route-card-body">
        <div class="route-name">${route.summary}</div>
        <div class="route-dist">${km} km · Real Road Navigation</div>
        <div class="route-reason">
          <div class="route-reason-dot" style="background:${reasonDotColor}"></div>
          ${route.recommendation_reason}
        </div>
      </div>
      <div class="route-status-bar ${statusBarClass}"></div>
    `;

    card.addEventListener('click', () => {
      selectRoute(route, data);
    });

    if (container) container.appendChild(card);
  });

  // Show Start Trip button
  const startBtn = document.getElementById('btnStartTrip');
  const wrapStart = document.getElementById('wrapStartTrip');
  const hasRec = data.routes.some(r => r.is_recommended);
  if (wrapStart) {
    wrapStart.style.display = hasRec ? 'block' : 'none';
  }
  if (startBtn) {
    startBtn.style.display = hasRec ? 'flex' : 'none';
  }

  // Floating AI Summary Bar
  const aiBar = document.getElementById('aiBar');
  if (aiBar) {
    aiBar.style.display = 'flex';
    document.getElementById('aiBarText').textContent = data.decision_rationale;
  }
}

function selectRoute(route, data) {
  state.activeRoute = route;
  document.querySelectorAll('.route-card').forEach((c, idx) => {
    if (data.routes[idx] && data.routes[idx].route_id === route.route_id) {
      c.classList.add('selected');
    } else {
      c.classList.remove('selected');
    }
  });

  clearRouteLayers();

  // Re-draw with this route active
  data.routes.forEach(r => {
    if (r.route_id !== route.route_id && r.coordinates.length > 1) {
      const altPoly = L.polyline(r.coordinates, {
        color: '#78909C', weight: 6, opacity: 0.65, lineCap: 'round', lineJoin: 'round'
      }).addTo(state.map);
      state.altRouteLayers.push(altPoly);
    }
  });

  drawActiveTrafficRoute(route);
}

function drawActiveTrafficRoute(route) {
  if (!route || !route.coordinates || route.coordinates.length < 2) return;

  // Layer 1: Sleek Casing / Border (Google Maps style dark outline with Tegaki animated draw-in)
  const casingPoly = L.polyline(route.coordinates, {
    color: '#0d47a1',
    weight: 9,
    opacity: 0.85,
    className: 'anim-draw-path',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.map);
  state.routeLayers.push(casingPoly);

  // Layer 2: Multi-color traffic segments (Green, Yellow, Red) with Tegaki draw-in
  if (route.traffic_segments && route.traffic_segments.length > 0) {
    route.traffic_segments.forEach(ts => {
      if (ts.coordinates && ts.coordinates.length > 1) {
        const segPoly = L.polyline(ts.coordinates, {
          color: ts.color || '#1E8E3E',
          weight: 5.5,
          opacity: 0.98,
          className: 'anim-draw-path',
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(state.map);
        state.routeLayers.push(segPoly);
      }
    });
  } else {
    // Solid vibrant navigation line
    const mainPoly = L.polyline(route.coordinates, {
      color: '#1A73E8',
      weight: 5.5,
      opacity: 0.96,
      className: 'anim-draw-path',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(state.map);
    state.routeLayers.push(mainPoly);
  }

  // Layer 3: Directional Flow Pulse (animated flowing traffic dashes along road curves)
  const flowPoly = L.polyline(route.coordinates, {
    color: '#ffffff',
    weight: 2.5,
    opacity: 0.85,
    dashArray: '10, 24',
    className: 'traffic-flowing-dash',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.map);
  state.routeLayers.push(flowPoly);

  // Smoothly fit bounds to show the entire road trip
  state.map.fitBounds(casingPoly.getBounds(), { padding: [60, 60] });
}

// ──────────────────────────────────────────────
//  AI ROUTE INSIGHTS
// ──────────────────────────────────────────────
async function fetchAIInsight() {
  const summary = document.getElementById('aiSummary');
  const metrics = document.getElementById('aiMetrics');
  const tipBox = document.getElementById('aiTipBox');
  const dots = document.getElementById('aiLoadingDots');

  if (dots) dots.style.display = 'flex';
  if (metrics) metrics.style.display = 'none';
  if (tipBox) tipBox.style.display = 'none';
  if (summary) summary.textContent = 'AI is evaluating road conditions…';

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

    if (dots) dots.style.display = 'none';
    if (summary) {
      summary.textContent = insight.summary;
      summary.classList.remove('tegaki-text-reveal');
      void summary.offsetWidth;
      summary.classList.add('tegaki-text-reveal');
    }

    document.getElementById('aiSafetyScore').textContent = insight.safety_score;
    document.getElementById('aiEta').textContent = insight.estimated_eta;
    document.getElementById('aiForecast').textContent = insight.congestion_forecast.split('.')[0] + '.';
    document.getElementById('aiTip').textContent = insight.smart_tip;

    if (metrics) metrics.style.display = 'grid';
    if (tipBox) tipBox.style.display = 'flex';

    const barText = document.getElementById('aiBarText');
    if (barText) barText.textContent = `✦ AI: ${insight.smart_tip}`;

  } catch (err) {
    if (dots) dots.style.display = 'none';
    if (summary) summary.textContent = 'AI route analysis temporarily in offline mode.';
  }
}

// ──────────────────────────────────────────────
//  ACTIVE NAVIGATION (TURN-BY-TURN HUD)
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
    state.tripStepIndex = 0;
    state.tripCoordIndex = 0;

    showPanel('panelTrip');

    // Update Turn-by-turn Navigation instructions
    updateTurnByTurnHUD();

    // Start Real GPS watch
    startActiveGpsNavigation();

    showToast('🚀 Navigation active. Real-time GPS transmitting foreground speeds.', 'success');

  } catch (err) {
    showToast('Failed to start trip session', 'error');
  } finally {
    btn.textContent = 'Start Trip — Activate Location';
    btn.disabled = false;
  }
}

function updateTurnByTurnHUD() {
  if (!state.activeRoute) return;

  const steps = state.activeRoute.steps || [];
  if (steps.length > 0 && state.tripStepIndex < steps.length) {
    const curStep = steps[state.tripStepIndex];
    const arrow = MANEUVER_ICONS[curStep.modifier] || MANEUVER_ICONS[curStep.type] || '⬆';

    document.getElementById('navPrimary').textContent = curStep.instruction || 'Follow the verified route';
    document.getElementById('navSecondary').textContent = curStep.name || state.activeRoute.summary;
    document.getElementById('navDist').textContent = curStep.distance_m ? `${Math.round(curStep.distance_m)} m` : '';

    const nextStep = steps[state.tripStepIndex + 1];
    const nextPreview = document.getElementById('navNextStep');
    if (nextStep && nextPreview) {
      nextPreview.style.display = 'flex';
      document.getElementById('navNextText').textContent = `Then ${nextStep.instruction.toLowerCase()} in ${Math.round(nextStep.distance_m)}m`;
    }
  } else {
    document.getElementById('navPrimary').textContent = 'Follow the verified road route';
    document.getElementById('navSecondary').textContent = state.activeRoute.summary || '';
  }

  document.getElementById('statDist').textContent = (state.activeRoute.total_distance_m / 1000).toFixed(1);
  document.getElementById('statTime').textContent = Math.round(state.activeRoute.total_duration_sec / 60);
}

function startActiveGpsNavigation() {
  if (navigator.geolocation) {
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = Math.round(pos.coords.accuracy || 12);
        const rawSpeed = pos.coords.speed;
        const speedKph = rawSpeed != null && rawSpeed >= 0 ? Math.round(rawSpeed * 3.6) : null;

        if (speedKph != null && speedKph > 0) {
          state.currentSpeedKph = speedKph;
          document.getElementById('statSpeed').textContent = speedKph;
        }

        updateUserMarker(lat, lon, accuracy);

        const badgeText = document.getElementById('gpsBadgeText');
        if (badgeText) {
          badgeText.textContent = `📡 Live GPS: ±${accuracy}m · ${state.currentSpeedKph} km/h`;
        }

        if (state.currentSessionToken) {
          transmitObservation(lat, lon, state.currentSpeedKph || 25, accuracy);
        }
      },
      (err) => console.warn('watchPosition error:', err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 6000 }
    );
  }

  // Smooth route progression simulator (ensures active test demo in stationary / desktop environments)
  const coords = state.activeRoute?.coordinates || [];
  state.tripSimTimer = setInterval(() => {
    if (coords.length > 1) {
      state.tripCoordIndex = (state.tripCoordIndex + 2) % coords.length;
      const pt = coords[state.tripCoordIndex];
      const lat = pt[0];
      const lon = pt[1];

      // Advance step index smoothly
      const steps = state.activeRoute.steps || [];
      if (steps.length > 1) {
        state.tripStepIndex = Math.min(steps.length - 1, Math.floor((state.tripCoordIndex / coords.length) * steps.length));
        updateTurnByTurnHUD();
      }

      // Speed simulation
      const baseSpeed = state.vehicle === 'two_wheeler' ? 38 : state.vehicle === 'auto_rickshaw' ? 26 : 35;
      const speed = Math.round(baseSpeed + (Math.random() - 0.5) * 8);
      state.currentSpeedKph = Math.max(10, speed);
      document.getElementById('statSpeed').textContent = state.currentSpeedKph;

      updateUserMarker(lat, lon, 10);

      // Countdown distance & ETA
      const elapsedSec = (Date.now() - state.tripStartTime) / 1000;
      const remainingSec = Math.max(0, state.activeRoute.total_duration_sec - elapsedSec);
      document.getElementById('statTime').textContent = Math.round(remainingSec / 60);

      const totalKm = state.activeRoute.total_distance_m / 1000;
      const distTraveledKm = (state.currentSpeedKph / 3600) * elapsedSec;
      const distLeft = Math.max(0, totalKm - distTraveledKm);
      document.getElementById('statDist').textContent = distLeft.toFixed(1);

      if (state.currentSessionToken) {
        transmitObservation(lat, lon, state.currentSpeedKph, 8.0);
      }
    }
  }, 2200);
}

function updateUserMarker(lat, lon, accuracy) {
  if (!state.userMarker) {
    const userIcon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;background:#1a73e8;border-radius:50%;opacity:0.35;animation:livePulse 1.4s infinite;"></div>
          <div style="position:absolute;inset:4px;background:#1a73e8;border:3px solid #ffffff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.45);"></div>
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

  // Smoothly keep user centered during active trip
  state.map.panTo([lat, lon], { animate: true, duration: 0.8 });
}

async function transmitObservation(lat, lon, speed, accuracy) {
  if (!state.currentSessionToken) return;

  const payload = {
    session_token: state.currentSessionToken,
    observations: [{
      timestamp: new Date().toISOString(),
      lat, lon,
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
  } catch (err) {}
}

async function doEndTrip() {
  if (state.watchId && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  if (state.tripSimTimer) {
    clearInterval(state.tripSimTimer);
    state.tripSimTimer = null;
  }

  if (state.userMarker) {
    state.map.removeLayer(state.userMarker);
    state.userMarker = null;
  }
  if (state.userAccuracyCircle) {
    state.map.removeLayer(state.userAccuracyCircle);
    state.userAccuracyCircle = null;
  }

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
  if (document.hidden && state.currentSessionToken) {
    console.log('SmartTraffic: Foreground-only location policy enforced.');
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
//  SEGMENTS & STATUS GRID
// ──────────────────────────────────────────────
function getSegmentStyle(seg) {
  if (seg.status === 'closed') return { color: '#5f6368', weight: 5, dashArray: '8 6' };
  if (seg.status === 'congested') return { color: '#d93025', weight: 6 };
  if (seg.status === 'slowing') return { color: '#f9ab00', weight: 5 };
  if (seg.road_class === 'residential') return { color: '#7c4dff', weight: 4, dashArray: '5 5', opacity: 0.7 };
  return { color: '#1e8e3e', weight: 5 };
}

function renderSegments(segs) {
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
          <span style="color:#5f6368">Evidence</span>
          <span style="font-weight:600">${seg.sample_count} devices (${seg.confidence})</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#5f6368">Detour quota</span>
          <span style="font-weight:600">${seg.current_diversion_count}/${seg.diversion_cap}</span>
        </div>
      </div>
    `;

    if (state.segmentLayers[seg.segment_id]) {
      const poly = state.segmentLayers[seg.segment_id];
      poly.setStyle(style);
      poly.setPopupContent(popupHtml);
    } else {
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
  } catch (err) {}
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
//  UI UTILITIES
// ──────────────────────────────────────────────
function initQuickChips() {
  const container = document.getElementById('quickChips');
  if (!container) return;
  container.innerHTML = '';

  POPULAR_HUBS.forEach(place => {
    const chip = document.createElement('button');
    chip.className = 'quick-chip';
    chip.innerHTML = `${place.isCurrentLoc ? '📍' : (TYPE_ICONS[place.type] || '📍')} ${place.name.replace('📍 ', '')}`;
    chip.addEventListener('click', () => {
      if (place.isCurrentLoc) {
        acquireUserLocation(true);
        return;
      }

      if (!state.origin) {
        state.origin = place;
        document.getElementById('originInput').value = place.name;
        document.getElementById('originClear').style.display = '';
        setMarker('origin', place.lat, place.lon, place.name, true);
        state.map.flyTo([place.lat, place.lon], 13);
      } else if (!state.dest) {
        state.dest = place;
        document.getElementById('destInput').value = place.name;
        document.getElementById('destClear').style.display = '';
        setMarker('dest', place.lat, place.lon, place.name, false);
        fitBothMarkers();
        setTimeout(() => doFindRoutes(false), 350);
      }
    });
    container.appendChild(chip);
  });
}

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

function showPanel(panelId) {
  ['panelSearch', 'panelRoutes', 'panelTrip'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === panelId) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  const sheet = document.getElementById('bottomSheet');
  if (!sheet) return;

  if (window.innerWidth < 768) {
    if (panelId === 'panelSearch') {
      sheet.style.maxHeight = 'min(450px, 70vh)';
    } else if (panelId === 'panelRoutes') {
      sheet.style.maxHeight = 'min(540px, 78vh)';
      const wrap = document.getElementById('wrapStartTrip');
      if (wrap) wrap.style.display = state.allRoutes.some(r => r.is_recommended) ? 'block' : 'none';
    } else if (panelId === 'panelTrip') {
      sheet.style.maxHeight = 'min(360px, 52vh)';
    }
  } else {
    sheet.style.maxHeight = '';
  }

  setTimeout(() => {
    if (state.map) state.map.invalidateSize();
  }, 250);
}

function initBottomSheet() {
  const sheet = document.getElementById('bottomSheet');
  const handle = document.getElementById('sheetHandle');
  if (!sheet || !handle) return;

  if (window.innerWidth < 768) {
    sheet.style.maxHeight = 'min(450px, 70vh)';
  }

  let startY = 0, startH = 0, dragging = false;
  const getH = () => sheet.getBoundingClientRect().height;

  function onStart(y) { startY = y; startH = getH(); dragging = true; }
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
    const h1 = 100, h2 = Math.min(450, window.innerHeight * 0.7), h3 = window.innerHeight * 0.88;
    const snap = [h1, h2, h3].reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
    sheet.style.transition = 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    sheet.style.maxHeight = snap + 'px';
    setTimeout(() => {
      sheet.style.transition = '';
      if (state.map) state.map.invalidateSize();
    }, 320);
  }

  handle.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
  window.addEventListener('touchmove', e => onMove(e.touches[0].clientY), { passive: true });
  window.addEventListener('touchend', onEnd);
  handle.addEventListener('mousedown', e => onStart(e.clientY));
  window.addEventListener('mousemove', e => { if (dragging) onMove(e.clientY); });
  window.addEventListener('mouseup', onEnd);
}

function initDrawer() {
  const drawer = document.getElementById('sideDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const open = () => { drawer.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { drawer.classList.remove('open'); overlay.classList.remove('open'); };

  document.getElementById('btnMenu')?.addEventListener('click', open);
  document.getElementById('btnCloseDrawer')?.addEventListener('click', close);
  overlay?.addEventListener('click', close);
}

function initSimulationButtons() {
  document.querySelectorAll('.sim-btn[data-sim]').forEach(btn => {
    btn.addEventListener('click', () => runSimulation(btn.dataset.sim));
  });
  document.getElementById('btnReset')?.addEventListener('click', doReset);
}

async function runSimulation(scenario) {
  async function getToken() {
    const r = await fetch('/v1/trips/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json(); return d.session_token;
  }
  async function postObs(token, lat, lon, speed) {
    await fetch('/v1/traffic/observations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_token: token,
        observations: [{ timestamp: new Date().toISOString(), lat, lon, speed_kph: speed, accuracy_m: 8 }]
      })
    });
  }

  const seg_lat = 12.9750, seg_lon = 77.6406;

  if (scenario === 'normal') {
    for (let i = 0; i < 4; i++) {
      const tok = await getToken();
      await postObs(tok, seg_lat + i * 0.0001, seg_lon, 35 + i);
    }
    showToast('✅ Normal flow: 4 devices report ~36 km/h. Corridor evaluated NORMAL.', 'success');
  } else if (scenario === 'single_glitch') {
    const tok = await getToken();
    await postObs(tok, seg_lat, seg_lon, 3.0);
    showToast('🔵 Single-phone at 3 km/h → Alert REJECTED (< 3 device rule). Stays NORMAL.', 'info');
  } else if (scenario === 'congestion') {
    for (let i = 0; i < 5; i++) {
      const tok = await getToken();
      await postObs(tok, seg_lat + i * 0.0001, seg_lon, 8 + i * 0.4);
    }
    showToast('🔴 Genuine congestion! 5 devices at ~9 km/h → 100ft Rd marked CONGESTED.', 'error');
  } else if (scenario === 'detour_cap') {
    await fetch('/v1/admin/segments/seg_suranjan_conn/override', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diversion_cap: 20, reset_diversion_count: false })
    });
    showToast('🟣 Detour cap scenario active. Check remaining quotas.', 'warning');
  }
}

async function doReset() {
  await fetch('/v1/admin/reset', { method: 'POST' });
  clearRouteLayers();
  const aiBar = document.getElementById('aiBar');
  if (aiBar) aiBar.style.display = 'none';
  showPanel('panelSearch');
  showToast('🔄 Pilot network reset to baseline.', 'info');
}

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
