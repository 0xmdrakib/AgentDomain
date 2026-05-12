'use client';

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button';
import {
  Check,
  X,
  Loader2,
  ArrowRight,
  Sparkles,
  ExternalLink,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { cn, shortAddress } from '@/lib/utils';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { useRegisterAgent } from '@/hooks/use-register-agent';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { toast } from 'sonner';
import { ADDITIONAL_SUPPORTED_TLDS, PRIMARY_SUPPORTED_TLDS } from '@agentdomain/shared/constants';
import type { SupportedTld } from '@agentdomain/shared';

const TLDS = PRIMARY_SUPPORTED_TLDS;
type Tld = (typeof TLDS)[number];

const MORE_TLDS = ADDITIONAL_SUPPORTED_TLDS;

const BASE_MAINNET_CHAIN_ID = 8453;
const COINBASE_BUY_USDC_URL = 'https://www.coinbase.com/buy/usdc';
const NEXORA_SWAP_URL = 'https://nexoraswap.online';
const BASE_SEPOLIA_FAUCET_URL = 'https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet';

interface AvailabilityResult {
  domain: string;
  available: boolean;
  reason?: string;
  premium?: boolean;
  priceUsd?: string;
  basename?: string;
  basenameAvailable?: boolean;
  basenameReason?: string;
  basenameCostUsdc?: string;
  ensName?: string;
  ensAvailable?: boolean;
  ensReason?: string;
  ensCostUsdc?: string;
  alternatives?: DomainAlternative[];
}

interface DomainAlternative {
  tld: Tld;
  domain: string;
  available: boolean;
  priceUsd: string;
  premium: boolean;
  priceSource: 'registrar' | 'fallback' | 'unknown';
}

interface QuoteResult {
  domainCostUsdc: string;
  basenameCostUsdc: string;
  ensCostUsdc: string;
  serviceFeeUsdc: string;
  totalUsdc: string;
  discountApplied?: boolean;
  discountPercent?: number;
}

export function RegisterFlow() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const {
    balanceNumber,
    balanceFormatted,
    isLoading: balanceLoading,
  } = useUsdcBalance(address, chainId);
  const { state: regState, register: submitRegister, reset: resetRegister } = useRegisterAgent();

  const [name, setName] = useState('');
  const [searchedName, setSearchedName] = useState('');
  const [tld, setTld] = useState<SupportedTld>('xyz');
  const [registerBasename, setRegisterBasename] = useState(true);
  const [basenameLabel, setBasenameLabel] = useState('');
  const [registerEns, setRegisterEns] = useState(false);
  const [ensLabel, setEnsLabel] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [ownerAddressInput, setOwnerAddressInput] = useState('');
  const [showMoreTlds, setShowMoreTlds] = useState(false);
  const [years, setYears] = useState(1);
  const [autoRenew, setAutoRenew] = useState(false);

  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [discountCode, setDiscountCode] = useState('');
  const [discountDraft, setDiscountDraft] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const effectiveBasenameLabel = basenameLabel || name;
  const effectiveEnsLabel = ensLabel || name;
  const checkedBasenameLabel = registerBasename ? effectiveBasenameLabel : name;
  const checkedEnsLabel = registerEns ? effectiveEnsLabel : name;

  // Live availability check
  useEffect(() => {
    if (searchedName.length < 3) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const query = new URLSearchParams({
          name: searchedName,
          tld,
          basenameLabel: registerBasename ? (basenameLabel || searchedName) : searchedName,
          ensLabel: registerEns ? (ensLabel || searchedName) : searchedName,
        });
        const res = await fetch(`/api/v1/domains/availability?${query.toString()}`);
        if (!res.ok) {
          // API error — optimistically mark available so user can attempt
          if (!cancelled)
            setAvailability({ domain: `${searchedName}.${tld}`, available: true, reason: 'api_error' });
          return;
        }
        const data = (await res.json()) as AvailabilityResult;
        if (!cancelled) setAvailability(data);
      } catch {
        // Network error — optimistically mark available
        if (!cancelled)
          setAvailability({ domain: `${searchedName}.${tld}`, available: true, reason: 'network_error' });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setChecking(false);
    };
  }, [searchedName, tld, basenameLabel, ensLabel, registerBasename, registerEns]);

  // Live quote
  useEffect(() => {
    if (searchedName.length < 3) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams({
      preferredName: searchedName,
      tld,
      registerBasename: String(registerBasename),
      basenameLabel: registerBasename ? (basenameLabel || searchedName) : searchedName,
      registerEns: String(registerEns),
      ensLabel: registerEns ? (ensLabel || searchedName) : searchedName,
      years: String(years),
    });
    if (discountCode) query.set('discountCode', discountCode);
    fetch(`/api/v1/agents/quote?${query.toString()}`)
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as QuoteResult;
      })
      .then((data) => !cancelled && setQuote(data?.totalUsdc ? data : null))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [
    searchedName,
    tld,
    registerBasename,
    registerEns,
    basenameLabel,
    ensLabel,
    years,
    discountCode,
  ]);

  const validName = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(name);
  const validBasenameLabel = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(effectiveBasenameLabel);
  const validEnsLabel = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(effectiveEnsLabel);
  const validOwnerAddress =
    !ownerAddressInput || /^0x[a-fA-F0-9]{40}$/.test(ownerAddressInput.trim());
  const totalCost = quote ? Number(quote.totalUsdc) : 0;
  const isMainnet = chainId === BASE_MAINNET_CHAIN_ID;
  const suggestedAlternatives = useMemo(
    () => availability?.alternatives?.filter((alt) => alt.available).slice(0, 6) ?? [],
    [availability?.alternatives],
  );
  const basenameBlocked =
    registerBasename && (!validBasenameLabel || availability?.basenameAvailable === false);
  const ensBlocked = registerEns && (!validEnsLabel || availability?.ensAvailable === false);
  const insufficientBalance = isConnected && totalCost > 0 && balanceNumber < totalCost;

  const canSubmit = useMemo(() => {
    if (!isConnected || !address) return false;
    if (!validName || !availability?.available || checking) return false;
    if (!validOwnerAddress) return false;
    if (basenameBlocked) return false;
    if (ensBlocked) return false;
    if (turnstileSiteKey && !turnstileToken) return false;
    if (insufficientBalance) return false;
    if (regState.phase !== 'idle' && regState.phase !== 'error') return false;
    return true;
  }, [
    isConnected,
    address,
    validName,
    validOwnerAddress,
    availability,
    checking,
    basenameBlocked,
    ensBlocked,
    turnstileSiteKey,
    turnstileToken,
    insufficientBalance,
    regState.phase,
  ]);

  const handleTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  async function handleRegister() {
    try {
      const result = await submitRegister({
        preferredName: name,
        tld,
        registerBasename,
        basenameLabel: effectiveBasenameLabel,
        registerEns,
        ensLabel: effectiveEnsLabel,
        ownerAddress: ownerAddressInput.trim()
          ? (ownerAddressInput.trim() as `0x${string}`)
          : undefined,
        emailEnabled,
        years,
        autoRenew,
        discountCode: quote?.discountApplied ? discountCode : undefined,
        turnstileToken: turnstileToken ?? undefined,
      });
      toast.success(`Registered ${result.domain}!`, {
        description: `Token #${result.nftTokenId} minted on Base.`,
      });
    } catch (e) {
      toast.error('Registration failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  // Show success screen if registration completed
  if (regState.phase === 'success' && regState.result) {
    return (
      <SuccessScreen
        result={regState.result}
        autoRenew={autoRenew}
        onReset={() => {
          resetRegister();
          setName('');
          setBasenameLabel('');
          setEnsLabel('');
          setOwnerAddressInput('');
          setYears(1);
          setAutoRenew(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Wallet connection banner */}
      {!isConnected && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Connect your wallet to begin
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Your agent identity will be linked to the connected address.
              </div>
            </div>
            <ConnectWalletButton variant="gradient" />
          </CardContent>
        </Card>
      )}

      {isConnected && address && (
        <div className="flex items-center justify-between text-sm px-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            Connected: <span className="font-mono text-foreground">{shortAddress(address)}</span>
          </div>
          <div className="text-muted-foreground">
            Balance:{' '}
            <span className={cn('font-mono', insufficientBalance && 'text-destructive')}>
              {balanceLoading ? '...' : `$${Number(balanceFormatted).toFixed(2)}`} USDC
            </span>
          </div>
        </div>
      )}

      {/* Step 1: Name */}
      <Card className="border-border/40">
        <CardContent className="p-6">
          <label className="block text-sm font-semibold mb-3">1. Choose your name</label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-background border rounded-lg focus-within:ring-2 focus-within:ring-primary">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  if (availability) setAvailability(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (name.length >= 3) setSearchedName(name);
                  }
                }}
                placeholder="myagent"
                className="flex-1 bg-transparent px-4 py-3 outline-none font-mono rounded-l-lg"
                autoFocus
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
              <TldSelector
                value={tld}
                onChange={(v) => {
                  setTld(v);
                  setShowMoreTlds(false);
                }}
                onShowMore={() => setShowMoreTlds(true)}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
            </div>
            <Button
              onClick={() => {
                if (name.length >= 3) setSearchedName(name);
              }}
              disabled={regState.phase !== 'idle' && regState.phase !== 'error' || name.length < 3 || checking}
              className="py-3 px-6 h-auto bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Search
            </Button>
          </div>
          {name && searchedName && name === searchedName && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              {checking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Checking availability...</span>
                </>
              ) : !validName ? (
                <>
                  <X className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">Invalid name format</span>
                </>
              ) : availability?.available ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-emerald-400">
                    {name}.{tld} is available
                    {availability.priceUsd && Number(availability.priceUsd) > 0
                      ? ` ($${availability.priceUsd})`
                      : ''}
                  </span>
                  {availability.premium && <Badge variant="warning">Premium</Badge>}
                </>
              ) : availability ? (
                <div>
                  <div className="flex items-center gap-2">
                    <X className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">
                      {name}.{tld} is unavailable — try an alternative below
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {name && validName && registerBasename && availability?.basename && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              {availability.basenameAvailable === false ? (
                <>
                  <X className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">
                    {availability.basename} is unavailable
                    {availability.basenameReason ? ` (${availability.basenameReason})` : ''}
                  </span>
                </>
              ) : availability.basenameAvailable === true ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-emerald-400">
                    {availability.basename} is available
                    {availability.basenameCostUsdc ? ` ($${availability.basenameCostUsdc})` : ''}
                  </span>
                </>
              ) : null}
            </div>
          )}
          {name && validName && registerEns && availability?.ensName && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              {availability.ensAvailable === false ? (
                <>
                  <X className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">
                    {availability.ensName} is unavailable
                    {availability.ensReason ? ` (${availability.ensReason})` : ''}
                  </span>
                </>
              ) : availability.ensAvailable === true ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-emerald-400">
                    {availability.ensName} is available
                    {availability.ensCostUsdc ? ` ($${availability.ensCostUsdc})` : ''}
                  </span>
                </>
              ) : null}
            </div>
          )}
          {suggestedAlternatives.length > 0 && (
            <div className="mt-4 rounded-xl border border-border/40 bg-background/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Available alternatives</span>
                <span>Cheapest first</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedAlternatives.map((alt, index) => (
                  <button
                    key={alt.domain}
                    type="button"
                    onClick={() => {
                      setTld(alt.tld);
                      setShowMoreTlds(false);
                    }}
                    disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
                    className="group rounded-lg border border-border/50 bg-card/80 px-3 py-2 text-left transition hover:border-primary/60 hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 font-mono text-sm text-foreground">
                      .{alt.tld}
                      {index === 0 && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-sans text-emerald-300">
                          Cheapest
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {alt.priceUsd ? `$${alt.priceUsd}` : 'See quote'}
                      {alt.premium ? ' premium' : ''}
                    </div>
                  </button>
                ))}
              </div>
              <MoreTldsToggle
                show={showMoreTlds}
                onToggle={() => setShowMoreTlds((prev) => !prev)}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
              {showMoreTlds && (
                <MoreTldsGrid
                  tld={tld}
                  setTld={(v) => {
                    setTld(v);
                    setShowMoreTlds(false);
                  }}
                  disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
                />
              )}
            </div>
          )}
          {suggestedAlternatives.length === 0 && showMoreTlds && name && validName && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-card/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">All top-level domains</span>
                <button
                  type="button"
                  onClick={() => setShowMoreTlds(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <MoreTldsGrid
                tld={tld}
                setTld={(v) => {
                  setTld(v);
                  setShowMoreTlds(false);
                }}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Add-ons */}
      <Card className="border-border/40">
        <CardContent className="p-6">
          <label className="block text-sm font-semibold mb-4">2. Choose your stack</label>
          <div className="space-y-8">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Registration
              </h4>
              <div
                className={cn(
                  'w-full flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-all',
                  years > 1
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/40 hover:border-border bg-card/40',
                  regState.phase !== 'idle' &&
                    regState.phase !== 'error' &&
                    'opacity-60 cursor-not-allowed',
                )}
              >
                <div>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    Registration Duration
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    Select how many years to register upfront
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <select
                    value={years}
                    onChange={(e) => setYears(Number(e.target.value))}
                    disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
                    className="bg-background/50 border border-border/40 rounded-md px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                  >
                    {[1, 2, 3, 5, 10].map((y) => (
                      <option key={y} value={y} className="bg-background text-foreground">
                        {y} year{y > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Toggle
                label="Enable Auto-Renew"
                sublabel="Automatically renew your domain and bundle each year using USDC from your Renewal Vault"
                checked={autoRenew}
                onChange={setAutoRenew}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Web3 Identities
              </h4>
              <Toggle
                label="Basename on Base"
                sublabel={
                  effectiveBasenameLabel
                    ? `${effectiveBasenameLabel}.base.eth`
                    : 'yourname.base.eth'
                }
                recommended
                checked={registerBasename}
                onChange={setRegisterBasename}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
              {registerBasename && (
                <NameOverrideInput
                  label="Basename label"
                  suffix=".base.eth"
                  value={effectiveBasenameLabel}
                  placeholder={name || 'myagent'}
                  valid={validBasenameLabel}
                  onChange={(value) => setBasenameLabel(sanitizeLabel(value))}
                  onReset={() => setBasenameLabel('')}
                  disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
                />
              )}
              <Toggle
                label="ENS Name on Ethereum L1"
                sublabel={effectiveEnsLabel ? `${effectiveEnsLabel}.eth` : 'yourname.eth'}
                badge="Ethereum L1"
                checked={registerEns}
                onChange={setRegisterEns}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
              {registerEns && (
                <NameOverrideInput
                  label="ENS label"
                  suffix=".eth"
                  value={effectiveEnsLabel}
                  placeholder={name || 'myagent'}
                  valid={validEnsLabel}
                  onChange={(value) => setEnsLabel(sanitizeLabel(value))}
                  onReset={() => setEnsLabel('')}
                  disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
                />
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Advanced Features
              </h4>
              <Toggle
                label="Email Inbox"
                sublabel={name ? `agent@${name}.${tld}` : 'agent@yourdomain.com'}
                checked={emailEnabled}
                onChange={setEmailEnabled}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
              <AddressOverrideInput
                value={ownerAddressInput}
                valid={validOwnerAddress}
                connectedAddress={address}
                onChange={setOwnerAddressInput}
                disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Quote */}
      {quote && validName && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-6">
            <label className="block text-sm font-semibold mb-4">3. Pricing</label>
            <div className="space-y-2 text-sm">
              <Line
                label={`Domain (.${tld})`}
                value={
                  Number(quote.domainCostUsdc) > 0 ? `$${quote.domainCostUsdc}` : 'Checking...'
                }
              />
              {registerBasename && <Line label="Basename" value={`$${quote.basenameCostUsdc}`} />}
              {registerEns && <Line label="ENS" value={`$${quote.ensCostUsdc}`} />}
              <Line label="Service fee" value={`$${quote.serviceFeeUsdc}`} />
              <div className="border-t border-border/40 pt-3 mt-3">
                <Line
                  label="Total (USDC on Base)"
                  value={Number(quote.domainCostUsdc) > 0 ? `$${quote.totalUsdc}` : 'Checking...'}
                  bold
                />
              </div>
              {quote.discountApplied && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-medium">
                      Code applied — {quote.discountPercent}% off service fee
                    </span>
                    <button
                      onClick={() => {
                        setDiscountCode('');
                        setDiscountDraft('');
                        setDiscountError(null);
                      }}
                      className="text-muted-foreground hover:text-foreground ml-2"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="text-muted-foreground">
                    Service fee: <span className="line-through">$2.00</span> →{' '}
                    <span className="text-emerald-300">${quote.serviceFeeUsdc}</span>
                  </div>
                </div>
              )}
              <div className="pt-2">
                {!quote.discountApplied && (
                  <div className="flex items-center gap-2">
                    <input
                      value={discountDraft}
                      onChange={(e) => {
                        setDiscountDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
                        setDiscountError(null);
                      }}
                      placeholder="Discount code"
                      className="flex-1 h-9 rounded-md border border-border/40 bg-background/50 px-3 text-sm font-mono outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 placeholder:text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!discountDraft.trim()) return;
                        setDiscountCode(discountDraft.trim());
                      }}
                      disabled={!discountDraft.trim()}
                      className="h-9"
                    >
                      Apply
                    </Button>
                  </div>
                )}
                {discountError && (
                  <div className="mt-1 text-xs text-destructive">{discountError}</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Insufficient balance warning */}
      {insufficientBalance && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm flex items-start gap-2">
            <X className="h-4 w-4 text-destructive flex-shrink-0" />
            <div className="space-y-2">
              <div>
                You need ${totalCost.toFixed(2)} USDC but only have ${balanceNumber.toFixed(2)}.
              </div>
              {isMainnet ? (
                <>
                  <div className="text-muted-foreground">
                    Add USDC to this wallet on Base mainnet, then refresh your balance.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <ExternalFundingLink href={COINBASE_BUY_USDC_URL}>
                      Buy USDC on Coinbase
                    </ExternalFundingLink>
                    <ExternalFundingLink href={NEXORA_SWAP_URL}>
                      Swap or bridge from other chains
                    </ExternalFundingLink>
                  </div>
                </>
              ) : (
                <ExternalFundingLink href={BASE_SEPOLIA_FAUCET_URL}>
                  Get testnet USDC
                </ExternalFundingLink>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status indicator during registration */}
      {regState.phase !== 'idle' && regState.phase !== 'error' && regState.phase !== 'success' && (
        <Card className="border-primary/60 bg-primary/10">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-sm font-medium">{regState.message ?? 'Working...'}</div>
          </CardContent>
        </Card>
      )}

      {regState.phase === 'error' && regState.error && (
        <Card className="border-destructive/60 bg-destructive/10">
          <CardContent className="p-4 text-sm text-destructive">
            <div className="font-semibold mb-1">Registration failed</div>
            <div>{regState.error}</div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Submit */}
      <div className="flex flex-wrap items-end justify-end gap-4">
        {turnstileSiteKey && isConnected && (
          <div className="mr-auto max-w-sm">
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              disabled={regState.phase !== 'idle' && regState.phase !== 'error'}
              onToken={handleTurnstileToken}
            />
          </div>
        )}
        {!isConnected ? (
          <ConnectWalletButton variant="gradient" size="xl" />
        ) : (
          <Button
            variant="gradient"
            size="xl"
            disabled={!canSubmit}
            onClick={handleRegister}
            className="group"
          >
            {regState.phase !== 'idle' && regState.phase !== 'error' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Registering...
              </>
            ) : !validName || !availability?.available ? (
              'Pick a valid available name'
            ) : insufficientBalance ? (
              'Insufficient USDC balance'
            ) : !validOwnerAddress ? (
              'Fix owner address'
            ) : registerBasename && !validBasenameLabel ? (
              'Fix Basename label'
            ) : basenameBlocked ? (
              'Basename unavailable'
            ) : registerEns && !validEnsLabel ? (
              'Fix ENS label'
            ) : ensBlocked ? (
              'ENS unavailable'
            ) : turnstileSiteKey && !turnstileToken ? (
              'Complete bot check'
            ) : (
              <>
                Register agent identity
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function TldSelector({
  value,
  onChange,
  onShowMore,
  disabled,
}: {
  value: SupportedTld;
  onChange: (value: SupportedTld) => void;
  onShowMore: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node | null)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        className="flex min-w-24 items-center justify-between gap-2 bg-card/70 px-3 py-3 font-mono text-sm text-foreground outline-none transition hover:bg-primary/10 focus:bg-primary/10 disabled:pointer-events-none disabled:opacity-60 rounded-r-lg"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        .{value}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-2 w-40 overflow-hidden rounded-xl border border-primary/30 bg-[#080b14] p-1 shadow-2xl shadow-blue-500/20 backdrop-blur"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Popular
          </div>
          {TLDS.map((item) => {
            const active = item === value;
            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(item);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 font-mono text-sm transition',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-primary/15 hover:text-foreground',
                )}
              >
                .{item}
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
          <div className="my-1 border-t border-border/30" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onShowMore();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-primary/15 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            More TLDs
          </button>
        </div>
      )}
    </div>
  );
}

function NameOverrideInput({
  label,
  suffix,
  value,
  placeholder,
  valid,
  onChange,
  onReset,
  disabled,
}: {
  label: string;
  suffix: string;
  value: string;
  placeholder: string;
  valid: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          className="text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Use domain name
        </button>
      </div>
      <div
        className={cn(
          'flex items-center overflow-hidden rounded-md border bg-card/60 focus-within:ring-2 focus-within:ring-primary',
          value && !valid && 'border-destructive/70',
        )}
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none"
          disabled={disabled}
        />
        <span className="border-l border-border/40 bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
          {suffix}
        </span>
      </div>
      {value && !valid && (
        <div className="mt-2 text-xs text-destructive">
          Use 3-63 lowercase letters, numbers, or hyphens. No leading or trailing hyphen.
        </div>
      )}
    </div>
  );
}

function AddressOverrideInput({
  value,
  valid,
  connectedAddress,
  onChange,
  disabled,
}: {
  value: string;
  valid: boolean;
  connectedAddress?: `0x${string}`;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-muted-foreground">Deliver identity to</span>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Leave empty to use connected wallet
            {connectedAddress ? ` (${shortAddress(connectedAddress)})` : ''}.
          </div>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            className="text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Use connected
          </button>
        )}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder="0x agent wallet address (optional)"
        className={cn(
          'w-full rounded-md border bg-card/60 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary',
          value && !valid && 'border-destructive/70',
        )}
        disabled={disabled}
      />
      {value && !valid && (
        <div className="mt-2 text-xs text-destructive">Enter a valid EVM address.</div>
      )}
    </div>
  );
}

function sanitizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function ExternalFundingLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline inline-flex items-center gap-1"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function SuccessScreen({
  result,
  autoRenew,
  onReset,
}: {
  result: NonNullable<ReturnType<typeof useRegisterAgent>['state']['result']>;
  autoRenew: boolean;
  onReset: () => void;
}) {
  return (
    <Card className="border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 to-transparent">
      <CardContent className="p-8 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 mb-6">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Identity registered!</h2>
        <p className="text-muted-foreground mb-6">
          Your agent now has a complete onchain identity.
        </p>

        <div className="bg-card/40 border border-border/40 rounded-lg p-6 text-left space-y-3 max-w-md mx-auto">
          <Detail label="Domain" value={result.domain} />
          {result.basename && <Detail label="Basename" value={result.basename} />}
          {result.ensName && <Detail label="ENS" value={result.ensName} />}
          <Detail label="Token ID" value={`#${result.nftTokenId}`} />
          <Detail label="Status" value={result.sslStatus} badge />
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={`https://basescan.org/tx/${result.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline">
              View on BaseScan
              <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
          <Button variant="gradient" onClick={onReset}>
            Register another
          </Button>
        </div>

        {autoRenew && (
          <div className="mt-6 border-t border-border/40 pt-6">
            <div className="text-sm text-muted-foreground mb-4">
              You selected <strong>Enable Auto-Renew</strong>. Since only the domain owner can
              enable this, please click below to authorize it on-chain.
            </div>
            <a href={`/agents/${result.agentId}`}>
              <Button variant="outline" className="w-full">
                Go to Agent Dashboard to Enable Auto-Renew
              </Button>
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant="success" className="font-mono text-xs">
          {value}
        </Badge>
      ) : (
        <span className="font-mono text-sm">{value}</span>
      )}
    </div>
  );
}

function Toggle({
  label,
  sublabel,
  checked,
  onChange,
  recommended,
  badge,
  disabled,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  recommended?: boolean;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'w-full flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-all',
        checked
          ? 'border-primary/50 bg-primary/10'
          : 'border-border/40 hover:border-border bg-card/40',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <div>
        <div className="flex items-center gap-2 font-medium text-sm">
          {label}
          {recommended && <Badge variant="success">Recommended</Badge>}
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </div>
        {sublabel && (
          <div className="text-xs text-muted-foreground font-mono mt-0.5">{sublabel}</div>
        )}
      </div>
      <div
        className={cn(
          'h-6 w-11 rounded-full p-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <div
          className={cn(
            'h-5 w-5 rounded-full bg-background transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </div>
    </button>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn('text-muted-foreground', bold && 'text-foreground font-semibold')}>
        {label}
      </span>
      <span className={cn('font-mono', bold && 'text-lg font-semibold')}>{value}</span>
    </div>
  );
}

function MoreTldsToggle({
  show,
  onToggle,
  disabled,
}: {
  show: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-primary/10 hover:text-foreground"
    >
      <Plus className="h-3 w-3" />
      {show ? 'Hide' : 'More TLDs'}
    </button>
  );
}

function MoreTldsGrid({
  tld,
  setTld,
  disabled,
}: {
  tld: SupportedTld;
  setTld: (v: SupportedTld) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {MORE_TLDS.map((item) => {
        const active = item === tld;
        return (
          <button
            key={item}
            type="button"
            onClick={() => setTld(item)}
            disabled={disabled}
            className={cn(
              'rounded-lg border px-3 py-1.5 font-mono text-sm transition',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border/50 bg-card/80 text-muted-foreground hover:border-primary/60 hover:bg-primary/10 hover:text-foreground',
            )}
          >
            .{item}
          </button>
        );
      })}
    </div>
  );
}
