'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { fetchSystemStatus } from '@/lib/api';
import { SystemStatus } from '@/types';
import { SettingsModal } from './SettingsModal';
import { AccountModal } from './AccountModal';
import { NotificationsPopover } from './NotificationsPopover';
import { useGlobalState } from '@/lib/GlobalStateContext';
import { clearVertexUser, useVertexUser } from '@/lib/auth-session';

export function Header() {
  const pathname = usePathname();
  const [time, setTime] = useState<string>('');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { user, ready: authReady } = useVertexUser();
  const { hotspots, criticalNotificationsEnabled } = useGlobalState();

  const criticalHotspots = useMemo(() => {
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

  const handleSignOut = () => {
    setShowNotifications(false);
    clearVertexUser();
    window.location.assign('/');
  };

  useEffect(() => {
    if (!user) {
      setShowNotifications(false);
    }
  }, [user]);

  /*
   * =========================================================
   * IST CLOCK
   * =========================================================
   */

  useEffect(() => {
    const updateClock = () => {
      const istTime = new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      setTime(istTime);
    };

    updateClock();

    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  /*
   * =========================================================
   * LIVE SYSTEM STATUS
   * =========================================================
   */

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const data = await fetchSystemStatus();
        setStatus(data);
      } catch (error) {
        console.error('Failed to fetch system status:', error);
      }
    };

    loadStatus();

    const interval = setInterval(loadStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  /*
   * =========================================================
   * STATUS FORMATTING
   * =========================================================
   */

  const firmsStatus =
    status?.services?.firms?.status?.toUpperCase() || 'OFFLINE';

  const firmsDisplay =
    firmsStatus === 'OK' ? 'NOMINAL' : firmsStatus;

  const isFirmsError =
    firmsStatus !== 'OK' &&
    firmsStatus !== 'NOMINAL';

  const facilityStatus =
    status?.services?.facility_data?.status?.toUpperCase() ||
    'OFFLINE';

  const facilitySource =
    status?.services?.facility_data?.source ||
    'UNKNOWN';

  const facilityDisplay =
    `${facilityStatus}/${facilitySource}`;

  const isFacilityError =
    facilityStatus === 'FAILED' ||
    facilityStatus === 'OFFLINE' ||
    facilityStatus === 'DEGRADED';

  const modelName =
    status?.classification_model ||
    'Gemini 3.5 Flash Lite';

  /*
   * =========================================================
   * HEADER
   * =========================================================
   */

  return (
    <header
      className="
        h-[40px]
        min-h-[40px]
        w-full
        border-b
        border-outline-variant
        bg-surface
        flex
        items-center
        justify-between
        px-0
        shrink-0
        overflow-hidden
        sticky
        top-0
        z-[9999]
        pointer-events-auto
      "
    >
      {/* ===================================================
          LEFT / BRAND & NAVIGATION (Exactly 300px to meet Sidebar border)
          =================================================== */}

      <div className="w-[300px] min-w-[300px] max-w-[300px] h-full flex items-center justify-between border-r border-outline-variant shrink-0 px-1">
        {/* Brand with User's Blue Logo */}
        <Link
          href="/"
          className="h-full flex items-center gap-2 px-2 hover:opacity-90 transition-opacity shrink-0"
        >
          <div className="h-7 w-7 rounded-md bg-black flex items-center justify-center p-0.5 border border-sky-500/40 shadow-[0_0_6px_rgba(56,189,248,0.3)] shrink-0 overflow-hidden">
            <img
              src="/logo.png"
              alt="VERTEX Logo"
              className="w-full h-full object-cover object-[center_28%] scale-[1.75]"
            />
          </div>
          <span className="font-headline-sm text-black text-[15px] font-black tracking-wider">
            VERTEX
          </span>
        </Link>

        {/* Navigation Tabs */}
        <nav className="h-full flex items-center shrink-0">
          <Link
            href="/"
            className={`
              relative h-full px-2.5 flex items-center justify-center
              font-mono-label text-[10px] tracking-widest transition-colors
              ${
                pathname === '/'
                  ? 'text-[#f5751c] font-bold'
                  : 'text-[#556575] hover:text-[#193946] hover:bg-[#556575]/10'
              }
            `}
          >
            HOME
            {pathname === '/' && (
              <span className="absolute bottom-0 left-1 right-1 h-[2px] bg-[#f5751c] rounded-full" />
            )}
          </Link>

          <Link
            href="/analytics"
            className={`
              relative h-full px-2.5 flex items-center justify-center
              font-mono-label text-[10px] tracking-widest transition-colors
              ${
                pathname?.startsWith('/analytics')
                  ? 'text-[#f5751c] font-bold'
                  : 'text-[#556575] hover:text-[#193946] hover:bg-[#556575]/10'
              }
            `}
          >
            ANALYTICS
            {pathname?.startsWith('/analytics') && (
              <span className="absolute bottom-0 left-1 right-1 h-[2px] bg-[#f5751c] rounded-full" />
            )}
          </Link>

          <Link
            href="/map"
            className={`
              relative h-full px-2.5 flex items-center justify-center
              font-mono-label text-[10px] tracking-widest transition-colors
              ${
                pathname?.startsWith('/map')
                  ? 'text-[#f5751c] font-bold'
                  : 'text-[#556575] hover:text-[#193946] hover:bg-[#556575]/10'
              }
            `}
          >
            MAP
            {pathname?.startsWith('/map') && (
              <span className="absolute bottom-0 left-1 right-1 h-[2px] bg-[#f5751c] rounded-full" />
            )}
          </Link>
        </nav>
      </div>

      {/* ===================================================
          CENTER / LIVE TELEMETRY (Fills area above Map between 300px and Right Panel)
          =================================================== */}

      <div className="flex-1 h-full flex items-center justify-center gap-4 px-3 min-w-0 overflow-hidden font-mono text-[10px] tracking-wider">
        {/* Clock */}
        <div className="flex items-center text-on-surface font-medium whitespace-nowrap shrink-0">
          IST {time}
        </div>

        <span className="text-outline-variant/60 shrink-0">|</span>

        {/* FIRMS */}
        <div className="flex items-center whitespace-nowrap shrink-0">
          <span className={isFirmsError ? 'text-error font-medium' : 'text-secondary'}>
            FIRMS VIIRS:
          </span>
          <span className="ml-1 text-on-surface font-medium">
            {firmsDisplay}
          </span>
        </div>

        <span className="text-outline-variant/60 shrink-0">|</span>

        {/* Facilities */}
        <div className="flex items-center whitespace-nowrap shrink-0">
          <span className={isFacilityError ? 'text-error font-medium' : 'text-secondary'}>
            FACILITIES:
          </span>
          <span className="ml-1 text-on-surface font-medium">
            {facilityDisplay}
          </span>
        </div>

        <span className="text-outline-variant/60 shrink-0">|</span>

        {/* Model */}
        <div className="flex items-center whitespace-nowrap shrink-0">
          <span className="text-secondary">
            MODEL:
          </span>
          <span className="ml-1 text-on-surface font-medium">
            {modelName}
          </span>
        </div>
      </div>

      {/* ===================================================
          RIGHT / ACTIONS (Exactly 340px to meet Target Dossier border)
          =================================================== */}

      <div
        className="
          w-[340px]
          min-w-[340px]
          max-w-[340px]
          h-full
          flex
          items-center
          justify-between
          shrink-0
          border-l
          border-outline-variant
        "
      >
        <div className={`flex items-center h-full min-w-0 flex-1 overflow-hidden ${!user ? 'justify-end' : ''}`}>
          {authReady && (user ? (
            <>
              {user.role === 'admin' ? (
                <Link
                  href="/admin"
                  className="flex h-full max-w-[150px] items-center gap-1.5 border-r border-outline-variant px-3 shrink-0 hover:bg-primary/10 transition-colors group"
                  title="Open Admin User Management Console"
                >
                  <span className="material-symbols-outlined text-[17px] text-primary">
                    shield_person
                  </span>
                  <span className="truncate font-mono text-[10px] font-bold tracking-wider text-on-surface group-hover:text-primary transition-colors">
                    {user.username}
                  </span>
                  <span className="border border-primary bg-primary/20 px-1 py-0.2 font-mono text-[8px] font-bold tracking-widest text-primary">
                    ADMIN
                  </span>
                </Link>
              ) : (
                <div className="flex h-full max-w-[140px] items-center gap-1.5 border-r border-outline-variant px-3 shrink-0">
                  <span className="material-symbols-outlined text-[17px] text-primary">
                    verified_user
                  </span>
                  <span className="truncate font-mono text-[10px] font-bold tracking-wider text-on-surface">{user.username}</span>
                </div>
              )}
              <button onClick={handleSignOut} className="h-full flex items-center gap-1 px-3 font-mono-label text-[10px] tracking-widest text-secondary transition-colors hover:bg-surface-container-high hover:text-primary shrink-0" title="Sign out">
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span className="hidden sm:inline">SIGN OUT</span>
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="h-full flex items-center justify-center px-3 font-mono-label text-[10px] tracking-widest text-secondary transition-colors hover:bg-surface-container-high hover:text-primary shrink-0">SIGN IN</Link>
              <Link href="/signup" className="h-full flex items-center justify-center bg-primary px-3 font-mono-label text-[10px] font-bold tracking-widest text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container shrink-0">REGISTER</Link>
            </>
          ))}
        </div>

        {user && (
          <div className="flex items-center h-full shrink-0">
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              className="
                h-full
                w-[36px]
                flex
                items-center
                justify-center
                text-primary
                hover:bg-surface-container-high
                transition-colors
                cursor-pointer
              "
            >
              <span className="material-symbols-outlined text-[18px]">
                settings
              </span>
            </button>

            {/* Notifications (only shown when signed in) */}
            <div className="relative h-full flex items-center">
              <button
                data-notification-bell="true"
                onClick={() => setShowNotifications((prev) => !prev)}
                title={
                  criticalNotificationsEnabled
                    ? `${criticalHotspots.length} High & Critical Threat(s) Monitored`
                    : 'Alert Notifications Muted'
                }
                className="
                  h-full
                  w-[36px]
                  flex
                  items-center
                  justify-center
                  text-primary
                  hover:bg-surface-container-high
                  transition-colors
                  cursor-pointer
                  relative
                "
              >
                <span className="material-symbols-outlined text-[18px]">
                  {criticalNotificationsEnabled ? 'notifications' : 'notifications_off'}
                </span>

                {criticalNotificationsEnabled && criticalHotspots.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 flex h-3.5 min-w-[14px] px-1 items-center justify-center rounded-full bg-red-600 text-white text-[8px] font-mono font-black shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse pointer-events-none">
                    {criticalHotspots.length}
                  </span>
                )}
              </button>

              {showNotifications && (
                <NotificationsPopover
                  isOpen={showNotifications}
                  onClose={() => setShowNotifications(false)}
                  onOpenSettings={() => {
                    setShowNotifications(false);
                    setShowSettings(true);
                  }}
                />
              )}
            </div>

            <button
              onClick={() => setShowAccount(true)}
              title="Account"
              className="
                h-full
                w-[36px]
                flex
                items-center
                justify-center
                text-primary
                hover:bg-surface-container-high
                transition-colors
                cursor-pointer
              "
            >
              <span className="material-symbols-outlined text-[18px]">
                account_circle
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ===================================================
          MODALS
          =================================================== */}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAccount && (
        <AccountModal
          onClose={() => setShowAccount(false)}
        />
      )}
    </header>
  );
}
