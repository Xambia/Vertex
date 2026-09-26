import httpx
import csv
from io import StringIO
from typing import List, Optional
import logging
from config import settings
from models.hotspot import FIRMSHotspot

logger = logging.getLogger(__name__)

# India bounding box: West, South, East, North
INDIA_BBOX = "68.0,6.0,97.5,37.0"
# Karnataka bounding box for faster testing
KARNATAKA_BBOX = "74.0,11.5,78.5,18.5"

import json
from pathlib import Path
from shapely.geometry import shape, Point
from shapely.prepared import prep

# Load high-fidelity India boundary GeoJSON
_INDIA_BOUNDARY_SHAPE = None
_INDIA_BOUNDARY_PREPARED = None
try:
    _geojson_path = Path(__file__).parent / 'india_boundary.geojson'
    with open(_geojson_path, 'r', encoding='utf-8') as f:
        _india_geojson = json.load(f)
        _INDIA_BOUNDARY_SHAPE = shape(_india_geojson['geometry']).buffer(0.15)
        _INDIA_BOUNDARY_PREPARED = prep(_INDIA_BOUNDARY_SHAPE)
except Exception as e:
    logger.error(f"Failed to load India boundary GeoJSON: {e}")

def point_in_india(lat: float, lon: float) -> bool:
    if _INDIA_BOUNDARY_PREPARED is not None:
        return _INDIA_BOUNDARY_PREPARED.covers(Point(lon, lat))
    # Fallback to India bounding box check if GeoJSON is missing
    return 6.0 <= lat <= 37.0 and 68.0 <= lon <= 97.5

_point_in_india = point_in_india

ALL_FIRMS_SOURCES = [
    'VIIRS_SNPP_NRT',
    'VIIRS_NOAA20_NRT',
    'VIIRS_NOAA21_NRT',
    'MODIS_NRT'
]

async def fetch_realtime_hotspots(
    country: str = 'IND',
    days: int = 1,
    source: str = 'ALL',
    bbox: Optional[str] = None
) -> List[FIRMSHotspot]:
    """
    Fetch real-time FIRMS hotspots. Uses area/bbox API (more reliable than country API).
    Defaults to India's bounding box to keep processing bounded.
    When source='ALL' (default), queries all operational satellite feeds concurrently.
    """
    if bbox is None:
        bbox = INDIA_BBOX

    import asyncio

    if not source or source.upper() == 'ALL':
        sources_to_query = ALL_FIRMS_SOURCES
    else:
        sources_to_query = [source]

    tasks = [
        _fetch_and_parse(f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{settings.FIRMS_MAP_KEY}/{s}/{bbox}/{days}")
        for s in sources_to_query
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    hotspots = []
    seen = set()
    for batch in results:
        if isinstance(batch, Exception) or not batch:
            continue
        for h in batch:
            if not point_in_india(h.latitude, h.longitude):
                continue
            key = (round(h.latitude, 5), round(h.longitude, 5), str(h.acq_date), str(h.acq_time), str(h.satellite))
            if key not in seen:
                seen.add(key)
                hotspots.append(h)

    # If days=1 returned no hotspots (e.g. early morning before today's daytime satellite pass arrives),
    # fallback to 2 days and retain the latest available date so situational awareness is never blank.
    if not hotspots and days == 1:
        logger.info("No hotspots returned for days=1, querying days=2 to retrieve latest satellite pass...")
        tasks_fallback = [
            _fetch_and_parse(f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{settings.FIRMS_MAP_KEY}/{s}/{bbox}/2")
            for s in sources_to_query
        ]
        results_fallback = await asyncio.gather(*tasks_fallback, return_exceptions=True)
        fallback_hotspots = []
        for batch in results_fallback:
            if isinstance(batch, Exception) or not batch:
                continue
            for h in batch:
                if not point_in_india(h.latitude, h.longitude):
                    continue
                key = (round(h.latitude, 5), round(h.longitude, 5), str(h.acq_date), str(h.acq_time), str(h.satellite))
                if key not in seen:
                    seen.add(key)
                    fallback_hotspots.append(h)
        if fallback_hotspots:
            dates = [str(h.acq_date)[:10] for h in fallback_hotspots if h.acq_date]
            if dates:
                latest_date = max(dates)
                hotspots = [h for h in fallback_hotspots if str(h.acq_date)[:10] == latest_date]
            else:
                hotspots = fallback_hotspots

    logger.info(f"Ingested {len(hotspots)} real-time hotspots across {sources_to_query}")
    # Sort by FRP descending so clients can easily slice highest priority if needed
    hotspots.sort(key=lambda h: h.frp or 0.0, reverse=True)
    return hotspots

async def fetch_area_hotspots(
    bbox: str,
    days: int = 1,
    source: str = 'ALL'
) -> List[FIRMSHotspot]:
    """Fetch FIRMS hotspots for a specific bounding box (filtered strictly to India)."""
    import asyncio
    if not source or source.upper() == 'ALL':
        sources_to_query = ALL_FIRMS_SOURCES
    else:
        sources_to_query = [source]

    tasks = [
        _fetch_and_parse(f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{settings.FIRMS_MAP_KEY}/{s}/{bbox}/{days}")
        for s in sources_to_query
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    hotspots = []
    seen = set()
    for batch in results:
        if isinstance(batch, Exception) or not batch:
            continue
        for h in batch:
            if not point_in_india(h.latitude, h.longitude):
                continue
            key = (round(h.latitude, 5), round(h.longitude, 5), str(h.acq_date), str(h.acq_time), str(h.satellite))
            if key not in seen:
                seen.add(key)
                hotspots.append(h)

    hotspots.sort(key=lambda h: h.frp or 0.0, reverse=True)
    return hotspots

async def _fetch_and_parse(url: str) -> List[FIRMSHotspot]:
    async with httpx.AsyncClient(verify=False) as client:
        try:
            response = await client.get(url, timeout=60.0)
            response.raise_for_status()

            csv_data = response.text
            if not csv_data or csv_data.strip() == "Invalid API call.":
                logger.warning(f"FIRMS API returned invalid response for URL: {url[:80]}...")
                return []

            reader = csv.DictReader(StringIO(csv_data))

            hotspots = []
            for row in reader:
                try:
                    def num(name, fallback=None):
                        value = row.get(name, fallback)
                        if value in (None, ''):
                            return None
                        return float(value)

                    hotspot = FIRMSHotspot(
                        latitude=num('latitude', 0) or 0.0,
                        longitude=num('longitude', 0) or 0.0,
                        bright_ti4=num('bright_ti4', row.get('bright_ti5')),
                        brightness=num('brightness', row.get('bright_ti4')),
                        scan=num('scan'),
                        track=num('track'),
                        version=row.get('version'),
                        bright_t31=num('bright_t31'),
                        frp=num('frp'),
                        confidence=row.get('confidence'),
                        daynight=row.get('daynight'),
                        satellite=row.get('satellite'),
                        acq_date=row.get('acq_date'),
                        acq_time=row.get('acq_time'),
                        instrument=row.get('instrument')
                    )
                    hotspots.append(hotspot)
                except (ValueError, KeyError) as e:
                    logger.warning(f"Failed to parse FIRMS row: {e}")

            logger.info(f"Fetched {len(hotspots)} hotspots from FIRMS")
            return hotspots
        except httpx.HTTPStatusError as e:
            logger.error(f"FIRMS API HTTP error {e.response.status_code}: {e}")
            return []
        except Exception as e:
            logger.error(f"Error fetching FIRMS data: {e}")
            return []
