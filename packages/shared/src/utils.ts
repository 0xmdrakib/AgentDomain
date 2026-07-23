import {
  SERVICE_PLAN_CATALOG,
  USDC_DECIMALS,
} from './constants.js';
import type { ServicePlanInterval, ServicePlanKey } from './types.js';

export function parseUsdc(amount: string): bigint {
  const [whole, frac = ''] = amount.replace(/[^0-9.]/g, '').split('.');
  const padded = (frac || '').padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(whole + padded);
}

export function formatUsdcAtomic(value: bigint): string {
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')}`;
}

export function getServicePlanPriceAtomic(
  plan: ServicePlanKey,
  _interval: ServicePlanInterval,
): bigint {
  const entry = SERVICE_PLAN_CATALOG[plan];
  return entry.yearlyPriceUsdcAtomic;
}

export function addServicePlanInterval(date: Date, _interval: ServicePlanInterval): Date {
  const out = new Date(date);
  out.setUTCFullYear(out.getUTCFullYear() + 1);
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = opts?.attempts ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxAttempts - 1) {
        await sleep(baseDelay * Math.pow(2, i));
      }
    }
  }
  throw lastError;
}

export function buildDomain(name: string, tld: string): string {
  return `${name}.${tld}`;
}

export function buildBasename(label: string): string {
  return `${label}.base.eth`;
}

export function buildEnsName(label: string): string {
  return `${label}.eth`;
}

export function usesRenewalPriceForFirstYear(tld: string): boolean {
  // Some TLDs always use renewal pricing; others use promo pricing for the first year.
  // This is a simplified version — adjust per registrar partner pricing.
  const renewalTlds = new Set(['com', 'net', 'org', 'io', 'co', 'ai']);
  return renewalTlds.has(tld);
}

const RESERVED_NAMES = new Set([
  'admin',
  'root',
  'system',
  'www',
  'mail',
  'smtp',
  'pop',
  'imap',
  'ftp',
  'api',
  'app',
  'ns1',
  'ns2',
]);

export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.has(name.toLowerCase());
}

export interface ComputeRegistrationCostOptions {
  tld: string;
  registerBasename: boolean;
  registerEns: boolean;
  emailEnabled?: boolean;
  years?: number;
  serviceFee: bigint;
  servicePlanFee?: bigint;
  emailFee?: bigint;
  sslCertificationFee?: bigint;
  domainMarkup: bigint;
  domainCost: bigint;
  basenameFee: bigint;
  basenameCost: bigint;
  ensFee: bigint;
  ensCost: bigint;
}

export interface ComputeRegistrationCostResult {
  domainCost: bigint;
  basenameCost: bigint;
  ensCost: bigint;
  serviceFee: bigint;
  servicePlanFee: bigint;
  emailFee: bigint;
  sslCertificationFee: bigint;
  total: bigint;
}

export function computeRegistrationCost(
  opts: ComputeRegistrationCostOptions,
): ComputeRegistrationCostResult {
  const years = Math.max(1, opts.years ?? 1);
  const yearlyServiceFee = opts.serviceFee;
  const serviceFee = yearlyServiceFee * BigInt(years);
  const servicePlanFee = opts.servicePlanFee ?? 0n;
  const emailFee = 0n;
  const sslCertificationFee = 0n;
  let total =
    opts.domainCost +
    opts.domainMarkup +
    serviceFee +
    servicePlanFee +
    emailFee +
    sslCertificationFee;
  const result: ComputeRegistrationCostResult = {
    domainCost: opts.domainCost,
    basenameCost: 0n,
    ensCost: 0n,
    serviceFee,
    servicePlanFee,
    emailFee,
    sslCertificationFee,
    total: 0n,
  };
  if (opts.registerBasename) {
    total += opts.basenameFee + opts.basenameCost;
    result.basenameCost = opts.basenameCost;
  }
  if (opts.registerEns) {
    total += opts.ensFee + opts.ensCost;
    result.ensCost = opts.ensCost;
  }
  result.total = total;
  return result;
}
