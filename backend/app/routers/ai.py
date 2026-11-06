import os
import httpx
import json
import re
from typing import Optional, List
from fastapi import APIRouter
from pydantic import BaseModel
from app.services.road_network import road_network

router = APIRouter(prefix="/v1/ai", tags=["ai-insights"])

class AIInsightRequest(BaseModel):
    origin_name: str = ""
    destination_name: str = ""
    vehicle_profile: str = "car"
    route_summary: Optional[str] = None

class AIInsightResponse(BaseModel):
    summary: str
    smart_tip: str
    congestion_forecast: str
    safety_score: str
    estimated_eta: str

class PlaceResult(BaseModel):
    name: str
    lat: float
    lon: float
    type: str
    display: str

# ─────────────────────────────────────────────────────
#  REAL PLACE SEARCH  —  Hybrid Multi-Provider Geocoding
#  Photon (Komoot) + OpenStreetMap Nominatim
#  Instant worldwide & India autocomplete, zero rate-limit, GPS-biased.
# ─────────────────────────────────────────────────────
_SEARCH_CACHE = {}

@router.get("/places/search")
async def search_places(
    q: str = "",
    limit: int = 10,
    lat: Optional[float] = None,
    lon: Optional[float] = None
) -> List[dict]:
    """
    High-speed, comprehensive place search powered by Photon (OSM) with Nominatim fallback.
    Supports city names, street names, landmarks, POIs, airports, railway stations across India and worldwide.
    """
    cleaned = (q or "").strip()
    if not cleaned or len(cleaned) < 2:
        return _get_pilot_presets()[:8]

    cache_key = f"{cleaned.lower()}_{round(lat, 2) if lat else None}_{round(lon, 2) if lon else None}_{limit}"
    if cache_key in _SEARCH_CACHE:
        return _SEARCH_CACHE[cache_key]

    results = []

    # 1. Primary: Photon API (Fast, no strict rate limit, supports lat/lon proximity bias)
    try:
        photon_params = {
            "q": cleaned,
            "limit": limit,
            "lang": "en"
        }
        if lat is not None and lon is not None:
            photon_params["lat"] = lat
            photon_params["lon"] = lon

        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://photon.komoot.io/api/",
                params=photon_params,
                headers={"User-Agent": "SmartTrafficNavigationPlatform/2.0"}
            )
            if resp.status_code == 200:
                data = resp.json()
                features = data.get("features", [])
                for feat in features:
                    props = feat.get("properties", {})
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    if len(coords) < 2:
                        continue
                    p_lon, p_lat = float(coords[0]), float(coords[1])

                    name = props.get("name") or props.get("street") or props.get("city") or cleaned.title()
                    
                    # Construct clean hierarchy
                    locality_parts = [
                        props.get("street"),
                        props.get("district") or props.get("locality"),
                        props.get("city"),
                        props.get("state"),
                        props.get("country")
                    ]
                    display = ", ".join([p for p in locality_parts if p and p != name])
                    if not display:
                        display = props.get("country", "India")

                    osm_val = props.get("osm_value") or props.get("osm_key") or props.get("type", "place")
                    ptype = "place"
                    if osm_val in ["aeroway", "aerodrome", "airport"]:
                        ptype = "transit"
                    elif osm_val in ["station", "railway", "train_station", "halt"]:
                        ptype = "transit"
                    elif osm_val in ["hospital", "clinic", "doctors"]:
                        ptype = "landmark"
                    elif osm_val in ["mall", "supermarket", "marketplace"]:
                        ptype = "landmark"
                    elif osm_val in ["motorway", "trunk", "primary", "secondary", "highway"]:
                        ptype = "road"
                    elif osm_val in ["city", "town", "village", "suburb"]:
                        ptype = "city"

                    results.append({
                        "name": name,
                        "lat": p_lat,
                        "lon": p_lon,
                        "type": ptype,
                        "display": f"{name}, {display}" if display else name
                    })

                if results:
                    _SEARCH_CACHE[cache_key] = results[:limit]
                    return results[:limit]
    except Exception:
        pass

    # 2. Secondary: OpenStreetMap Nominatim
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            nom_params = {
                "q": cleaned,
                "format": "json",
                "limit": limit,
                "addressdetails": 1,
                "accept-language": "en"
            }
            if lat is not None and lon is not None:
                # viewbox around user's location
                d = 0.8
                nom_params["viewbox"] = f"{lon-d},{lat+d},{lon+d},{lat-d}"

            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params=nom_params,
                headers={"User-Agent": "SmartTrafficNavigationPlatform/2.0"}
            )
            if resp.status_code == 200:
                data = resp.json()
                for item in data:
                    display_name = item.get("display_name", "")
                    parts = [p.strip() for p in display_name.split(",") if p.strip()]
                    short_title = ", ".join(parts[:2]) if len(parts) >= 2 else display_name
                    full_sub = ", ".join(parts[:5]) if len(parts) >= 3 else display_name

                    results.append({
                        "name": short_title,
                        "lat": float(item["lat"]),
                        "lon": float(item["lon"]),
                        "type": item.get("type", "place"),
                        "display": full_sub
                    })

                if results:
                    _SEARCH_CACHE[cache_key] = results[:limit]
                    return results[:limit]
    except Exception:
        pass

    # 3. Fallback: Filtered Pilot Presets
    presets = _get_pilot_presets_filtered(cleaned)
    return presets if presets else _get_pilot_presets()[:limit]

