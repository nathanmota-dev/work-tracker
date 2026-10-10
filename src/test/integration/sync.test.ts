import { afterEach, describe, expect, test, beforeEach } from "vitest";
import { Database } from "../../db/sqlite.ts";
import { SCHEMA_SQL } from "../../db/schema.ts";
import {
  planSync,
  applySync,
  pendingRecruiters,
  type DetectedPerson,
  type RecruiterRow,
} from "../../recruiter/sync.ts";
function makeDb(): Database {
  const d = new Database(":memory:");
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec(SCHEMA_SQL);
  return d;
}

function seed(
  d: Database,
  rows: Array<Partial<RecruiterRow> & { name: string }>,
) {
  const stmt = d.query(
    `INSERT INTO recruiters (name, username, company, degree, status)
     VALUES ($name, $username, $company, $degree, $status)`,
  );
  for (const r of rows) {
    stmt.run({
      $name: r.name,
      $username: r.username ?? null,
      $company: r.company ?? null,
      $degree: r.degree ?? "2nd",
      $status: r.status ?? "pending",
    });
  }
}

describe("planSync / applySync", () => {
  let d: Database;
  beforeEach(() => {
    d = makeDb();
  });
  afterEach(() => d.close());

  test("plan groups by company and matches accepted, without writing", async () => {
    seed(d, [
      {
        name: "Recruiter One",
        username: "recruiter-one-000001",
        company: "Acme Corp",
      },
      {
        name: "Recruiter Two",
        username: "recruiter-two",
        company: "Acme Corp",
      },
      {
        name: "Recruiter Three",
        username: "recruiter-three",
        company: "Beta Inc",
      },
    ]);

    const detect = async (company: string): Promise<DetectedPerson[]> => {
      if (company === "Acme Corp")
        return [
          { username: "/in/recruiter-one-000001/", name: "Recruiter One" },
        ];
      if (company === "Beta Inc")
        return [{ username: "/in/recruiter-three/", name: "Recruiter Three" }];
      return [];
    };

    const plan = await planSync(d, detect);
    expect(plan.applied).toBe(false);
    expect(plan.scanned).toBe(3);
    expect(plan.companiesQueried).toBe(2);
    expect(plan.changes.map((c) => c.name).sort()).toEqual([
      "Recruiter One",
      "Recruiter Three",
    ]);
    // Dry run must not mutate the DB.
    const stillPending = d
      .query("SELECT COUNT(*) AS n FROM recruiters WHERE status='pending'")
      .get() as { n: number };
    expect(stillPending.n).toBe(3);
  });

  test("apply transitions matched rows to accepted + sets accepted_at", async () => {
    seed(d, [
      {
        name: "Recruiter One",
        username: "recruiter-one-000001",
        company: "Acme Corp",
      },
    ]);
    const detect = async () => [
      { username: "/in/recruiter-one-000001/", name: "Recruiter One" },
    ];

    const plan = await planSync(d, detect);
    const applied = applySync(plan, d);
    expect(applied.applied).toBe(true);

    const row = d
      .query(
        "SELECT status, accepted_at FROM recruiters WHERE name='Recruiter One'",
      )
      .get() as { status: string; accepted_at: string | null };
    expect(row.status).toBe("accepted");
    expect(row.accepted_at).not.toBeNull();
  });

  test("recruiters without a company are skipped from search but counted as scanned", async () => {
    seed(d, [{ name: "No Company", username: "x", company: null }]);
    const detect = async () => [{ username: "/in/x/", name: "No Company" }];
    const plan = await planSync(d, detect);
    expect(plan.scanned).toBe(1);
    expect(plan.companiesQueried).toBe(0);
    expect(plan.changes).toHaveLength(0);
  });

  test("detector error for a company is reported as skipped, others proceed", async () => {
    seed(d, [
      {
        name: "Recruiter One",
        username: "recruiter-one-000001",
        company: "Acme Corp",
      },
      { name: "Broken Co Person", username: "bcp", company: "BrokenCo" },
    ]);
    const detect = async (company: string): Promise<DetectedPerson[]> => {
      if (company === "BrokenCo") throw new Error("MCP unreachable");
      return [{ username: "/in/recruiter-one-000001/", name: "Recruiter One" }];
    };
    const plan = await planSync(d, detect);
    expect(plan.skipped).toEqual(["BrokenCo"]);
    expect(plan.changes.map((c) => c.name)).toEqual(["Recruiter One"]);
  });

  test("apply is idempotent (re-running matches nothing new)", async () => {
    seed(d, [
      {
        name: "Recruiter One",
        username: "recruiter-one-000001",
        company: "Acme Corp",
      },
    ]);
    const detect = async () => [
      { username: "/in/recruiter-one-000001/", name: "Recruiter One" },
    ];

    applySync(await planSync(d, detect), d);
    // Second pass: the row is no longer pending, so plan finds nothing.
    const plan2 = await planSync(d, detect);
    expect(plan2.changes).toHaveLength(0);
    expect(pendingRecruiters(d)).toHaveLength(0);
  });
});
