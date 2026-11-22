/**
 * Money, labelled with the currency it is actually in.
 *
 * The rule this file exists to enforce: never invent a currency. Meta reports
 * an amount in the WhatsApp Business Account's billing currency, and that
 * currency is a fact about the account rather than a display preference. An
 * app that prints "$" over a rupee figure is wrong in a way that survives
 * every test that only checks the number.
 *
 * So when the currency is unknown the digits are shown bare — grouped and
 * rounded, with no symbol at all — and the screen says why. A dash is kept for
 * an amount that does not exist, because `0` would read as "this was free".
 */

/** Money for display: a dash when absent, bare digits when the currency is not known. */
export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  // Charges are often fractions of a unit (a few paise, a fraction of a cent),
  // so a sub-unit amount needs more decimals than a monthly total does.
  const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;

  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: digits,
      }).format(value);
    } catch {
      // An unknown or malformed code: the digits are still true, the symbol is
      // not worth guessing.
      return `${currency} ${groupDigits(value, digits)}`;
    }
  }

  return groupDigits(value, digits);
}

/** `INR`, `USD`, or null — used for the "billed in" line, never for a symbol. */
export function currencyLabel(currency: string | null | undefined): string | null {
  const code = currency?.trim().toUpperCase();

  return code ? code : null;
}

function groupDigits(value: number, digits: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
