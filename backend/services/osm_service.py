import math
import logging
import asyncio
import httpx
from typing import Dict, Any, List, Optional
from collections import OrderedDict
from models.hotspot import FIRMSHotspot
from models.classification import OSMContext
from services.status import service_status
from services.facility_service import find_nearby_facilities

logger = logging.getLogger(__name__)

MAX_LIVE_OSM_CACHE = 512
_live_osm_cache: OrderedDict[str, OSMContext] = OrderedDict()

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]


def _water_tag(tags: Dict[str, Any]) -> Optional[str]:
    natural = str(tags.get("natural", "")).lower()
    water = str(tags.get("water", "")).lower()
    waterway = str(tags.get("waterway", "")).lower()
    landuse = str(tags.get("landuse", "")).lower()
    if landuse == "reservoir":
        return "RESERVOIR"
    if natural == "water" or water:
        return f"WATERBODY:{water or 'water'}"
    if waterway in {"river", "riverbank", "stream", "canal", "drain", "ditch"}:
        return f"WATERWAY:{waterway}"
    return None


async def query_overpass(lat: float, lon: float, radius: int = 1000) -> Optional[tuple[List[Dict[str, Any]], List[str]]]:
    query = f"""
    [out:json][timeout:5];
    (
      way["landuse"="industrial"](around:{radius},{lat},{lon});
      node["man_made"="works"](around:{radius},{lat},{lon});
      way["man_made"="works"](around:{radius},{lat},{lon});
      relation["landuse"="industrial"](around:{radius},{lat},{lon});
      nwr["power"="plant"](around:{radius},{lat},{lon});
      nwr["power"="generator"](around:{radius},{lat},{lon});
      nwr["industrial"](around:{radius},{lat},{lon});
      nwr["natural"="wood"](around:{radius},{lat},{lon});
      nwr["landuse"="forest"](around:{radius},{lat},{lon});
      nwr["leisure"="nature_reserve"](around:{radius},{lat},{lon});
      nwr["landuse"="farmland"](around:{radius},{lat},{lon});
    );
    out center tags;
    """

    headers = {"User-Agent": "VERTEX-Geospatial-System/1.0 (NTRO Fire Detection)"}
    timeout = httpx.Timeout(4.0, connect=1.5)
    async with httpx.AsyncClient(timeout=timeout, headers=headers, verify=False) as client:
        for mirror in OVERPASS_MIRRORS:
            try:
                response = await client.post(mirror, data={"data": query})
                response.raise_for_status()
                elements = response.json().get("elements", [])
                facilities = []
                land_use_tags = []
                for el in elements:
                    tags = el.get("tags", {}) or {}
                    if tags.get("natural") == "wood":
                        land_use_tags.append("FOREST_WOOD")
                    if tags.get("landuse") == "forest":
                        land_use_tags.append("FOREST")
                    if tags.get("leisure") == "nature_reserve":
                        land_use_tags.append("NATURE_RESERVE")
                    if tags.get("landuse") == "farmland":
                        land_use_tags.append("FARMLAND")
                    lat_el = el.get("lat") or (el.get("center") or {}).get("lat")
                    lon_el = el.get("lon") or (el.get("center") or {}).get("lon")
                    if lat_el is None or lon_el is None:
                        continue
                    facilities.append({
                        "name": tags.get("name") or tags.get("operator") or "Unknown Facility",
                        "type": tags.get("industrial") or tags.get("power") or tags.get("man_made") or "industrial",
                        "latitude": lat_el,
                        "longitude": lon_el,
                        "water_feature": _water_tag(tags),
                    })
                land_use_tags = list(set(land_use_tags))
                return facilities, land_use_tags
            except Exception as e:
                logger.warning(f"Overpass mirror {mirror} failed: {e}")
        return None



