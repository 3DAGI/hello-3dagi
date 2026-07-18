// ============================================================
// Live price feed — keeps SOL/SKR quotes fresh so the game can
// show real prices and warn when the on-chain rates drift.
//
// Primary source: Jupiter price API v3 (mint-based, prices any SPL
// token incl. SKR). Fallback: CoinGecko for SOL. Cached with a TTL,
// stale values are kept on fetch errors (stale-while-error).
//
// Settlement truth stays ON-CHAIN (config.sol_rate / skr_rate); the
// live feed is for display, drift warnings and the rate keeper
// (scripts/update-rates.mjs) that calls set_rates.
// ============================================================

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// FUEL price peg in USD until FUEL has its own market. The keeper and
// the client derive both exchange rates from this one anchor.
export const FUEL_USD = 0.001;

const JUP_URL = 'https://lite-api.jup.ag/price/v3?ids=';
const CG_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
const TTL_MS = 60_000;

export const prices = {
  solUsd: 0,
  skrUsd: 0,
  ts: 0,        // last successful fetch (ms)
  error: '',
  fetching: false,
};

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Refresh quotes (no-op inside the TTL). skrMint is the base58 mint
// from the on-chain config; pass null before the program is live.
export async function fetchPrices(skrMint) {
  if (prices.fetching || Date.now() - prices.ts < TTL_MS) return prices;
  prices.fetching = true;
  try {
    const ids = [SOL_MINT];
    if (skrMint) ids.push(skrMint);
    try {
      const data = await fetchJson(JUP_URL + ids.join(','));
      const sol = data[SOL_MINT];
      if (sol && sol.usdPrice > 0) prices.solUsd = sol.usdPrice;
      if (skrMint && data[skrMint] && data[skrMint].usdPrice > 0) {
        prices.skrUsd = data[skrMint].usdPrice;
      }
    } catch {
      // Jupiter down — CoinGecko still covers SOL
      const cg = await fetchJson(CG_URL);
      if (cg.solana && cg.solana.usd > 0) prices.solUsd = cg.solana.usd;
    }
    if (prices.solUsd > 0) {
      prices.ts = Date.now();
      prices.error = '';
    } else {
      prices.error = 'NO PRICE DATA';
    }
  } catch (e) {
    prices.error = 'PRICE FEED OFFLINE';
  } finally {
    prices.fetching = false;
  }
  return prices;
}

export function pricesFresh() {
  return prices.ts > 0 && Date.now() - prices.ts < 10 * 60_000;
}

// Exchange rates the chain SHOULD have right now, derived from the
// live quotes and the FUEL peg (same math as the program expects):
// sol_rate = lamports per whole FUEL, skr_rate = SKR units per FUEL.
export function liveRates(skrDecimals = 6) {
  if (!prices.solUsd) return null;
  const solRate = Math.round(FUEL_USD / prices.solUsd * 1e9);
  const skrRate = prices.skrUsd > 0
    ? Math.round(FUEL_USD / prices.skrUsd * 10 ** skrDecimals)
    : 0;
  return { solRate, skrRate };
}

// How far the stored on-chain rates are from the live market, in bps
// of the live value (max of both legs). null = cannot tell.
export function rateDriftBps(cfg) {
  const live = liveRates();
  if (!live || !cfg) return null;
  const drift = (a, b) => (b > 0 ? Math.abs(a - b) * 10_000 / b : 0);
  return Math.max(
    drift(cfg.solRate, live.solRate),
    live.skrRate > 0 ? drift(cfg.skrRate, live.skrRate) : 0
  );
}

// USD value of a FUEL-priced item, from the live SOL quote and the
// on-chain sol_rate (falls back to the peg when rates are unset).
export function fuelToUsd(fuelWhole, cfg) {
  if (cfg && cfg.solRate > 0 && prices.solUsd > 0) {
    return fuelWhole * cfg.solRate / 1e9 * prices.solUsd;
  }
  return fuelWhole * FUEL_USD;
}
