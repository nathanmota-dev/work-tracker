import { callTool } from "../mcp/linkedin.ts";
import { loadConfig } from "../paths.ts";
export async function fetchProfile(username?: string): Promise<void> {
  username ??= loadConfig().username;
  if (!username) throw new Error("Set username in Work Tracker config.json or pass a username");
  console.log(JSON.stringify(await callTool("get_person_profile", {
    linkedin_username: username,
    sections: "experience,education,skills,certifications,projects,honors,languages,posts",
  }), null, 2));
}