async def query_water_context(lat: float, lon: float, radius: int = 150) -> Optional[List[Dict[str, Any]]]:
    """Find nearby OSM water features independently of industrial context."""
    query = f"""
    [out:json][timeout:3];
    (
      nwr["natural"="water"](around:{radius},{lat},{lon});
      nwr["landuse"="reservoir"](around:{radius},{lat},{lon});
      nwr["waterway"~"^(river|riverbank|stream|canal|drain|ditch)$"](around:{radius},{lat},{lon});
    );
    out center tags;
    """
    headers = {"User-Agent": "VERTEX-Geospatial-System/1.0 (NTRO Fire Detection)"}
    timeout = httpx.Timeout(3.0, connect=1.5)
    async with httpx.AsyncClient(timeout=timeout, headers=headers, verify=False) as client:
        for mirror in OVERPASS_MIRRORS:
            try:
                response = await client.post(mirror, data={"data": query})
                response.raise_for_status()
                out = []
                for el in response.json().get("elements", []):
                    label = _water_tag(el.get("tags", {}) or {})
                    if label:
                        out.append({"type": label, "name": (el.get("tags", {}) or {}).get("name")})
                return out
            except Exception as e:
                logger.warning(f"Water Overpass mirror {mirror} failed: {e}")
    return None


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _cache_key(hotspot: FIRMSHotspot) -> str:
    return f"{float(hotspot.latitude):.6f}:{float(hotspot.longitude):.6f}"


def _is_valid_live_context(context: Optional[OSMContext]) -> bool:
    if context is None:
        return False
    return context.osm_source in {"LIVE", "LIVE_NO_FACILITY", "CACHED", "CACHED_NO_FACILITY", "OFFLINE_CATALOG"}


def _cache_get(key: str) -> Optional[OSMContext]:
    context = _live_osm_cache.get(key)
    if context is None or not _is_valid_live_context(context):
        return None
    _live_osm_cache.move_to_end(key)
    return context


def _cache_put(key: str, context: OSMContext) -> None:
    _live_osm_cache[key] = context
    _live_osm_cache.move_to_end(key)
    while len(_live_osm_cache) > MAX_LIVE_OSM_CACHE:
        _live_osm_cache.popitem(last=False)


def _get_supabase_cached_context(hotspot: FIRMSHotspot) -> Optional[OSMContext]:
    try:
        from db.supabase_client import supabase_service
        db_id = getattr(hotspot, '_db_id', None)
        if db_id:
            res = supabase_service.table("classifications").select("osm_context").eq("hotspot_id", db_id).limit(1).execute()
            if res and res.data and len(res.data) > 0 and res.data[0].get("osm_context"):
                raw = res.data[0]["osm_context"]
                return OSMContext(**raw)
    except Exception as e:
        logger.debug(f"Supabase cached context lookup failed: {e}")
    return None


