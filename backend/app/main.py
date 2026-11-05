import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routers import traffic, routes, trips, admin, ai
from app.ws.router import router as ws_router

app = FastAPI(
    title="Smart Traffic Routing API",
    description="Privacy-first, evidence-based urban congestion sensing and safe detour routing MVP.",
    version="1.0.0"
)

# CORS middleware for local web UI & Android emulator access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(traffic.router)
app.include_router(routes.router)
app.include_router(trips.router)
app.include_router(admin.router)
app.include_router(ai.router)
app.include_router(ws_router)

# Mount static directory for interactive Web Map & Simulation Dashboard
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", include_in_schema=False)
async def root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "title": "Smart Traffic Routing API",
        "status": "online",
        "docs_url": "/docs",
        "endpoints": [
            "/v1/traffic/observations",
            "/v1/traffic/segments",
            "/v1/routes/alternatives",
            "/v1/trips/start",
            "/v1/trips/end",
            "/v1/admin/segments"
        ]
    }

