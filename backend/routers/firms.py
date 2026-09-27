from fastapi import APIRouter, Query, Request
from typing import List, Dict, Any
from services.firms_service import fetch_realtime_hotspots, fetch_area_hotspots
from models.hotspot import FIRMSHotspot, HotspotGeoJSON
from limiter import limiter

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/firms", tags=["FIRMS Data"])

def to_geojson(hotspots: List[FIRMSHotspot]) -> Dict[str, Any]:
    features = []
    for h in hotspots:
        try:
            props = h.model_dump(exclude={'latitude', 'longitude'}) if hasattr(h, 'model_dump') else h.dict(exclude={'latitude', 'longitude'})
        except Exception:
            props = {k: v for k, v in h.__dict__.items() if k not in ('latitude', 'longitude')}
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [h.longitude, h.latitude]
            },
            "properties": props
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
    try:
        hotspots = await fetch_realtime_hotspots(country, days, source)
        return to_geojson(hotspots)
    except Exception as e:
        logger.error(f"Error in /firms/realtime: {e}", exc_info=True)
        return {"type": "FeatureCollection", "features": []}

@router.get("/area")
@limiter.limit("60/minute")
async def get_area(
    request: Request,
    bbox: str = Query(..., description="Bounding box (W,S,E,N)"),
    days: int = Query(1, description="Number of days"),
    source: str = Query("ALL", description="FIRMS Source")
):
    try:
        hotspots = await fetch_area_hotspots(bbox, days, source)
        return to_geojson(hotspots)
    except Exception as e:
        logger.error(f"Error in /firms/area: {e}", exc_info=True)
        return {"type": "FeatureCollection", "features": []}
