import { NextResponse } from 'next/server';
import { getServerEnv } from './env';
import { errorResponse } from './api-helpers';

export function assertWritesAllowed(): NextResponse | null {
  const env = getServerEnv();
  if (env.MAINTENANCE_MODE === 'true' || env.WRITE_FREEZE === 'true') {
    return errorResponse(
      503,
      'MAINTENANCE_MODE',
      'Writes are temporarily paused for database maintenance.',
    );
  }
  return null;
}
