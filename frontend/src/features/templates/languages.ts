/**
 * Meta's supported template languages.
 *
 * These are Meta's codes, not ours: a template is created *in* a language, and
 * the same name may exist once per code. The list follows WhatsApp's published
 * table; a code Meta adds later still works, because the API only shape-checks
 * the string and this table is used for display and selection.
 */

export interface TemplateLanguage {
  code: string;
  label: string;
}

const ROWS: [string, string][] = [
  ["af", "Afrikaans"],
  ["sq", "Albanian"],
  ["ar", "Arabic"],
  ["ar_EG", "Arabic (Egypt)"],
  ["ar_AE", "Arabic (United Arab Emirates)"],
  ["ar_LB", "Arabic (Lebanon)"],
  ["ar_MA", "Arabic (Morocco)"],
  ["ar_QA", "Arabic (Qatar)"],
  ["az", "Azerbaijani"],
  ["be_BY", "Belarusian"],
  ["bn", "Bengali"],
  ["bn_IN", "Bengali (India)"],
  ["bg", "Bulgarian"],
  ["ca", "Catalan"],
  ["zh_CN", "Chinese (Simplified, China)"],
  ["zh_HK", "Chinese (Traditional, Hong Kong)"],
  ["zh_TW", "Chinese (Traditional, Taiwan)"],
  ["hr", "Croatian"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["prs_AF", "Dari (Afghanistan)"],
  ["nl", "Dutch"],
  ["nl_BE", "Dutch (Belgium)"],
  ["en", "English"],
  ["en_GB", "English (United Kingdom)"],
  ["en_US", "English (United States)"],
  ["en_AE", "English (United Arab Emirates)"],
  ["en_AU", "English (Australia)"],
  ["en_CA", "English (Canada)"],
  ["en_GH", "English (Ghana)"],
  ["en_IE", "English (Ireland)"],
  ["en_IN", "English (India)"],
  ["en_JM", "English (Jamaica)"],
  ["en_MY", "English (Malaysia)"],
  ["en_NZ", "English (New Zealand)"],
  ["en_QA", "English (Qatar)"],
  ["en_SG", "English (Singapore)"],
  ["en_UG", "English (Uganda)"],
  ["en_ZA", "English (South Africa)"],
  ["et", "Estonian"],
  ["fil", "Filipino"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["fr_BE", "French (Belgium)"],
  ["fr_CA", "French (Canada)"],
  ["fr_CH", "French (Switzerland)"],
  ["fr_CI", "French (Côte d'Ivoire)"],
  ["fr_MA", "French (Morocco)"],
  ["ka", "Georgian"],
  ["de", "German"],
  ["de_AT", "German (Austria)"],
  ["de_CH", "German (Switzerland)"],
  ["el", "Greek"],
  ["gu", "Gujarati"],
  ["ha", "Hausa"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["hu", "Hungarian"],
  ["id", "Indonesian"],
  ["ga", "Irish"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["kn", "Kannada"],
  ["kk", "Kazakh"],
  ["rw_RW", "Kinyarwanda"],
  ["ko", "Korean"],
  ["ky_KG", "Kyrgyz"],
  ["lo", "Lao"],
  ["lv", "Latvian"],
  ["lt", "Lithuanian"],
  ["mk", "Macedonian"],
  ["ms", "Malay"],
  ["ml", "Malayalam"],
  ["mr", "Marathi"],
  ["nb", "Norwegian"],
  ["ps_AF", "Pashto (Afghanistan)"],
  ["fa", "Persian"],
  ["pl", "Polish"],
  ["pt_BR", "Portuguese (Brazil)"],
  ["pt_PT", "Portuguese (Portugal)"],
  ["pa", "Punjabi"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["sr", "Serbian"],
  ["si_LK", "Sinhala (Sri Lanka)"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["es", "Spanish"],
  ["es_AR", "Spanish (Argentina)"],
  ["es_CL", "Spanish (Chile)"],
  ["es_CO", "Spanish (Colombia)"],
  ["es_CR", "Spanish (Costa Rica)"],
  ["es_DO", "Spanish (Dominican Republic)"],
  ["es_EC", "Spanish (Ecuador)"],
  ["es_HN", "Spanish (Honduras)"],
  ["es_MX", "Spanish (Mexico)"],
  ["es_PA", "Spanish (Panama)"],
  ["es_PE", "Spanish (Peru)"],
  ["es_ES", "Spanish (Spain)"],
  ["es_UY", "Spanish (Uruguay)"],
  ["sw", "Swahili"],
  ["sv", "Swedish"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["uz", "Uzbek"],
  ["vi", "Vietnamese"],
  ["zu", "Zulu"],
];

export const TEMPLATE_LANGUAGES: TemplateLanguage[] = ROWS.map(([code, label]) => ({
  code,
  label,
}));

const BY_CODE = new Map(TEMPLATE_LANGUAGES.map((language) => [language.code, language]));

/**
 * `en_US` → `English (United States)`. A code this build has not seen is shown
 * as itself rather than hidden, because a template in it really exists.
 */
export function languageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code;
}
