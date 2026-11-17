/**
 * The rule the sign-up card advertises: 8 characters, upper and lower case, a
 * number and a symbol. Supabase enforces whatever the project is configured
 * with; this runs first so the customer gets one clear sentence instead of a
 * provider error after a round-trip.
 *
 * Returns the first unmet requirement, or `null` when the password passes.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Add an uppercase letter.";
  if (!/\d/.test(password)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Add a symbol, such as ! or #.";
  return null;
}

/** 0–4, for the four-bar meter on the password fields. */
export function passwordScore(password: string): number {
  if (!password) return 0;

  const checks = [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];

  return checks.filter(Boolean).length;
}
