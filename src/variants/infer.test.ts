import { expect, test } from "vitest";
import { inferVariantProfile } from "./infer.ts";

test("a full stack .NET and Angular job: role from the title, stacks from the title and the requirements", () => {
  const description = "Requisitos:\n- C# e .NET 8\n- Angular\n- SQL Server\n\nDiferenciais: Docker";
  expect(inferVariantProfile({ title: "Desenvolvedor Full Stack .NET/Angular", description })).toEqual({
    name: "Desenvolvedor Full Stack .NET/Angular", role: "fullstack", stacks: [".NET", "Angular", "C#"],
  });
});

test("without a role in the title, the stack decides it", () => {
  expect(inferVariantProfile({ title: "Software Engineer", description: "Requirements: React, TypeScript and Tailwind" })).toMatchObject({ role: "frontend", stacks: ["React", "TypeScript", "Tailwind CSS"] });
  expect(inferVariantProfile({ title: "Software Engineer", description: "Requirements: Java, Spring Boot" })).toMatchObject({ role: "backend", stacks: ["Java", "Spring Boot"] });
  expect(inferVariantProfile({ title: "Software Engineer", description: "Requirements: Node.js and Vue" })).toMatchObject({ role: "fullstack" });
  // Shared languages say nothing about the side.
  expect(inferVariantProfile({ title: "Engineer", description: "TypeScript" })).toMatchObject({ role: "other", stacks: ["TypeScript"] });
});

test("the description's role is the last hint, after the stack", () => {
  expect(inferVariantProfile({ title: "Engineer", description: "Join our back-end team. Kubernetes and AWS." })).toEqual({ name: "Engineer", role: "backend", stacks: ["AWS"] });
  expect(inferVariantProfile({ title: "Engineer", description: "Front-end and back-end work" })).toMatchObject({ role: "fullstack", stacks: ["General"] });
});

test("keeps at most six stacks and a name within the limit", () => {
  const profile = inferVariantProfile({ title: "x".repeat(120), description: "Requirements: C#, Java, Python, Go, PHP, Ruby, Rust, Kotlin" });
  expect(profile.stacks).toHaveLength(6);
  expect(profile.name).toHaveLength(80);
  expect(inferVariantProfile({ title: null, description: null })).toEqual({ name: "Tailored resume", role: "other", stacks: ["General"] });
});
