from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from services.osm_service import enrich_hotspot, query_overpass
from services.facility_service import find_nearby_facilities
from db.supabase_client import supabase_service
from models.hotspot import FIRMSHotspot
from typing import Optional, List
import asyncio
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/osm", tags=["OpenStreetMap"])

class EnrichTop50Request(BaseModel):
    hotspot_ids: Optional[List[str]] = None

def _synthetic_to_hotspot(value: str) -> Optional[FIRMSHotspot]:
    parts = str(value).split("-")
    if len(parts) < 5 or parts[0].lower() != "firms":
        return None
    try:
        lat, lon = float(parts[1]), float(parts[2])
        return FIRMSHotspot(latitude=lat, longitude=lon, acq_date=parts[3], acq_time=parts[4])
    except (ValueError, TypeError):
        return None


async def _gemini_identify_facilities(lat: float, lon: float) -> Optional[dict]:
    """Use Gemini API to identify potential industrial facilities near given coordinates."""
    try:
        from services.gemini_service import client
        from config import settings

        prompt = f"""Geographic Coordinates: Latitude {lat}, Longitude {lon} (in India).

Analyze this location carefully:
1. Identify any known industrial facilities, chemical plants, oil/gas refineries, thermal/nuclear/hydro power plants, steel mills, cement factories, major manufacturing complexes, or mines within 5km of these coordinates.
2. What is the predominant land use in this immediate area (e.g. FOREST, WOODLAND, AGRICULTURAL/FARMLAND, INDUSTRIAL, URBAN, WATERBODY, BARREN)?

Return a JSON object with this exact structure:
{{
  "facilities": [
    {{
      "name": "Exact Name of Facility",
      "type": "refinery|power_plant|steel_plant|chemical_plant|cement_plant|mining|factory|manufacturing|other",
      "estimated_distance_m": 800,
      "description": "Brief description"
    }}
  ],
  "has_industrial_facility": false,
  "land_use": ["FOREST" or "FARMLAND" or "INDUSTRIAL"],
  "area_description": "Brief description of the area"
}}

If no industrial facilities exist within 5km, set "facilities": [] and "has_industrial_facility": false.
Be accurate and realistic to Indian geography."""

        response = await asyncio.to_thread(
            client.models.generate_content,
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config={'response_mime_type': 'application/json'}
        )

        data = json.loads(response.text)
        if isinstance(data, list):
            data = {"facilities": data, "has_industrial_facility": len(data) > 0, "land_use": [], "area_description": ""}
        return data
    except Exception as e:
        logger.warning(f"Gemini facility identification failed for ({lat}, {lon}): {e}")
        return None


