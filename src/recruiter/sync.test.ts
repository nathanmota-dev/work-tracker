/**
 * Covers pure helper functions and sync orchestration with scripted database
 * responses and a stubbed MCP detector.
 *
 * All names, usernames, and companies below are synthetic fixtures.
 */
import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  normalizeName,
  usernameFromRef,
  matchAccepted,
  parsePeopleResult,
  applySync,
  type RecruiterRow,
  type DetectedPerson,
} from "./sync.ts";

describe("normalizeName", () => {
  test("lowercases + strips diacritics", () =>
    expect(normalizeName("Renée Würst")).toBe("renee wurst"));
  test("collapses whitespace + drops punctuation", () =>
    expect(normalizeName("  Alex   Sample!! ")).toBe("alex sample"));
  test("empty stays empty", () => expect(normalizeName("   ")).toBe(""));
});

describe("usernameFromRef", () => {
  test("extracts slug from /in/ path", () =>
    expect(usernameFromRef("/in/recruiter-one-000001/")).toBe(
      "recruiter-one-000001",
    ));
  test("extracts from full URL", () =>
    expect(usernameFromRef("https://www.linkedin.com/in/recruiter-two/")).toBe(
      "recruiter-two",
    ));
  test("decodes percent-encoding", () =>
    expect(usernameFromRef("re%C3%A9-recruiter-003")).toBe(
      "reé-recruiter-003",
    ));
  test("lowercases bare slug", () =>
    expect(usernameFromRef("Recruiter-Four")).toBe("recruiter-four"));
  test("null/empty → null", () => {
    expect(usernameFromRef(null)).toBeNull();
    expect(usernameFromRef("")).toBeNull();
    expect(usernameFromRef(undefined)).toBeNull();
  });
});

function rec(
  partial: Partial<RecruiterRow> & { id: number; name: string },
): RecruiterRow {
  return {
    username: null,
    company: "Acme Corp",
    degree: "2nd",
    status: "pending",
    ...partial,
  };
}

describe("matchAccepted", () => {
  test("matches by username (exact, normalized)", () => {
    const pending = [
      rec({ id: 1, name: "Recruiter One", username: "recruiter-one-000001" }),
    ];
    const detected: DetectedPerson[] = [
      { username: "/in/recruiter-one-000001/", name: "Recruiter One" },
    ];
    const changes = matchAccepted(pending, detected);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: 1,
      to: "accepted",
      matchedBy: "username",
    });
  });

  test("matches by name when username missing", () => {
    const pending = [
      rec({
        id: 2,
        name: "Recruiter Two",
        username: null,
        company: "Beta Inc",
      }),
    ];
    const detected: DetectedPerson[] = [
      { username: "/in/recruiter-two/", name: "Recruiter Two" },
    ];
    const changes = matchAccepted(pending, detected);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: 2, matchedBy: "name" });
  });

  test("username match wins over name fallback (reports username)", () => {
    const pending = [
      rec({ id: 3, name: "Sample Person", username: "sample-person-123" }),
    ];
    const detected: DetectedPerson[] = [
      { username: "/in/sample-person-123/", name: "Totally Different" },
    ];
    const changes = matchAccepted(pending, detected);
    expect(changes[0].matchedBy).toBe("username");
  });

  test("no match → no change", () => {
    const pending = [
      rec({ id: 4, name: "Recruiter Four", username: "recruiter-four-000004" }),
    ];
    const detected: DetectedPerson[] = [
      { username: "/in/someone-else/", name: "Someone Else" },
    ];
    expect(matchAccepted(pending, detected)).toHaveLength(0);
  });

  test("ignores non-pending recruiters", () => {
    const pending = [
      rec({
        id: 5,
        name: "Already Accepted",
        username: "x",
        status: "accepted",
      }),
      rec({
        id: 6,
        name: "Interviewing One",
        username: "y",
        status: "interviewing",
      }),
    ];
    const detected: DetectedPerson[] = [
      { username: "/in/x/", name: "Already Accepted" },
      { username: "/in/y/", name: "Interviewing One" },
    ];
    expect(matchAccepted(pending, detected)).toHaveLength(0);
  });

  test("diacritic-insensitive name match", () => {
    const pending = [rec({ id: 7, name: "Renée Würst", username: null })];
    const detected: DetectedPerson[] = [
      { username: "/in/rw/", name: "Renee Wurst" },
    ];
    expect(matchAccepted(pending, detected)).toHaveLength(1);
  });
});

