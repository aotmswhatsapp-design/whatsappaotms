/**
 * Sample numbers for the dashboard preview.
 *
 * A newly provisioned workspace has no WhatsApp Business number, so it has no
 * traffic at all. The dashboard shows this dataset behind an explicit
 * "Preview" label instead of zeros or empty charts; every card on the page is
 * replaced by live query results once the WhatsApp module lands.
 *
 * Delete this file together with `previewMode` in the dashboard board.
 */

export const previewMode = true;

export const previewKpis = {
  contacts: { value: "1,248", hint: "312 added this month" },
  conversations: { value: "37", hint: "9 waiting on a reply" },
  delivery: { value: "98.4%", hint: "26 failed of 18,420" },
  optouts: { value: "12", hint: "0.07% of recipients" },
} as const;

export const previewTrend = {
  label: "Messages delivered",
  value: 18420,
  delta: "8.2%",
  note: "vs. previous 30 days",
  caption: "Last 30 days",
  series: [
    { label: "Oct 14", value: 520 },
    { label: "Oct 16", value: 560 },
    { label: "Oct 18", value: 585 },
    { label: "Oct 20", value: 610 },
    { label: "Oct 22", value: 545 },
    { label: "Oct 24", value: 690 },
    { label: "Oct 26", value: 640 },
    { label: "Oct 28", value: 705 },
    { label: "Oct 30", value: 760 },
    { label: "Nov 01", value: 720 },
    { label: "Nov 03", value: 655 },
    { label: "Nov 05", value: 790 },
    { label: "Nov 07", value: 742 },
    { label: "Nov 09", value: 688 },
    { label: "Nov 11", value: 812 },
  ],
};

/** Messages per hour, midnight to 23:00. */
export const previewFlow = {
  total: 1251,
  note: "565 in · 686 out today",
  inbound: [
    2, 1, 1, 1, 1, 2, 6, 14, 26, 38, 46, 44, 36, 30, 28, 32, 40, 48, 52, 44,
    34, 22, 12, 5,
  ],
  outbound: [
    1, 1, 0, 1, 1, 3, 9, 20, 34, 48, 56, 52, 44, 38, 33, 38, 49, 58, 62, 52,
    40, 26, 14, 6,
  ],
  priorInbound: [
    2, 1, 0, 1, 1, 2, 5, 12, 22, 32, 40, 38, 31, 26, 24, 27, 34, 41, 45, 38,
    29, 19, 10, 4,
  ],
  priorOutbound: [
    1, 0, 1, 0, 1, 2, 7, 17, 29, 41, 48, 45, 38, 33, 28, 33, 42, 50, 53, 45,
    34, 22, 12, 5,
  ],
};

export const previewCategories = {
  title: "Templates by category",
  groups: [
    { id: "marketing", name: "Marketing", color: "#ea580c", ink: "light" as const },
    { id: "utility", name: "Utility", color: "#2563eb", ink: "light" as const },
    { id: "auth", name: "Authentication", color: "#84cc16", ink: "dark" as const },
    { id: "support", name: "Support", color: "#f59e0b", ink: "dark" as const },
  ],
  items: [
    { name: "Order shipped", group: "utility", value: 6240 },
    { name: "Login OTP", group: "auth", value: 5410 },
    { name: "Diwali offer", group: "marketing", value: 4820 },
    { name: "Appointment", group: "utility", value: 3980 },
    { name: "Weekend promo", group: "marketing", value: 3140 },
    { name: "Delivery update", group: "support", value: 2860 },
    { name: "Payment receipt", group: "utility", value: 2410 },
    { name: "Return request", group: "support", value: 1240 },
  ],
};

export const previewSeasonality = {
  title: "Messages by month",
  previousLabel: "2025",
  months: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ],
  current: [820, 910, 1240, 1380, 1520, 1680, 1450, 1320, 1490, 2350, 2680, 1820],
  previous: [610, 720, 980, 1040, 1180, 1290, 1150, 1010, 1180, 1890, 2140, 1480],
};
