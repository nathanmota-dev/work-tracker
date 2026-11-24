import { expect, test } from "vitest";
import { EMPTY_CONTACT, parseContact, profileUrl, webAddress } from "./contact.ts";

test("reads the labeled entries of an English export, joining a URL that wraps before its label", () => {
  expect(parseContact(["alex@example.com", "+351 912 345 678 (Mobile)", "www.linkedin.com/in/alex-", "example-123 (LinkedIn)", "github.com/alex-example", "(Portfolio)", "alex.dev/ (Personal)"])).toEqual({
    email: "alex@example.com", phone: "+351 912 345 678", linkedin: "https://www.linkedin.com/in/alex-example-123/", github: "https://github.com/alex-example", website: "https://alex.dev",
  });
});

test("reads a Portuguese export and unlabeled lines, keeping the first value of each field", () => {
  expect(parseContact(["(16) 99993-6596 (Celular)", "linkedin.com/in/alex-ex", "second@example.com", "alex@example.com", "exemplo.com.br (Pessoal)"])).toEqual({
    ...EMPTY_CONTACT, phone: "(16) 99993-6596", linkedin: "https://www.linkedin.com/in/alex-ex/", email: "second@example.com", website: "https://exemplo.com.br",
  });
  expect(parseContact(["www.example.org", "+1 555 010 0199"])).toEqual({ ...EMPTY_CONTACT, website: "https://www.example.org", phone: "+1 555 010 0199" });
});

test("an absent section or unreadable entries leave every field empty", () => {
  expect(parseContact([])).toEqual(EMPTY_CONTACT);
  expect(parseContact(["Not a link (Other)", "abc (Mobile)", ""])).toEqual(EMPTY_CONTACT);
});

test("normalizes web and profile addresses", () => {
  expect(webAddress("https://site.example/")).toBe("https://site.example");
  expect(webAddress("#")).toBe("");
  expect(profileUrl("see linkedin.com/in/alex?x=1", "linkedin")).toBe("https://www.linkedin.com/in/alex/");
  expect(profileUrl("https://github.com/alex/repo", "github")).toBe("https://github.com/alex");
  expect(profileUrl("https://gitlab.com/alex", "github")).toBe("");
});
