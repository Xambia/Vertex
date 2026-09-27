export enum ClassificationType {
  INDUSTRIAL_FIRE = 'INDUSTRIAL_FIRE',
  PERSISTENT_INDUSTRIAL_SOURCE = 'PERSISTENT_INDUSTRIAL_SOURCE',
  GAS_FLARE = 'GAS_FLARE',
  WILDFIRE_FOREST_FIRE = 'WILDFIRE_FOREST_FIRE',
  AGRICULTURAL_BURN = 'AGRICULTURAL_BURN',
  MINING_THERMAL_ACTIVITY = 'MINING_THERMAL_ACTIVITY',
  OTHER_THERMAL_ANOMALY = 'OTHER_THERMAL_ANOMALY',
  UNKNOWN_UNCERTAIN = 'UNKNOWN_UNCERTAIN',
  UNCLASSIFIED = 'UNCLASSIFIED',
}

export const CLASSIFICATION_COLORS: Record<ClassificationType, string> = {
  [ClassificationType.INDUSTRIAL_FIRE]: '#dc2626', // red
  [ClassificationType.PERSISTENT_INDUSTRIAL_SOURCE]: '#ea580c', // deep orange
  [ClassificationType.GAS_FLARE]: '#f59e0b', // amber
  [ClassificationType.WILDFIRE_FOREST_FIRE]: '#16a34a', // green
  [ClassificationType.AGRICULTURAL_BURN]: '#ca8a04', // yellow
  [ClassificationType.MINING_THERMAL_ACTIVITY]: '#7c3aed', // violet
  [ClassificationType.OTHER_THERMAL_ANOMALY]: '#6366f1', // indigo
  [ClassificationType.UNKNOWN_UNCERTAIN]: '#6b7280', // gray
  [ClassificationType.UNCLASSIFIED]: '#9ca3af', // light gray
};

export const CLASSIFICATION_LABELS: Record<ClassificationType, string> = {
  [ClassificationType.INDUSTRIAL_FIRE]: 'Industrial Fire',
  [ClassificationType.PERSISTENT_INDUSTRIAL_SOURCE]: 'Persistent Ind. Source',
  [ClassificationType.GAS_FLARE]: 'Gas Flare',
  [ClassificationType.WILDFIRE_FOREST_FIRE]: 'Wildfire / Forest Fire',
  [ClassificationType.AGRICULTURAL_BURN]: 'Agricultural Burn',
  [ClassificationType.MINING_THERMAL_ACTIVITY]: 'Mining / Thermal Act.',
  [ClassificationType.OTHER_THERMAL_ANOMALY]: 'Other Thermal Anomaly',
  [ClassificationType.UNKNOWN_UNCERTAIN]: 'Unknown / Uncertain',
  [ClassificationType.UNCLASSIFIED]: 'Unclassified / Pending',
};

export interface FIRMSHotspot {
  id: string;
  latitude: number;
  longitude: number;
  brightness: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
  confidence: string | number;
  version: string;
  bright_t31: number;
  frp: number;
  daynight: string;
  bright_ti4?: number;
  bright_ti5?: number;
}

export interface OSMFacility {
  name: string;
  type: string;
  distance_m: number;
  distance_meters?: number;
}

export type OSMSource = 'LIVE' | 'LIVE_NO_FACILITY' | 'CACHED' | 'CACHED_NO_FACILITY' | 'OFFLINE_CATALOG' | 'FAILED' | 'PENDING' | 'QUERY_FAILED' | 'SERVICE_UNAVAILABLE' | 'NOT_QUERIED';

export interface OSMContext {
  nearby_facilities: OSMFacility[];
  nearest_facility_distance: number | null;
  nearest_facility_type: string | null;
  facility_count_in_radius: number;
  land_use_context: string[];
  osm_source?: OSMSource;
  queried_at?: string | null;
}

export interface ClassificationResult {
  classification: ClassificationType;
  confidence_score: number;
  explanation: string;
  evidence: string[];
  risk_score?: number;
  risk_level?: string;
  source_data?: Record<string, any>;
}

export interface ClassifiedHotspot {
  id: string;
  hotspot: FIRMSHotspot;
  classification: ClassificationResult;
  context: OSMContext;
}

export interface HealthResponse {
  status: string;
  version: string;
}

export interface SystemStatus {
  status: string;
  services: {
    firms: { status: string; last_success?: string };
    facility_data?: { status: string; source?: string };
    osm: { status: string; source?: string };
    gemini: { status: string; model?: string };
    database: { status: string; error?: string };
  };
  classification_model: string;
  version: string;
}

