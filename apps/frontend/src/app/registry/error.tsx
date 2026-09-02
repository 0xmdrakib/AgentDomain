'use client';

import { PublicDataError } from '@/components/public-data-error';

export default function RegistryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PublicDataError
      title="Registry temporarily unavailable"
      description="Public identity data could not be loaded. Please try again in a moment."
      error={error}
      reset={reset}
    />
  );
}
