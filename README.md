# Smart Traffic Routing MVP (Privacy-First)

> A privacy-first smart traffic routing MVP for Android targeting urban Indian pilot corridors (Bengaluru Indiranagar – Koramangala corridor).

## Core Principles
1. **Evidence-Based Congestion**: No single device can trigger a congestion alert. Multi-contributor agreement (>= 3 independent active trips) across time windows is required.
2. **Safe Detour Diversion Budgets**: Avoids sending hundreds of drivers into narrow residential cross streets. Enforces per-segment diversion caps.
3. **Strict Privacy & Lifecycle**:
   - Foreground-only location (`ACCESS_FINE_LOCATION`).
   - Zero background location polling or services.
   - Raw coordinates map-matched in volatile memory and expired immediately.
   - Immediate session invalidation upon user ending trip or dismissing app.
   - Zero third-party ad/tracking/analytics SDKs.

## Project Structure
- `backend/`: FastAPI application, road network graph, congestion detection engine, safe routing with diversion budgets, and REST API.
- `android/`: Kotlin + Jetpack Compose Android client with foreground-only location lifecycle, trip controls, route comparison, and consent screen.
- `simulation/`: Realistic synthetic multi-vehicle traffic simulator demonstrating normal flow, genuine multi-vehicle congestion, detour diversion capping, and stale data expiry.
- `backend/tests/`: Comprehensive test suite testing all algorithmic rules, privacy guarantees, and API endpoints.

## Running the Backend & Interactive Ops Dashboard
```bash
cd backend
python -m pip install -r requirements.txt
python run_server.py
```
Open your browser at `http://localhost:8000` to interact with the Live Road Map, trigger multi-device traffic simulations, and test route queries.

## Running the Test Suite
```bash
cd backend
pytest -v
```

