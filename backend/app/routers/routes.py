from fastapi import APIRouter
from app.models.routing import RouteRequest, RouteResponse
from app.services.routing import routing_engine

router = APIRouter(prefix="/v1/routes", tags=["routes"])

@router.post("/alternatives", response_model=RouteResponse)
async def get_route_alternatives(request: RouteRequest):
    """
    Evaluates candidate routes using origin, destination, and vehicle profile.
    Applies hard constraints (road suitability, vehicle limits, residential protection)
    and checks detour diversion budgets to prevent shifting jams into neighborhoods.
    """
    return routing_engine.find_routes(request)
