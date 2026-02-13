'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ConsolePage() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');

  const wsUrl = searchParams.get('wsUrl') || '';
  const ticket = searchParams.get('ticket') || '';
  const vmId = searchParams.get('vmId') || '';

  useEffect(() => {
    // Debug: mostrar la URL recibida
    console.log('[console] URL params:', { wsUrl, ticket: ticket ? 'present' : 'missing', vmId });
    setDebugInfo(`wsUrl: ${wsUrl.substring(0, 50)}... ticket: ${ticket ? 'OK' : 'MISSING'}`);
    
    if (!wsUrl || !containerRef.current) {
      setErrorMsg('Falta wsUrl o container');
      setStatus('error');
      return;
    }

    if (wsUrl.includes(':0/') || wsUrl.includes('localhost:0')) {
      setErrorMsg('URL tiene puerto 0 - proxy no iniciado correctamente');
      setStatus('error');
      return;
    }

    let rfb: any = null;

    const connect = async () => {
      try {
        console.log('[console] Conectando a:', wsUrl);
        
        const mod = await import('@novnc/novnc/lib/rfb');
        const RFB = (mod as { default?: any }).default;
        if (!RFB) throw new Error('noVNC no disponible');

        const canvas = document.createElement('div');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        containerRef.current!.appendChild(canvas);

        console.log('[console] Creando RFB con URL:', wsUrl);
        rfb = new RFB(canvas, wsUrl, {
          credentials: { password: ticket },
          shared: true,
        });

        rfb.viewOnly = false;
        rfb.scaleViewport = true;
        rfb.clipViewport = true;
        (rfb as any).resizeSession = true;

        rfb.addEventListener('connect', () => {
          console.log('[console] Conectado!');
          setStatus('connected');
          
          // Forzar refresh inicial (como en consola embebida)
          setTimeout(() => {
            try {
              const anyRfb = rfb as any;
              if ((RFB as any)?.messages && anyRfb?._sock) {
                (RFB as any).messages.fbUpdateRequest(anyRfb._sock, false, 0, 0, 4096, 2160);
                console.log('[console] fbUpdateRequest enviado');
              }
            } catch (e) {
              console.warn('[console] fbUpdateRequest failed:', e);
            }
          }, 500);
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
        });
      } catch (err) {
        console.error('[console] Error:', err);
        setStatus('error');
        setErrorMsg((err as Error).message);
      }
    };

    connect();

    return () => {
      if (rfb) {
        rfb.disconnect();
      }
    };
  }, [wsUrl, ticket]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0b1321] border-b border-white/10">
        <div>
          <h1 className="text-sm font-semibold">Consola VM</h1>
          <p className="text-xs text-white/60">{vmId}</p>
          <p className="text-xs text-amber-300">{debugInfo}</p>
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
        className="flex-1 relative"
        style={{ minHeight: 'calc(100vh - 70px)' }}
      />
    </div>
  );
}
