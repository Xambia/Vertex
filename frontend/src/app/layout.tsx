import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { GlobalStateProvider } from '@/lib/GlobalStateContext';

export const metadata: Metadata = {
  title: 'VERTEX | Thermal Intelligence',
  description: 'AI-Based Detection and Classification of Industrial Fires',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function isAbort(e) {
                  var r = e && (e.reason || e.error || e);
                  if (!r) return false;
                  var n = r.name || (r.constructor && r.constructor.name) || '';
                  var m = String(r.message || r);
                  return n === 'AbortError' ||
                         m.indexOf('signal is aborted') !== -1 ||
                         m.indexOf('aborted without reason') !== -1 ||
                         m.indexOf('user aborted') !== -1;
                }
                window.addEventListener('unhandledrejection', function(event) {
                  if (isAbort(event)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                  }
                }, true);
                window.addEventListener('error', function(event) {
                  if (isAbort(event)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                  }
                }, true);
              })();
            `,
          }}
        />
      </head>
      <body className="bg-background text-on-surface font-body-md h-screen w-screen overflow-hidden flex flex-col">
        <GlobalStateProvider>
          <Header />
          {children}
        </GlobalStateProvider>
      </body>
    </html>
  );
}
