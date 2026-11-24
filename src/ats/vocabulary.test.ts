import { expect, test } from "vitest";
import { VOCABULARY, canonicalSkill, resumeTerms, scanTerms } from "./vocabulary.ts";

const terms = (text: string) => [...new Set(scanTerms(text).map(hit => VOCABULARY[hit.index]!.term))];

test.each([
  ["C# and .NET 8 APIs", ["C#", ".NET"]],
  ["C++ and C with C#", ["C++", "C#"]],
  ["Node.js, NodeJS or Node.", ["Node.js"]],
  ["Vue.js with ASP.NET Core", ["Vue.js", "ASP.NET Core"]],
  ["CI/CD pipelines and GitHub Actions", ["CI/CD", "GitHub Actions"]],
  ["JavaScript only", ["JavaScript"]],
  ["Java, Kotlin.", ["Java", "Kotlin"]],
  ["Java/JavaScript", ["Java", "JavaScript"]],
  ["Go and Golang services", ["Go"]],
  ["let's go to the office, then Google", []],
  ["ReactJS, React.js, React Native and Next.js", ["React", "React Native", "Next.js"]],
  ["Angular and AngularJS", ["Angular", "AngularJS"]],
  ["Spring Boot and Spring", ["Spring Boot", "Spring"]],
  ["SQL Server, Postgres and MySQL", ["SQL Server", "PostgreSQL", "MySQL"]],
  ["Experiência com microsserviços e integração contínua", ["Microservices", "CI/CD"]],
  ["front-end, Frontend, back end and full-stack", ["Front-end", "Back-end", "Full stack"]],
  ["REST and RESTful APIs, the rest of the team", ["REST"]],
  ["Express.js or Express; express interest", ["Express"]],
  ["node.js.", ["Node.js"]],
])("%s", (text, expected) => {
  expect(terms(text)).toEqual(expected);
});

test("each spelling belongs to one term and the vocabulary covers 80 to 120 terms", () => {
  expect(VOCABULARY.length).toBeGreaterThanOrEqual(80);
  expect(VOCABULARY.length).toBeLessThanOrEqual(120);
  expect(new Set(VOCABULARY.map(entry => entry.term)).size).toBe(VOCABULARY.length);
  for (const entry of VOCABULARY) if (entry.parent) expect(VOCABULARY.some(other => other.term === entry.parent)).toBe(true);
});

test("a resume covers the broader terms its technologies imply", () => {
  expect([...resumeTerms("AWS S3, EF Core and NestJS")].sort()).toEqual([".NET", "AWS", "AWS S3", "Entity Framework Core", "NestJS", "Node.js"]);
  expect(resumeTerms("JavaScript").has("Java")).toBe(false);
});

test("canonical skill names reuse the vocabulary aliases and keep unknown names", () => {
  expect(["Node", "Next", "NextJs", "ReactJs", "PostrgreSQL", "TailwindCSS", "Amazon S3", "Amazon EC2", " golang ", "Rust"].map(canonicalSkill))
    .toEqual(["Node.js", "Next.js", "Next.js", "React", "PostgreSQL", "Tailwind CSS", "AWS S3", "AWS EC2", "Go", "Rust"]);
  expect(canonicalSkill("Frontend")).toBe("Frontend");
  expect(canonicalSkill("Fictional Framework")).toBe("Fictional Framework");
});
