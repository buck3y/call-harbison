// Personal details out of a visitor's text before any of it leaves this server (only ever toward the configured model).
// Pattern-based, so it removes what looks like a detail; the privacy page words it that way. Markers stay readable
// so the model can still tell what kind of question it is ("my house at [address]").
export const MAX_SENT = 500;

const STREET = 'st|str|street|ave|av|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|cir|circle|way|pl|place|ter|terrace|trl|trail|pkwy|parkway|hwy|highway|loop|row|sq|square|plaza|pike|alley|calle|avenida|camino';
const RULES = [
  // "my name is …", "me llamo …", "mi nombre es …": everything to the end of that sentence.
  [/\b(my name is|my name['’]s|me llamo|mi nombre es)\s+[^.!?\n]*/giu, (m, lead) => `${lead} [name]`],
  // e-mail addresses
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[email]'],
  // card-like numbers (13 to 19 digits, spaces or dashes between) and nine-digit numbers such as a Social Security number
  [/\b(?:\d[ -]?){12,18}\d\b/g, '[number]'],
  [/\b\d{3}[ .-]?\d{2}[ .-]?\d{4}\b/g, '[number]'],
  // phone numbers: (661) 472-7499, 661.472.7499, +1 661 472 7499, 6614727499
  [/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]'],
  // street addresses: a house number, up to four words, a street word ("1234 N Chester Ave", "55 Calle Ocho")
  [new RegExp(`\\b\\d{1,6}[a-z]?\\s+(?:[\\p{L}\\p{N}.'’-]+\\s+){0,4}(?:${STREET})\\b\\.?`, 'giu'), '[address]'],
  [/\b(?:calle|avenida|av\.|camino)\s+(?:[\p{L}.'’-]+\s+){0,3}\d{1,6}\b/giu, '[address]'],
  // parcel numbers and any other long run of digits (seven or more, separators allowed)
  [/\b\d(?:[\s.-]?\d){6,}\b/g, '[number]'],
];

/** The text with personal details replaced by markers, cut at MAX_SENT characters. */
export function redact(text) {
  let out = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
  for (const [re, to] of RULES) out = out.replace(re, to);
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out.length > MAX_SENT ? out.slice(0, MAX_SENT) : out;
}
