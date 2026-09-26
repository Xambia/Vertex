import httpx

# Ensure httpx clients created by google-genai SDK don't fail SSL verification on Windows
_original_sync_init = httpx.Client.__init__
httpx.Client.__init__ = lambda self, *args, **kwargs: _original_sync_init(self, *args, **{**kwargs, 'verify': False})
_original_async_init = httpx.AsyncClient.__init__
httpx.AsyncClient.__init__ = lambda self, *args, **kwargs: _original_async_init(self, *args, **{**kwargs, 'verify': False})

from google import genai
from pydantic import ValidationError
import json
import logging
from config import settings
from models.hotspot import FIRMSHotspot
from models.classification import OSMContext, ClassificationResult, ClassificationEnum

logger = logging.getLogger(__name__)
logging.getLogger("google_genai.models").setLevel(logging.WARNING)

client = genai.Client(api_key=settings.GEMINI_API_KEY)

async def classify_with_gemini(hotspot: FIRMSHotspot, osm_context: OSMContext) -> ClassificationResult:
    prompt = f"""
    Analyze the following fire/hotspot event and classify it into one of these categories:
    INDUSTRIAL_FIRE, PERSISTENT_INDUSTRIAL_SOURCE, GAS_FLARE, WILDFIRE_FOREST_FIRE, AGRICULTURAL_BURN, MINING_THERMAL_ACTIVITY, OTHER_THERMAL_ANOMALY, UNKNOWN_UNCERTAIN.
    
    Hotspot Data:
    - Latitude: {hotspot.latitude}
    - Longitude: {hotspot.longitude}
    - FRP (Fire Radiative Power): {hotspot.frp} MW
    - Confidence: {hotspot.confidence}
    - Day/Night: {hotspot.daynight}
    - Acquisition Date/Time: {hotspot.acq_date} {hotspot.acq_time}
    - Satellite/Instrument: {hotspot.satellite} {hotspot.instrument}
    
    OSM Context (nearby features) - Source: {osm_context.osm_source}:
    - Nearest industrial facility type: {osm_context.nearest_facility_type}
    - Distance to nearest industrial facility: {osm_context.nearest_facility_distance} meters
    - Total industrial facilities in 5km: {osm_context.facility_count_in_radius}
    - Local land use context (2km radius): {', '.join(osm_context.land_use_context) if osm_context.land_use_context else 'None identified'}
    - Nearby water context: {', '.join(osm_context.water_context) if osm_context.water_context else 'None identified'}
    - Hotspot within/very near mapped water feature: {osm_context.near_water}
    
    Rules:
    - High FRP and very close proximity (<500m) to a refinery/power plant/flare strongly suggests GAS_FLARE.
    - Low FRP, persistent and close proximity to an industrial facility strongly suggests PERSISTENT_INDUSTRIAL_SOURCE.
    - Accidental or structural fires at industrial zones are INDUSTRIAL_FIRE.
    - Geospatial terrain intelligence: OpenStreetMap coverage in rural/industrial India is frequently unmapped or offline. NEVER classify as UNKNOWN_UNCERTAIN merely because OSM context is 'None identified' or 'FAILED'. You possess expert knowledge of Indian geography: evaluate the exact Latitude and Longitude coordinates against India's industrial hubs, ports, refineries, mining belts, agrarian plains, and forest biomes.
    - Nighttime thermal detections (Day/Night: N): Agricultural stubble burning does not occur at night. Nighttime thermal anomalies with low-to-moderate FRP (1-5 MW) located in industrial zones, ports, chemical corridors, steel belts, or manufacturing nodes (e.g. Kalinganagar, Gandhidham/Kandla, Anjar, Roha/Pen, Jamshedpur, Udaipur/Debari, Hazira) should be classified as PERSISTENT_INDUSTRIAL_SOURCE, GAS_FLARE, or INDUSTRIAL_FIRE.
    - If near coal fields, opencast pits, or mineral belts, classify as MINING_THERMAL_ACTIVITY.
    - If located in dense forests, national reserves, or mountainous tracts (e.g. Western Ghats, Northeast India, Central Indian hills), classify as WILDFIRE_FOREST_FIRE.
    - Daytime thermal detections (Day/Night: D): In rural cultivated plains with low-to-moderate FRP, classify as AGRICULTURAL_BURN.
    - Reserve UNKNOWN_UNCERTAIN strictly for anomalous coordinates with completely conflicting physical signatures.
    
    Return a JSON response with exactly this structure:
    {{
      "classification": "...",
      "confidence_score": 0.9,
      "explanation": "...",
      "evidence": ["...", "..."],
      "risk_level": "LOW", // Can be LOW, MODERATE, HIGH, CRITICAL
      "source_data": {{"model": "{settings.GEMINI_MODEL}"}}
    }}
    """
    
    try:
        import asyncio
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config={
                'response_mime_type': 'application/json'
            }
        )
        
        data = json.loads(response.text)
        
        raw_cls = data.get("classification", "UNKNOWN_UNCERTAIN")
        # Strict domain rule: Agricultural stubble burning does not occur at night in India
        if hotspot.daynight == "N" and raw_cls == "AGRICULTURAL_BURN":
            if (osm_context.nearby_facilities and len(osm_context.nearby_facilities) > 0) or (hotspot.frp and hotspot.frp < 5.0):
                raw_cls = "PERSISTENT_INDUSTRIAL_SOURCE"
            else:
                raw_cls = "OTHER_THERMAL_ANOMALY"

        try:
            parsed_enum = ClassificationEnum(raw_cls)
        except ValueError:
            parsed_enum = ClassificationEnum.OTHER_THERMAL_ANOMALY

        return ClassificationResult(
            classification=parsed_enum,
            confidence_score=float(data.get("confidence_score", 0.5)),
            explanation=str(data.get("explanation", "Could not fully parse reasoning.")),
            evidence=data.get("evidence", []),
            risk_level=data.get("risk_level", "LOW"),
            source_data=data.get("source_data", {"model": settings.GEMINI_MODEL})
        )
        
    except Exception as e:
        logger.error(f"Gemini classification error: {e}")
        return ClassificationResult(
            classification=ClassificationEnum.UNKNOWN_UNCERTAIN,
            confidence_score=0.1,
            explanation=f"Error calling LLM: {str(e)}",
            evidence=[],
            risk_level="LOW",
            source_data={"error": str(e)}
        )
