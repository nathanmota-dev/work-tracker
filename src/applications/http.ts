import {
  ApplicationBoardError,
  executeApplicationAction,
  listApplicationBoard,
} from "./store.ts";
import type { ApplicationActions } from "./types.ts";

const actions: (keyof ApplicationActions)[] = [
  "create",
  "update",
  "move",
  "archive",
  "reopen",
  "details",
  "stages/save",
  "stages/reorder",
  "stages/set-archived",
];

export async function handleApplicationBoard(
  path: string,
  req: Request,
  broadcast: (event: unknown) => void,
): Promise<Response> {
  const action = path.slice("/api/application-board".length).replace(/^\//, "");
  if (
    (action === "" && req.method !== "GET") ||
    (actions.includes(action as keyof ApplicationActions) &&
      req.method !== "POST")
  ) {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  try {
    if (action === "") return Response.json(listApplicationBoard());
    if (!actions.includes(action as keyof ApplicationActions))
      return Response.json({ error: "Not found." }, { status: 404 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApplicationBoardError("Invalid JSON body.");
    }
    const result = executeApplicationAction(
      action as keyof ApplicationActions,
      body,
    );
    for (const table of result.changed) broadcast({ type: "changed", table });
    return Response.json(result.value, {
      status: action === "create" ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof ApplicationBoardError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