describe("parsePeopleResult", () => {
  test("extracts people from references.search_results", () => {
    const result = {
      references: {
        search_results: [
          {
            kind: "person",
            url: "/in/recruiter-one-000001/",
            text: "Recruiter One",
          },
          { kind: "person", url: "/in/recruiter-two/", text: "Recruiter Two" },
        ],
      },
    };
    const people = parsePeopleResult(result);
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({
      username: "recruiter-one-000001",
      name: "Recruiter One",
    });
  });

  test("dedupes repeated slugs", () => {
    const result = {
      references: {
        search_results: [
          { url: "/in/dup/", text: "Dup One" },
          { url: "/in/dup/", text: "Dup One" },
        ],
      },
    };
    expect(parsePeopleResult(result)).toHaveLength(1);
  });

  test("empty / malformed → []", () => {
    expect(parsePeopleResult({})).toEqual([]);
    expect(parsePeopleResult(null)).toEqual([]);
    expect(parsePeopleResult({ references: {} })).toEqual([]);
  });
});

import { db } from "../db/index.ts";
import { callTool } from "../mcp/linkedin.ts";
import { detectAccepted, runSync } from "./sync.ts";
import { databaseDouble } from "../test/doubles.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: vi.fn() }));
vi.mock("../mcp/linkedin.ts", () => ({ callTool: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
});
test("orchestration groups companies, counts unassigned recruiters, tolerates detector errors and performs no dry-run writes", async () => {
  d.statement.all.mockReturnValue([
    rec({ id: 1, name: "One", username: "one" }),
    rec({ id: 2, name: "Two", username: "two" }),
    rec({ id: 3, name: "Broken", company: "Broken" }),
    rec({ id: 4, name: "No Company", company: null }),
  ]);
  const detect = vi.fn(async (company: string) => {
    if (company === "Broken") throw new Error("offline");
    return [{ username: "one", name: "One" }];
  });
  const result = await runSync({ apply: false, detect });
  expect(result).toEqual({
    scanned: 4,
    companiesQueried: 2,
    applied: false,
    skipped: ["Broken"],
    changes: [
      {
        id: 1,
        name: "One",
        company: "Acme Corp",
        from: "pending",
        to: "accepted",
        matchedBy: "username",
      },
    ],
  });
  expect(detect.mock.calls).toEqual([["Acme Corp"], ["Broken"]]);
  expect(d.transaction).not.toHaveBeenCalled();
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(applySync(result, d.asDatabase)).toEqual({ ...result, applied: true });
  expect(d.transaction).toHaveBeenCalledOnce();
  expect(d.statement.run).toHaveBeenCalledExactlyOnceWith({ $id: 1 });
  expect(d.query).toHaveBeenLastCalledWith(
    expect.stringContaining("WHERE id = $id AND status = 'pending'"),
  );
});
test("empty apply skips a transaction; detection uses first-degree search and surfaces errors", async () => {
  const result = await runSync({ apply: true });
  expect(result).toEqual({
    scanned: 0,
    companiesQueried: 0,
    changes: [],
    applied: true,
    skipped: [],
  });
  expect(d.transaction).not.toHaveBeenCalled();
  vi.mocked(callTool).mockResolvedValue({
    references: { search_results: [{ url: "/in/one", text: "One" }] },
  });
  expect(await detectAccepted("Acme")).toEqual([
    { username: "one", name: "One" },
  ]);
  expect(callTool).toHaveBeenCalledWith("search_people", {
    keywords: "Acme recruiter",
    network: ["F"],
  });
  vi.mocked(callTool).mockRejectedValue(new Error("offline"));
  await expect(detectAccepted("Acme")).rejects.toThrow("offline");
});
test("malformed encoding and blank references are handled", () => {
  expect(usernameFromRef("bad%ZZ")).toBe("bad%zz");
  expect(usernameFromRef(" / ")).toBeNull();
  expect(parsePeopleResult(null)).toEqual([]);
});
