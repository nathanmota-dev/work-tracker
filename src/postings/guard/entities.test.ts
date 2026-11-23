import { expect, test } from "vitest";
import { decodeEntities } from "./entities.ts";

test.each([
  ["plain text", "plain text"],
  ["display&#58;none &#x3a; &#X3A", "display:none : :"],
  ["&colon;&semi;&lpar;&rpar;&NewLine;", ":;()\n"],
  ["caf&eacute; &copy; &amp; &lt;b&gt; &quot;q&quot; &apos;", "café © & <b> \"q\" '"],
  ["&ampfoo &copy2026 &amp", "&foo ©2026 &"],
  ["&unknown; &zz", "&unknown; &zz"],
  ["&#150; &#128; &#0; &#13;", "– € � \r"],
  ["&#x110000; &#xD800; &#1; &#xFFFE;", "� �  "],
  ["ig&ZeroWidthSpace;nore &zwj; &shy;", "ig\u200bnore \u200d \u00ad"],
  ["N&ocy;vo &Acy; &IEcy; &SHCHcy; &iocy;", "Nоvo А Е Щ ё"],
  ["&alpha;&omega;&sigmaf; &Alpha;&Rho;&Sigma;&Omega;", "αως ΑΡΣΩ"],
])("decodes %j like a browser", (input, expected) => {
  expect(decodeEntities(input)).toBe(expected);
});
