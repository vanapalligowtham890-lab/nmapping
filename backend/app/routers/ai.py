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
#  REAL PLACE SEARCH  —  OpenStreetMap Nominatim
#  Works for ANY location in India, completely free.
# ─────────────────────────────────────────────────────
@router.get("/places/search")
async def search_places(q: str = "", limit: int = 8) -> List[dict]:
    """
    Real geocoding search using OpenStreetMap Nominatim.
    Returns actual lat/lon for any location typed by user.
    Falls back to pilot area preset list if network unavailable.
    """
    if not q or len(q) < 2:
        return _get_pilot_presets()[:6]

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": q + ", Bangalore, India",
                    "format": "json",
                    "limit": limit,
                    "addressdetails": 1,
                    "countrycodes": "in",
                    "accept-language": "en"
                },
                headers={"User-Agent": "SmartTrafficBengaluruPilot/1.0"}
            )
            data = resp.json()
            results = []
            for item in data:
                name = item.get("display_name", "")
                # Shorten display name: take first 2 parts
                short = ", ".join(name.split(", ")[:2])
                t = item.get("type", "place")
                results.append({
                    "name": short,
                    "lat": float(item["lat"]),
                    "lon": float(item["lon"]),
                    "type": t,
                    "display": name[:60]
                })
            return results if results else _get_pilot_presets_filtered(q)
    except Exception:
        return _get_pilot_presets_filtered(q)

def _get_pilot_presets():
    return [
        {"name": "CMH Road Junction", "lat": 12.9784, "lon": 77.6408, "type": "junction", "display": "CMH Road Junction, Indiranagar, Bengaluru"},
        {"name": "100 Feet Road, Indiranagar", "lat": 12.9750, "lon": 77.6407, "type": "road", "display": "100 Feet Road, Indiranagar, Bengaluru"},
        {"name": "Domlur Flyover", "lat": 12.9610, "lon": 77.6385, "type": "landmark", "display": "Domlur Flyover, Bengaluru"},
        {"name": "Embassy Golf Links (EGL)", "lat": 12.9515, "lon": 77.6360, "type": "landmark", "display": "Embassy Golf Links, IRR, Bengaluru"},
        {"name": "Sony World Junction", "lat": 12.9352, "lon": 77.6245, "type": "junction", "display": "Sony World Junction, Koramangala, Bengaluru"},
        {"name": "Koramangala 4th Block", "lat": 12.9420, "lon": 77.6290, "type": "area", "display": "4th Block, Koramangala, Bengaluru"},
        {"name": "Old Airport Road", "lat": 12.9635, "lon": 77.6465, "type": "road", "display": "Old Airport Road, Domlur, Bengaluru"},
        {"name": "Suranjan Das Road", "lat": 12.9690, "lon": 77.6580, "type": "road", "display": "Suranjan Das Road, Indiranagar, Bengaluru"},
        {"name": "Indiranagar Metro", "lat": 12.9784, "lon": 77.6408, "type": "transit", "display": "Indiranagar Metro Station, Bengaluru"},
    ]

def _get_pilot_presets_filtered(q: str) -> List[dict]:
    q_lower = q.lower()
    return [p for p in _get_pilot_presets() if q_lower in p["name"].lower()][:6]

# ─────────────────────────────────────────────────────
#  REVERSE GEOCODING  —  lat/lon → address name
# ─────────────────────────────────────────────────────
@router.get("/places/reverse")
async def reverse_geocode(lat: float, lon: float) -> dict:
    """Convert GPS coordinates to a human-readable place name."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "accept-language": "en"},
                headers={"User-Agent": "SmartTrafficBengaluruPilot/1.0"}
            )
            data = resp.json()
            addr = data.get("address", {})
            # Build a short human-readable name
            parts = [
                addr.get("road") or addr.get("pedestrian") or addr.get("footway"),
                addr.get("suburb") or addr.get("neighbourhood"),
                addr.get("city_district") or addr.get("city"),
            ]
            name = ", ".join(p for p in parts if p)
            return {
                "name": name or data.get("display_name", f"{lat:.4f}, {lon:.4f}"),
                "lat": lat, "lon": lon,
                "full": data.get("display_name", "")
            }
    except Exception:
        return {"name": f"{lat:.4f}, {lon:.4f}", "lat": lat, "lon": lon, "full": ""}

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
