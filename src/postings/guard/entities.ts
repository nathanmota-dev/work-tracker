/**
 * Character references decoded the way Python's `html.unescape` (and a browser)
 * decodes them, so `display&#58;none` or `ig&ZeroWidthSpace;nore` is read as
 * the text a reader would see. Named references cover the legacy Latin-1 set,
 * ASCII punctuation, typography, invisible characters and the Greek and
 * Cyrillic letters a look-alike spoof would use; any other name stays literal.
 */
const LATIN1 = ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 "
  + "acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring "
  + "AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times "
  + "Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave "
  + "eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave "
  + "uacute ucirc uuml yacute thorn yuml").split(" ");
const CYRILLIC = "a b v g d ie zh z i j k l m n o p r s t u f kh ts ch sh shch hard y soft e yu ya".split(" ");
const GREEK = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega".split(" ");
const capital = (name: string) => name[0]!.toUpperCase() + name.slice(1);

const LEGACY: Record<string, string> = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: "\"", QUOT: "\"", COPY: "\u00a9", REG: "\u00ae",
  ...Object.fromEntries(LATIN1.map((name, index) => [name, String.fromCodePoint(0xa0 + index)])),
};
const NAMED: Record<string, string> = {
  ...LEGACY,
  Tab: "\t", NewLine: "\n", excl: "!", num: "#", dollar: "$", percnt: "%", apos: "'", lpar: "(", rpar: ")",
  ast: "*", midast: "*", plus: "+", comma: ",", period: ".", sol: "/", colon: ":", semi: ";", equals: "=",
  quest: "?", commat: "@", lsqb: "[", lbrack: "[", bsol: "\\", rsqb: "]", rbrack: "]", Hat: "^", lowbar: "_",
  UnderBar: "_", grave: "`", DiacriticalGrave: "`", lcub: "{", lbrace: "{", verbar: "|", vert: "|",
  VerticalLine: "|", rcub: "}", rbrace: "}", NonBreakingSpace: "\u00a0",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", hairsp: "\u200a", ThinSpace: "\u2009",
  ZeroWidthSpace: "\u200b", NegativeVeryThinSpace: "\u200b", NegativeThinSpace: "\u200b",
  NegativeMediumSpace: "\u200b", NegativeThickSpace: "\u200b", zwnj: "\u200c", zwj: "\u200d", lrm: "\u200e",
  rlm: "\u200f", NoBreak: "\u2060", af: "\u2061", ApplyFunction: "\u2061", it: "\u2062", InvisibleTimes: "\u2062",
  ic: "\u2063", InvisibleComma: "\u2063", hyphen: "\u2010", dash: "\u2010", ndash: "\u2013", mdash: "\u2014",
  lsquo: "\u2018", rsquo: "\u2019", rsquor: "\u2019", sbquo: "\u201a", ldquo: "\u201c", rdquo: "\u201d",
  rdquor: "\u201d", bdquo: "\u201e", dagger: "\u2020", Dagger: "\u2021", bull: "\u2022", bullet: "\u2022",
  hellip: "\u2026", mldr: "\u2026", permil: "\u2030", prime: "\u2032", Prime: "\u2033", lsaquo: "\u2039",
  rsaquo: "\u203a", oline: "\u203e", frasl: "\u2044", euro: "\u20ac", trade: "\u2122", TRADE: "\u2122",
  minus: "\u2212", iocy: "\u0451", IOcy: "\u0401",
  ...Object.fromEntries(CYRILLIC.flatMap((name, index) => [
    [`${name}cy`, String.fromCodePoint(0x430 + index)],
    [`${name.length > 1 ? name.toUpperCase() : capital(name)}cy`, String.fromCodePoint(0x410 + index)],
  ])),
  ...Object.fromEntries(GREEK.map((name, index) => [name, String.fromCodePoint(0x3b1 + index)])),
  ...Object.fromEntries(GREEK.filter(name => name !== "sigmaf")
    .map((name, index) => [capital(name), String.fromCodePoint(0x391 + index + (index >= 17 ? 1 : 0))])),
};
/** Numeric references in the C1 range mean windows-1252, as browsers read them. */
const WINDOWS_1252: Record<number, string> = {
  0x00: "\ufffd", 0x0d: "\r", 0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e", 0x85: "\u2026",
  0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6", 0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152",
  0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c", 0x94: "\u201d", 0x95: "\u2022", 0x96: "\u2013",
  0x97: "\u2014", 0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a", 0x9c: "\u0153", 0x9e: "\u017e",
  0x9f: "\u0178", 0x81: "\x81", 0x8d: "\x8d", 0x8f: "\x8f", 0x90: "\x90", 0x9d: "\x9d",
};
const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g;

function dropped(code: number): boolean {
  return (code >= 0x1 && code <= 0x8) || code === 0xb || (code >= 0xe && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)
    || (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xfffe) === 0xfffe;
}

function numeric(reference: string): string {
  const digits = reference.replace(/;$/, "");
  const code = /^#[xX]/.test(digits) ? parseInt(digits.slice(2), 16) : parseInt(digits.slice(1), 10);
  if (code in WINDOWS_1252) return WINDOWS_1252[code]!;
  if ((code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return "\ufffd";
  return dropped(code) ? "" : String.fromCodePoint(code);
}

function named(reference: string): string {
  if (reference.endsWith(";") && Object.hasOwn(NAMED, reference.slice(0, -1))) return NAMED[reference.slice(0, -1)]!;
  if (Object.hasOwn(LEGACY, reference)) return LEGACY[reference]!;
  // The longest legacy name a reference starts with, as the HTML standard reads `&ampfoo`.
  for (let end = reference.length - 1; end > 1; end--) {
    const prefix = reference.slice(0, end);
    if (Object.hasOwn(LEGACY, prefix)) return LEGACY[prefix]! + reference.slice(end);
  }
  return `&${reference}`;
}

/** Decode every character reference in `text`. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(CHARREF, (_match, reference: string) => reference.startsWith("#") ? numeric(reference) : named(reference));
}
