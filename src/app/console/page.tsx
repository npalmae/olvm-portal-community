'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const XK_F1 = 0xffbe;
const XK_F2 = 0xffbf;
const XK_F3 = 0xffc0;
const XK_F4 = 0xffc1;
const XK_F5 = 0xffc2;
const XK_F6 = 0xffc3;
const XK_F7 = 0xffc4;
const XK_F8 = 0xffc5;
const XK_F9 = 0xffc6;
const XK_F10 = 0xffc7;
const XK_F11 = 0xffc8;
const XK_F12 = 0xffc9;
const XK_CTRL_L = 0xffe3;
const XK_ALT_L = 0xffe9;
const XK_DELETE = 0xffff;

function ConsolePageContent() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [renderInfo, setRenderInfo] = useState<string>('');
  const [showOnboardKb, setShowOnboardKb] = useState(false);
  const rfbRef = useRef<any>(null);

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
        // Si la URL ya apunta al proxy WS (path /console-proxy/, incluso en otro
        // puerto, p.ej. ws://host:3010/console-proxy/), se usa tal cual.
        const isProxyUrl = parsed.pathname.startsWith('/console-proxy/');

        if (isProxyUrl) {
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
          rfbRef.current = rfb;
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

  const handleAction = async (action: string) => {
    const tid = searchParams.get('tenantId') || '';
    const id = searchParams.get('vmId') || '';
    if (!tid || !id) return;
    setErrorMsg('');
    try {
      const res = await fetch(`/api/tenants/${tid}/vms/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Error en la acción');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const sendKey = (keysym: number, label: string) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    try {
      rfb.sendKey(keysym, label, true);
      setTimeout(() => rfb.sendKey(keysym, label, false), 50);
    } catch (e) {
      console.error('[console] sendKey error:', e);
    }
  };

  const sendCtrlAltDel = () => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    try {
      rfb.sendCtrlAltDel();
    } catch (e) {
      console.error('[console] sendCtrlAltDel error:', e);
      sendKey(XK_CTRL_L, 'ControlLeft');
      sendKey(XK_ALT_L, 'AltLeft');
      sendKey(XK_DELETE, 'Delete');
    }
  };

  const sendCombo = (keys: { keysym: number; label: string }[]) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    for (const k of keys) {
      try {
        rfb.sendKey(k.keysym, k.label, true);
      } catch {}
    }
    setTimeout(() => {
      for (const k of [...keys].reverse()) {
        try {
          rfb.sendKey(k.keysym, k.label, false);
        } catch {}
      }
    }, 80);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        el.requestFullscreen();
      }
    } catch (e) {
      console.error('[console] fullscreen error:', e);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-black text-white flex flex-col">
      <div className="flex-none flex items-center justify-between px-4 py-2 bg-[#0b1321] border-b border-white/10">
        <div>
          <h1 className="text-sm font-semibold">Consola VM</h1>
          <p className="text-xs text-white/50">Haz clic dentro de la consola para capturar teclado y mouse.</p>
        </div>
        <div className="flex items-center gap-2">
          {status === 'connecting' && (
            <span className="text-xs text-amber-300">Conectando...</span>
          )}
          {status === 'connected' && (
            <span className="text-xs text-emerald-400">● Conectado</span>
          )}
          {status === 'error' && (
            <span className="text-xs text-red-400">Error: {errorMsg}</span>
          )}
          <button onClick={sendCtrlAltDel} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Ctrl+Alt+Del">Ctrl+Alt+Del</button>
          <button onClick={() => sendCombo([{keysym: XK_CTRL_L, label: 'ControlLeft'}, {keysym: XK_ALT_L, label: 'AltLeft'}, {keysym: XK_F1, label: 'F1'}])} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Ctrl+Alt+F1">Ctrl+Alt+F1</button>
          <button onClick={toggleFullscreen} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Pantalla completa">Fullscreen</button>
          <button onClick={() => setShowOnboardKb(v => !v)} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Teclado en pantalla">Teclado</button>
          <button onClick={() => handleAction('shutdown')} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Apagado ordenado">Apagar</button>
          <button onClick={() => handleAction('stop')} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Apagado forzado">Stop</button>
          <button onClick={() => handleAction('reboot')} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Reiniciar">Reiniciar</button>
          <button onClick={() => handleAction('eject')} className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 text-white/80 hover:bg-gray-700" title="Expulsar CD/ISO">Expulsar</button>
        </div>
      </div>
      {showOnboardKb && (
        <div className="flex-none px-4 py-2 bg-[#0b1321] border-b border-white/10 flex flex-wrap gap-1.5">
          <button onClick={() => sendKey(XK_CTRL_L, 'ControlLeft')} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Ctrl</button>
          <button onClick={() => sendKey(XK_ALT_L, 'AltLeft')} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Alt</button>
          <button onClick={() => sendKey(XK_DELETE, 'Delete')} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Del</button>
          <span className="text-white/30 mx-1">|</span>
          {[XK_F1,XK_F2,XK_F3,XK_F4,XK_F5,XK_F6,XK_F7,XK_F8,XK_F9,XK_F10,XK_F11,XK_F12].map((k, i) => (
            <button key={k} onClick={() => sendKey(k, `F${i+1}`)} className="text-xs px-1.5 py-1 rounded bg-gray-700 hover:bg-gray-600">F{i+1}</button>
          ))}
        </div>
      )}
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
