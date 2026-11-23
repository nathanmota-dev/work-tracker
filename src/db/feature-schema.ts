import { ONBOARDING_SCHEMA_SQL } from "./onboarding-schema.ts";
import { INTERVIEW_PREP_SCHEMA_SQL } from "./interview-prep-schema.ts";

/** Tables of the smaller features, kept apart so `schema.ts` stays within the file-size limit. */
export const FEATURE_SCHEMA_SQL = ONBOARDING_SCHEMA_SQL + INTERVIEW_PREP_SCHEMA_SQL;
