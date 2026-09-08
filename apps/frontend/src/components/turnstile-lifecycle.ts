export interface TurnstileProvider {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark' | 'auto';
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

export function mountTurnstile({
  container,
  siteKey,
  loadProvider,
  onToken,
  onError,
}: {
  container: HTMLElement;
  siteKey: string;
  loadProvider: () => Promise<TurnstileProvider>;
  onToken: (token: string | null) => void;
  onError: (error: string | null) => void;
}): () => void {
  let active = true;
  let provider: TurnstileProvider | null = null;
  let widgetId: string | null = null;

  onError(null);
  onToken(null);

  void loadProvider()
    .then((loaded) => {
      if (!active) return;
      provider = loaded;
      const renderedId = loaded.render(container, {
        sitekey: siteKey,
        theme: 'dark',
        callback: (token) => {
          if (!active) return;
          onError(null);
          onToken(token);
        },
        'expired-callback': () => {
          if (active) onToken(null);
        },
        'error-callback': () => {
          if (!active) return;
          onError('Spam check failed to load. Refresh and try again.');
          onToken(null);
        },
      });
      // A synchronous provider callback can unmount before render returns its ID.
      if (active) widgetId = renderedId;
      else loaded.remove(renderedId);
    })
    .catch((error: unknown) => {
      if (!active) return;
      active = false;
      onError(error instanceof Error ? error.message : 'Turnstile failed to load');
      onToken(null);
    });

  return () => {
    active = false;
    const removedId = widgetId;
    widgetId = null;
    if (removedId !== null) provider?.remove(removedId);
  };
}
