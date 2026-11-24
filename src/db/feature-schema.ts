import { ONBOARDING_SCHEMA_SQL } from "./onboarding-schema.ts";
import { INTERVIEW_PREP_SCHEMA_SQL } from "./interview-prep-schema.ts";
import { COMPANY_RESEARCH_SCHEMA_SQL } from "./company-research-schema.ts";
import { FOLLOWUP_SCHEMA_SQL } from "./followup-schema.ts";
import { RANKING_SCHEMA_SQL } from "./ranking-schema.ts";
import { GATE_SCHEMA_SQL } from "./gate-schema.ts";
import { PROFILE_SCHEMA_SQL } from "./profile-schema.ts";

/** Tables of the smaller features, kept apart so `schema.ts` stays within the file-size limit. */
export const FEATURE_SCHEMA_SQL = ONBOARDING_SCHEMA_SQL + INTERVIEW_PREP_SCHEMA_SQL + COMPANY_RESEARCH_SCHEMA_SQL + FOLLOWUP_SCHEMA_SQL + RANKING_SCHEMA_SQL + GATE_SCHEMA_SQL + PROFILE_SCHEMA_SQL;
