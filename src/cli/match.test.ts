import { beforeEach, expect, test, vi } from "vitest";
import { text } from "node:stream/consumers";
import { matchCmd } from "./match.ts";
import { matchLabels } from "../match/matcher.ts";
import { db } from "../db/index.ts";
import { cliSpies, databaseDouble } from "../test/doubles.ts";
vi.mock("node:stream/consumers", () => ({ text: vi.fn() }));
vi.mock("../match/matcher.ts", () => ({
  matchLabels: vi.fn(() => ({ matched: [], unfilled: [] })),
}));
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
let d: ReturnType<typeof databaseDouble>, output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  output = cliSpies();
});
test("inline labels exclude missing answers and convert percentage threshold", async () => {
  d.statement.all.mockReturnValue([
    { key: "email", value: "candidate@example.invalid" },
    { key: "phone", value: null },
    { key: "website", value: "" },
  ]);
  await matchCmd({ labels: '["Email","Website"]', "threshold-pct": "75" });
  expect(matchLabels).toHaveBeenCalledWith(["Email", "Website"], {
    answers: { email: "candidate@example.invalid" },
    threshold: 0.75,
  });
  expect(text).not.toHaveBeenCalled();
  expect(JSON.parse(String(output.log.mock.calls[0][0]))).toEqual({
    matched: [],
    unfilled: [],
    resolutions: expect.any(Object),
  });
});
test("piped labels use default threshold", async () => {
  vi.spyOn(process, "stdin", "get").mockReturnValue({
    isTTY: false,
  } as typeof process.stdin);
  vi.mocked(text).mockResolvedValue(' ["Email"] \n');
  await matchCmd({});
  expect(text).toHaveBeenCalledWith(process.stdin);
  expect(matchLabels).toHaveBeenCalledWith(["Email"], {
    answers: {},
    threshold: undefined,
  });
});
test.each(["not json", "{}", '["Email",3]'])(
  "invalid labels %s do not query stored answers",
  async (labels) => {
    await expect(matchCmd({ labels })).rejects.toThrow("exit:1");
    expect(d.query).not.toHaveBeenCalled();
  },
);

test("terminal without labels reports usage before querying answers", async () => {
  vi.spyOn(process, "stdin", "get").mockReturnValue({
    isTTY: true,
  } as typeof process.stdin);
  await expect(matchCmd({})).rejects.toThrow("exit:1");
  expect(d.query).not.toHaveBeenCalled();
});

test("requested languages require an explicit fallback and report provenance without duplicating values", async () => {
  d.statement.all.mockReturnValue([
    { key: "notice_period", value: "Two weeks", language: "default" },
    { key: "notice_period", value: "Duas semanas", language: "pt-BR" },
  ]);
  await matchCmd({ labels: '["Notice period"]', language: "en" });
  expect(matchLabels).toHaveBeenLastCalledWith(["Notice period"], { answers: {}, threshold: undefined });
  await matchCmd({ labels: '["Notice period"]', language: "en", "fallback-language": "pt-br" });
  expect(matchLabels).toHaveBeenLastCalledWith(["Notice period"], { answers: { notice_period: "Duas semanas" }, threshold: undefined });
  expect(JSON.parse(String(output.log.mock.calls.at(-1)![0])).resolutions.notice_period).toEqual({ status: "ready", language: "pt-BR", fallback: true });
});

test("invalid legacy values reach matcher validation and are never silently replaced by fallback", async () => {
  d.statement.all.mockReturnValue([
    { key: "email", value: "invalid", language: "en" },
    { key: "email", value: "fixture@example.test", language: "default" },
  ]);
  await matchCmd({ labels: '["Email"]', language: "en", "fallback-language": "default" });
  expect(matchLabels).toHaveBeenLastCalledWith(["Email"], { answers: { email: "invalid" }, threshold: undefined });
  expect(JSON.parse(String(output.log.mock.calls.at(-1)![0])).resolutions.email).toEqual({ status: "invalid", language: "en", fallback: false });
});
