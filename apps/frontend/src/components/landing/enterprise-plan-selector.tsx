'use client';

import { useState } from 'react';

type EnterprisePlanOption = {
  sku: string;
  monthlyEmails: number;
  yearlyPriceUsdc: number;
};

export function EnterprisePlanSelector({ offers }: { offers: EnterprisePlanOption[] }) {
  const [selectedSku, setSelectedSku] = useState(offers[0].sku);
  const enterprise = offers.find((offer) => offer.sku === selectedSku) ?? offers[0];

  return (
    <div data-enterprise-plan-selector className="contents">
      <label className="mt-3 text-xs font-medium text-muted-foreground" htmlFor="enterprise-tier">
        Monthly volume
      </label>
      <select
        id="enterprise-tier"
        value={selectedSku}
        onChange={(event) => setSelectedSku(event.target.value)}
        className="mt-1 h-10 rounded-md border border-border bg-background px-3 text-sm"
      >
        {offers.map((offer) => (
          <option key={offer.sku} value={offer.sku}>
            {offer.monthlyEmails.toLocaleString('en-US')} emails/month
          </option>
        ))}
      </select>
      <div className="mt-3 font-mono text-xl font-bold" aria-live="polite">
        ${enterprise.yearlyPriceUsdc.toLocaleString('en-US')}/year
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        ${(enterprise.yearlyPriceUsdc / 12).toLocaleString('en-US', { maximumFractionDigits: 2 })}
        /month equivalent
      </div>
    </div>
  );
}
