'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ConsolePageContent() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [renderInfo, setRenderInfo] = useState<string>('');

  const wsUrl = searchParams.get('wsUrl') || '';
  const ticket = searchParams.get('ticket') || '';
  const vmId = searchParams.get('vmId') || '';

  useEffect(() => {
    const buildEffectiveWsUrl = () => {
      if (!wsUrl) return '';
      if (typeof window === 'undefined') return wsUrl;

      try {
        const parsed = new URL(wsUrl);
        const currentProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const currentOrigin = `${currentProtocol}//${window.location.host}`;
        const isSameProxyHost =
          parsed.host === window.location.host &&
          parsed.pathname.startsWith('/console-proxy/');

        if (isSameProxyHost) {
          return wsUrl;
        }

        if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
          return `${currentOrigin}/console-proxy/?targets=${encodeURIComponent(wsUrl)}&insecure=1`;
        }

        return wsUrl;
      } catch {
        return wsUrl;
      }
    };

    const effectiveWsUrl = buildEffectiveWsUrl();

    // Debug: mostrar la URL recibida
    console.log('[console] URL params:', { wsUrl, effectiveWsUrl, ticket: ticket ? 'present' : 'missing', vmId });
    setDebugInfo(
      `wsUrl: ${effectiveWsUrl.substring(0, 80)}... ticket: ${ticket ? 'OK' : 'MISSING'}`,
    );
    
    if (!effectiveWsUrl || !containerRef.current) {
      setErrorMsg('Falta wsUrl o container');
      setStatus('error');
      return;
    }

    if (effectiveWsUrl.includes(':0/') || effectiveWsUrl.includes('localhost:0')) {
      setErrorMsg('URL tiene puerto 0 - proxy no iniciado correctamente');
      setStatus('error');
      return;
    }

    let rfb: any = null;
    let cleanupFocusHandlers: (() => void) | null = null;
    let focusBoostTimer: ReturnType<typeof setInterval> | null = null;
    let renderInfoTimer: ReturnType<typeof setInterval> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const connect = async () => {
      try {
        console.log('[console] Conectando a:', effectiveWsUrl);
        
        const mod = await import('@novnc/novnc/lib/rfb');
        const RFB = (mod as { default?: any }).default;
        if (!RFB) throw new Error('noVNC no disponible');

        const container = containerRef.current!;
        container.innerHTML = '';
        container.tabIndex = 0;
        container.style.outline = 'none';
        container.style.width = '100%';
        container.style.height = '100%';

        console.log('[console] Creando RFB con URL:', effectiveWsUrl);
        rfb = new RFB(container, effectiveWsUrl, {
          credentials: { password: ticket },
          shared: true,
          wsProtocols: ['binary'],
        });

        rfb.viewOnly = false;
        rfb.scaleViewport = false;
        rfb.clipViewport = false;
        (rfb as any).resizeSession = false;
        (rfb as any).showDotCursor = true;

        const refreshViewport = () => {
          try {
            (rfb as any)?._updateClip?.();
          } catch {
            // no-op
          }
          try {
            (rfb as any)?._updateScale?.();
          } catch {
            // no-op
          }
        };

        const updateRenderInfo = () => {
          const anyRfb = rfb as any;
          const screen = anyRfb?._screen as HTMLDivElement | undefined;
          const canvas = anyRfb?._canvas as HTMLCanvasElement | undefined;
          const screenBox = screen?.getBoundingClientRect();
          const canvasBox = canvas?.getBoundingClientRect();
          setRenderInfo(
            [
              `fb ${anyRfb?._fbWidth ?? 0}x${anyRfb?._fbHeight ?? 0}`,
              `canvas ${canvas?.width ?? 0}x${canvas?.height ?? 0}`,
              `css ${Math.round(canvasBox?.width ?? 0)}x${Math.round(canvasBox?.height ?? 0)}`,
              `screen ${Math.round(screenBox?.width ?? 0)}x${Math.round(screenBox?.height ?? 0)}`,
            ].join(' · '),
          );
        };

        const enableViewportScaling = () => {
          try {
            rfb.scaleViewport = true;
            rfb.clipViewport = true;
            refreshViewport();
          } catch {
            // no-op
          }
        };

        const focusConsole = () => {
          try {
            window.focus();
          } catch {
            // no-op
          }
          try {
            container.focus();
          } catch {
            // no-op
          }
          try {
            rfb?.focus?.();
          } catch {
            // no-op
          }
          try {
            (rfb as any)?._keyboard?.grab?.();
          } catch {
            // no-op
          }
          try {
            (rfb as any)?._mouse?.grab?.();
          } catch {
            // no-op
          }
        };

        const onPointerFocus = () => focusConsole();
        const onKeyboardFocus = () => focusConsole();
        container.addEventListener('mousedown', onPointerFocus);
        container.addEventListener('mouseup', onPointerFocus);
        container.addEventListener('click', onPointerFocus);
        window.addEventListener('keydown', onKeyboardFocus, true);
        window.addEventListener('keyup', onKeyboardFocus, true);
        cleanupFocusHandlers = () => {
          container.removeEventListener('mousedown', onPointerFocus);
          container.removeEventListener('mouseup', onPointerFocus);
          container.removeEventListener('click', onPointerFocus);
          window.removeEventListener('keydown', onKeyboardFocus, true);
          window.removeEventListener('keyup', onKeyboardFocus, true);
        };

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            enableViewportScaling();
            updateRenderInfo();
          });
          resizeObserver.observe(container);
        }

        rfb.addEventListener('connect', () => {
          console.log('[console] Conectado!');
          setStatus('connected');
          const anyRfb = rfb as any;
          if (anyRfb?._screen) {
            anyRfb._screen.style.width = '100%';
            anyRfb._screen.style.height = '100%';
            anyRfb._screen.style.minHeight = '100%';
            anyRfb._screen.style.flex = '1 1 auto';
            anyRfb._screen.style.display = 'flex';
            anyRfb._screen.style.overflow = 'hidden';
            anyRfb._screen.style.alignItems = 'center';
            anyRfb._screen.style.justifyContent = 'center';
          }
          if (anyRfb?._canvas) {
            anyRfb._canvas.style.display = 'block';
            anyRfb._canvas.style.maxWidth = '100%';
            anyRfb._canvas.style.maxHeight = '100%';
          }
          enableViewportScaling();
          updateRenderInfo();
          setTimeout(() => {
            focusConsole();
            enableViewportScaling();
            updateRenderInfo();
          }, 0);
          setTimeout(() => {
            focusConsole();
            enableViewportScaling();
            updateRenderInfo();
          }, 200);
          setTimeout(() => {
            enableViewportScaling();
            updateRenderInfo();
          }, 700);
          setTimeout(() => {
            enableViewportScaling();
            updateRenderInfo();
          }, 1400);
          let focusBoostTicks = 0;
          focusBoostTimer = setInterval(() => {
            focusBoostTicks += 1;
            focusConsole();
            enableViewportScaling();
            updateRenderInfo();
            if (focusBoostTicks >= 12) {
              if (focusBoostTimer) clearInterval(focusBoostTimer);
              focusBoostTimer = null;
            }
          }, 500);
          renderInfoTimer = setInterval(updateRenderInfo, 1000);
          
          let attempts = 0;
          const timer = setInterval(() => {
            attempts += 1;
            try {
              const anyRfb = rfb as any;
              const w = anyRfb?._fbWidth ?? 4096;
              const h = anyRfb?._fbHeight ?? 2160;
              if ((RFB as any)?.messages && anyRfb?._sock) {
                (RFB as any).messages.fbUpdateRequest(anyRfb._sock, false, 0, 0, w, h);
                console.log('[console] fbUpdateRequest enviado', { w, h, attempts });
              }
            } catch (e) {
              console.warn('[console] fbUpdateRequest failed:', e);
              clearInterval(timer);
            }
            if (attempts >= 10) {
              clearInterval(timer);
            }
            updateRenderInfo();
          }, 1200);
        });

        rfb.addEventListener('disconnect', (evt: any) => {
          console.log('[console] Desconectado:', evt);
          setStatus('error');
          setErrorMsg(`Desconectado: ${JSON.stringify(evt?.detail || {})}`);
        });

        rfb.addEventListener('securityfailure', (evt: any) => {
          console.log('[console] Security failure:', evt);
          setStatus('error');
          setErrorMsg('Security failure');
        });

        rfb.addEventListener('credentialsrequired', () => {
          console.log('[console] Credentials required');
          focusConsole();
        });

        rfb.addEventListener('desktopname', (evt: any) => {
          console.log('[console] desktopname', evt?.detail);
        });
      } catch (err) {
        console.error('[console] Error:', err);
        setStatus('error');
        setErrorMsg((err as Error).message);
      }
    };

    connect();

    return () => {
      if (focusBoostTimer) {
        clearInterval(focusBoostTimer);
      }
      if (renderInfoTimer) {
        clearInterval(renderInfoTimer);
      }
      resizeObserver?.disconnect();
      cleanupFocusHandlers?.();
      if (rfb) {
        rfb.disconnect();
      }
    };
  }, [wsUrl, ticket]);

  return (
    <div className="h-screen overflow-hidden bg-black text-white flex flex-col">
      <div className="flex-none flex items-center justify-between px-4 py-2 bg-[#0b1321] border-b border-white/10">
        <div>
          <h1 className="text-sm font-semibold">Consola VM</h1>
          <p className="text-xs text-white/60">{vmId}</p>
          <p className="text-xs text-amber-300">{debugInfo}</p>
          <p className="text-xs text-sky-300">{renderInfo || 'Preparando render…'}</p>
          <p className="text-xs text-white/50">Haz clic dentro de la consola para capturar teclado y mouse.</p>
        </div>
        <div className="flex items-center gap-3">
          {status === 'connecting' && (
            <span className="text-xs text-amber-300">Conectando...</span>
          )}
          {status === 'connected' && (
            <span className="text-xs text-emerald-400">● Conectado</span>
          )}
          {status === 'error' && (
            <span className="text-xs text-red-400">Error: {errorMsg}</span>
          )}
          <button
            onClick={() => window.close()}
            className="text-xs px-3 py-1 bg-white/10 hover:bg-white/20 rounded"
          >
            Cerrar
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        style={{ height: 'calc(100vh - 70px)', minHeight: 'calc(100vh - 70px)' }}
      />
    </div>
  );
}

export default function ConsolePage() {
  return (
    <Suspense fallback={null}>
      <ConsolePageContent />
    </Suspense>
  );
}
