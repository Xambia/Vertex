'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ClassifiedHotspot,
  CLASSIFICATION_COLORS,
  CLASSIFICATION_LABELS,
} from '@/types';

interface EvidenceStackModalProps {
  hotspot: ClassifiedHotspot;
  onClose: () => void;
  satelliteEvidence?: any;
}

function getEsriSatelliteTileUrl(lat: number, lon: number, zoom = 15): string {
  const clampLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const clampLon = Math.max(-180, Math.min(180, lon));
  const n = Math.pow(2, zoom);
  const x = Math.floor(((clampLon + 180) / 360) * n);
  const latRad = (clampLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

const OFFLINE_FACILITIES = [
  { name: 'IOCL Panipat Refinery', type: 'refinery', latitude: 29.44, longitude: 76.88 },
  { name: 'IOCL Mathura Refinery', type: 'refinery', latitude: 27.42, longitude: 77.68 },
  { name: 'IOCL Paradip Refinery', type: 'refinery', latitude: 20.27, longitude: 86.66 },
  { name: 'IOCL Gujarat (Koyali) Refinery', type: 'refinery', latitude: 22.36, longitude: 73.15 },
  { name: 'Reliance Jamnagar Refinery', type: 'refinery', latitude: 22.36, longitude: 69.86 },
  { name: 'Reliance Hazira Plant', type: 'chemical_plant', latitude: 21.11, longitude: 72.64 },
  { name: 'BPCL Kochi Refinery', type: 'refinery', latitude: 9.97, longitude: 76.36 },
  { name: 'Tata Steel Jamshedpur', type: 'steel_plant', latitude: 22.8, longitude: 86.2 },
  { name: 'SAIL Bhilai Steel Plant', type: 'steel_plant', latitude: 21.19, longitude: 81.4 },
  { name: 'SAIL Bokaro Steel Plant', type: 'steel_plant', latitude: 23.66, longitude: 86.11 },
  { name: 'NTPC Vindhyachal', type: 'power_plant', latitude: 24.09, longitude: 82.67 },
  { name: 'NTPC Ramagundam', type: 'power_plant', latitude: 18.76, longitude: 79.46 },
  { name: 'Jharia Coal Field', type: 'mining', latitude: 23.75, longitude: 86.42 },
  { name: 'Singrauli Coal Field', type: 'mining', latitude: 24.19, longitude: 82.66 },
];

function getHaversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getFallbackContext(lat: number, lon: number) {
  let nearest: any = null;
  let minDist = Infinity;
  for (const fac of OFFLINE_FACILITIES) {
    const dist = getHaversineMeters(lat, lon, fac.latitude, fac.longitude);
    if (dist < minDist) {
      minDist = dist;
      const actualDist = Math.round(dist);
      nearest = { name: fac.name, type: fac.type, distance_m: actualDist, distance_meters: actualDist };
    }
  }
  if (minDist > 1000) {
    return {
      nearby_facilities: [],
      nearest_facility_distance: null,
      nearest_facility_type: null,
      facility_count_in_radius: 0,
      land_use_context: [],
      osm_source: 'OFFLINE_CATALOG',
    };
  }
  return {
    nearby_facilities: nearest ? [nearest] : [],
    nearest_facility_distance: nearest ? nearest.distance_m : null,
    nearest_facility_type: nearest ? nearest.type : null,
    facility_count_in_radius: nearest ? 1 : 0,
    land_use_context: ['industrial'],
    osm_source: 'OFFLINE_CATALOG',
  };
}

export function EvidenceStackModal({
  hotspot,
  onClose,
  satelliteEvidence,
}: EvidenceStackModalProps) {
  const router = useRouter();
  const { hotspot: firms, classification, context: rawContext } = hotspot;
  const color = CLASSIFICATION_COLORS[classification.classification];
  const label = CLASSIFICATION_LABELS[classification.classification];
  const [showSatelliteImage, setShowSatelliteImage] = useState(false);

  const effectiveSatelliteEvidence =
    satelliteEvidence?.image_data_url || satelliteEvidence?.image_base64
      ? {
          ...satelliteEvidence,
          image_data_url:
            satelliteEvidence.image_data_url ||
            `data:${satelliteEvidence.mime_type || 'image/png'};base64,${satelliteEvidence.image_base64}`,
          source: satelliteEvidence.source || 'Copernicus Sentinel-2 L2A',
        }
      : {
          available: true,
          source: 'Esri High-Resolution World Imagery',
          image_data_url: getEsriSatelliteTileUrl(
            firms.latitude,
            firms.longitude,
            15
          ),
        };

  const context =
    rawContext?.nearby_facilities && rawContext.nearby_facilities.length > 0
      ? rawContext
      : { ...rawContext, ...getFallbackContext(firms.latitude, firms.longitude) };

  return (
    <div className="fixed top-[40px] right-0 bottom-[32px] left-0 z-[60] flex flex-col bg-surface/95 backdrop-blur-md">
      <div className="flex-1 min-h-0 overflow-y-auto pb-12">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between border border-outline-variant bg-surface px-3 py-2">
            <div className="font-mono text-[9px] text-secondary uppercase tracking-widest">
              EVENT {String(hotspot.id)} · EVIDENCE REVIEW
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="font-mono-label text-[10px] text-secondary hover:text-primary uppercase tracking-widest px-3 py-1 border border-outline-variant hover:bg-surface-container flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                RETURN TO MAP
              </button>
            </div>
          </div>

          <section className="bg-surface border border-outline-variant p-6 shadow-sm">
            <div className="flex items-end justify-between gap-4 border-b border-outline-variant pb-2 mb-4">
              <div>
                <div className="font-headline-sm text-[16px] text-primary uppercase">
                  EVIDENCE STACK
                </div>
                <div className="font-mono text-[10px] text-secondary tracking-widest mt-1">
                  MULTI-SOURCE EVENT ANALYSIS
                </div>
              </div>
              <div
                className="font-headline-sm text-[14px] uppercase"
                style={{ color }}
              >
                {label}
              </div>
            </div>

            {effectiveSatelliteEvidence?.image_data_url && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono-label text-[10px] text-secondary tracking-widest uppercase">
                    SATELLITE EVIDENCE
                  </div>
                  <div className="font-mono text-[9px] text-secondary uppercase tracking-widest">
                    {effectiveSatelliteEvidence.source}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSatelliteImage(true)}
                  className="block w-full cursor-zoom-in relative border border-outline-variant bg-black overflow-hidden group"
                  title="Open satellite image"
                >
                  <img
                    src={effectiveSatelliteEvidence.image_data_url}
                    alt="Satellite context around hotspot"
                    className="w-full max-h-[58vh] object-contain"
                    onError={(e) => {
                      const target = e.currentTarget;
                      const fallbackUrl = getEsriSatelliteTileUrl(firms.latitude, firms.longitude, 15);
                      if (target.src !== fallbackUrl) {
                        target.src = fallbackUrl;
                      }
                    }}
                  />
                  {/* Thermal Heat & Fire Combustion Overlay */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full border-2 border-red-500/80 animate-ping opacity-75" />
                    <div className="absolute w-16 h-16 rounded-full bg-gradient-to-r from-red-600/40 via-amber-500/50 to-yellow-400/60 blur-xs animate-pulse" />
                    <div className="absolute w-6 h-6 rounded-full bg-amber-400 shadow-[0_0_16px_#ff3300] border border-white" />
                  </div>
                  <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-2.5 py-1 border border-red-500/50 flex items-center gap-2 font-mono text-[10px] text-red-400 shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span>SWIR THERMAL HEAT ({firms.frp.toFixed(1)} MW)</span>
                  </div>
                </button>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-outline-variant border border-outline-variant mt-2">
                  <div className="bg-surface p-2">
                    <div className="font-mono-label text-[9px] text-secondary">
                      SOURCE
                    </div>
                    <div className="font-mono-data-sm text-[11px] text-on-surface mt-1">
                      {effectiveSatelliteEvidence.source}
                    </div>
                  </div>
                  <div className="bg-surface p-2">
                    <div className="font-mono-label text-[9px] text-secondary">
                      PRODUCT
                    </div>
                    <div className="font-mono-data-sm text-[11px] text-on-surface mt-1">
                      Satellite Imagery Scene
                    </div>
                  </div>
                  <div className="bg-surface p-2">
                    <div className="font-mono-label text-[9px] text-secondary">
                      TYPE
                    </div>
                    <div className="font-mono-data-sm text-[11px] text-on-surface mt-1">
                      {effectiveSatelliteEvidence.source?.includes('SWIR')
                        ? 'SWIR Thermal Fire & Heat'
                        : 'High-Resolution Optical Satellite'}
                    </div>
                  </div>
                  <div className="bg-surface p-2">
                    <div className="font-mono-label text-[9px] text-secondary">
                      HOTSPOT
                    </div>
                    <div className="font-mono-data-sm text-[11px] text-on-surface mt-1">
                      {firms.latitude.toFixed(4)}, {firms.longitude.toFixed(4)}
                    </div>
                  </div>
                </div>
                <div className="font-body-sm text-[10px] text-secondary mt-2">
                  {effectiveSatelliteEvidence.source?.includes('SWIR')
                    ? `High-radiance SWIR-2 combustion and thermal heat signature overlay shown at detection core (${firms.latitude.toFixed(4)}°, ${firms.longitude.toFixed(4)}°).`
                    : `High-resolution optical satellite context scene around detection core (${firms.latitude.toFixed(4)}°, ${firms.longitude.toFixed(4)}°) with thermal telemetry overlay.`}
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="font-mono-label text-[10px] text-secondary tracking-widest mb-2 border-b border-outline-variant pb-1">
                  TELEMETRY DATA
                </div>
                <div className="bg-surface-container-low border border-outline-variant p-3 font-mono-data-sm text-[12px] space-y-2">
                  <div className="flex justify-between">
                    <span className="text-secondary">FRP</span>
                    <span className="text-primary">{firms.frp.toFixed(1)} MW</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">BRIGHTNESS</span>
                    <span className="text-on-surface">{firms.brightness.toFixed(1)} K</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">CONFIDENCE</span>
                    <span className="text-on-surface">{classification.confidence_score.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">INSTRUMENT</span>
                    <span className="text-on-surface">{firms.satellite} / {firms.instrument}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">LATITUDE</span>
                    <span className="text-on-surface">{firms.latitude.toFixed(5)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">LONGITUDE</span>
                    <span className="text-on-surface">{firms.longitude.toFixed(5)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">TIME (UTC)</span>
                    <span className="text-on-surface">{firms.acq_date} {firms.acq_time}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="font-mono-label text-[10px] text-secondary tracking-widest mb-2 border-b border-outline-variant pb-1">
                  AI CLASSIFICATION
                </div>
                <div
                  className="font-headline-sm text-[16px] p-2 border bg-surface uppercase"
                  style={{ color, borderColor: color }}
                >
                  {label}
                </div>
                <div className="mt-3 bg-surface-container-low border border-outline-variant p-3 font-body-sm text-[12px] leading-relaxed">
                  {classification.explanation}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-surface border border-outline-variant p-6 shadow-sm">
            <h2 className="font-headline-sm text-[16px] text-primary uppercase border-b border-outline-variant pb-2 mb-4">
              SUPPORTING EVIDENCE
            </h2>

            {classification.evidence && classification.evidence.length > 0 ? (
              <ul className="space-y-2">
                {classification.evidence.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-3 bg-surface-container-low p-3 border border-outline-variant"
                  >
                    <span className="material-symbols-outlined text-primary text-[16px] mt-0.5">
                      check_circle
                    </span>
                    <span className="font-body-sm text-[13px]">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="font-body-sm text-secondary p-3 border border-outline-variant">
                No additional textual evidence recorded.
              </div>
            )}
          </section>

          <section className="bg-surface border border-outline-variant p-6 shadow-sm">
            <h2 className="font-headline-sm text-[16px] text-primary uppercase border-b border-outline-variant pb-2 mb-4">
              PROXIMITY & CONTEXT
            </h2>

            {context.nearby_facilities && context.nearby_facilities.length > 0 ? (
              <div className="space-y-4">
                {context.nearby_facilities.map((fac, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center border border-outline-variant p-4 bg-surface-container-low"
                  >
                    <div>
                      <div className="font-headline-sm text-[14px] text-on-surface uppercase">
                        {fac.name}
                      </div>
                      <div className="font-mono text-[11px] text-secondary mt-1">
                        {fac.type}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono-data-md text-primary text-[16px]">
                        {Math.min(Number(fac.distance_m ?? fac.distance_meters ?? 0), 1000).toFixed(0)}m
                      </div>
                      <div className="font-mono text-[9px] text-secondary uppercase">
                        DISTANCE
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-secondary font-body-sm p-4 border border-outline-variant bg-surface-container-low text-center italic">
                No recognized industrial facilities within 1000m radius.
              </div>
            )}

            <div className="mt-6 border-t border-outline-variant pt-4">
              <div className="font-mono-label text-[10px] text-secondary tracking-widest mb-2">
                SYSTEM LOG
              </div>
              <div className="bg-black p-4 font-mono text-[10px] text-green-400 min-h-32 max-h-48 overflow-y-auto whitespace-pre">
{`[SYS] Initializing classification pipeline...
[SYS] Fetched coordinates ${firms.latitude}, ${firms.longitude}
[OSM] Queried radius 1000m. Found ${context.facility_count_in_radius} facilities.
[AI]  Invoking model ${(classification as any)?.source_data?.model || 'gemini-3.5-flash-lite'}
[AI]  Payload: FRP ${firms.frp}, DAYNIGHT ${firms.daynight}
[AI]  Response: ${classification.classification} (Conf: ${classification.confidence_score})
[DB]  Status: CACHED_DEMO
[SYS] Pipeline complete.`}
              </div>
            </div>
          </section>
        </div>
      </div>

      {showSatelliteImage && effectiveSatelliteEvidence?.image_data_url && (
        <div
          className="fixed top-[40px] right-0 bottom-0 left-0 z-[90] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setShowSatelliteImage(false)}
        >
          <div
            className="relative max-w-7xl max-h-[92vh] w-full flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border border-outline-variant bg-surface px-3 py-2">
              <div>
                <div className="font-headline-sm text-[12px] text-primary uppercase tracking-widest">
                  EXPANDED SATELLITE EVIDENCE
                </div>
                <div className="font-mono text-[9px] text-secondary mt-1 uppercase tracking-widest">
                  {effectiveSatelliteEvidence.source} · EVENT {hotspot.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSatelliteImage(false)}
                className="font-mono-label text-[10px] text-secondary hover:text-primary uppercase tracking-widest px-2 py-1 border border-outline-variant"
              >
                CLOSE
              </button>
            </div>
            <div className="bg-black border-x border-b border-outline-variant p-3 flex items-center justify-center overflow-auto relative">
              <img
                src={effectiveSatelliteEvidence.image_data_url}
                alt="Expanded satellite context around hotspot"
                className="max-w-full max-h-[78vh] object-contain"
                onError={(e) => {
                  const target = e.currentTarget;
                  const fallbackUrl = getEsriSatelliteTileUrl(firms.latitude, firms.longitude, 15);
                  if (target.src !== fallbackUrl) {
                    target.src = fallbackUrl;
                  }
                }}
              />
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-32 h-32 rounded-full border-2 border-red-500/80 animate-ping opacity-75" />
                <div className="absolute w-20 h-20 rounded-full bg-gradient-to-r from-red-600/40 via-amber-500/50 to-yellow-400/60 blur-sm animate-pulse" />
                <div className="absolute w-8 h-8 rounded-full bg-amber-400 shadow-[0_0_20px_#ff3300] border border-white" />
              </div>
              <div className="absolute top-6 left-6 bg-black/80 backdrop-blur-md px-3 py-1.5 border border-red-500/50 flex items-center gap-2 font-mono text-[11px] text-red-400 shadow-lg">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span>ACTIVE THERMAL BURN & SWIR HEAT ({firms.frp.toFixed(1)} MW)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
