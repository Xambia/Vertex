from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict, Any, List

class FIRMSHotspot(BaseModel):
    latitude: float
    longitude: float
    bright_ti4: Optional[float] = None
    brightness: Optional[float] = None
    scan: Optional[float] = None
    track: Optional[float] = None
    version: Optional[str] = None
    bright_t31: Optional[float] = None
    frp: Optional[float] = None
    confidence: Optional[str] = None
    daynight: Optional[str] = None
    satellite: Optional[str] = None
    acq_date: Optional[str] = None
    acq_time: Optional[str] = None
    instrument: Optional[str] = None

    @field_validator('acq_time', mode='before')
    def validate_acq_time(cls, v):
        if isinstance(v, int):
            return f"{v:04d}"
        return str(v) if v is not None else None

class HotspotGeoJSON(BaseModel):
    type: str = "Feature"
    geometry: Dict[str, Any]
    properties: Dict[str, Any]

class PersistentSource(BaseModel):
    id: Optional[str] = None
    centroid_lat: float
    centroid_lon: float
    first_seen: Optional[str] = None # Will store datetime as ISO string
    last_seen: Optional[str] = None
    observation_count: int = 1
    active_days: int = 1
    avg_frp: Optional[float] = None
    max_frp: Optional[float] = None
    avg_confidence: Optional[float] = None
    persistence_duration: Optional[float] = None
