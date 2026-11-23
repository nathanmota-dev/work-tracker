import { beforeEach, expect, test, vi } from "vitest";
import { handleInterviewPreps } from "./http.ts";
import { listInterviewPreps } from "./store.ts";

vi.mock("./store.ts", () => ({ listInterviewPreps: vi.fn() }));

beforeEach(() => vi.mocked(listInterviewPreps).mockReset().mockReturnValue([]));
const get = (path: string, method = "GET") => handleInterviewPreps(path, new Request(`http://localhost${path}`, { method }));

test("lists every pack, or the packs of one application", async () => {
  expect(await get("/api/interview-preps").json()).toEqual([]);
  expect(listInterviewPreps).toHaveBeenLastCalledWith();
  expect(get("/api/interview-preps/12").status).toBe(200);
  expect(listInterviewPreps).toHaveBeenLastCalledWith(12);
});

test.each(["/abc", "/0", "/-1", "/7/extra", "/"])("rejects the application id %s", (suffix) => {
  expect(get(`/api/interview-preps${suffix}`).status).toBe(400);
  expect(listInterviewPreps).not.toHaveBeenCalled();
});

test("only reads are supported", () => {
  expect(get("/api/interview-preps", "POST").status).toBe(404);
});
