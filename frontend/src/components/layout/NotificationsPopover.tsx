'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useGlobalState } from '@/lib/GlobalStateContext';
import { ClassifiedHotspot, CLASSIFICATION_LABELS } from '@/types';

interface NotificationsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function NotificationsPopover({
  isOpen,
  onClose,
  onOpenSettings,
}: NotificationsPopoverProps) {
  const router = useRouter();
  const pathname = usePathname();
  const popoverRef = useRef<HTMLDivElement>(null);

  const {
    hotspots,
    setSelectedHotspot,
    criticalNotificationsEnabled,
    setCriticalNotificationsEnabled,
  } = useGlobalState();

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Close when clicking outside safely
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        const target = event.target as HTMLElement;
        if (target.closest('[data-notification-bell="true"]')) {
          return;
        }
        onClose();
      }
    }
    if (isOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 50);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  // Extract all high and critical risk hotspots dynamically
  const alertHotspots = useMemo(() => {
    if (!hotspots || !Array.isArray(hotspots)) return [];
    return hotspots
      .filter((h) => {
        const risk = String(h.classification?.risk_level ?? '').toUpperCase();
        const score = Number(h.classification?.risk_score ?? 0);
        return risk === 'CRITICAL' || risk === 'HIGH' || score >= 55;
      })
      .sort((a, b) => {
        const riskOrder: Record<string, number> = { CRITICAL: 3, HIGH: 2, MODERATE: 1, LOW: 0 };
        const aRisk = riskOrder[String(a.classification?.risk_level ?? '').toUpperCase()] ?? 0;
        const bRisk = riskOrder[String(b.classification?.risk_level ?? '').toUpperCase()] ?? 0;
        if (bRisk !== aRisk) return bRisk - aRisk;
        const bScore = Number(b.classification?.risk_score ?? 0);
        const aScore = Number(a.classification?.risk_score ?? 0);
        if (bScore !== aScore) return bScore - aScore;
        return Number(b.hotspot?.frp ?? 0) - Number(a.hotspot?.frp ?? 0);
      });
  }, [hotspots]);

  // Filter out any dismissed for this session
  const activeAlerts = useMemo(() => {
    return alertHotspots.filter((h) => !dismissedIds.has(String(h.id)));
  }, [alertHotspots, dismissedIds]);

  const handleLocate = (hotspot: ClassifiedHotspot) => {
    setSelectedHotspot(hotspot);
    if (pathname !== '/map') {
      router.push('/map');
    }
    onClose();
  };

  const handleDismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedIds((prev) => new Set([...prev, String(id)]));
  };

  const handleDismissAll = () => {
    const allIds = alertHotspots.map((h) => String(h.id));
    setDismissedIds(new Set(allIds));
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="
        fixed
        top-[41px]
        right-2
        w-[380px]
        max-w-[calc(100vw-16px)]
        bg-surface
        border
        border-outline-variant
        shadow-2xl
        z-[999999]
        flex
        flex-col
        font-body-md
        animate-in
        fade-in
        slide-in-from-top-2
        duration-150
      "
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant bg-surface-container-low">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
          </span>
          <h3 className="font-headline-sm text-on-surface uppercase tracking-wider text-[12px] font-bold">
            Critical & High Alerts
          </h3>
          <span className="border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded">
            {activeAlerts.length} ACTIVE
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeAlerts.length > 0 && (
            <button
              onClick={handleDismissAll}
              className="text-[10px] font-mono-label text-secondary hover:text-on-surface tracking-wider transition-colors"
              title="Acknowledge all alerts"
            >
              CLEAR ALL
            </button>
          )}
          <button
            onClick={onClose}
            className="text-secondary hover:text-on-surface transition-colors p-0.5"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {/* Muted Warning if disabled */}
      {!criticalNotificationsEnabled && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 p-2.5 px-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-[11px]">
            <span className="material-symbols-outlined text-[14px]">notifications_off</span>
            <span>Notifications are muted in settings</span>
          </div>
          <button
            onClick={() => setCriticalNotificationsEnabled(true)}
            className="text-[10px] font-mono-label font-bold text-amber-700 dark:text-amber-300 underline tracking-wider"
          >
            ENABLE
          </button>
        </div>
      )}

      {/* Body: Alert List */}
      <div className="max-h-[380px] overflow-y-auto divide-y divide-outline-variant/60">
        {activeAlerts.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center text-secondary">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-emerald-500 text-[20px]">
                check_circle
              </span>
            </div>
            <div className="font-headline-sm text-on-surface text-[12px] font-bold mb-1">
              NO HIGH OR CRITICAL THREATS
            </div>
            <p className="text-[11px] text-secondary max-w-[240px] leading-relaxed">
              All monitored thermal hotspots are currently operating within nominal parameters.
            </p>
          </div>
        ) : (
          activeAlerts.map((h) => {
            const hid = String(h.id);
            const frp = Number(h.hotspot?.frp ?? 0);
            const brightness = Number(h.hotspot?.brightness ?? h.hotspot?.bright_ti4 ?? 0);
            const lat = Number(h.hotspot?.latitude ?? 0);
            const lon = Number(h.hotspot?.longitude ?? 0);
            const rawCls = h.classification?.classification ?? 'UNKNOWN';
            const label = CLASSIFICATION_LABELS[rawCls as keyof typeof CLASSIFICATION_LABELS] || rawCls;
            const score = Number(h.classification?.risk_score ?? 0);
            const riskLevel = String(h.classification?.risk_level ?? '').toUpperCase();
            const isCritical = riskLevel === 'CRITICAL' || score >= 75;
            const facilityName = (h.classification?.source_data as any)?.facility_name;

            return (
              <div
                key={hid}
                className="p-3 hover:bg-surface-container transition-colors group cursor-pointer"
                onClick={() => handleLocate(h)}
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-bold text-primary">
                      VTX-{hid}
                    </span>
                    <span className={`text-white text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                      isCritical ? 'bg-red-600' : 'bg-orange-600'
                    }`}>
                      {isCritical ? 'CRITICAL RISK' : 'HIGH RISK'}
                    </span>
                    {score > 0 && (
                      <span className="text-[10px] font-mono text-secondary">
                        ({score.toFixed(1)}/100)
                      </span>
                    )}
                  </div>

                  <button
                    onClick={(e) => handleDismiss(hid, e)}
                    className="text-secondary/50 hover:text-secondary transition-colors text-[12px] p-0.5"
                    title="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>

                {/* Classification Title */}
                <div className="font-headline-sm text-[13px] font-bold text-on-surface mb-1 flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-[16px] ${
                    isCritical ? 'text-red-500' : 'text-orange-500'
                  }`}>
                    local_fire_department
                  </span>
                  <span>{label}</span>
                </div>

                {/* Telemetry Metrics */}
                <div className="grid grid-cols-2 gap-1 bg-surface-container-low p-1.5 border border-outline-variant/60 font-mono text-[10px] mb-2">
                  <div>
                    <span className="text-secondary">FRP: </span>
                    <span className="text-primary font-bold">{frp.toFixed(1)} MW</span>
                  </div>
                  <div>
                    <span className="text-secondary">BRIGHT: </span>
                    <span className="text-on-surface">{brightness.toFixed(1)} K</span>
                  </div>
                  <div>
                    <span className="text-secondary">COORDS: </span>
                    <span className="text-on-surface">{lat.toFixed(3)}°, {lon.toFixed(3)}°</span>
                  </div>
                  <div>
                    <span className="text-secondary">CAPTURED: </span>
                    <span className="text-on-surface">{h.hotspot?.acq_time ? String(h.hotspot.acq_time).padStart(4, '0') : 'N/A'}</span>
                  </div>
                </div>

                {/* Context description if available */}
                {facilityName && (
                  <div className="text-[10px] text-secondary font-mono mb-2 truncate">
                    📍 Near: <span className="text-on-surface font-medium">{facilityName}</span>
                  </div>
                )}

                {/* Action button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLocate(h);
                  }}
                  className="w-full py-1 bg-primary text-on-primary font-mono-label text-[10px] tracking-wider font-bold flex items-center justify-center gap-1.5 hover:bg-primary-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">my_location</span>
                  LOCATE & INSPECT TARGET
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-2.5 px-3 border-t border-outline-variant bg-surface-container-low flex items-center justify-between text-[10px] font-mono text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          REAL-TIME TELEMETRY ACTIVE
        </span>
        <span className="text-[9px] text-outline font-mono uppercase tracking-wider">
          NASA FIRMS · AI CLASSIFIED
        </span>
      </div>
    </div>
  );
}
