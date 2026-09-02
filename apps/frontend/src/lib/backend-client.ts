import 'server-only';
import { createPublicBackend } from './backend-transport';

export function getPublicBackend() {
  return createPublicBackend(process.env.FRONTEND_PUBLIC_API_URL, process.env.NODE_ENV);
}
