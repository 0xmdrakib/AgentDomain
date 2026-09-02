'use client';

import { PublicDataError } from '@/components/public-data-error';

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
  return (
    <PublicDataError
      title="Something went wrong"
      description="The page could not be loaded. Please try again in a moment."
      error={error}
      reset={reset}
    />
  );
}
