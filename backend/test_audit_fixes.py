import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from config import settings
from services.firms_service import _point_in_india
from services.osm_service import _is_valid_live_context
from models.classification import OSMContext


import unittest

class AuditFixesTests(unittest.TestCase):
    def test_gemini_model_default_or_configured(self):
        self.assertTrue(settings.GEMINI_MODEL == "gemini-2.0-flash" or bool(settings.GEMINI_MODEL))

    def test_osm_zero_facility_context_valid(self):
        self.assertTrue(_is_valid_live_context(OSMContext(nearby_facilities=[], osm_source="LIVE_NO_FACILITY")))
        self.assertTrue(_is_valid_live_context(OSMContext(nearby_facilities=[], osm_source="CACHED_NO_FACILITY")))

    def test_india_boundary_point(self):
        self.assertTrue(_point_in_india(20.5937, 78.9629))

if __name__ == "__main__":
    unittest.main()
