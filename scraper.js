// scraper.js
// Scrapes real local Egyptian Sagha gold/silver prices from iSagha (market.isagha.com/prices)
// and real currency rates, with a priority chain: National Bank of Egypt (via egrates.com,
// a bank-rate aggregator) > iSagha's own currency table > Frankfurter (blended, reliable fallback).
//
// Design notes:
// - CBE's own official site actively blocks automated requests behind a WAF — confirmed
//   directly, multiple times, against multiple URL variants (Arabic and English paths).
//   It is not usable as a scrape target.
// - NBE's own site (nbe.com.eg) is a JavaScript single-page app — the actual rate data
//   loads dynamically after page load, not present in the static HTML, so a simple
//   HTTP-fetch-and-parse scraper can't see it without a full headless browser.
// - egrates.com is a dedicated Egyptian bank-rate aggregator. Confirmed directly (fetched
//   the live page) that it shows real NBE buy/sell rates, updated within minutes, for
//   every currency this site needs, in a plain HTML table — no JS rendering required.
//   This is used as tier 1.
// - iSagha's page doesn't block automated requests (confirmed by direct test) and has its
//   own real local buy/sell for 4 currencies — used as tier 2.
// - Frankfurter (free, no key, well-supported) is tier 3, the final reliable fallback.
// - Parsing is anchored to row labels/img-alt text rather than CSS classes, since those
//   are far more likely to change than the labels themselves.

const axios = require('axios');
const cheerio = require('cheerio');

const ISAGHA_URL = 'https://market.isagha.com/prices/eg'; // Egypt-specific — pinned so results don't vary by scraper server location
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v2/rates';
const NBE_URL = 'https://egrates.com/en/banks/4'; // National Bank of Egypt rates, via egrates.com

const CURRENCY_CODES = ['USD', 'GBP', 'EUR', 'SAR', 'AED', 'JOD', 'KWD', 'CAD', 'BHD', 'QAR', 'AUD', 'LYD', 'TRY', 'CHF'];

// iSagha's currency table only covers these 4 (confirmed on the live page), but what it
// does cover is real local buy/sell — more useful than a single blended rate.
const ISAGHA_CURRENCY_ROW_MAP = {
  'دولار أمريكي': 'USD', 'الدولار الأمريكي': 'USD',
  'ريال سعودي': 'SAR', 'الريال السعودي': 'SAR',
  'دينار كويتي': 'KWD', 'الدينار الكويتي': 'KWD',
  'درهم إماراتي': 'AED', 'الدرهم الإماراتي': 'AED',
};

// Row label -> output key, for the gold table
const GOLD_ROW_MAP = {
  'عيار 24': 'k24',
  'عيار 22': 'k22',
  'عيار 21': 'k21',
  'عيار 18': 'k18',
  'جنيه ذهب': 'goldPound',
};

// Row label -> output key, for the silver table
const SILVER_ROW_MAP = {
  'عيار 999': 's999',
  'عيار 925': 's925',
  'عيار 900': 's900',
  'عيار 800': 's800',
  'عيار 600': 's600',
  'الجنيه الفضة': 'silverPound',
};

function parseEgpNumber(text) {
  if (!text) return null;
  // Strip "ج.م", commas, extra whitespace, keep the numeric value (and minus sign)
  const cleaned = text.replace(/ج\.م/g, '').replace(/,/g, '').trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Scrapes iSagha's live prices page for local Egyptian gold and silver rates.
 * Returns { gold: {...}, silver: {...}, scrapedAt: ISOString } or throws on failure.
 */
async function scrapeISagha() {
  const res = await axios.get(ISAGHA_URL, {
    timeout: 15000,
    headers: {
      // A normal browser User-Agent avoids being treated as an obviously non-browser client.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ar,en;q=0.8',
    },
  });

  const $ = cheerio.load(res.data);
  const gold = {};
  const silver = {};
  const isaghaCurrencies = {};

  // Walk every table row on the page; for each row, check if its first cell's text
  // matches one of our known Arabic labels. This survives table/column reordering
  // and class-name changes, as long as the label text itself is unchanged.
  //
  // Column layouts differ between table types (confirmed against the real live page):
  // - Gold/silver rows: label, sell, gap%, buy, gap%, change, pct  → 7 cells, buy at index 3
  // - Currency rows:    label, sell, buy, change, pct              → 5 cells, buy at index 2
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return; // header rows / malformed rows

    const label = $(cells[0]).text().trim();
    const sellText = $(cells[1]).text().trim();

    // Only take the FIRST occurrence of each label. If the page has more than one table
    // using the same row labels (e.g. a historical/comparison section further down), later
    // matches are ignored — this guards against silently overwriting the correct current
    // price with a stale or unrelated one from elsewhere on the page.
    if (GOLD_ROW_MAP[label] && !gold[GOLD_ROW_MAP[label]]) {
      const buyText = $(cells[3]).text().trim();
      gold[GOLD_ROW_MAP[label]] = { sell: parseEgpNumber(sellText), buy: parseEgpNumber(buyText) };
    } else if (SILVER_ROW_MAP[label] && !silver[SILVER_ROW_MAP[label]]) {
      const buyText = $(cells[3]).text().trim();
      silver[SILVER_ROW_MAP[label]] = { sell: parseEgpNumber(sellText), buy: parseEgpNumber(buyText) };
    } else if (ISAGHA_CURRENCY_ROW_MAP[label] && !isaghaCurrencies[ISAGHA_CURRENCY_ROW_MAP[label]]) {
      const buyText = $(cells[2]).text().trim();
      isaghaCurrencies[ISAGHA_CURRENCY_ROW_MAP[label]] = { sell: parseEgpNumber(sellText), buy: parseEgpNumber(buyText) };
    }
  });

  // Sanity check: if we didn't find 24K gold, something about the page changed — treat as failure
  // rather than silently caching nonsense/empty data.
  if (!gold.k24 || !gold.k24.sell) {
    throw new Error('Could not locate 24K gold row on iSagha page — page structure may have changed');
  }

  return { gold, silver, isaghaCurrencies, scrapedAt: new Date().toISOString() };
}

