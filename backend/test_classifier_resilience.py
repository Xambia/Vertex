"""No-network checks for per-hotspot OSM/Gemini isolation and persistence."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from models.classification import ClassificationEnum, ClassificationResult, OSMContext
from models.hotspot import FIRMSHotspot
from services import classifier


def make_hotspot(index: int) -> FIRMSHotspot:
    hotspot = FIRMSHotspot(
        latitude=19.5 + (index / 1000),
        longitude=75.5 + (index / 1000),
        frp=12.0,
        confidence="h",
    )
    setattr(hotspot, "_db_id", index + 1)
    return hotspot


def gemini_result() -> ClassificationResult:
    return ClassificationResult(
        classification=ClassificationEnum.UNKNOWN_UNCERTAIN,
        confidence_score=0.5,
        explanation="test result",
        evidence=[],
        source_data={},
    )


class FakeQuery:
    def __init__(self, calls, table_name, action):
        self.calls = calls
        self.table_name = table_name
        self.action = action

    def eq(self, column, value):
        self.calls.append(("eq", self.table_name, column, value))
        return self

    def execute(self):
        self.calls.append(("execute", self.table_name, self.action))
        return self


class FakeSupabase:
    def __init__(self):
        self.calls = []

    def table(self, table_name):
        service = self

        class Table:
            def insert(self, payload):
                service.calls.append(("insert", table_name, payload))
                return FakeQuery(service.calls, table_name, "insert")

            def update(self, payload):
                service.calls.append(("update", table_name, payload))
                return FakeQuery(service.calls, table_name, "update")

        return Table()


class ClassifierResilienceTests(unittest.TestCase):
    def test_failed_osm_does_not_block_any_of_27_gemini_calls(self):
        hotspots = [make_hotspot(index) for index in range(27)]
        contexts = [
            RuntimeError("Overpass unavailable"),
            *[
                OSMContext(osm_source="CACHED")
                for _ in range(26)
            ],
        ]

        with patch(
            "services.classifier.enrich_hotspot",
            new=AsyncMock(side_effect=contexts),
        ), patch(
            "services.classifier.classify_with_gemini",
            new=AsyncMock(side_effect=lambda *_: gemini_result()),
        ) as gemini:
            results = asyncio.run(classifier.classify_hotspots(hotspots))

        self.assertEqual(27, len(results))
        self.assertEqual(27, gemini.await_count)
        self.assertEqual("FAILED", results[0].osm_context.osm_source)
        self.assertEqual("CACHED", results[-1].osm_context.osm_source)

    def test_stale_record_updates_and_new_record_inserts_once(self):
        supabase = FakeSupabase()
        stale = make_hotspot(0)
        setattr(stale, "_stale_classification_id", 101)
        new = make_hotspot(1)
        context = OSMContext(osm_source="OFFLINE_CATALOG")

        with patch(
            "services.classifier.classify_with_gemini",
            new=AsyncMock(return_value=gemini_result()),
        ):
            stale_result = asyncio.run(
                classifier.classify_hotspot_with_context(stale, context)
            )
            new_result = asyncio.run(
                classifier.classify_hotspot_with_context(new, context)
            )

        self.assertEqual("updated", classifier.persist_classification(stale_result, supabase))
        self.assertEqual("inserted", classifier.persist_classification(new_result, supabase))
        self.assertEqual(1, sum(call[0] == "update" for call in supabase.calls))
        self.assertEqual(1, sum(call[0] == "insert" for call in supabase.calls))
        self.assertIn(("eq", "classifications", "id", 101), supabase.calls)


    def test_remote_low_frp_hotspot_invokes_gemini_instead_of_blind_agri_burn(self):
        hotspot = FIRMSHotspot(
            latitude=27.8190,
            longitude=96.1839,
            frp=2.3,
            daynight="D",
            confidence="n"
        )
        context = OSMContext(
            osm_source="LIVE_NO_FACILITY",
            land_use_context=[],
            nearby_facilities=[]
        )
        mock_gemini_response = ClassificationResult(
            classification=ClassificationEnum.WILDFIRE_FOREST_FIRE,
            confidence_score=0.88,
            explanation="Arunachal Pradesh forest terrain identified by AI",
            evidence=["Terrain: Forest"],
            source_data={"model": "gemini-3.5-flash-lite"}
        )

        with patch("services.classifier.classify_with_gemini", new=AsyncMock(return_value=mock_gemini_response)) as mock_gemini:
            result = asyncio.run(classifier.classify_hotspot_with_context(hotspot, context))

        self.assertEqual(ClassificationEnum.WILDFIRE_FOREST_FIRE, result.classification.classification)
        self.assertEqual(1, mock_gemini.await_count)

    def test_forest_tag_directly_classified_as_wildfire(self):
        hotspot = FIRMSHotspot(
            latitude=27.8190,
            longitude=96.1839,
            frp=2.3,
            daynight="D",
            confidence="n"
        )
        context = OSMContext(
            osm_source="LIVE",
            land_use_context=["FOREST_WOOD"],
            nearby_facilities=[]
        )

        result = asyncio.run(classifier.classify_hotspot_with_context(hotspot, context))
        self.assertEqual(ClassificationEnum.WILDFIRE_FOREST_FIRE, result.classification.classification)

    def test_farmland_tag_classified_as_agri_burn(self):
        hotspot = FIRMSHotspot(
            latitude=30.0,
            longitude=76.0,
            frp=5.0,
            daynight="D",
            confidence="n"
        )
        context = OSMContext(
            osm_source="LIVE",
            land_use_context=["FARMLAND"],
            nearby_facilities=[]
        )

        result = asyncio.run(classifier.classify_hotspot_with_context(hotspot, context))
        self.assertEqual(ClassificationEnum.AGRICULTURAL_BURN, result.classification.classification)


if __name__ == "__main__":
    unittest.main()

