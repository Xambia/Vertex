import math
import logging
import asyncio
import time
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
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

_mirror_cooldowns: Dict[str, float] = {}
MIRROR_COOLDOWN_SECONDS = 60.0

def _get_active_mirrors() -> List[str]:
    """Return mirrors whose failure cooldown has expired."""
    now = time.time()
    return [m for m in OVERPASS_MIRRORS if _mirror_cooldowns.get(m, 0) < now]

def _trip_mirror(mirror: str, error: Exception):
    """Place failing mirror in cooldown and log cleanly."""
    _mirror_cooldowns[mirror] = time.time() + MIRROR_COOLDOWN_SECONDS
    err_type = type(error).__name__
    err_msg = f"{err_type}: {error}" if str(error) else err_type
    logger.debug(f"Overpass mirror {mirror} timed out/failed ({err_msg}), cooling down for {int(MIRROR_COOLDOWN_SECONDS)}s")

def _reset_mirror(mirror: str):
    """Clear cooldown on successful response."""
    _mirror_cooldowns.pop(mirror, None)


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


async def query_overpass(lat: float, lon: float, radius: int = 1000) -> Optional[Any]:
    """
    Query Overpass API for industrial facilities, land use, and nearby water in a single roundtrip.
    Implements a circuit-breaker cooldown so rate-limited mirrors do not stall batch processing.
    """
    active_mirrors = _get_active_mirrors()
    if not active_mirrors:
        logger.debug("All Overpass mirrors in cooldown; bypassing to offline GIS catalog & Gemini.")
        return None

    query = f"""
    [out:json][timeout:4];
    (
      way["landuse"="industrial"](around:{radius},{lat},{lon});
      relation["landuse"="industrial"](around:{radius},{lat},{lon});
      nwr["man_made"~"^(works|flare|storage_tank|gasometer|petroleum_well|wastewater_plant)$"](around:{radius},{lat},{lon});
      nwr["power"~"^(plant|generator|substation)$"](around:{radius},{lat},{lon});
      nwr["industrial"](around:{radius},{lat},{lon});
      nwr["natural"="wood"](around:{radius},{lat},{lon});
      nwr["landuse"="forest"](around:{radius},{lat},{lon});
      nwr["leisure"="nature_reserve"](around:{radius},{lat},{lon});
      nwr["landuse"="farmland"](around:{radius},{lat},{lon});
      nwr["natural"="water"](around:150,{lat},{lon});
      nwr["landuse"="reservoir"](around:150,{lat},{lon});
      nwr["waterway"~"^(river|riverbank|stream|canal|drain|ditch)$"](around:150,{lat},{lon});
    );
    out center tags;
    """

    headers = {
        "User-Agent": "VERTEX-Geospatial-System/2.0 (NTRO Fire Detection; contact@vertex-sih.org)",
        "Accept": "application/json",
    }
    timeout = httpx.Timeout(4.0, connect=2.0)
    async with httpx.AsyncClient(timeout=timeout, headers=headers, verify=False) as client:
        for mirror in active_mirrors:
            try:
                response = await client.post(mirror, data={"data": query})
                response.raise_for_status()
                _reset_mirror(mirror)
                elements = response.json().get("elements", [])
                facilities = []
                land_use_tags = []
                water_features = []
                for el in elements:
                    tags = el.get("tags", {}) or {}
                    w_tag = _water_tag(tags)
                    if w_tag:
                        water_features.append({"type": w_tag, "name": tags.get("name")})
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
                    # Only treat as a facility if it actually has industrial / power / works tags
                    fac_type = (
                        tags.get("industrial")
                        or tags.get("power")
                        or tags.get("man_made")
                        or ("industrial" if tags.get("landuse") == "industrial" else None)
                    )
                    if not fac_type:
                        continue

                    name = tags.get("name") or tags.get("operator")
                    if not name:
                        clean_type = str(fac_type).replace("_", " ").title()
                        name = f"{clean_type}"

                    facilities.append({
                        "name": name,
                        "type": fac_type,
                        "latitude": lat_el,
                        "longitude": lon_el,
                        "water_feature": w_tag,
                    })
                land_use_tags = list(set(land_use_tags))
                return facilities, land_use_tags, water_features
            except Exception as e:
                _trip_mirror(mirror, e)
        return None



async def query_water_context(lat: float, lon: float, radius: int = 150) -> Optional[List[Dict[str, Any]]]:
    """Find nearby OSM water features independently of industrial context."""
    active_mirrors = _get_active_mirrors()
    if not active_mirrors:
        return None

    query = f"""
    [out:json][timeout:3];
    (
      nwr["natural"="water"](around:{radius},{lat},{lon});
      nwr["landuse"="reservoir"](around:{radius},{lat},{lon});
      nwr["waterway"~"^(river|riverbank|stream|canal|drain|ditch)$"](around:{radius},{lat},{lon});
    );
    out center tags;
    """
    headers = {
        "User-Agent": "VERTEX-Geospatial-System/2.0 (NTRO Fire Detection; contact@vertex-sih.org)",
        "Accept": "application/json",
    }
    timeout = httpx.Timeout(3.0, connect=1.5)
    async with httpx.AsyncClient(timeout=timeout, headers=headers, verify=False) as client:
        for mirror in active_mirrors:
            try:
                response = await client.post(mirror, data={"data": query})
                response.raise_for_status()
                _reset_mirror(mirror)
                out = []
                for el in response.json().get("elements", []):
                    label = _water_tag(el.get("tags", {}) or {})
                    if label:
                        out.append({"type": label, "name": (el.get("tags", {}) or {}).get("name")})
                return out
            except Exception as e:
                _trip_mirror(mirror, e)
    return None


