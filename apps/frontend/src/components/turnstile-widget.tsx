'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { mountTurnstile, type TurnstileProvider } from './turnstile-lifecycle';

declare global {
  interface Window {
    turnstile?: TurnstileProvider;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  // Checkout activity must not reset a challenge or invalidate its accepted token.
  disabled?: boolean;
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadError, setLoadError] = useState<string | null>(null);

  useLayoutEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    return mountTurnstile({
      container,
      siteKey,
      loadProvider: async () => {
        await loadTurnstileScript();
        if (!window.turnstile) throw new Error('Turnstile failed to load');
        return window.turnstile;
      },
      onToken: (token) => onTokenRef.current(token),
      onError: setLoadError,
    });
  }, [siteKey]);

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-4">
      <div className="mb-3 text-sm font-semibold">Spam protection</div>
      <div ref={containerRef} className="min-h-[65px]" />
      {loadError && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {loadError}
        </div>
      )}
    </div>
  );
}
