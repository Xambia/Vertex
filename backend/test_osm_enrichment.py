"""State-machine tests for industrial-context provenance (no network or DB required)."""
import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from models.classification import OSMContext
from models.hotspot import FIRMSHotspot
from services import osm_service


def hotspot(lat: float, lon: float) -> FIRMSHotspot:
    return FIRMSHotspot(latitude=lat, longitude=lon)


def offline_facility():
    return [{"name": "Test Refinery", "type": "refinery", "latitude": 0, "longitude": 0, "distance_m": 420.0}]


def test_live_osm_facility_is_live():
    osm_service._live_osm_cache.clear()
    with patch("services.osm_service._get_supabase_cached_context", return_value=None), \
         patch("services.osm_service.query_overpass", new=AsyncMock(return_value=[{"name": "Live Works", "type": "works", "latitude": 10.001, "longitude": 20.001}])), \
         patch("services.osm_service.query_water_context", new=AsyncMock(return_value=[])):
        with patch("services.osm_service.find_nearby_facilities") as catalog:
            result = asyncio.run(osm_service.enrich_hotspot(hotspot(10, 20)))
    assert result.osm_source == "LIVE"
    assert result.nearby_facilities[0]["name"] == "Live Works"
    catalog.assert_not_called()


def test_live_empty_uses_offline_catalog():
    osm_service._live_osm_cache.clear()
    with patch("services.osm_service._get_supabase_cached_context", return_value=None), \
         patch("services.osm_service.query_overpass", new=AsyncMock(return_value=[])), \
         patch("services.osm_service.query_water_context", new=AsyncMock(return_value=[])):
        with patch("services.osm_service.find_nearby_facilities", return_value=offline_facility()):
            result = asyncio.run(osm_service.enrich_hotspot(hotspot(11, 21)))
    assert result.osm_source == "OFFLINE_CATALOG"
    assert result.nearby_facilities[0]["name"] == "Test Refinery"


def test_failed_osm_uses_offline_catalog():
    osm_service._live_osm_cache.clear()
    with patch("services.osm_service._get_supabase_cached_context", return_value=None), \
         patch("services.osm_service.query_overpass", new=AsyncMock(return_value=None)), \
         patch("services.osm_service.query_water_context", new=AsyncMock(return_value=[])):
        with patch("services.osm_service.find_nearby_facilities", return_value=offline_facility()):
            result = asyncio.run(osm_service.enrich_hotspot(hotspot(12, 22)))
    assert result.osm_source == "OFFLINE_CATALOG"


def test_failed_osm_without_catalog_is_failed():
    osm_service._live_osm_cache.clear()
    with patch("services.osm_service._get_supabase_cached_context", return_value=None), \
         patch("services.osm_service.query_overpass", new=AsyncMock(return_value=None)), \
         patch("services.osm_service.query_water_context", new=AsyncMock(return_value=[])):
        with patch("services.osm_service.find_nearby_facilities", return_value=[]):
            result = asyncio.run(osm_service.enrich_hotspot(hotspot(13, 23)))
    assert result.osm_source == "FAILED"


def test_failed_osm_uses_recent_live_cache_only():
    osm_service._live_osm_cache.clear()
    existing = OSMContext(
        nearby_facilities=[{"name": "Previously live", "type": "works", "distance_m": 100.0}],
        nearest_facility_distance=100.0,
        nearest_facility_type="works",
        facility_count_in_radius=1,
        osm_source="LIVE",
        queried_at=datetime.now(timezone.utc).isoformat(),
    )
    with patch("services.osm_service._get_supabase_cached_context", return_value=None), \
         patch("services.osm_service.query_overpass", new=AsyncMock(return_value=None)), \
         patch("services.osm_service.query_water_context", new=AsyncMock(return_value=[])):
        with patch("services.osm_service.find_nearby_facilities", return_value=[]):
            result = asyncio.run(osm_service.enrich_hotspot(hotspot(14, 24), existing))
    assert result.osm_source == "CACHED"
    assert result.nearby_facilities[0]["name"] == "Previously live"


def test_distant_overpass_element_is_not_treated_as_nearby():
    osm_service._live_osm_cache.clear()
    distant_facility = {"name": "Far Away Reserve", "type": "industrial", "latitude": 10.3, "longitude": 20.3}
    with patch("services.osm_service._get_supabase_cached_context", return_value=None), \
         patch("services.osm_service.query_overpass", new=AsyncMock(return_value=[distant_facility])), \
         patch("services.osm_service.query_water_context", new=AsyncMock(return_value=[])):
        with patch("services.osm_service.find_nearby_facilities", return_value=[]):
            result = asyncio.run(osm_service.enrich_hotspot(hotspot(10, 20)))
    assert result.osm_source == "LIVE_NO_FACILITY"
    assert len(result.nearby_facilities) == 0
    assert result.nearest_facility_distance is None
    assert result.nearest_facility_type is None


def load_tests(loader, tests, pattern):
    """Keep this test runnable with the Python standard library alone."""
    functions = [
        test_live_osm_facility_is_live,
        test_live_empty_uses_offline_catalog,
        test_failed_osm_uses_offline_catalog,
        test_failed_osm_without_catalog_is_failed,
        test_failed_osm_uses_recent_live_cache_only,
        test_distant_overpass_element_is_not_treated_as_nearby,
    ]
    return unittest.TestSuite(unittest.FunctionTestCase(function) for function in functions)

