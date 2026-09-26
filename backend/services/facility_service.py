import json
import os
import math
import logging
from typing import List, Dict, Any
from db.supabase_client import supabase_service

logger = logging.getLogger(__name__)

# Basic in-memory cache to prevent downloading all facilities constantly
_cached_facilities: List[Dict[str, Any]] = []

def _load_fallback_facilities() -> List[Dict[str, Any]]:
    try:
        json_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'india_industrial_facilities.json')
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                logger.info(f"Loaded {len(data)} offline industrial facilities from JSON.")
                return data
    except Exception as e:
        logger.error(f'Error loading offline facilities JSON: {e}')
    return []

def _get_all_facilities() -> List[Dict[str, Any]]:
    global _cached_facilities
    if _cached_facilities:
        return _cached_facilities
        
    combined: Dict[str, Dict[str, Any]] = {}
    for f in _load_fallback_facilities():
        combined[f['name'].lower()] = f

    try:
        res = supabase_service.table('industrial_facilities').select('*').execute()
        if res and res.data:
            for r in res.data:
                combined[r['name'].lower()] = r
    except Exception as e:
        logger.error(f'Error fetching facilities from Supabase: {e}')
    
    _cached_facilities = list(combined.values())
    return _cached_facilities

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000  # radius of Earth in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2.0)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def find_nearby_facilities(lat: float, lon: float, radius_m: int = 1000) -> List[Dict[str, Any]]:
    facilities = _get_all_facilities()
    if not facilities:
        return []
        
    nearby = []
    all_with_dist = []
    for fac in facilities:
        dist = haversine_distance(lat, lon, fac['latitude'], fac['longitude'])
        actual_dist = round(dist, 2)
        item = {
            'name': fac['name'],
            'type': fac['type'],
            'latitude': fac['latitude'],
            'longitude': fac['longitude'],
            'distance_m': actual_dist
        }
        all_with_dist.append((dist, item))
        if dist <= radius_m:
            nearby.append(item)
            
    if nearby:
        nearby.sort(key=lambda x: x['distance_m'])
        return nearby

    return []