def _get_pilot_presets():
    return [
        {"name": "CMH Road Junction", "lat": 12.9784, "lon": 77.6408, "type": "junction", "display": "CMH Road, Indiranagar, Bengaluru, Karnataka"},
        {"name": "100 Feet Road, Indiranagar", "lat": 12.9750, "lon": 77.6407, "type": "road", "display": "100 Feet Road, Indiranagar, Bengaluru, Karnataka"},
        {"name": "Domlur Flyover", "lat": 12.9610, "lon": 77.6385, "type": "landmark", "display": "Domlur Flyover, Old Airport Road, Bengaluru"},
        {"name": "Sony World Junction", "lat": 12.9352, "lon": 77.6245, "type": "junction", "display": "Sony World Junction, 80ft Road, Koramangala, Bengaluru"},
        {"name": "Kempegowda International Airport", "lat": 13.1986, "lon": 77.7066, "type": "transit", "display": "BLR Airport, Devanahalli, Bengaluru, Karnataka"},
        {"name": "Embassy Golf Links (EGL)", "lat": 12.9515, "lon": 77.6360, "type": "landmark", "display": "Embassy Golf Links Business Park, IRR, Bengaluru"},
        {"name": "MG Road Metro Station", "lat": 12.9756, "lon": 77.6066, "type": "transit", "display": "Mahatma Gandhi Road, Bengaluru, Karnataka"},
        {"name": "Whitefield ITPL", "lat": 12.9863, "lon": 77.7381, "type": "area", "display": "International Tech Park Bangalore (ITPL), Whitefield"},
        {"name": "Kakinada", "lat": 16.9891, "lon": 82.2475, "type": "place", "display": "Kakinada, Andhra Pradesh, India"},
        {"name": "Rajahmundry", "lat": 17.0005, "lon": 81.8040, "type": "place", "display": "Rajahmundry, East Godavari, Andhra Pradesh"},
        {"name": "Vijayawada", "lat": 16.5062, "lon": 80.6480, "type": "place", "display": "Vijayawada, Andhra Pradesh, India"},
        {"name": "Hyderabad", "lat": 17.3850, "lon": 78.4867, "type": "place", "display": "Hyderabad, Telangana, India"},
        {"name": "Solapur", "lat": 17.6599, "lon": 75.9064, "type": "place", "display": "Solapur, Maharashtra, India"},
        {"name": "Mysuru (Mysore)", "lat": 12.2958, "lon": 76.6394, "type": "place", "display": "Mysuru, Karnataka, India"},
    ]

def _get_pilot_presets_filtered(q: str) -> List[dict]:
    q_lower = q.lower()
    return [p for p in _get_pilot_presets() if q_lower in p["name"].lower() or q_lower in p["display"].lower()][:8]

# ─────────────────────────────────────────────────────
#  REVERSE GEOCODING  —  lat/lon → address name
#  Hybrid Photon + Nominatim
# ─────────────────────────────────────────────────────
_REVERSE_CACHE = {}

@router.get("/places/reverse")
async def reverse_geocode(lat: float, lon: float) -> dict:
    """Convert GPS coordinates to a human-readable place name using Photon and Nominatim."""
    cache_key = f"{round(lat, 4)}_{round(lon, 4)}"
    if cache_key in _REVERSE_CACHE:
        return _REVERSE_CACHE[cache_key]

    # 1. Primary: Photon reverse
    try:
        async with httpx.AsyncClient(timeout=3.5) as client:
            resp = await client.get(
                "https://photon.komoot.io/reverse",
                params={"lat": lat, "lon": lon},
                headers={"User-Agent": "SmartTrafficNavigationPlatform/2.0"}
            )
            if resp.status_code == 200:
                data = resp.json()
                feats = data.get("features", [])
                if feats:
                    props = feats[0].get("properties", {})
                    name = props.get("name") or props.get("street")
                    loc_parts = [
                        props.get("street"),
                        props.get("district") or props.get("locality"),
                        props.get("city") or props.get("county"),
                        props.get("state")
                    ]
                    full = ", ".join([p for p in loc_parts if p])
                    final_name = name or props.get("city") or props.get("locality") or f"{lat:.4f}, {lon:.4f}"
                    res = {
                        "name": final_name,
                        "lat": lat,
                        "lon": lon,
                        "full": f"{final_name}, {full}" if full and final_name not in full else (full or final_name)
                    }
                    _REVERSE_CACHE[cache_key] = res
                    return res
    except Exception:
        pass

    # 2. Secondary: Nominatim reverse
    try:
        async with httpx.AsyncClient(timeout=3.5) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "accept-language": "en"},
                headers={"User-Agent": "SmartTrafficNavigationPlatform/2.0"}
            )
            if resp.status_code == 200:
                data = resp.json()
                addr = data.get("address", {})
                parts = [
                    addr.get("road") or addr.get("pedestrian") or addr.get("footway"),
                    addr.get("suburb") or addr.get("neighbourhood"),
                    addr.get("city_district") or addr.get("city"),
                ]
                name = ", ".join(p for p in parts if p)
                res = {
                    "name": name or data.get("display_name", f"{lat:.4f}, {lon:.4f}"),
                    "lat": lat, "lon": lon,
                    "full": data.get("display_name", "")
                }
                _REVERSE_CACHE[cache_key] = res
                return res
    except Exception:
        pass

    fallback_res = {"name": f"{lat:.4f}, {lon:.4f}", "lat": lat, "lon": lon, "full": ""}
    _REVERSE_CACHE[cache_key] = fallback_res
    return fallback_res

