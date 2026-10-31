import { onboardingStatus } from "./status.ts";
import { OnboardingError, savePreferences } from "./store.ts";

export async function handleOnboarding(path: string, req: Request, broadcast: (event: unknown) => void): Promise<Response> {
  if (req.method === "GET" && path === "/api/onboarding/status") return Response.json(await onboardingStatus());
  if (req.method !== "POST" || path !== "/api/onboarding/preferences") return new Response("not found", { status: 404 });
  try {
    savePreferences(await req.json().catch(() => null));
    broadcast({ type: "changed", table: "onboarding_state" });
    return Response.json(await onboardingStatus());
  } catch (error) {
    return Response.json({ error: error instanceof OnboardingError ? error.message : "Could not save the checklist preferences. Your previous choices were kept." },
      { status: error instanceof OnboardingError ? 400 : 500 });
  }
}