/**
 * Scrapes real National Bank of Egypt buy/sell rates via egrates.com, a dedicated
 * Egyptian bank-rate aggregator. Confirmed by direct test: this page is plain server-
 * rendered HTML (not a JS app like NBE's own site), shows real rates for every currency
 * this project needs, and is not blocked (unlike CBE's own site).
 * Anchored to each row's <img alt="Currency Name/CODE"> attribute rather than visible
 * text or CSS classes — the alt text reliably contains the ISO code (e.g. "US Dollar/USD"),
 * which is far less likely to change than styling or exact currency-name wording.
 */
async function scrapeNBE() {
  const res = await axios.get(NBE_URL, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en,ar;q=0.8',
    },
  });

  const $ = cheerio.load(res.data);
  const rates = {};

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return; // bank, currency, buy, sell, updated = 5 cells minimum

    // Find the currency code from the row's image alt text (format: "Currency Name/CODE")
    let code = null;
    $(row).find('img').each((__, img) => {
      const alt = $(img).attr('alt') || '';
      const match = alt.match(/\/([A-Z]{3})\b/);
      if (match && CURRENCY_CODES.includes(match[1])) code = match[1];
    });
    if (!code) return;

    const buyText = $(cells[2]).text().trim();
    const sellText = $(cells[3]).text().trim();
    const buy = parseEgpNumber(buyText);
    const sell = parseEgpNumber(sellText);
    if (buy && sell) rates[code] = { buy, sell };
  });

  if (!rates.USD) throw new Error('Could not locate USD row on NBE/egrates page — page structure may have changed');

  return { rates, scrapedAt: new Date().toISOString() };
}

/**
 * Fetches currency rates (EGP per 1 unit of each currency) from Frankfurter.
 * Used as the final fallback tier — reliable, but only a single blended rate
 * (no separate buy/sell), so buy and sell are set equal when this tier is used.
 */
async function fetchCurrencies() {
  const url = `${FRANKFURTER_URL}?base=EGP&quotes=${CURRENCY_CODES.join(',')}`;
  const res = await axios.get(url, { timeout: 15000 });
  const data = res.data;

  if (!Array.isArray(data)) throw new Error('Unexpected Frankfurter response shape');

  const rates = {};
  let rateDate = null;
  for (const rec of data) {
    if (rec.rate) {
      rates[rec.quote] = 1 / rec.rate; // invert: EGP per 1 unit of currency
      rateDate = rec.date;
    }
  }
  if (!rates.USD) throw new Error('Frankfurter response missing USD');

  return { rates, rateDate };
}

/**
 * Combines all three currency sources into one result, per-currency, with a clear
 * priority: CBE official buy/sell > iSagha local buy/sell > Frankfurter (buy=sell).
 * Never throws — if everything fails, returns an empty object and lets the caller
 * decide what to do (keep previous cached data).
 */
async function resolveCurrencies() {
  const result = {};
  const sources = {};

  // Tier 3 first (most reliable), so it's the baseline every currency has by default.
  try {
    const { rates } = await fetchCurrencies();
    for (const code of Object.keys(rates)) {
      result[code] = { buy: rates[code], sell: rates[code] };
      sources[code] = 'frankfurter';
    }
  } catch (err) {
    console.error('Frankfurter currency fetch failed:', err.message);
  }

  // Tier 2: overwrite with iSagha's real local buy/sell where available.
  try {
    const { isaghaCurrencies } = await scrapeISagha();
    for (const code of Object.keys(isaghaCurrencies || {})) {
      if (isaghaCurrencies[code].sell) {
        result[code] = isaghaCurrencies[code];
        sources[code] = 'isagha';
      }
    }
  } catch (err) {
    console.error('iSagha currency scrape failed (gold data fetched separately, this only affects currency tier 2):', err.message);
  }

  // Tier 1 (best, and verified against the real live page): overwrite with NBE buy/sell.
  try {
    const { rates } = await scrapeNBE();
    for (const code of Object.keys(rates)) {
      if (rates[code].sell) {
        result[code] = rates[code];
        sources[code] = 'nbe';
      }
    }
  } catch (err) {
    console.error('NBE scrape failed:', err.message);
  }

  return { rates: result, sources };
}

module.exports = {
  scrapeISagha, scrapeNBE, fetchCurrencies, resolveCurrencies,
  parseEgpNumber, GOLD_ROW_MAP, SILVER_ROW_MAP, ISAGHA_CURRENCY_ROW_MAP,
};
