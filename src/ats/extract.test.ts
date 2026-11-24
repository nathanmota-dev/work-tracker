import { expect, test } from "vitest";
import { MAX_KEYWORDS, jobKeywords } from "./extract.ts";

const weights = (description: string) => Object.fromEntries(jobKeywords(description).map(keyword => [keyword.term, `${keyword.section}:${keyword.weight}`]));

test("weights English sections: requirements 3, nice to have 1, elsewhere 2", () => {
  expect(weights(`About the role
We build APIs with Docker.

Requirements:
- C# and .NET
- SQL Server

Nice to have
- Kafka
- Docker`)).toEqual({ "C#": "required:3", ".NET": "required:3", "SQL Server": "required:3", Docker: "other:2", Kafka: "preferred:1" });
});

test("detects Portuguese headings, inline headings and accents", () => {
  expect(weights(`## Requisitos obrigatórios
* Experiência com Node.js e TypeScript
**Diferenciais:**
* React
Benefícios:
Vale-refeição; AWS
Qualificações: PostgreSQL`)).toEqual({ "Node.js": "required:3", TypeScript: "required:3", PostgreSQL: "required:3", AWS: "other:2", React: "preferred:1" });
});

test("a term in several sections keeps its highest weight; a bullet's inline heading applies to it only", () => {
  expect(weights("Desejável: Redis\nMust have: Redis, Java\n- Plus: Go\n- Kotlin")).toEqual({ Redis: "required:3", Java: "required:3", Kotlin: "required:3", Go: "preferred:1" });
  expect(weights("What you'll need\n- Strong skills in Python\n- Django")).toEqual({ Python: "required:3", Django: "required:3" });
});

test("keeps at most 40 terms, heaviest first, and tolerates a missing description", () => {
  const many = ["Java", "Kotlin", "Python", "PHP", "Ruby", "Rust", "Swift", "Dart", "JavaScript", "TypeScript", "HTML", "CSS", "Sass", "Bash", "Django", "Flask",
    "Laravel", "Hibernate", "FastAPI", "Prisma", "Redux", "Svelte", "Bootstrap", "jQuery", "Flutter", "TypeORM", "MySQL", "MariaDB", "SQLite", "Redis", "NoSQL", "Firebase",
    "Azure", "GCP", "Serverless", "RabbitMQ", "Kafka", "Docker", "Terraform", "Ansible", "Jenkins", "Git"];
  const keywords = jobKeywords(`${many.join(", ")}\nRequirements:\nScrum`);
  expect(keywords).toHaveLength(MAX_KEYWORDS);
  expect(keywords[0]).toEqual({ term: "Scrum", category: "practice", weight: 3, section: "required" });
  expect(keywords.at(-1)!.term).toBe("Terraform");
  expect(jobKeywords(null)).toEqual([]);
});
