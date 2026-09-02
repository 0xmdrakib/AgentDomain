import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names safely.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an address for display: 0x1234…abcd
 */
export function shortAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/**
 * Format a USDC amount string for display.
 */
export function formatUsd(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return '$0';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a date for display.
 */
export function formatDate(d: Date | string | number): string {
  const date = new Date(d);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a relative time (e.g. "2 hours ago").
 */
export function timeAgo(d: Date | string | number): string {
  const date = new Date(d);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const future = seconds < 0;
  const absSeconds = Math.abs(seconds);
  if (absSeconds < 60) return future ? `in ${absSeconds}s` : `${absSeconds}s ago`;
  const minutes = Math.floor(absSeconds / 60);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(absSeconds / 60 / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(absSeconds / 60 / 60 / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return future ? `in ${months}mo` : `${months}mo ago`;
  return future ? `in ${Math.floor(months / 12)}y` : `${Math.floor(months / 12)}y ago`;
}