# ─────────────────────────────────────────────────────
#  AI ROUTE INSIGHT  —  Gemini or smart fallback
# ─────────────────────────────────────────────────────
@router.post("/route-insight", response_model=AIInsightResponse)
async def get_ai_route_insight(req: AIInsightRequest):
    """Gemini AI generates natural-language smart insights for the selected route."""
    segments = list(road_network.segments.values())
    congested = [s for s in segments if s.status.value == "congested"]
    slowing = [s for s in segments if s.status.value == "slowing"]

    context = f"""You are a smart urban traffic AI assistant for Bengaluru, India.

Live pilot corridor status right now:
- {len(congested)} segments congested: {[s.name for s in congested] or 'None'}
- {len(slowing)} segments slowing: {[s.name for s in slowing] or 'None'}
- Route: {req.origin_name} → {req.destination_name}
- Vehicle: {req.vehicle_profile}

Generate a JSON response with EXACTLY these keys (pure JSON, no markdown):
{{
  "summary": "One sentence describing current route condition",
  "smart_tip": "One specific, actionable tip for this route right now",
  "congestion_forecast": "Brief forecast for next 20-30 minutes",
  "safety_score": "Score like 8/10 with brief reason",
  "estimated_eta": "ETA estimate like 14-18 mins"
}}"""

    try:
        import google.genai as genai
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("No API key set")
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model="gemini-2.0-flash", contents=context)
        text = response.text.strip()
        text = re.sub(r"```json\s*|\s*```", "", text).strip()
        data = json.loads(text)
        return AIInsightResponse(**data)
    except Exception:
        # Context-aware intelligent fallback
        if congested:
            names = " and ".join(s.name.split("(")[0].strip() for s in congested[:2])
            return AIInsightResponse(
                summary=f"Congestion on {names}. Best to use the bypass route.",
                smart_tip=f"Leave now via Suranjan Das bypass to save 8-14 mins. Avoid {congested[0].name.split('(')[0]}.",
                congestion_forecast="Congestion likely to persist 20-30 more mins based on evening peak patterns.",
                safety_score="5/10 — Heavy congestion on primary corridor",
                estimated_eta="20-28 mins via bypass · 35-45 mins on main road"
            )
        elif slowing:
            return AIInsightResponse(
                summary=f"Traffic slowing on {slowing[0].name.split('(')[0]}. 20% slower than usual.",
                smart_tip="Start your trip now before peak worsens. All verified bypasses still have capacity.",
                congestion_forecast="Likely to ease in 15-20 mins as evening peak gradually drops.",
                safety_score="7/10 — Moderate slowdown, manageable",
                estimated_eta="16-22 mins via primary corridor"
            )
        return AIInsightResponse(
            summary=f"Clear roads from {req.origin_name or 'origin'} to {req.destination_name or 'destination'}.",
            smart_tip="Great conditions! All verified corridors flowing normally. Ideal time to travel.",
            congestion_forecast="Traffic expected clear for next 25-30 mins.",
            safety_score="9/10 — Excellent conditions",
            estimated_eta="12-16 mins via primary corridor"
        )

# ─────────────────────────────────────────────────────
#  LIVE TRAFFIC SUMMARY
# ─────────────────────────────────────────────────────
@router.get("/traffic-summary")
async def get_traffic_summary():
    """Live summary of entire pilot corridor status."""
    from app.services.congestion import congestion_engine
    congestion_engine.evaluate_all()

    segments = list(road_network.segments.values())
    total = len(segments)
    congested = sum(1 for s in segments if s.status.value == "congested")
    slowing = sum(1 for s in segments if s.status.value == "slowing")
    normal = total - congested - slowing
    pct_clear = round((normal / total) * 100) if total else 100

    if congested >= 2:
        level, color, emoji = "Heavy", "#d93025", "🔴"
    elif congested >= 1 or slowing >= 3:
        level, color, emoji = "Moderate", "#f9ab00", "🟡"
    else:
        level, color, emoji = "Light", "#1e8e3e", "🟢"

    return {
        "overall_level": level, "color": color, "emoji": emoji,
        "pct_clear": pct_clear, "congested_count": congested,
        "slowing_count": slowing, "normal_count": normal,
        "total_segments": total, "timestamp": "Live"
    }
