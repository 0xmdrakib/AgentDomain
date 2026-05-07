'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

/**
 * Global error boundary. Catches runtime errors anywhere in the app and shows
 * a friendly fallback UI instead of a blank page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Async-import + capture so this client-only file doesn't pull in Sentry
    // unless an error actually fires.
    import('@/lib/sentry').then(({ captureException }) => {
      captureException(error, { digest: error.digest });
    });
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mb-6">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
        <p className="text-muted-foreground mb-6">
          We hit an unexpected error. The team has been notified.
        </p>
        {process.env.NODE_ENV === 'development' && (
          <pre className="text-left text-xs bg-muted/40 border border-border/40 rounded p-3 mb-6 overflow-auto">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3 justify-center">
          <Button onClick={reset}>Try again</Button>
          <Link href="/">
            <Button variant="outline">Go home</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