async def query_nominatim_reverse(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Reverse geocodes coordinates via OpenStreetMap Nominatim API.
    Fast, reliable fallback that directly extracts verified plant/facility names and land-use.
    """
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
    headers = {
        "User-Agent": "VERTEX-Geospatial-System/2.0 (NTRO Fire Detection; contact@vertex-sih.org)",
        "Accept": "application/json"
    }
    timeout = httpx.Timeout(3.5, connect=1.5)
    try:
        async with httpx.AsyncClient(timeout=timeout, headers=headers, verify=False) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                address = data.get("address", {})
                display_name = data.get("display_name", "")

                ind_name = (
                    address.get("industrial")
                    or address.get("factory")
                    or address.get("works")
                    or address.get("power")
                    or address.get("substation")
                    or address.get("quarry")
                    or address.get("mine")
                )

                if not ind_name:
                    lower_disp = display_name.lower()
                    for keyword in ["cement", "refinery", "chemical", "power plant", "steel", "works", "industrial area", "midc", "gidc", "sez", "terminal"]:
                        if keyword in lower_disp:
                            ind_name = data.get("name") or display_name.split(",")[0].strip()
                            break

                if ind_name:
                    fac_type = "industrial"
                    lower_name = (ind_name + " " + display_name).lower()
                    if "cement" in lower_name:
                        fac_type = "cement_plant"
                    elif "steel" in lower_name or "iron" in lower_name:
                        fac_type = "steel_plant"
                    elif "refinery" in lower_name or "petro" in lower_name:
                        fac_type = "refinery"
                    elif "power" in lower_name or "thermal" in lower_name:
                        fac_type = "power_plant"
                    elif "mine" in lower_name or "coal" in lower_name:
                        fac_type = "mining"
                    elif "chemical" in lower_name or "fertilizer" in lower_name:
                        fac_type = "chemical_plant"

                    land_use = ["INDUSTRIAL"]
                    return {
                        "facility_name": ind_name,
                        "facility_type": fac_type,
                        "display_name": display_name,
                        "land_use": land_use,
                    }
    except Exception as e:
        logger.debug(f"Nominatim reverse lookup failed for ({lat}, {lon}): {e}")
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
    return context.osm_source in {"LIVE", "LIVE_NO_FACILITY", "CACHED", "CACHED_NO_FACILITY", "OFFLINE_CATALOG", "NOMINATIM_LIVE"}


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

    # Single roundtrip query for facilities, land use, and water features
    live_facilities = None
    land_use_context = []
    water_features = None

    try:
        live_result = await query_overpass(hotspot.latitude, hotspot.longitude, 1000)
    except Exception:
        live_result = None

    if live_result is not None:
        if isinstance(live_result, tuple):
            if len(live_result) == 3:
                live_facilities, land_use_context, water_features = live_result
            elif len(live_result) == 2:
                live_facilities, land_use_context = live_result
        elif isinstance(live_result, list):
            live_facilities = live_result

    # If water features were not retrieved in unified query and mirrors are not in cooldown, fallback
    if water_features is None and _get_active_mirrors():
        try:
            water_features = await query_water_context(hotspot.latitude, hotspot.longitude, 150)
        except Exception:
            water_features = None

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
                if actual_dist > 1000:
                    continue
                nearby.append({"type": fac["type"], "distance_m": actual_dist, "name": fac["name"]})
                if actual_dist < nearest_dist:
                    nearest_dist = actual_dist
                    nearest_type = fac["type"]
            nearby.sort(key=lambda x: x["distance_m"])
            if nearby:
                context = OSMContext(
                    nearby_facilities=nearby,
                    nearest_facility_distance=nearest_dist,
                    nearest_facility_type=nearest_type,
                    facility_count_in_radius=len(nearby),
                    land_use_context=land_use_context,
                    water_context=water_context,
                    near_water=bool(water_context),
                    osm_source="LIVE",
                )
                _cache_put(key, context)
                return context

        offline_facilities = find_nearby_facilities(hotspot.latitude, hotspot.longitude, 1500)
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
            # Query Nominatim reverse geocode before declaring no facility
            nom_res = await query_nominatim_reverse(hotspot.latitude, hotspot.longitude)
            if nom_res and nom_res.get("facility_name"):
                context = OSMContext(
                    nearby_facilities=[{"type": nom_res["facility_type"] or "industrial", "distance_m": 0.0, "name": nom_res["facility_name"]}],
                    nearest_facility_distance=0.0,
                    nearest_facility_type=nom_res["facility_type"] or "industrial",
                    facility_count_in_radius=1,
                    land_use_context=nom_res.get("land_use", []) or land_use_context,
                    water_context=water_context,
                    near_water=bool(water_context),
                    osm_source="NOMINATIM_LIVE",
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
    if existing_context and existing_context.osm_source in {"LIVE", "CACHED", "OFFLINE_CATALOG", "LIVE_NO_FACILITY", "CACHED_NO_FACILITY", "NOMINATIM_LIVE"}:
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

    offline_facilities = find_nearby_facilities(hotspot.latitude, hotspot.longitude, 1500)
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

    nom_res = await query_nominatim_reverse(hotspot.latitude, hotspot.longitude)
    if nom_res and nom_res.get("facility_name"):
        return OSMContext(
            nearby_facilities=[{"type": nom_res["facility_type"] or "industrial", "distance_m": 0.0, "name": nom_res["facility_name"]}],
            nearest_facility_distance=0.0,
            nearest_facility_type=nom_res["facility_type"] or "industrial",
            facility_count_in_radius=1,
            land_use_context=nom_res.get("land_use", []),
            water_context=water_context,
            near_water=bool(water_context),
            osm_source="NOMINATIM_LIVE",
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
