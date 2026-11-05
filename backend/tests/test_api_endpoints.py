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