async def enrich_hotspot(hotspot: FIRMSHotspot, existing_context: Optional[OSMContext] = None) -> OSMContext:
    key = _cache_key(hotspot)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    sb_cached = _get_supabase_cached_context(hotspot)
    if sb_cached is not None and _is_valid_live_context(sb_cached):
        _cache_put(key, sb_cached)
        return sb_cached

    # Facility and water lookups are independent. A water lookup failure must not block classification.
    facilities_task = asyncio.create_task(query_overpass(hotspot.latitude, hotspot.longitude, 1000))
    water_task = asyncio.create_task(query_water_context(hotspot.latitude, hotspot.longitude, 150))
    live_result, water_features = await asyncio.gather(facilities_task, water_task, return_exceptions=True)
    if isinstance(live_result, Exception):
        live_result = None
    if isinstance(water_features, Exception):
        water_features = None

    live_facilities = None
    land_use_context = []
    if live_result is not None:
        live_facilities, land_use_context = live_result

    water_context = []
    if water_features:
        seen = set()
        for wf in water_features:
            t = wf.get("type")
            if t and t not in seen:
                seen.add(t)
                water_context.append(t)
        if water_context:
            water_context.append("NEAR_WATER_<150M>")

    if live_facilities is not None:
        if len(live_facilities) > 0:
            service_status["osm"] = {"status": "ONLINE", "source": "LIVE"}
            nearby = []
            nearest_dist = float("inf")
            nearest_type = None
            for fac in live_facilities:
                dist = haversine_distance(hotspot.latitude, hotspot.longitude, fac["latitude"], fac["longitude"])
                if fac.get("water_feature"):
                    continue
                actual_dist = round(dist, 2)
                nearby.append({"type": fac["type"], "distance_m": actual_dist, "name": fac["name"]})
                if actual_dist < nearest_dist:
                    nearest_dist = actual_dist
                    nearest_type = fac["type"]
            nearby.sort(key=lambda x: x["distance_m"])
            source = "LIVE" if nearby else "LIVE_NO_FACILITY"
            context = OSMContext(
                nearby_facilities=nearby,
                nearest_facility_distance=nearest_dist if nearest_dist != float("inf") else None,
                nearest_facility_type=nearest_type,
                facility_count_in_radius=len(nearby),
                land_use_context=land_use_context,
                water_context=water_context,
                near_water=bool(water_context),
                osm_source=source,
            )
            _cache_put(key, context)
            return context

        offline_facilities = find_nearby_facilities(hotspot.latitude, hotspot.longitude, 1000)
        if offline_facilities:
            context = OSMContext(
                nearby_facilities=[{"type": f["type"], "distance_m": round(float(f["distance_m"]), 2), "name": f["name"]} for f in offline_facilities],
                nearest_facility_distance=round(float(offline_facilities[0]["distance_m"]), 2),
                nearest_facility_type=offline_facilities[0]["type"],
                facility_count_in_radius=len(offline_facilities),
                land_use_context=land_use_context,
                water_context=water_context,
                near_water=bool(water_context),
                osm_source="OFFLINE_CATALOG",
            )
        else:
            context = OSMContext(
                nearby_facilities=[],
                nearest_facility_distance=None,
                nearest_facility_type=None,
                facility_count_in_radius=0,
                land_use_context=land_use_context,
                water_context=water_context,
                near_water=bool(water_context),
                osm_source="LIVE_NO_FACILITY",
            )
        _cache_put(key, context)
        return context

    # OSM facility query failed; preserve an existing valid context, and retain water result if available.
    if existing_context and existing_context.osm_source in {"LIVE", "CACHED", "OFFLINE_CATALOG", "LIVE_NO_FACILITY", "CACHED_NO_FACILITY"}:
        actual_nearest = existing_context.nearest_facility_distance if existing_context.nearest_facility_distance is not None else None
        actual_facilities = [{"type": f.get("type"), "distance_m": float(f.get("distance_m", 0)), "name": f.get("name")} for f in existing_context.nearby_facilities] if existing_context.nearby_facilities else []
        return OSMContext(
            nearby_facilities=actual_facilities,
            nearest_facility_distance=actual_nearest,
            nearest_facility_type=existing_context.nearest_facility_type,
            facility_count_in_radius=existing_context.facility_count_in_radius,
            land_use_context=existing_context.land_use_context,
            water_context=water_context or existing_context.water_context,
            near_water=bool(water_context or existing_context.near_water),
            osm_source="CACHED",
        )

    offline_facilities = find_nearby_facilities(hotspot.latitude, hotspot.longitude, 1000)
    if offline_facilities:
        return OSMContext(
            nearby_facilities=[{"type": f["type"], "distance_m": round(float(f["distance_m"]), 2), "name": f["name"]} for f in offline_facilities],
            nearest_facility_distance=round(float(offline_facilities[0]["distance_m"]), 2),
            nearest_facility_type=offline_facilities[0]["type"],
            facility_count_in_radius=len(offline_facilities),
            land_use_context=[],
            water_context=water_context,
            near_water=bool(water_context),
            osm_source="OFFLINE_CATALOG",
        )

    service_status["osm"] = {"status": "DEGRADED", "source": "FAILED"}
    return OSMContext(
        nearby_facilities=[],
        nearest_facility_distance=None,
        nearest_facility_type=None,
        facility_count_in_radius=0,
        land_use_context=[],
        water_context=water_context,
        near_water=bool(water_context),
        osm_source="FAILED",
    )
