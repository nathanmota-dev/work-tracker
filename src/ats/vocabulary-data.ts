/**
 * Canonical technical vocabulary of the ATS keyword score.
 *
 * @property term Canonical name shown to the candidate.
 * @property aliases Other spellings matched in running text, ignoring case and accents.
 * @property category What kind of keyword it is.
 * @property [caseSensitive] The term itself only matches with this exact case
 *   ("Go", "REST"): in lower case it is a common word. Aliases still match in any case.
 * @property [listOnly] Spellings recognized only as an exact entry of a skills list
 *   (`parseResumeData`), never in running text, where they are common words.
 * @property [parent] A broader term a resume also covers when it names this one
 *   (a resume with "AWS S3" covers "AWS").
 */
export interface VocabularyTerm {
  term: string;
  aliases: string[];
  category: TermCategory;
  caseSensitive?: boolean;
  listOnly?: string[];
  parent?: string;
}
export type TermCategory = "language" | "framework" | "database" | "cloud" | "tool" | "practice" | "role";

const t = (category: TermCategory, term: string, aliases: string[] = [], extra: Partial<VocabularyTerm> = {}): VocabularyTerm => ({ term, aliases, category, ...extra });

// Ambiguous one-letter languages (C, R) are left out: they cannot be told apart from plain text.
export const VOCABULARY: readonly VocabularyTerm[] = [
  t("language", "C#", ["C Sharp", "CSharp"]),
  t("language", "C++", ["CPP"]),
  t("language", "Java"),
  t("language", "Kotlin"),
  t("language", "Python"),
  t("language", "Go", ["Golang"], { caseSensitive: true }),
  t("language", "PHP"),
  t("language", "Ruby"),
  t("language", "Rust"),
  t("language", "Swift"),
  t("language", "Dart"),
  t("language", "JavaScript", ["JS", "ECMAScript", "ES6"]),
  t("language", "TypeScript"),
  t("language", "HTML", ["HTML5"]),
  t("language", "CSS", ["CSS3"]),
  t("language", "Sass", ["SCSS"]),
  t("language", "Bash", ["Shell Script", "Shell Scripting"]),

  t("framework", ".NET", ["dotnet", "dot net", ".NET Core", ".NET Framework", ".NET 6", ".NET 7", ".NET 8", ".NET 9"]),
  t("framework", "ASP.NET Core", ["ASP.NET", "ASP.NET MVC", "ASP.NET Web API"], { parent: ".NET" }),
  t("framework", "Entity Framework Core", ["EF Core", "Entity Framework"], { parent: ".NET" }),
  t("framework", "Blazor", [], { parent: ".NET" }),
  t("framework", "Spring", ["Spring Framework"]),
  t("framework", "Spring Boot", [], { parent: "Spring" }),
  t("framework", "Hibernate"),
  t("framework", "FastAPI"),
  t("framework", "Django"),
  t("framework", "Flask"),
  t("framework", "Laravel"),
  t("framework", "Ruby on Rails", ["Rails"]),
  t("framework", "Node.js", ["Node", "NodeJS"]),
  t("framework", "Express", ["Express.js", "ExpressJS"], { caseSensitive: true, parent: "Node.js" }),
  t("framework", "NestJS", ["Nest.js"], { parent: "Node.js" }),
  t("framework", "Fastify", [], { parent: "Node.js" }),
  t("framework", "React", ["ReactJS", "React.js", "ReactJs"]),
  t("framework", "React Native"),
  t("framework", "Next.js", ["NextJS"], { listOnly: ["Next"], parent: "React" }),
  t("framework", "Redux", [], { parent: "React" }),
  t("framework", "Angular", ["Angular 2+"]),
  t("framework", "AngularJS", ["Angular.js"]),
  t("framework", "Vue.js", ["Vue", "VueJS", "Vue 3"]),
  t("framework", "Nuxt", ["Nuxt.js", "NuxtJS"], { parent: "Vue.js" }),
  t("framework", "Svelte", ["SvelteKit"]),
  t("framework", "Tailwind CSS", ["Tailwind", "TailwindCSS"]),
  t("framework", "Bootstrap"),
  t("framework", "jQuery"),
  t("framework", "Flutter"),
  t("framework", "Prisma"),
  t("framework", "TypeORM"),

  t("database", "SQL"),
  t("database", "PostgreSQL", ["Postgres", "PostrgreSQL"]),
  t("database", "MySQL"),
  t("database", "MariaDB"),
  t("database", "SQL Server", ["MSSQL", "Microsoft SQL Server", "MS SQL Server"]),
  t("database", "Oracle Database", ["Oracle DB", "Oracle"]),
  t("database", "SQLite"),
  t("database", "MongoDB", ["Mongo"]),
  t("database", "Redis"),
  t("database", "Elasticsearch", ["Elastic Search", "OpenSearch"]),
  t("database", "DynamoDB", ["Amazon DynamoDB"], { parent: "AWS" }),
  t("database", "NoSQL"),
  t("database", "Firebase", ["Firestore"]),

  t("cloud", "AWS", ["Amazon Web Services"]),
  t("cloud", "AWS S3", ["Amazon S3", "S3"], { parent: "AWS" }),
  t("cloud", "AWS EC2", ["Amazon EC2", "EC2"], { parent: "AWS" }),
  t("cloud", "AWS Lambda", ["Amazon Lambda"], { parent: "AWS" }),
  t("cloud", "Amazon ECS", ["AWS ECS", "ECS", "Fargate"], { parent: "AWS" }),
  t("cloud", "Amazon RDS", ["AWS RDS", "RDS"], { parent: "AWS" }),
  t("cloud", "Azure", ["Microsoft Azure"]),
  t("cloud", "GCP", ["Google Cloud", "Google Cloud Platform"]),
  t("cloud", "Serverless"),

  t("tool", "RabbitMQ"),
  t("tool", "Kafka", ["Apache Kafka"]),
  t("tool", "Docker", ["Docker Compose"]),
  t("tool", "Kubernetes", ["K8s", "EKS", "AKS", "GKE"]),
  t("tool", "Terraform"),
  t("tool", "Ansible"),
  t("tool", "Jenkins"),
  t("tool", "GitHub Actions"),
  t("tool", "GitLab CI", ["GitLab CI/CD"]),
  t("tool", "Azure DevOps"),
  t("tool", "Git"),
  t("tool", "GitHub"),
  t("tool", "GitLab"),
  t("tool", "Jira"),
  t("tool", "Linux"),
  t("tool", "Nginx"),
  t("tool", "Grafana"),
  t("tool", "Prometheus"),
  t("tool", "Webpack"),
  t("tool", "Vite"),
  t("tool", "Jest"),
  t("tool", "Vitest"),
  t("tool", "xUnit"),
  t("tool", "NUnit"),
  t("tool", "JUnit"),
  t("tool", "Cypress"),
  t("tool", "Playwright"),
  t("tool", "Selenium"),
  t("tool", "pytest"),
  t("tool", "Postman"),
  t("tool", "Figma"),

  t("practice", "CI/CD", ["CI CD", "continuous integration", "continuous delivery", "continuous deployment", "integracao continua", "entrega continua"]),
  t("practice", "REST", ["RESTful", "REST API", "REST APIs", "API REST", "APIs REST"], { caseSensitive: true }),
  t("practice", "GraphQL"),
  t("practice", "gRPC"),
  t("practice", "Microservices", ["microservice", "micro services", "microsservicos", "microsservico", "microservicos", "microservico"]),
  t("practice", "Event-driven architecture", ["event driven", "event-driven", "arquitetura orientada a eventos"]),
  t("practice", "Automated testing", ["unit testing", "unit tests", "unit test", "integration tests", "automated tests", "testes unitarios", "testes automatizados", "testes de integracao"]),
  t("practice", "TDD", ["test-driven development", "test driven development"]),
  t("practice", "DDD", ["domain-driven design", "domain driven design"]),
  t("practice", "Clean Architecture", ["arquitetura limpa"]),
  t("practice", "SOLID", [], { caseSensitive: true }),
  t("practice", "OOP", ["object-oriented programming", "object oriented programming", "POO", "orientacao a objetos", "programacao orientada a objetos"]),
  t("practice", "DevOps"),
  t("practice", "Agile", ["agil", "metodologias ageis", "agile methodologies"]),
  t("practice", "Scrum"),
  t("practice", "Kanban"),

  t("role", "Front-end", ["frontend", "front end"]),
  t("role", "Back-end", ["backend", "back end"]),
  t("role", "Full stack", ["fullstack", "full-stack"]),
];
