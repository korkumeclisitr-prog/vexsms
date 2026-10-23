import "server-only";

/**
 * VexSMS Pricing Engine
 * -----------------------------------------------------------------------------
 * 5sim maliyetini (RUB) platform para birimine (USD) ve kuruşa (cents) çevirir.
 * Kar marjı ve minimum sipariş taban fiyatı sunucuda uygulanır.
 */

const DEFAULT_RUB_TO_USD_RATE = 0.012; // 1 RUB ~ 0.012 USD
const DEFAULT_PROFIT_MARGIN = 1.35;    // %35 kar marjı
const DEFAULT_MIN_PRICE_CENTS = 50;    // Minimum $0.50

export interface PriceCalculation {
  quotedCost: number;
  retailPriceCents: number;
  currency: string;
}

export function calculateRetailPriceCents(costInProviderCurrency: number): PriceCalculation {
  const rubToUsd = Number(process.env.PROVIDER_CURRENCY_TO_USD_RATE) || DEFAULT_RUB_TO_USD_RATE;
  const margin = Number(process.env.PROFIT_MARGIN_MULTIPLIER) || DEFAULT_PROFIT_MARGIN;
  const minCents = Number(process.env.MIN_PRICE_CENTS) || DEFAULT_MIN_PRICE_CENTS;

  const costInUsd = costInProviderCurrency * rubToUsd;
  const retailInUsd = costInUsd * margin;
  const rawCents = Math.round(retailInUsd * 100);

  const retailPriceCents = Math.max(minCents, rawCents);

  return {
    quotedCost: costInProviderCurrency,
    retailPriceCents,
    currency: "USD",
  };
}
