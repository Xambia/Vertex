'use client';

import { useState } from 'react';
import { useGlobalState } from '@/lib/GlobalStateContext';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const {
    mapStyle,
    setMapStyle,
    autoRefreshInterval,
    setAutoRefreshInterval,
    minConfidenceDisplay,
    setMinConfidenceDisplay,
    strictRiskFiltering,
    setStrictRiskFiltering,
    criticalNotificationsEnabled,
    setCriticalNotificationsEnabled,
  } = useGlobalState();

  const [localMapStyle, setLocalMapStyle] = useState(mapStyle);
  const [localInterval, setLocalInterval] = useState(autoRefreshInterval);
  const [localMinConf, setLocalMinConf] = useState(minConfidenceDisplay);
  const [localStrictRisk, setLocalStrictRisk] = useState(strictRiskFiltering);
  const [localCriticalNotifs, setLocalCriticalNotifs] = useState(criticalNotificationsEnabled);

  const handleSave = () => {
    setMapStyle(localMapStyle);
    setAutoRefreshInterval(localInterval);
    setMinConfidenceDisplay(localMinConf);
    setStrictRiskFiltering(localStrictRisk);
    setCriticalNotificationsEnabled(localCriticalNotifs);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface w-[500px] border border-outline-variant shadow-2xl flex flex-col font-body-md animate-in fade-in zoom-in-95 duration-150">
        
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">settings</span>
            <h2 className="font-headline-sm text-on-surface uppercase tracking-widest text-[14px]">Platform Settings</h2>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          
          <div>
            <h3 className="font-mono-label text-[10px] text-secondary tracking-widest uppercase mb-3">Map & Telemetry</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-surface-container p-3 border border-outline-variant">
                <div>
                  <span className="text-[12px] text-on-surface block font-medium">Base Map Layer</span>
                  <span className="text-[10px] text-secondary">Satellite or tactical dark view</span>
                </div>
                <select 
                  value={localMapStyle === 'Dark Canvas' ? 'Dark Tactical' : localMapStyle} 
                  onChange={(e) => setLocalMapStyle(e.target.value)}
                  className="bg-surface border border-outline-variant text-[11px] font-mono px-2 py-1 outline-none focus:border-primary text-on-surface"
                >
                  <option value="Esri World Imagery (Satellite)">Esri World Imagery (Satellite)</option>
                  <option value="Dark Tactical">Dark Tactical</option>
                  <option value="OSM Light">Street / Terrain Light (OSM)</option>
                </select>
              </div>

              <div className="flex items-center justify-between bg-surface-container p-3 border border-outline-variant">
                <div>
                  <span className="text-[12px] text-on-surface block font-medium">Auto-Refresh Interval</span>
                  <span className="text-[10px] text-secondary">Telemetry query polling frequency</span>
                </div>
                <select 
                  value={localInterval}
                  onChange={(e) => setLocalInterval(e.target.value)}
                  className="bg-surface border border-outline-variant text-[11px] font-mono px-2 py-1 outline-none focus:border-primary text-on-surface"
                >
                  <option value="30 Seconds">30 Seconds (Fast)</option>
                  <option value="1 Minute">1 Minute</option>
                  <option value="5 Minutes">5 Minutes</option>
                  <option value="30 Minutes">30 Minutes</option>
                  <option value="1 Hour">1 Hour</option>
                  <option value="Manual Only">Manual Only</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-mono-label text-[10px] text-secondary tracking-widest uppercase mb-3">Classification & AI</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-surface-container p-3 border border-outline-variant">
                <div>
                  <span className="text-[12px] text-on-surface block font-medium">Minimum Confidence Display</span>
                  <span className="text-[10px] text-secondary">Filter out lower-confidence observations</span>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="range" 
                    className="accent-primary w-24 cursor-pointer" 
                    min="0" 
                    max="1" 
                    step="0.05" 
                    value={localMinConf}
                    onChange={(e) => setLocalMinConf(parseFloat(e.target.value))}
                  />
                  <span className="font-mono text-[11px] w-10 text-right text-primary font-bold">{localMinConf.toFixed(2)}</span>
                </div>
              </div>

              <label className="flex items-center justify-between bg-surface-container p-3 border border-outline-variant cursor-pointer group">
                <div>
                  <span className="text-[12px] text-on-surface block font-medium">Strict Risk Filtering</span>
                  <span className="text-[10px] text-secondary">Hide low-risk noise; show only Moderate, High & Critical</span>
                </div>
                <input 
                  type="checkbox" 
                  className="accent-primary w-4 h-4 bg-surface border-outline-variant cursor-pointer" 
                  checked={localStrictRisk}
                  onChange={(e) => setLocalStrictRisk(e.target.checked)}
                />
              </label>
            </div>
          </div>

          <div>
            <h3 className="font-mono-label text-[10px] text-secondary tracking-widest uppercase mb-3">System Alerts</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between bg-surface-container p-3 border border-outline-variant cursor-pointer group">
                <div>
                  <span className="text-[12px] text-on-surface block font-medium">High & Critical Threat Notifications</span>
                  <span className="text-[10px] text-secondary">Show pulsing badge & notification stream for High & Critical events</span>
                </div>
                <input 
                  type="checkbox" 
                  className="accent-primary w-4 h-4 bg-surface border-outline-variant cursor-pointer" 
                  checked={localCriticalNotifs}
                  onChange={(e) => setLocalCriticalNotifs(e.target.checked)}
                />
              </label>
            </div>
          </div>

        </div>

        <div className="p-4 border-t border-outline-variant bg-surface-container-low flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-outline-variant text-secondary text-[11px] font-mono-label tracking-widest hover:bg-surface-container-high transition-colors">
            CANCEL
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary text-on-primary text-[11px] font-mono-label tracking-widest hover:bg-primary-container transition-colors">
            SAVE SETTINGS
          </button>
        </div>

      </div>
    </div>
  );
}
