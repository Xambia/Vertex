'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useGlobalState } from '@/lib/GlobalStateContext';
import {
  ClassifiedHotspot,
  CLASSIFICATION_COLORS,
  CLASSIFICATION_LABELS,
  ClassificationType,
} from '@/types';

interface FilterState {
  classifications: ClassificationType[];
  minFrp: number;
  maxFrp: number;
  minConfidence: number;
  riskLevels: string[];
}

interface SidebarProps {
  hotspots?: ClassifiedHotspot[];
  selectedId?: string;
  onSelect?: (hotspot: ClassifiedHotspot) => void;
  onFiltersChange?: (filters: FilterState) => void;
}

export function Sidebar({
  hotspots = [],
  selectedId,
  onSelect,
  onFiltersChange,
}: SidebarProps) {
  const {
    streamFilter,
    setStreamFilter,
    hotspots: globalHotspots,
    mapStyle,
    setMapStyle,
  } = useGlobalState();

  const sourceHotspots =
    hotspots && hotspots.length > 0
      ? hotspots
      : (globalHotspots || []);

  const [activeTab, setActiveTab] = useState<
    'STREAM' | 'FILTER' | 'LAYERS'
  >('STREAM');

  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  const riskOrder: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MODERATE: 2,
    LOW: 3,
  };

  const isClassified = (h: ClassifiedHotspot) =>
    Boolean(
      h?.classification?.classification &&
      h.classification.classification !== ClassificationType.UNCLASSIFIED
    );

  const sortedHotspots = useMemo(() => {
    let filtered = sourceHotspots;

    if (streamFilter === 'CLASSIFIED') {
      filtered = sourceHotspots.filter(isClassified);
    } else if (streamFilter === 'PENDING') {
      filtered = sourceHotspots.filter((h) => !isClassified(h));
    }

    return [...filtered].sort((a, b) => {
      const aClassified = isClassified(a);
      const bClassified = isClassified(b);

      if (aClassified && !bClassified) {
        return -1;
      }

      if (!aClassified && bClassified) {
        return 1;
      }

      if (aClassified && bClassified) {
        const aRisk = String(a?.classification?.risk_level || 'LOW').toUpperCase();
        const bRisk = String(b?.classification?.risk_level || 'LOW').toUpperCase();
        const aRank = riskOrder[aRisk] ?? 4;
        const bRank = riskOrder[bRisk] ?? 4;

        if (aRank !== bRank) {
          return aRank - bRank;
        }

        const aScore = Number(a?.classification?.risk_score ?? 0);
        const bScore = Number(b?.classification?.risk_score ?? 0);
        if (aScore !== bScore) {
          return bScore - aScore;
        }
      }

      return (
        Number(b?.hotspot?.frp || 0) -
        Number(a?.hotspot?.frp || 0)
      );
    });
  }, [sourceHotspots, hotspots, streamFilter]);

  const [draftFilters, setDraftFilters] = useState<FilterState>({
    classifications: [],
    minFrp: 0,
    maxFrp: 1000,
    minConfidence: 0,
    riskLevels: [],
  });

  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    classifications: [],
    minFrp: 0,
    maxFrp: 1000,
    minConfidence: 0,
    riskLevels: [],
  });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.classifications.length > 0) count += appliedFilters.classifications.length;
    if (appliedFilters.minConfidence > 0) count += 1;
    if (appliedFilters.minFrp > 0 || appliedFilters.maxFrp < 1000) count += 1;
    if (appliedFilters.riskLevels.length > 0) count += appliedFilters.riskLevels.length;
    return count;
  }, [appliedFilters]);

  const isFilterModified = useMemo(() => {
    return JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters);
  }, [draftFilters, appliedFilters]);

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters);
    onFiltersChange?.(draftFilters);
  };

  const handleResetFilters = () => {
    const empty: FilterState = {
      classifications: [],
      minFrp: 0,
      maxFrp: 1000,
      minConfidence: 0,
      riskLevels: [],
    };
    setDraftFilters(empty);
    setAppliedFilters(empty);
    onFiltersChange?.(empty);
  };

  const toggleClassification = (type: ClassificationType) => {
    setDraftFilters((prev) => ({
      ...prev,
      classifications: prev.classifications.includes(type)
        ? prev.classifications.filter((t) => t !== type)
        : [...prev.classifications, type],
    }));
  };

  const toggleRiskLevel = (level: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      riskLevels: prev.riskLevels.includes(level)
        ? prev.riskLevels.filter((l) => l !== level)
        : [...prev.riskLevels, level],
    }));
  };

  return (
    <aside className="bg-surface-container-low w-[300px] h-[calc(100vh-72px)] flex flex-col border-r border-outline-variant fixed left-0 top-[40px] bottom-[32px] z-40 overflow-hidden">

      {/* HEADER */}
      <div className="p-2 border-b border-outline-variant shrink-0">
        <div className="font-headline-sm text-[14px] text-[#193946] font-black tracking-wide">
          ANOMALY STREAM
        </div>

        <div className="font-body-sm text-[11px] text-[#556575] mt-1 tracking-widest uppercase">
          REAL-TIME THERMAL EVENTS
        </div>
      </div>

      {/* MAIN TABS */}
      <div className="flex border-b border-outline-variant bg-surface shrink-0">

        <button
          onClick={() => setActiveTab('STREAM')}
          className={`flex-1 py-2 flex flex-col items-center transition-all border-b-[3px] ${
            activeTab === 'STREAM'
              ? 'border-[#f5751c] bg-[#f5751c]/10 text-[#f5751c] font-bold shadow-[inset_0_-2px_6px_rgba(245,117,28,0.12)]'
              : 'border-transparent text-[#556575] hover:text-[#f5751c] hover:bg-[#f5751c]/5'
          }`}
        >
          <span className="material-symbols-outlined text-[16px] mb-1 font-mono">
            radar
          </span>

          <span className="font-mono-label text-[10px] tracking-widest">
            STREAM
          </span>
        </button>

        <button
          onClick={() => setActiveTab('FILTER')}
          className={`flex-1 py-2 flex flex-col items-center transition-all border-b-[3px] relative ${
            activeTab === 'FILTER'
              ? 'border-[#556575] bg-[#556575]/10 text-[#193946] font-bold shadow-[inset_0_-2px_6px_rgba(85,101,117,0.12)]'
              : 'border-transparent text-[#556575] hover:text-[#193946] hover:bg-[#556575]/5'
          }`}
        >
          <span className="material-symbols-outlined text-[16px] mb-1 font-mono">
            filter_alt
          </span>

          <span className="font-mono-label text-[10px] tracking-widest flex items-center gap-1">
            FILTER
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#f5751c] text-white text-[9px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('LAYERS')}
          className={`flex-1 py-2 flex flex-col items-center transition-all border-b-[3px] ${
            activeTab === 'LAYERS'
              ? 'border-[#193946] bg-[#193946]/10 text-[#193946] font-bold shadow-[inset_0_-2px_6px_rgba(25,57,70,0.12)]'
              : 'border-transparent text-[#556575] hover:text-[#193946] hover:bg-[#193946]/5'
          }`}
        >
          <span className="material-symbols-outlined text-[16px] mb-1 font-mono">
            layers
          </span>

          <span className="font-mono-label text-[10px] tracking-widest">
            LAYERS
          </span>
        </button>

      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto pb-12">

        {/* ================================================= */}
        {/* STREAM */}
        {/* ================================================= */}

        {activeTab === 'STREAM' && (
          <>
            {/* STREAM FILTER */}
            <div className="flex border-b border-outline-variant bg-surface shrink-0">

              <button
                onClick={() => setStreamFilter('ALL')}
                className={`flex-1 py-1.5 text-center font-mono-label text-[10px] tracking-widest uppercase transition-all border-b-2 ${
                  streamFilter === 'ALL'
                    ? 'border-[#193946] bg-[#193946]/10 text-[#193946] font-bold'
                    : 'border-transparent text-[#797983] hover:text-[#193946] hover:bg-[#193946]/5'
                }`}
              >
                ALL
              </button>

              <button
                onClick={() => setStreamFilter('CLASSIFIED')}
                className={`flex-1 py-1.5 text-center font-mono-label text-[10px] tracking-widest uppercase transition-all border-b-2 ${
                  streamFilter === 'CLASSIFIED'
                    ? 'border-[#f5751c] bg-[#f5751c]/10 text-[#f5751c] font-bold'
                    : 'border-transparent text-[#797983] hover:text-[#f5751c] hover:bg-[#f5751c]/5'
                }`}
              >
                CLASSIFIED
              </button>

              <button
                onClick={() => setStreamFilter('PENDING')}
                className={`flex-1 py-1.5 text-center font-mono-label text-[10px] tracking-widest uppercase transition-all border-b-2 ${
                  streamFilter === 'PENDING'
                    ? 'border-[#fca26e] bg-[#fca26e]/15 text-[#c95914] font-bold'
                    : 'border-transparent text-[#797983] hover:text-[#c95914] hover:bg-[#fca26e]/5'
                }`}
              >
                PENDING
              </button>

            </div>

            {/* HOTSPOT LIST */}
            <div className="px-2.5 py-1.5 border-b border-[#efbc9d]/40 bg-[#193946]/5 shrink-0 flex items-center justify-between">
              <div className="font-mono text-[10px] text-[#193946] font-black uppercase tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f5751c]" />
                {sortedHotspots.length} PRIORITY EVENTS
              </div>
              <span className="font-mono text-[9px] text-[#556575] font-bold uppercase">LIVE RADAR</span>
            </div>
            {sortedHotspots.length > 0 ? (

              sortedHotspots.map(
                (h, i) => {

                  const classification =
                    h.classification
                      .classification;

                  const isPending =
                    classification ===
                    ClassificationType.UNCLASSIFIED;

                  const context =
                    h.context;

                  const confidence =
                    Number(
                      h.classification
                        .confidence_score
                    ) || 0;

                  const normSelected = String(selectedId || '').replace(/^vtx-/i, '');
                  const normId = String(h.id || '').replace(/^vtx-/i, '');
                  const isSelected = Boolean(selectedId && normSelected === normId);
                  const frpValue = Number(h.hotspot?.frp ?? 0);
                  const riskLevel = String(h.classification?.risk_level || 'LOW').toUpperCase();

                  return (
                    <div
                      key={
                        h.id || `hotspot-${i}`
                      }
                      ref={isSelected ? selectedRef : undefined}
                      onClick={() => onSelect?.(h)}
                      className={`px-2.5 py-3 border-b border-[#efbc9d]/30 cursor-pointer transition-all flex items-start gap-3 ${
                        isSelected
                          ? 'border-l-[3.5px] border-l-[#f5751c] bg-[#193946]/[0.07] shadow-[inset_0_1px_3px_rgba(25,57,70,0.05)]'
                          : 'border-l-[3.5px] border-l-transparent bg-surface hover:bg-[#193946]/[0.03]'
                      }`}
                    >

                      {/* RANK */}
                      <div className="w-6 shrink-0 mt-0.5">
                        <div className={`font-mono text-[12px] font-black text-center ${
                          isSelected ? 'text-[#f5751c]' : 'text-[#193946]'
                        }`}>
                          {i + 1}
                        </div>

                        <div className="font-mono text-[8px] text-[#556575] text-center mt-0.5 font-bold">
                          PRI
                        </div>
                      </div>

                      {/* FIRE ICON */}
                      <div className="mt-1 shrink-0">
                        <span
                          className="material-symbols-outlined text-lg"
                          style={{
                            color:
                              CLASSIFICATION_COLORS[
                                classification as ClassificationType
                              ] || '#888',
                          }}
                        >
                          local_fire_department
                        </span>
                      </div>

                      {/* DETAILS */}
                      <div className="flex-1 overflow-hidden">

                        {/* ID + FRP + RISK + CONFIDENCE */}
                        <div className="flex justify-between items-center mb-1 gap-2 flex-wrap">

                          <span className={`font-mono text-[11px] font-black tracking-wide ${
                            isSelected ? 'text-[#f5751c]' : 'text-[#193946]'
                          }`}>
                            VTX-{normId}
                          </span>

                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {frpValue > 0 && (
                              <span className="font-mono text-[9px] font-bold text-amber-700 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                {frpValue.toFixed(1)} MW
                              </span>
                            )}
                            {!isPending && riskLevel && (
                              <span className={`font-mono text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                                riskLevel === 'CRITICAL'
                                  ? 'bg-red-600 text-white shadow-sm'
                                  : riskLevel === 'HIGH'
                                  ? 'bg-rose-500/20 text-rose-700 border border-rose-500/30'
                                  : riskLevel === 'MODERATE'
                                  ? 'bg-amber-500/15 text-amber-800 border border-amber-500/25'
                                  : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
                              }`}>
                                {riskLevel}
                              </span>
                            )}
                            <span className="font-mono text-[9px] font-bold text-[#193946] bg-[#193946]/10 px-1.5 py-0.5 rounded border border-[#193946]/20">
                              {isPending
                                ? 'PENDING'
                                : `${(confidence * 100).toFixed(0)}%`}
                            </span>
                          </div>

                        </div>

                        {/* CLASSIFICATION */}
                        <div className="font-headline-sm text-[13px] text-[#193946] font-bold uppercase tracking-wider truncate">
                          {CLASSIFICATION_LABELS[
                            classification as ClassificationType
                          ] ||
                            'UNKNOWN_UNCERTAIN'}
                        </div>

                        {/* OSM CONTEXT */}
                        <div className="font-body-sm text-[11px] text-[#556575] mt-1 truncate">
                          {(() => {
                            if (!context || context.osm_source === 'PENDING' || isPending) {
                              return 'Analyzing area context...';
                            }

                            const topFac = context.nearby_facilities?.[0];
                            const dist =
                              topFac?.distance_m != null
                                ? Math.round(Number(topFac.distance_m))
                                : (context.nearest_facility_distance != null
                                  ? Math.round(Number(context.nearest_facility_distance))
                                  : null);

                            if (dist != null && dist <= 1500) {
                              const facName = topFac?.name && topFac.name !== 'Unknown Facility'
                                ? topFac.name
                                : (context.nearest_facility_type || 'Industrial Facility')
                                    .replace(/_/g, ' ')
                                    .replace(/\b\w/g, (c: string) => c.toUpperCase());
                              const distStr = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`;
                              return `${facName} (${distStr})`;
                            }

                            if (
                              classification === ClassificationType.INDUSTRIAL_FIRE ||
                              classification === ClassificationType.GAS_FLARE
                            ) {
                              return 'Industrial corridor / facility';
                            }

                            if (context.osm_source === 'FAILED') {
                              return 'Geospatial query offline';
                            }

                            return 'No industrial site nearby';
                          })()}
                        </div>

                      </div>

                    </div>
                  );
                }
              )

            ) : (

              <div className="p-4 text-center mt-8">

                <span className="material-symbols-outlined text-4xl text-outline-variant animate-pulse">
                  satellite_alt
                </span>

                <div className="font-mono text-[11px] text-secondary mt-4 uppercase tracking-widest">
                  Awaiting Live Telemetry
                </div>

              </div>

            )}

          </>
        )}

        {/* ================================================= */}
        {/* FILTER */}
        {/* ================================================= */}

        {activeTab === 'FILTER' && (
          <div className="p-4 space-y-6">

            {/* CLASSIFICATION */}
            <div>

              <div className="font-mono-label text-[10px] text-secondary mb-2 tracking-widest">
                CLASSIFICATION TYPE
              </div>

              <div className="space-y-2">

                {Object.values(
                  ClassificationType
                ).map(
                  (type) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 cursor-pointer group"
                    >

                      <input
                        type="checkbox"
                        checked={draftFilters.classifications.includes(
                          type
                        )}
                        onChange={() =>
                          toggleClassification(
                            type
                          )
                        }
                        className="accent-primary w-3.5 h-3.5 bg-surface border-outline-variant cursor-pointer"
                      />

                      <div
                        className="w-2.5 h-2.5 shrink-0"
                        style={{
                          backgroundColor:
                            CLASSIFICATION_COLORS[
                              type
                            ],
                        }}
                      />

                      <span className="font-body-sm text-[11px] group-hover:text-primary transition-colors">
                        {
                          CLASSIFICATION_LABELS[
                            type
                          ]
                        }
                      </span>

                    </label>
                  )
                )}

              </div>

            </div>

            {/* CONFIDENCE */}
            <div>

              <div className="font-mono-label text-[10px] text-secondary mb-2 tracking-widest">
                MIN CONFIDENCE (
                {draftFilters.minConfidence.toFixed(
                  2
                )}
                )
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={
                  draftFilters.minConfidence
                }
                onChange={(e) =>
                  setDraftFilters(
                    (prev) => ({
                      ...prev,
                      minConfidence:
                        parseFloat(
                          e.target.value
                        ),
                    })
                  )
                }
                className="w-full accent-primary cursor-pointer"
              />

            </div>

            {/* FRP */}
            <div>

              <div className="font-mono-label text-[10px] text-secondary mb-2 tracking-widest">
                FIRE RADIATIVE POWER (MW)
              </div>

              <div className="flex gap-2 items-center">

                <input
                  type="number"
                  value={
                    draftFilters.minFrp
                  }
                  onChange={(e) =>
                    setDraftFilters(
                      (prev) => ({
                        ...prev,
                        minFrp:
                          parseFloat(
                            e.target.value
                          ) || 0,
                      })
                    )
                  }
                  className="w-full bg-surface-container border border-outline-variant px-2 py-1 font-mono text-[11px] text-on-surface focus:border-primary outline-none"
                  placeholder="Min"
                />

                <span className="text-secondary">
                  -
                </span>

                <input
                  type="number"
                  value={
                    draftFilters.maxFrp
                  }
                  onChange={(e) =>
                    setDraftFilters(
                      (prev) => ({
                        ...prev,
                        maxFrp:
                          parseFloat(
                            e.target.value
                          ) || 1000,
                      })
                    )
                  }
                  className="w-full bg-surface-container border border-outline-variant px-2 py-1 font-mono text-[11px] text-on-surface focus:border-primary outline-none"
                  placeholder="Max"
                />

              </div>

            </div>

            {/* RISK */}
            <div>

              <div className="font-mono-label text-[10px] text-secondary mb-2 tracking-widest">
                RISK LEVEL
              </div>

              <div className="space-y-2">

                {[
                  'CRITICAL',
                  'HIGH',
                  'MODERATE',
                  'LOW',
                ].map(
                  (level) => (
                    <label
                      key={level}
                      className="flex items-center gap-2 cursor-pointer group"
                    >

                      <input
                        type="checkbox"
                        checked={draftFilters.riskLevels.includes(
                          level
                        )}
                        onChange={() =>
                          toggleRiskLevel(
                            level
                          )
                        }
                        className="accent-primary w-3.5 h-3.5 bg-surface border-outline-variant cursor-pointer"
                      />

                      <span className="font-body-sm text-[11px] group-hover:text-primary transition-colors">
                        {level}
                      </span>

                    </label>
                  )
                )}

              </div>

            </div>

            {/* BOTTOM APPLY & RESET BUTTONS */}
            <div className="space-y-2 pt-4 border-t border-outline-variant">
              <button
                type="button"
                id="apply-filters-btn"
                onClick={handleApplyFilters}
                className={`w-full py-2.5 px-3 font-mono-label text-[11px] font-bold tracking-widest uppercase transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md ${
                  isFilterModified
                    ? 'bg-primary text-on-primary ring-2 ring-primary ring-offset-1 hover:brightness-110'
                    : 'bg-primary text-on-primary hover:brightness-105'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">filter_alt</span>
                APPLY FILTERS {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
              </button>

              <button
                type="button"
                onClick={handleResetFilters}
                className="w-full py-1.5 bg-surface-container border border-outline-variant text-secondary font-mono-label text-[10px] tracking-widest uppercase hover:border-primary hover:text-primary transition-colors cursor-pointer"
              >
                RESET FILTERS
              </button>
            </div>

          </div>
        )}

        {/* ================================================= */}
        {/* LAYERS */}
        {/* ================================================= */}

        {activeTab === 'LAYERS' && (
          <div className="p-4 space-y-4">
            <div>
              <div className="font-headline-sm text-[12px] text-[#193946] font-black mb-3 tracking-widest uppercase flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-[#193946]" />
                Base Map Imagery & Theme
              </div>
              <div className="space-y-2.5">
                {[
                  {
                    id: 'Esri World Imagery (Satellite)',
                    name: 'Satellite Imagery',
                    provider: 'Esri World Imagery',
                    icon: 'satellite_alt',
                    badge: 'PHOTOGRAPHIC',
                  },
                  {
                    id: 'Dark Tactical',
                    name: 'Dark Tactical',
                    provider: 'Tactical Dark Canvas',
                    icon: 'contrast',
                    badge: 'TACTICAL',
                  },
                  {
                    id: 'OSM Light',
                    name: 'Street / Terrain Light',
                    provider: 'OpenStreetMap',
                    icon: 'map',
                    badge: 'REFERENCE',
                  },
                ].map((layer) => {
                  const isSelected =
                    mapStyle === layer.id ||
                    (layer.id.includes('Satellite') && (mapStyle === 'Satellite' || mapStyle === 'Esri Satellite' || mapStyle === 'Satellite Imagery (Esri)')) ||
                    (layer.id === 'Dark Tactical' && (mapStyle === 'Dark Canvas' || mapStyle === 'OpenFreeMap Dark' || mapStyle === 'Carto Dark (OSM Dark)' || mapStyle === 'Carto Dark Matter')) ||
                    (layer.id === 'OSM Light' && (mapStyle === 'Standard OpenStreetMap' || mapStyle === 'OpenStreetMap'));

                  return (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setMapStyle(layer.id)}
                      className={`w-full text-left p-3 border transition-all flex items-start gap-3 cursor-pointer rounded-sm ${
                        isSelected
                          ? 'border-2 border-[#193946] bg-[#193946]/10 shadow-[0_2px_8px_rgba(25,57,70,0.12)]'
                          : 'border-[#efbc9d]/60 bg-surface hover:border-[#193946]/40 hover:bg-[#193946]/[0.03]'
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[20px] mt-0.5 ${
                          isSelected ? 'text-[#193946]' : 'text-[#556575]'
                        }`}
                      >
                        {layer.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-mono text-[11px] font-black uppercase tracking-wider ${
                            isSelected ? 'text-[#193946]' : 'text-[#193946]/90'
                          }`}>
                            {layer.name}
                          </span>
                          <span className={`font-mono text-[8px] px-1.5 py-0.5 tracking-widest uppercase font-bold rounded-xs ${
                            isSelected
                              ? 'bg-[#193946] text-white'
                              : 'text-[#556575] border border-[#efbc9d] bg-surface-container/60'
                          }`}>
                            {layer.badge}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-[#556575] mt-1 truncate">
                          {layer.provider}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3 bg-[#193946]/5 border border-[#efbc9d]/50 text-[11px] text-[#556575] font-mono leading-relaxed space-y-1">
              <div>
                Base tiles load with caching enabled. Select <strong className="text-[#193946]">Satellite Imagery</strong> for high-resolution aerial context around fire hotspots.
              </div>
            </div>
          </div>
        )}

      </div>
    </aside>
  );
}