from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_api_trips_flow():
    # 1. Start Trip
    resp_start = client.post("/v1/trips/start", json={"vehicle_profile": "car"})
    assert resp_start.status_code == 200
    data_start = resp_start.json()
    assert "session_token" in data_start
    token = data_start["session_token"]
    assert data_start["consent_ack"] is True

    # 2. Ingest observation with token
    obs_payload = {
        "session_token": token,
        "observations": [
            {
                "timestamp": "2026-11-05T07:15:00Z",
                "lat": 12.9716,
                "lon": 77.6405,
                "speed_kph": 30.0,
                "accuracy_m": 8.5
            }
        ]
    }
    resp_obs = client.post("/v1/traffic/observations", json=obs_payload)
    assert resp_obs.status_code == 200
    data_obs = resp_obs.json()
    assert data_obs["accepted"] == 1

    # 3. Request route alternatives
    route_req = {
        "origin": {"lat": 12.9784, "lon": 77.6408},
        "destination": {"lat": 12.9352, "lon": 77.6245},
        "vehicle_profile": "car",
        "avoid_residential_shortcuts": True
    }
    resp_routes = client.post("/v1/routes/alternatives", json=route_req)
    assert resp_routes.status_code == 200
    data_routes = resp_routes.json()
    assert len(data_routes["routes"]) >= 1

    # 4. End Trip
    resp_end = client.post("/v1/trips/end", json={"session_token": token})
    assert resp_end.status_code == 200
    assert resp_end.json()["status"] == "terminated"

    # 5. Subsequent observation rejected
    resp_post_end = client.post("/v1/traffic/observations", json=obs_payload)
    assert resp_post_end.status_code == 403

def test_traffic_segments_endpoint():
    resp = client.get("/v1/traffic/segments")
    assert resp.status_code == 200
    segments = resp.json()
    assert len(segments) > 0
    assert any(s["segment_id"] == "seg_100ft_south" for s in segments)

def test_ai_traffic_summary_endpoint():
    resp = client.get("/v1/ai/traffic-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "overall_level" in data
    assert "pct_clear" in data
    assert data["total_segments"] > 0

def test_places_search_endpoint():
    # Empty query returns pilot presets
    resp = client.get("/v1/ai/places/search?q=")
    assert resp.status_code == 200
    places = resp.json()
    assert len(places) > 0
    assert any("100 Feet Road" in p["name"] or "Indiranagar" in p["display"] for p in places)

def test_places_reverse_endpoint():
    resp = client.get("/v1/ai/places/reverse?lat=12.9750&lon=77.6407")
    assert resp.status_code == 200
    data = resp.json()
    assert "name" in data
    assert "lat" in data
    assert "lon" in data

def test_ai_route_insight_endpoint():
    req = {
        "origin_name": "CMH Road",
        "destination_name": "Sony World",
        "vehicle_profile": "car"
    }
    resp = client.post("/v1/ai/route-insight", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "smart_tip" in data
    assert "safety_score" in data

def test_websocket_traffic_stream():
    with client.websocket_connect("/ws/traffic") as ws:
        # Upon connect, immediate traffic snapshot is received
        data = ws.receive_json()
        assert data["type"] == "traffic_update"
        assert "segments" in data
        assert len(data["segments"]) > 0
        assert "summary" in data

        # Send ping, receive pong
        ws.send_json({"type": "ping"})
        pong = ws.receive_json()
        assert pong["type"] == "pong"


