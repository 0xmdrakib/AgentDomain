'use client';

import { PublicDataError } from '@/components/public-data-error';

export default function AgentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PublicDataError
      title="Identity temporarily unavailable"
      description="This public identity could not be loaded. Please try again in a moment."
      error={error}
      reset={reset}
    />
  );
}
