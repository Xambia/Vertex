import math
from typing import List, Dict, Any
from db.supabase_client import supabase_service
from models.hotspot import PersistentSource
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

MAX_DISTANCE = 1000  # meters
MIN_ACTIVE_DAYS = 3
MIN_OBSERVATIONS = 3

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlon/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))

def cluster_hotspots(hotspots: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Cluster nearby observations using a spatial grid and Disjoint-Set Union (Union-Find)."""
    if not hotspots:
        return []

    parent = list(range(len(hotspots)))

    def find(i: int) -> int:
        path = []
        while parent[i] != i:
            path.append(i)
            i = parent[i]
        for node in path:
            parent[node] = i
        return i

    def union(i: int, j: int) -> None:
        root_i = find(i)
        root_j = find(j)
        if root_i != root_j:
            parent[root_i] = root_j

    cell_deg = MAX_DISTANCE / 111_320.0
    buckets: Dict[tuple[int, int], List[int]] = {}

    for i, h in enumerate(hotspots):
        lat = float(h['latitude'])
        lon = float(h['longitude'])
        key = (int(lat / cell_deg), int(lon / cell_deg))

        for dlat in (-1, 0, 1):
            for dlon in (-1, 0, 1):
                neighbor_key = (key[0] + dlat, key[1] + dlon)
                for other_idx in buckets.get(neighbor_key, []):
                    other_h = hotspots[other_idx]
                    if haversine(lat, lon, float(other_h['latitude']), float(other_h['longitude'])) <= MAX_DISTANCE:
                        union(i, other_idx)

        buckets.setdefault(key, []).append(i)

    groups: Dict[int, List[Dict[str, Any]]] = {}
    for i, h in enumerate(hotspots):
        root = find(i)
        groups.setdefault(root, []).append(h)

    return list(groups.values())

async def calculate_persistent_sources() -> List[Dict[str, Any]]:
    """
    Fetch all hotspots, cluster them, and store persistent sources.
    A persistent source requires observations within 1000m AND across at least 3 distinct days.
    """
    logger.info("Starting persistent source calculation")
    try:
        # Fetch hotspots
        res = supabase_service.table("hotspots").select("*").execute()
        hotspots = res.data
    except Exception as e:
        logger.error(f"Failed to fetch hotspots for persistence calculation: {e}")
        return []

    clusters = cluster_hotspots(hotspots)
    
    persistent_sources_data = []

    for c in clusters:
        if len(c) < MIN_OBSERVATIONS:
            continue
            
        # check distinct days
        days = set()
        for pt in c:
            date_str = pt.get('acq_date')
            if date_str:
                days.add(str(date_str).split('T')[0])
                
        if len(days) < MIN_ACTIVE_DAYS:
            continue
            
        # It's a persistent source
        lat = sum(pt['latitude'] for pt in c) / len(c)
        lon = sum(pt['longitude'] for pt in c) / len(c)
        
        dates = [str(pt.get('acq_date')).split('T')[0] for pt in c if pt.get('acq_date')]
        dates.sort()
        first_seen = dates[0] if dates else None
        last_seen = dates[-1] if dates else None
        
        persistence_duration = None
        if first_seen and last_seen:
            try:
                dt1 = datetime.strptime(first_seen, "%Y-%m-%d")
                dt2 = datetime.strptime(last_seen, "%Y-%m-%d")
                persistence_duration = (dt2 - dt1).days
            except Exception:
                pass

        frp_list = [pt.get('frp', 0) for pt in c if pt.get('frp') is not None]
        avg_frp = sum(frp_list) / len(frp_list) if frp_list else 0
        max_frp = max(frp_list) if frp_list else 0
        
        conf_list = []
        for pt in c:
            conf = str(pt.get('confidence', '')).lower()
            if conf in ['h', 'high']: conf_list.append(100.0)
            elif conf in ['n', 'nominal']: conf_list.append(50.0)
            elif conf in ['l', 'low']: conf_list.append(0.0)
            else:
                try: conf_list.append(float(conf))
                except ValueError: pass
        avg_conf = sum(conf_list) / len(conf_list) if conf_list else None

        ps = {
            "centroid_lat": lat,
            "centroid_lon": lon,
            "first_seen": first_seen,
            "last_seen": last_seen,
            "observation_count": len(c),
            "active_days": len(days),
            "avg_frp": avg_frp,
            "max_frp": max_frp,
            "avg_confidence": avg_conf,
            "persistence_duration": persistence_duration
        }
        persistent_sources_data.append(ps)
        
    try:
        old = supabase_service.table("persistent_sources").select("id").execute().data or []
        inserted = []
        if persistent_sources_data:
            result = supabase_service.table("persistent_sources").insert(persistent_sources_data).execute()
            inserted = result.data or []
        # Only remove the previous generation after the new generation is safely inserted.
        old_ids = [r.get("id") for r in old if r.get("id")]
        if old_ids:
            for old_id in old_ids:
                supabase_service.table("persistent_sources").delete().eq("id", old_id).execute()
    except Exception as e:
        logger.error(f"Failed to safely update persistent_sources table: {e}")
        
    logger.info(f"Identified and stored {len(persistent_sources_data)} persistent sources")
    return persistent_sources_data
