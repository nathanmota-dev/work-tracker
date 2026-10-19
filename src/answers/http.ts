import { ANSWER_CATALOG } from "./catalog.ts";
import { AnswerError, deleteAnswer, listAnswerVariants, saveAnswer } from "./store.ts";

export async function handleAnswer(path: string, req: Request, broadcast: (event: unknown) => void): Promise<Response> {
  if (req.method === "GET" && path === "/api/answers/variants") return Response.json(listAnswerVariants());
  if (req.method === "GET" && path === "/api/answers/catalog") return Response.json(ANSWER_CATALOG);
  if (req.method !== "POST" || !["/api/answer", "/api/answer/delete"].includes(path)) return new Response("not found", { status: 404 });
  try {
    const body: unknown = await req.json().catch(() => null);
    if (path.endsWith("/delete")) deleteAnswer(body);
    else saveAnswer(body);
    broadcast({ type: "changed", table: "applicant_answers" });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof AnswerError ? error.message : "Could not update the answer. Your saved answers were preserved; retry." },
      { status: error instanceof AnswerError ? 400 : 500 });
  }
}
