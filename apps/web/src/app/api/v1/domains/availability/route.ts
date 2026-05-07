import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  tldSchema,
  domainLabelSchema,
  buildDomain,
  buildBasename,
  buildEnsName,
  isReservedName,
  PRIMARY_SUPPORTED_TLDS,
  type SupportedTld,
} from '@agentdomain/shared';
import { withErrorHandling, parseQuery } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';

const log = logger.child({ route: '/domains/availability' });

const schema = z.object({
  name: domainLabelSchema,
  tld: tldSchema.default('xyz'),
  basenameLabel: domainLabelSchema.optional(),
  ensLabel: domainLabelSchema.optional(),
});

const POPULAR_TLDS: SupportedTld[] = [...PRIMARY_SUPPORTED_TLDS];

export const runtime = 'nodejs';

/**
 * GET /api/v1/domains/availability?name=foo&tld=ai&basenameLabel=foo-ai&ensLabel=fooagent
 *
 * Every domain price comes from Spaceship's live /availability API.
 * There are no fallback prices anywhere in this route.
 *
 * Flow:
 *   1. Reserved name check (always)
 *   2. Local DB check (if DB configured)
 *   3. Spaceship single check for selected TLD
 *   4. Spaceship bulk check for popular alternative TLDs
 *   5. Basename + ENS checks (independent)
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const parsed = parseQuery(req, schema);
      if (parsed instanceof Response) return parsed;

      const basenameLabel = parsed.basenameLabel ?? parsed.name;
      const ensLabel = parsed.ensLabel ?? parsed.name;
      const domain = buildDomain(parsed.name, parsed.tld);
      const basename = buildBasename(basenameLabel);
      const ensName = buildEnsName(ensLabel);

      // 1. Always check reserved names
      if (isReservedName(parsed.name)) {
        return Response.json({
          domain,
          available: false,
          reason: 'reserved',
          basename,
          ensName,
          alternatives: [],
        });
      }

      // Spaceship is required for production — no fake prices.
      if (!process.env.SPACESHIP_API_KEY || !process.env.SPACESHIP_API_SECRET) {
        return Response.json(
          {
            error:
              'Spaceship API is not configured. Set SPACESHIP_API_KEY and SPACESHIP_API_SECRET in .env.local',
          },
          { status: 503 },
        );
      }

      const { getSpaceship } = await import('@/services/spaceship');
      const ss = getSpaceship();

      // 2. Single check for the selected domain
      let selectedResult: Awaited<ReturnType<typeof ss.checkAvailability>>;
      try {
        selectedResult = await ss.checkAvailability(domain);
      } catch (e) {
        log.error('spaceship single check failed', { err: String(e), domain });
        return Response.json(
          { error: `Unable to check price for ${domain}. Spaceship API error.` },
          { status: 502 },
        );
      }

      // 3. Bulk check for popular alternative TLDs
      const alternatives = await getDomainAlternatives(ss, parsed.name, parsed.tld);

      // 4. Basename check
      let basenameAvailable: boolean | undefined;
      let basenameReason: string | undefined;
      let basenameCostUsdc: string | undefined;
      if (isReservedName(basenameLabel)) {
        basenameAvailable = false;
        basenameReason = 'reserved';
      } else {
        try {
          const { getBasenames } = await import('@/services/basenames');
          basenameAvailable = await getBasenames().isAvailable(basenameLabel);
          if (!basenameAvailable) {
            basenameReason = 'taken';
          } else {
            const quote = await getBasenames().getQuoteUsdcAtomic(basenameLabel, 31536000);
            basenameCostUsdc = formatAtomicUsdc(quote.totalUsdcAtomic);
          }
        } catch (e) {
          basenameAvailable = false;
          basenameReason = 'check_failed';
          log.warn('basename check failed', { err: String(e), basename });
        }
      }

      // 5. ENS check
      let ensAvailable: boolean | undefined;
      let ensReason: string | undefined;
      let ensCostUsdc: string | undefined;
      if (isReservedName(ensLabel)) {
        ensAvailable = false;
        ensReason = 'reserved';
      } else {
        try {
          const { getEns } = await import('@/services/ens');
          const ens = getEns();
          ensAvailable = await ens.isAvailable(ensLabel);
          if (ensAvailable) {
            const quote = await ens.getQuoteUsdcAtomic(ensLabel);
            ensCostUsdc = formatAtomicUsdc(quote.totalUsdcAtomic);
          } else {
            ensReason = 'taken';
          }
        } catch (e) {
          ensAvailable = false;
          ensReason = 'check_failed';
          log.warn('ens check failed', { err: String(e), ensName });
        }
      }

      // 6. DB check (skip gracefully if DB not configured)
      if (process.env.DATABASE_URL) {
        try {
          const { getDb } = await import('@/db/index');
          const { agents } = await import('@/db/schema');
          const { eq } = await import('drizzle-orm');
          const db = getDb();
          const existing = await db.select().from(agents).where(eq(agents.domain, domain)).limit(1);
          if (existing.length > 0) {
            return Response.json({
              domain,
              available: false,
              reason: 'taken',
              basename,
              basenameAvailable,
              basenameReason,
              basenameCostUsdc,
              ensName,
              ensAvailable,
              ensReason,
              ensCostUsdc,
              alternatives,
            });
          }
        } catch (e) {
          log.warn('db check failed (non-fatal)', { err: String(e), domain });
        }
      }

      const priceUsd = domainPriceUsd(selectedResult.priceUsd, parsed.tld);
      const renewPriceUsd = selectedResult.renewPriceUsd
        ? domainPriceUsd(selectedResult.renewPriceUsd, parsed.tld)
        : undefined;

      return Response.json({
        domain,
        available: selectedResult.available,
        premium: selectedResult.premium,
        priceUsd,
        priceUsdc: priceUsd || undefined,
        renewPriceUsd,
        renewPriceUsdc: renewPriceUsd || undefined,
        priceSource: Number(selectedResult.priceUsd) > 0 ? 'registrar' : 'wholesale',
        basename,
        basenameAvailable,
        basenameReason,
        basenameCostUsdc,
        ensName,
        ensAvailable,
        ensReason,
        ensCostUsdc,
        alternatives,
      });
    },
    { route: '/domains/availability' },
  );
}

async function getDomainAlternatives(
  ss: Awaited<ReturnType<typeof import('@/services/spaceship').getSpaceship>>,
  name: string,
  selectedTld: SupportedTld,
) {
  const alternativeDomains = POPULAR_TLDS.filter((tld) => tld !== selectedTld).map((tld) =>
    buildDomain(name, tld),
  );

  if (alternativeDomains.length === 0) return [];

  let taken = new Set<string>();
  if (process.env.DATABASE_URL) {
    try {
      const { getDb } = await import('@/db/index');
      const { agents } = await import('@/db/schema');
      const { inArray } = await import('drizzle-orm');
      const rows = await getDb()
        .select({ domain: agents.domain })
        .from(agents)
        .where(inArray(agents.domain, alternativeDomains));
      taken = new Set(rows.map((row) => row.domain.toLowerCase()));
    } catch (e) {
      log.warn('alternative DB check failed (non-fatal)', { err: String(e) });
    }
  }

  try {
    const results = await ss.checkBulkAvailability(alternativeDomains);
    return results
      .map((result) => {
        const tld = result.domain.split('.').pop() as SupportedTld;
        const locallyTaken = taken.has(result.domain.toLowerCase());
        return {
          tld,
          domain: result.domain,
          available: result.available && !locallyTaken,
          premium: result.premium,
          priceUsd: domainPriceUsd(result.priceUsd, tld),
          priceSource:
            Number(result.priceUsd) > 0 ? ('registrar' as const) : ('wholesale' as const),
        };
      })
      .filter((item) => item.available)
      .sort(compareAlternatives);
  } catch (e) {
    log.warn('spaceship bulk alternative check failed', { err: String(e), name });
    return [];
  }
}

function compareAlternatives(
  a: { available: boolean; priceUsd: string },
  b: { available: boolean; priceUsd: string },
) {
  if (a.available !== b.available) return a.available ? -1 : 1;
  const priceA = Number(a.priceUsd) || 999999;
  const priceB = Number(b.priceUsd) || 999999;
  return priceA - priceB;
}

function domainPriceUsd(spaceshipPriceUsd: string, _tld: string): string {
  return Number(spaceshipPriceUsd) > 0 ? spaceshipPriceUsd : '';
}

function formatAtomicUsdc(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const frac = atomic % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}
