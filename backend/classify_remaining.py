#!/usr/bin/env python3
"""
VERTEX Hotspot Classifier - One-Shot DB Classification Script
Classifies all unclassified FIRMS hotspots in Supabase/PostgreSQL.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from config import settings
from db.supabase_client import supabase_service
from models.hotspot import FIRMSHotspot
from services.classifier import classify_hotspots

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("classify_remaining")

async def classify_unclassified_hotspots(batch_size: int = 50, concurrency: int = 5):
    logger.info("Starting one-shot classification of unclassified DB hotspots...")
    
    # 1. Fetch all hotspots
    all_hotspots = []
    start = 0
    page_size = 1000
    while True:
        res = supabase_service.table("hotspots").select(
            "id, latitude, longitude, brightness, scan, track, bright_t31, acq_date, acq_time, satellite, instrument, confidence, frp, daynight, classifications(id)"
        ).range(start, start + page_size - 1).execute()
        
        rows = res.data or []
        if not rows:
            break
        all_hotspots.extend(rows)
        if len(rows) < page_size:
            break
        start += page_size

    logger.info(f"Retrieved {len(all_hotspots)} total hotspots from database.")

    # 2. Filter unclassified ones
    unclassified_rows = []
    for r in all_hotspots:
        class_list = r.get("classifications") or []
        if len(class_list) == 0:
            unclassified_rows.append(r)

    logger.info(f"Found {len(unclassified_rows)} unclassified hotspots awaiting AI analysis.")
    if not unclassified_rows:
        logger.info("All hotspots are already classified. Nothing to do.")
        return

    # Sort by FRP descending
    unclassified_rows.sort(key=lambda r: float(r.get("frp") or 0.0), reverse=True)

    # Convert to FIRMSHotspot models
    unclassified_models = []
    for r in unclassified_rows:
        hs = FIRMSHotspot(
            latitude=float(r.get("latitude") or 0.0),
            longitude=float(r.get("longitude") or 0.0),
            brightness=float(r.get("brightness")) if r.get("brightness") is not None else None,
            scan=float(r.get("scan")) if r.get("scan") is not None else None,
            track=float(r.get("track")) if r.get("track") is not None else None,
            bright_t31=float(r.get("bright_t31")) if r.get("bright_t31") is not None else None,
            acq_date=r.get("acq_date"),
            acq_time=r.get("acq_time"),
            satellite=r.get("satellite"),
            instrument=r.get("instrument"),
            confidence=r.get("confidence"),
            frp=float(r.get("frp")) if r.get("frp") is not None else None,
            daynight=r.get("daynight") or "D"
        )
        setattr(hs, "_db_id", r["id"])
        unclassified_models.append(hs)

    # 3. Process in batches
    total_processed = 0
    total_inserted = 0

    for i in range(0, len(unclassified_models), batch_size):
        chunk = unclassified_models[i:i + batch_size]
        logger.info(f"Classifying batch {i // batch_size + 1}/{(len(unclassified_models) + batch_size - 1) // batch_size} ({len(chunk)} hotspots)...")
        
        classified_chunk = await classify_hotspots(chunk, concurrency=concurrency)
        total_processed += len(chunk)

        # Insert classifications
        for item in classified_chunk:
            db_id = getattr(item.hotspot, "_db_id", None)
            if not db_id:
                continue
            
            cls = item.classification
            osm = item.osm_context
            cls_data = {
                "hotspot_id": db_id,
                "classification": cls.classification.value if hasattr(cls.classification, "value") else str(cls.classification),
                "confidence_score": cls.confidence_score,
                "explanation": cls.explanation,
                "evidence": cls.evidence,
                "risk_score": cls.risk_score,
                "risk_level": cls.risk_level,
                "source_data": cls.source_data,
                "osm_context": {
                    "nearby_facilities": osm.nearby_facilities,
                    "nearest_facility_distance": osm.nearest_facility_distance,
                    "nearest_facility_type": osm.nearest_facility_type,
                    "facility_count_in_radius": osm.facility_count_in_radius,
                    "land_use_context": osm.land_use_context,
                    "water_context": osm.water_context,
                    "near_water": osm.near_water,
                    "osm_source": osm.osm_source.value if hasattr(osm.osm_source, "value") else str(osm.osm_source)
                }
            }
            try:
                supabase_service.table("classifications").insert(cls_data).execute()
                total_inserted += 1
            except Exception as exc:
                logger.error(f"Failed to persist classification for hotspot {db_id}: {exc}")

        logger.info(f"Progress: {total_processed}/{len(unclassified_models)} classified, {total_inserted} inserted into database.")

    logger.info(f"Classification completed! Successfully classified and inserted {total_inserted} hotspots.")

if __name__ == "__main__":
    asyncio.run(classify_unclassified_hotspots())
