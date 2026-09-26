'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useGlobalState } from '@/lib/GlobalStateContext';
import { useVertexUser } from '@/lib/auth-session';
import { AuthRequiredDialog } from '@/components/auth/AuthRequiredDialog';
import {
  CLASSIFICATION_COLORS,
  CLASSIFICATION_LABELS,
  ClassificationType,
} from '@/types';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

function AnalyticsWorkspace() {
  const router = useRouter();
  const {
    analyticsSummary: summary,
    hotspots,
    mapHotspots,
    loading,
    error,
  } = useGlobalState();

  const [facilitySearch, setFacilitySearch] = useState('');
  const isFacilitySearching = facilitySearch.trim().length > 0;

  /*
   * =========================================================
   * LIVE ANALYTICS
   * =========================================================
   *
   * Current FIRMS observations are the authoritative population.
   * The stored classified stream is merged onto those observations
   * by FIRMS identity. Backend summary values are not used for the
   * headline numbers/charts because they can lag the live feed.
   */

  const classifiedHotspots = Array.isArray(hotspots)
    ? hotspots
    : [];

  const firmsObservations = Array.isArray(mapHotspots)
    ? mapHotspots
    : [];

  const hotspotIdentity = (hotspot: any) => {
    const source = hotspot?.hotspot ?? hotspot;
    const latitude = Number(source?.latitude);
    const longitude = Number(source?.longitude);
    const acqDate = String(source?.acq_date ?? '');
    const acqTime = String(source?.acq_time ?? '').padStart(4, '0');
    const satellite = String(source?.satellite ?? '');

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return '';
    }

    return `${latitude.toFixed(5)}|${longitude.toFixed(5)}|${acqDate}|${acqTime}|${satellite}`;
  };

  const classifiedIndex = new Map<string, any>();

  classifiedHotspots.forEach((hotspot: any) => {
    const key = hotspotIdentity(hotspot);

    if (key) {
      classifiedIndex.set(key, hotspot);
    }
  });

  /*
   * Normally mapHotspots contains the complete current FIRMS feed.
   * During a transient provider state, fall back to the classified
   * current stream instead of displaying false zeros.
   */
  const liveObservations =
    firmsObservations.length > 0
      ? firmsObservations.map((observation: any) => {
          const match = classifiedIndex.get(
            hotspotIdentity(observation)
          );

          if (!match) {
            return observation;
          }

          return {
            ...observation,
            id: match.id,
            hotspot: {
              ...observation.hotspot,
              ...match.hotspot,
            },
            classification: match.classification,
            context: match.context,
          };
        })
      : classifiedHotspots;

  const isClassified = (hotspot: any) => {
    const type = String(
      hotspot?.classification?.classification ?? ''
    ).toUpperCase();

    return (
      type.length > 0 &&
      type !== String(
        ClassificationType.UNCLASSIFIED
      ).toUpperCase()
    );
  };

  const liveClassifiedHotspots =
    liveObservations.filter(isClassified);

  const totalFirmsObservations =
    liveObservations.length;

  const aiClassified =
    liveClassifiedHotspots.length;

  const aiPending =
    Math.max(
      totalFirmsObservations - aiClassified,
      0
    );

  const frpValues = liveObservations
    .map((hotspot: any) =>
      Number(
        hotspot?.hotspot?.frp ??
        hotspot?.frp ??
        0
      )
    )
    .filter((value: number) =>
      Number.isFinite(value)
    );

  const averageFrp = frpValues.length
    ? frpValues.reduce(
        (sum: number, value: number) =>
          sum + value,
        0
      ) / frpValues.length
    : 0;

  const classificationCounts: Record<
    string,
    number
  > = {};

  liveClassifiedHotspots.forEach(
    (hotspot: any) => {
      const type =
        String(
          hotspot?.classification?.classification ??
            ClassificationType.UNKNOWN_UNCERTAIN
        );

      classificationCounts[type] =
        (classificationCounts[type] || 0) + 1;
    }
  );

  const riskCounts: Record<
    string,
    number
  > = {};

  liveClassifiedHotspots.forEach(
    (hotspot: any) => {
      const level =
        String(
          hotspot?.classification?.risk_level ??
            'UNKNOWN'
        ).toUpperCase();

      riskCounts[level] =
        (riskCounts[level] || 0) + 1;
    }
  );

  const industrialTypes = new Set([
    'INDUSTRIAL_FIRE',
    'GAS_FLARE',
    'PERSISTENT_INDUSTRIAL_SOURCE',
  ]);

  const industrialEvents =
    Object.entries(classificationCounts)
      .filter(([type]) =>
        industrialTypes.has(type)
      )
      .reduce(
        (sum, [, count]) =>
          sum + count,
        0
      );

  const highRisk =
    (riskCounts.HIGH || 0) +
    (riskCounts.CRITICAL || 0);

  const pieData =
    Object.entries(classificationCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({
        name:
          CLASSIFICATION_LABELS[
            type as ClassificationType
          ] || type,
        value: count,
        color:
          CLASSIFICATION_COLORS[
            type as ClassificationType
          ] ||
          CLASSIFICATION_COLORS[
            ClassificationType.UNKNOWN_UNCERTAIN
          ],
      }));

  const frpBuckets = [
    {
      range: '0–5',
      min: 0,
      max: 5,
    },
    {
      range: '5–10',
      min: 5,
      max: 10,
    },
    {
      range: '10–25',
      min: 10,
      max: 25,
    },
    {
      range: '25–50',
      min: 25,
      max: 50,
    },
    {
      range: '50+',
      min: 50,
      max: Infinity,
    },
  ];

  const frpDistribution =
    frpBuckets.map(
      ({
        range,
        min,
        max,
      }) => ({
        range,
        count:
          frpValues.filter(
            (value) =>
              value >= min &&
              value < max
          ).length,
      })
    );

  const facilityMap: Record<
    string,
    {
      name: string;
      type: string;
      count: number;
    }
  > = {};

  liveClassifiedHotspots.forEach(
    (hotspot: any) => {
      const context =
        hotspot?.context ||
        hotspot?.osm_context ||
        {};

      const facilities =
        Array.isArray(
          context?.nearby_facilities
        )
          ? context.nearby_facilities
          : [];

      facilities.forEach(
        (facility: any) => {
          const name =
            facility?.name ||
            facility?.tags?.name ||
            'UNNAMED FACILITY';

          const type =
            facility?.type ||
            facility?.tags?.industrial ||
            facility?.tags?.amenity ||
            'UNKNOWN';

          const key = `${name}|${type}`;

          if (!facilityMap[key]) {
            facilityMap[key] = {
              name,
              type: String(
                type
              ).replace(
                /_/g,
                ' '
              ),
              count: 0,
            };
          }

          facilityMap[key].count += 1;
        }
      );
    }
  );

  const topFacilities =
    Object.values(facilityMap)
      .sort(
        (a, b) =>
          b.count - a.count
      )
      .slice(0, 10);

  const filteredFacilities = useMemo(() => {
    const list = Object.values(facilityMap).sort((a, b) => b.count - a.count);
    if (!facilitySearch.trim()) return list.slice(0, 10);
    const q = facilitySearch.toLowerCase();
    return list.filter((f) => f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)).slice(0, 15);
  }, [facilityMap, facilitySearch]);

  const riskOrder = [
    'CRITICAL',
    'HIGH',
    'MODERATE',
    'LOW',
    'UNKNOWN',
  ];

  const riskDistribution =
    riskOrder
      .filter(
        (level) =>
          riskCounts[level] !==
          undefined
      )
      .map((level) => ({
        level,
        count:
          riskCounts[level] || 0,
      }));

  /*
   * =========================================================
   * LOADING
   * =========================================================
   */

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-surface-dim text-on-surface flex flex-col overflow-y-auto">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <span className="material-symbols-outlined text-4xl text-primary animate-spin mb-4">
              sync
            </span>

            <span className="font-mono text-[10px] text-secondary uppercase tracking-widest">
              LOADING ANALYTICS
            </span>
          </div>
        </div>
      </div>
    );
  }

  /*
   * =========================================================
   * ERROR
   * =========================================================
   */

  if (
    error &&
    !summary &&
    classifiedHotspots.length === 0
  ) {
    return (
      <div className="flex-1 min-h-0 bg-surface-dim text-on-surface flex flex-col overflow-y-auto">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center bg-surface border border-error p-8 max-w-md text-center">
            <span className="material-symbols-outlined text-4xl text-error mb-4">
              database
            </span>

            <span className="font-headline-sm text-[14px] text-error uppercase tracking-widest mb-2">
              SYSTEM ERROR
            </span>

            <p className="font-body-sm text-secondary">
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /*
   * =========================================================
   * PAGE
   * =========================================================
   */

  return (
    <div className="bg-surface-dim flex-1 min-h-0 text-on-surface overflow-y-auto">
      <div className="w-full px-6 sm:px-10 lg:px-14 xl:px-20 py-8 space-y-6">

        
        {/* =================================================
            PAGE HEADER
            ================================================= */}

        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#efbc9d]/60 pb-5 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold tracking-[.18em] text-[#f5751c]">VERTEX ANALYTICS ENGINE</span>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <h1 className="mt-2 font-headline-sm text-3xl font-black text-[#193946] tracking-wide">
              Thermal Event Analytics
            </h1>
            <p className="mt-1 text-sm text-[#556575]">
              Authoritative FIRMS satellite observations aggregated with AI classification and spatial facility intelligence.
            </p>
          </div>
        </div>

        {/* =================================================
            STAT CARDS
            ================================================= */}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

          <div className="border border-[#193946]/30 bg-[#193946]/5 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#193946] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#193946]" />
              TOTAL FIRMS OBSERVATIONS
            </div>

            <div className="font-mono text-3xl font-black text-[#193946]">
              {totalFirmsObservations}
            </div>
          </div>

          <div className="border border-[#556575]/30 bg-[#556575]/5 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#556575] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#556575]" />
              AI CLASSIFIED
            </div>

            <div className="font-mono text-3xl font-black text-[#193946]">
              {aiClassified}
            </div>
          </div>

          <div className="border border-[#fca26e]/50 bg-[#fca26e]/10 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#f5751c] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5751c]" />
              AI PENDING
            </div>

            <div className="font-mono text-3xl font-black text-[#f5751c]">
              {aiPending}
            </div>
          </div>

          <div className="border border-[#efbc9d]/70 bg-[#efbc9d]/15 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#193946] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#efbc9d]" />
              AVERAGE FRP (MW)
            </div>

            <div className="font-mono text-3xl font-black text-[#193946]">
              {Number(averageFrp || 0).toFixed(1)}
            </div>
          </div>

        </div>

        {/* =================================================
            OPERATIONAL SUMMARY
            ================================================= */}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          <div className="border border-[#193946]/30 bg-[#193946]/5 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#193946] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#193946]" />
              INDUSTRIAL / PERSISTENT
            </div>

            <div className="font-mono text-2xl font-black text-[#193946]">
              {industrialEvents}
            </div>
          </div>

          <div className="border border-[#ca8a04]/40 bg-[#ca8a04]/5 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#ca8a04] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ca8a04]" />
              AGRICULTURAL BURNS
            </div>

            <div className="font-mono text-2xl font-black text-[#ca8a04]">
              {classificationCounts['AGRICULTURAL_BURN'] || 0}
            </div>
          </div>

          <div className="border border-[#16a34a]/40 bg-[#16a34a]/5 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#16a34a] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
              WILDFIRE / FOREST
            </div>

            <div className="font-mono text-2xl font-black text-[#16a34a]">
              {classificationCounts['WILDFIRE_FOREST_FIRE'] || 0}
            </div>
          </div>

          <div className="border border-[#f5751c]/50 bg-[#f5751c]/10 p-4 shadow-sm">
            <div className="font-mono text-[10px] tracking-widest text-[#f5751c] font-bold uppercase flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5751c]" />
              HIGH / CRITICAL RISK
            </div>

            <div className="font-mono text-2xl font-black text-[#f5751c]">
              {highRisk}
            </div>
          </div>

        </div>

        {/* =================================================
            CHART ROW 1
            ================================================= */}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Classification */}

          <div className="bg-surface border border-[#efbc9d]/60 shadow-sm p-4 flex flex-col h-[400px]">

            <div className="font-mono text-[11px] font-bold text-[#193946] uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#193946]" />
              CLASSIFICATION DISTRIBUTION
            </div>

            <div className="flex-1 min-h-0">

              {pieData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="font-mono text-[10px] text-[#556575] uppercase tracking-widest">
                    NO CLASSIFICATION DATA
                  </span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>

                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={120}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map(
                        (entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.color}
                          />
                        )
                      )}
                    </Pie>

                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: '#193946',
                        borderColor: '#556575',
                        borderRadius: '0',
                        fontFamily: 'JetBrains Mono',
                        color: '#ffffff',
                      }}
                      itemStyle={{
                        color: '#ffffff',
                        fontSize: '12px',
                      }}
                    />

                    <Legend
                      layout="vertical"
                      verticalAlign="middle"
                      align="right"
                      wrapperStyle={{
                        fontFamily: 'JetBrains Mono',
                        fontSize: '10px',
                      }}
                    />

                  </PieChart>
                </ResponsiveContainer>
              )}

            </div>
          </div>

          {/* FRP */}

          <div className="bg-surface border border-[#efbc9d]/60 shadow-sm p-4 flex flex-col h-[400px]">

            <div className="font-mono text-[11px] font-bold text-[#193946] uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5751c]" />
              FRP DISTRIBUTION (MW)
            </div>

            <div className="flex-1 min-h-0">

              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={frpDistribution}>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#efbc9d"
                    strokeOpacity={0.3}
                    vertical={false}
                  />

                  <XAxis
                    dataKey="range"
                    stroke="#556575"
                    tick={{
                      fill: '#556575',
                      fontSize: 10,
                      fontFamily: 'JetBrains Mono',
                    }}
                  />

                  <YAxis
                    allowDecimals={false}
                    stroke="#556575"
                    tick={{
                      fill: '#556575',
                      fontSize: 10,
                      fontFamily: 'JetBrains Mono',
                    }}
                  />

                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#193946',
                      borderColor: '#556575',
                      borderRadius: '0',
                      fontFamily: 'JetBrains Mono',
                      color: '#ffffff',
                    }}
                  />

                  <Bar
                    dataKey="count"
                    fill="#f5751c"
                    radius={[2, 2, 0, 0]}
                  />

                </BarChart>
              </ResponsiveContainer>

            </div>
          </div>

        </div>

        {/* =================================================
            CHART ROW 2
            ================================================= */}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Risk */}

          <div className="bg-surface border border-[#efbc9d]/60 shadow-sm p-4 flex flex-col h-[320px]">

            <div className="font-mono text-[11px] font-bold text-[#193946] uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#193946]" />
              RISK LEVEL DISTRIBUTION
            </div>

            <div className="flex-1 min-h-0">

              {riskDistribution.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="font-mono text-[10px] text-[#556575] uppercase tracking-widest">
                    NO RISK DATA
                  </span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={riskDistribution}
                    layout="vertical"
                  >

                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#efbc9d"
                      strokeOpacity={0.3}
                      horizontal={false}
                    />

                    <XAxis
                      type="number"
                      allowDecimals={false}
                      stroke="#556575"
                      tick={{
                        fill: '#556575',
                        fontSize: 10,
                        fontFamily: 'JetBrains Mono',
                      }}
                    />

                    <YAxis
                      dataKey="level"
                      type="category"
                      stroke="#556575"
                      width={80}
                      tick={{
                        fill: '#556575',
                        fontSize: 10,
                        fontFamily: 'JetBrains Mono',
                      }}
                    />

                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: '#193946',
                        borderColor: '#556575',
                        borderRadius: '0',
                        fontFamily: 'JetBrains Mono',
                        color: '#ffffff',
                      }}
                    />

                    <Bar
                      dataKey="count"
                      fill="#193946"
                      radius={[0, 2, 2, 0]}
                    />

                  </BarChart>
                </ResponsiveContainer>
              )}

            </div>
          </div>

          {/* Facilities */}

          <div className={`bg-surface transition-all border p-4 flex flex-col h-[320px] overflow-hidden shadow-sm ${
            isFacilitySearching ? 'border-2 border-[#193946] shadow-[0_4px_20px_rgba(25,57,70,0.15)]' : 'border border-[#efbc9d]/60'
          }`}>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="font-mono text-[11px] font-bold text-[#193946] uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#556575]" />
                TOP FACILITIES BY THERMAL ACTIVITY
              </div>

              <div className={`relative transition-all ${
                isFacilitySearching
                  ? 'border-2 border-[#193946] bg-[#193946]/10 ring-2 ring-[#193946]/20'
                  : 'border border-[#efbc9d] bg-surface hover:border-[#193946]/50 focus-within:border-[#193946]'
              }`}>
                <span className={`material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] ${
                  isFacilitySearching ? 'text-[#193946] font-bold' : 'text-[#556575]'
                }`}>
                  search
                </span>
                <input
                  type="text"
                  value={facilitySearch}
                  onChange={(e) => setFacilitySearch(e.target.value)}
                  placeholder="Filter facilities..."
                  className={`bg-transparent py-1 pl-7 pr-6 text-[11px] outline-none ${
                    isFacilitySearching ? 'text-[#193946] font-bold placeholder:text-[#556575]/60' : 'text-on-surface placeholder:text-secondary/60'
                  }`}
                />
                {isFacilitySearching && (
                  <button
                    onClick={() => setFacilitySearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#556575] hover:text-[#193946]"
                    title="Clear filter"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                )}
              </div>
            </div>

            {isFacilitySearching && (
              <div className="flex items-center justify-between bg-[#193946] text-white px-2.5 py-1 mb-2 font-mono text-[10px] tracking-wider rounded-sm shrink-0">
                <span>FILTER: &ldquo;{facilitySearch}&rdquo;</span>
                <span className="bg-[#556575] px-1.5 py-0.5 rounded text-[9px] font-bold">{filteredFacilities.length} MATCHES</span>
              </div>
            )}

            <div className="flex-1 overflow-auto">

              <table className="w-full text-left border-collapse">

                <thead className="sticky top-0 bg-[#193946]/10 border-b border-[#193946]/30">

                  <tr>

                    <th className="font-mono text-[10px] text-[#193946] font-bold tracking-widest pb-2 p-2">
                      FACILITY NAME
                    </th>

                    <th className="font-mono text-[10px] text-[#193946] font-bold tracking-widest pb-2 p-2">
                      TYPE
                    </th>

                    <th className="font-mono text-[10px] text-[#193946] font-bold tracking-widest pb-2 p-2 text-right">
                      EVENTS
                    </th>

                  </tr>

                </thead>

                <tbody className="divide-y divide-[#efbc9d]/40">

                  {filteredFacilities.map(
                    (facility, index) => (
                      <tr
                        key={`${facility.name}-${facility.type}-${index}`}
                        className="hover:bg-[#193946]/[0.04] transition-colors"
                      >

                        <td className="font-body-sm text-[12px] p-2 text-on-surface font-medium">
                          {facility.name}
                        </td>

                        <td className="font-body-sm text-[12px] p-2 text-[#556575] capitalize">
                          {facility.type}
                        </td>

                        <td className="font-mono text-[12px] p-2 text-right text-[#f5751c] font-bold">
                          {facility.count}
                        </td>

                      </tr>
                    )
                  )}

                  {filteredFacilities.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="text-center py-6 font-mono text-[10px] text-[#556575] uppercase tracking-widest"
                      >
                        {isFacilitySearching ? `NO FACILITIES MATCHED "${facilitySearch}"` : 'NO FACILITY DATA AVAILABLE'}
                      </td>
                    </tr>
                  )}

                </tbody>

              </table>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user, ready } = useVertexUser();

  if (!ready) {
    return <div className="flex-1 bg-surface-dim" />;
  }

  return user ? <AnalyticsWorkspace /> : <AuthRequiredDialog />;
}
