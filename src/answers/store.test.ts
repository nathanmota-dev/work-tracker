import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { db } from "../db/index.ts";
import { deleteAnswer, listAnswerVariants, parseAnswer, saveAnswer } from "./store.ts";
import { handleAnswer } from "./http.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "fixture-time" }));
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => { d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase); });
test.each([null, [], {}, { key: 12 }, { key: "x", value: 1 }, { key: "x", category: 1 }, { key: "x", language: 1 }, { key: "x", language: "bad_tag" }, { key: "email", value: "bad" }])("rejects malformed answer %j before writing", input => {
  expect(() => saveAnswer(input)).toThrow(); expect(d.query).not.toHaveBeenCalled();
});
test("normalizes canonical categories and saves language variants in one transaction", () => {
  expect(parseAnswer({ key: " email ", value: null, category: "custom" })).toEqual({ key: "email", value: null, category: "contact", language: "default" });
  saveAnswer({ key: "notice_period", value: "Two weeks", language: "en" });
  expect(d.transaction).toHaveBeenCalledOnce();
  expect(d.statement.run).toHaveBeenLastCalledWith("notice_period", "en", "Two weeks", "fixture-time");
  saveAnswer({ key: "custom", category: "", value: "Text" });
  expect(d.statement.run).toHaveBeenLastCalledWith(expect.objectContaining({ $cat: "custom", $default: 1 }));
  listAnswerVariants(); expect(d.statement.all).toHaveBeenCalled();
  deleteAnswer({ key: "custom" }); deleteAnswer({ key: "notice_period", language: "en" });
  expect(d.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM applicant_answer_variants"));
});
test("HTTP reports failed saves without broadcasting success and permits retry", async () => {
  const broadcast = vi.fn();
  const req = (body: unknown) => new Request("http://localhost/api/answer", { method: "POST", body: JSON.stringify(body) });
  d.statement.run.mockImplementationOnce(() => { throw new Error("disk failure"); });
  expect((await handleAnswer("/api/answer", req({ key: "custom", value: "Text" }), broadcast)).status).toBe(500);
  expect(broadcast).not.toHaveBeenCalled();
  expect((await handleAnswer("/api/answer", req({ key: "email", value: "bad" }), broadcast)).status).toBe(400);
  expect((await handleAnswer("/api/answer", req({ key: "custom", value: "Text" }), broadcast)).status).toBe(200);
  expect((await handleAnswer("/api/answer/delete", req({ key: "custom" }), broadcast)).status).toBe(200);
  expect((await handleAnswer("/api/answer", new Request("http://localhost"), broadcast)).status).toBe(404);
  expect((await handleAnswer("/api/answers/catalog", new Request("http://localhost"), broadcast)).status).toBe(200);
  expect((await handleAnswer("/api/answers/variants", new Request("http://localhost"), broadcast)).status).toBe(200);
});