async def _enrich_one_hotspot(hotspot_id: str, use_gemini: bool = False):
    hotspot_data = None
    try:
        # Support integer IDs or UUIDs
        try:
            lookup_id = int(hotspot_id)
        except ValueError:
            lookup_id = hotspot_id

        res = supabase_service.table("hotspots").select("*").eq("id", lookup_id).limit(1).execute()
        if res.data:
            hotspot_data = res.data[0]
    except Exception as e:
        logger.warning(f"Stored hotspot lookup failed for {hotspot_id}: {e}")
    if hotspot_data:
        hotspot = FIRMSHotspot(**hotspot_data)
    else:
        hotspot = _synthetic_to_hotspot(hotspot_id)
        if hotspot is None:
            raise HTTPException(status_code=404, detail="Hotspot not found")

    if not use_gemini:
        osm_context = await asyncio.wait_for(enrich_hotspot(hotspot), timeout=120.0)
    else:
        from models.classification import OSMContext
        offline_facs = find_nearby_facilities(hotspot.latitude, hotspot.longitude, 1000)
        osm_context = OSMContext(
            nearby_facilities=offline_facs,
            nearest_facility_distance=offline_facs[0]["distance_m"] if offline_facs else None,
            nearest_facility_type=offline_facs[0]["type"] if offline_facs else None,
            facility_count_in_radius=len(offline_facs),
            land_use_context=[],
            osm_source="PENDING"
        )

    # If force query requested, use Gemini to identify facilities and reclassify
    gemini_context = None
    classification_payload = None

    if use_gemini:
        gemini_context = await _gemini_identify_facilities(hotspot.latitude, hotspot.longitude)

    osm_data = {
        "nearby_facilities": osm_context.nearby_facilities,
        "nearest_facility_distance": osm_context.nearest_facility_distance,
        "nearest_facility_type": osm_context.nearest_facility_type,
        "facility_count_in_radius": osm_context.facility_count_in_radius,
        "land_use_context": osm_context.land_use_context,
        "osm_source": osm_context.osm_source,
    }

    # Merge Gemini-identified facilities and land use into the context
    if gemini_context:
        raw_facs = gemini_context.get("facilities", [])
        gemini_facilities = []
        for f in raw_facs:
            dist_val = f.get("estimated_distance_m") or (float(f.get("distance_km", 1.0)) * 1000)
            gemini_facilities.append({
                "name": f.get("name") or f.get("facility_name") or "AI-identified Facility",
                "type": f.get("type") or f.get("facility_type") or "industrial",
                "distance_m": round(float(dist_val), 2),
            })

        if gemini_facilities and not osm_data["nearby_facilities"]:
            osm_data["nearby_facilities"] = gemini_facilities[:5]
            closest = gemini_facilities[0]
            osm_data["nearest_facility_distance"] = closest["distance_m"]
            osm_data["nearest_facility_type"] = closest["type"]
            osm_data["facility_count_in_radius"] = len(gemini_facilities)
            osm_data["osm_source"] = "GEMINI_AI_IDENTIFIED"
        elif not osm_data["nearby_facilities"]:
            # Gemini explicitly confirmed no facilities nearby
            osm_data["osm_source"] = "GEMINI_VERIFIED_NO_FACILITY"

        # Merge AI land use
        gemini_land_use = gemini_context.get("land_use", [])
        if gemini_land_use:
            merged_land_use = list(set(osm_data["land_use_context"] + gemini_land_use))
            osm_data["land_use_context"] = merged_land_use

        osm_data["gemini_area_description"] = gemini_context.get("area_description", "")

        # Now run full Gemini classification using the newly enriched context
        try:
            from services.gemini_service import classify_with_gemini
            from services.classifier import calculate_risk_score
            from models.classification import OSMContext

            updated_context = OSMContext(
                nearby_facilities=osm_data["nearby_facilities"],
                nearest_facility_distance=osm_data["nearest_facility_distance"],
                nearest_facility_type=osm_data["nearest_facility_type"],
                facility_count_in_radius=osm_data["facility_count_in_radius"],
                land_use_context=osm_data["land_use_context"],
                water_context=osm_context.water_context,
                near_water=osm_context.near_water,
                osm_source=osm_data["osm_source"]
            )

            gemini_cls_result = await classify_with_gemini(hotspot, updated_context)
            if gemini_cls_result:
                risk_score, risk_level = calculate_risk_score(
                    gemini_cls_result.classification,
                    hotspot.frp or 0.0,
                    osm_data["nearest_facility_distance"],
                    hotspot.confidence
                )
                gemini_cls_result.risk_score = risk_score
                gemini_cls_result.risk_level = risk_level

                classification_payload = {
                    "classification": gemini_cls_result.classification.value if hasattr(gemini_cls_result.classification, "value") else str(gemini_cls_result.classification),
                    "confidence_score": gemini_cls_result.confidence_score,
                    "explanation": gemini_cls_result.explanation,
                    "evidence": gemini_cls_result.evidence,
                    "risk_score": risk_score,
                    "risk_level": risk_level,
                    "source_data": {
                        "method": "gemini_force_enrich",
                        "model": "gemini-3.5-flash-lite",
                        "facility_name": osm_data["nearby_facilities"][0]["name"] if osm_data["nearby_facilities"] else None,
                        "facility_type": osm_data["nearest_facility_type"],
                        "distance_m": osm_data["nearest_facility_distance"],
                        "osm_source": osm_data["osm_source"],
                        "area_description": osm_data.get("gemini_area_description", "")
                    },
                    "osm_context": osm_data
                }

                # Persist classification directly to Supabase
                if hotspot_data:
                    try:
                        lookup_id = hotspot_data["id"]
                        existing = supabase_service.table("classifications").select("id").eq("hotspot_id", lookup_id).execute().data
                        if existing:
                            supabase_service.table("classifications").update(classification_payload).eq("id", existing[0]["id"]).execute()
                        else:
                            cls_insert = dict(classification_payload)
                            cls_insert["hotspot_id"] = lookup_id
                            supabase_service.table("classifications").insert(cls_insert).execute()
                    except Exception as cls_err:
                        logger.warning(f"Could not persist Gemini classification for {hotspot_id}: {cls_err}")
        except Exception as e:
            logger.warning(f"Gemini re-classification failed during force enrich: {e}")

    # If not using Gemini, just update osm_context on existing classification
    if hotspot_data and not classification_payload:
        try:
            lookup_id = hotspot_data["id"]
            supabase_service.table("classifications").update({"osm_context": osm_data}).eq("hotspot_id", lookup_id).execute()
        except Exception as e:
            logger.warning(f"Could not persist OSM context for {hotspot_id}: {e}")

    return osm_context, osm_data, classification_payload


@router.get("/industrial")
async def get_industrial(lat: float = Query(...), lon: float = Query(...), radius: int = Query(1000)):
    live_facilities = await query_overpass(lat, lon, radius)
    if live_facilities is not None:
        facilities_list = live_facilities[0] if isinstance(live_facilities, tuple) else live_facilities
        return {"facilities": facilities_list, "source": "LIVE", "query_status": "SUCCESS"}
    offline_facilities = find_nearby_facilities(lat, lon, radius)
    return {"facilities": offline_facilities, "source": "OFFLINE_CATALOG", "query_status": "SUCCESS"}

@router.get("/health")
async def check_osm_health():
    return {"mirrors": [{"mirror": "overpass", "status": "AVAILABLE"}]}

@router.post("/enrich/{hotspot_id}")
async def manual_enrich_hotspot(hotspot_id: str, force: bool = Query(False)):
    try:
        osm_context, osm_data, classification_payload = await _enrich_one_hotspot(hotspot_id, use_gemini=force)
        return {
            "osm_context": osm_data,
            "classification": classification_payload
        }
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="OSM enrichment timed out")
    except Exception as e:
        logger.exception("OSM enrichment failed")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/enrich/top50")
async def enrich_top50(request: EnrichTop50Request = EnrichTop50Request()):
    if request.hotspot_ids is not None:
        ids = [str(v) for v in request.hotspot_ids][:50]
    else:
        res = supabase_service.table("hotspots").select("id,frp").order("frp", desc=True).limit(50).execute()
        ids = [str(r.get("id")) for r in (res.data or []) if r.get("id") is not None]
    results = []
    for hotspot_id in ids:
        try:
            osm_context, osm_data, _ = await _enrich_one_hotspot(hotspot_id)
            results.append({"hotspot_id": hotspot_id, "status": "ok", "context": osm_data})
        except Exception as e:
            results.append({"hotspot_id": hotspot_id, "status": "error", "error": str(e)})
    return {"processed": len(results), "results": results}

