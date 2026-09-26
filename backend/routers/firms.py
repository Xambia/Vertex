from fastapi import APIRouter, Query, Request
from typing import List, Dict, Any
from services.firms_service import fetch_realtime_hotspots, fetch_area_hotspots
from models.hotspot import FIRMSHotspot, HotspotGeoJSON
from limiter import limiter

router = APIRouter(prefix="/firms", tags=["FIRMS Data"])

def to_geojson(hotspots: List[FIRMSHotspot]) -> Dict[str, Any]:
    features = []
    for h in hotspots:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [h.longitude, h.latitude]
            },
            "properties": h.dict(exclude={'latitude', 'longitude'})
        })
    return {
        "type": "FeatureCollection",
        "features": features
    }

@router.get("/realtime")
@limiter.limit("60/minute")
async def get_realtime(
    request: Request,
    country: str = Query("IND", description="Country Code"),
    days: int = Query(1, description="Number of days"),
    source: str = Query("ALL", description="FIRMS Source")
):
    hotspots = await fetch_realtime_hotspots(country, days, source)
    return to_geojson(hotspots)

@router.get("/area")
@limiter.limit("60/minute")
async def get_area(
    request: Request,
    bbox: str = Query(..., description="Bounding box (W,S,E,N)"),
    days: int = Query(1, description="Number of days"),
    source: str = Query("ALL", description="FIRMS Source")
):
    hotspots = await fetch_area_hotspots(bbox, days, source)
    return to_geojson(hotspots)
