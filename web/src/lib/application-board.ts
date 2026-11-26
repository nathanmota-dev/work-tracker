import { request } from "@/lib/api"
import { QUIET_STALE_DAYS } from "../../../src/applications/types"
import type {
  ApplicationActions,
  ApplicationDetails,
  ApplicationStage,
  JobLinkOptions,
  JobLinkResult,
  PortalLinkResult,
  QuietApplications,
  QuietResolution,
  ReviewItem,
  TrackedApplication,
} from "../../../src/applications/types"
export {
  QUIET_MIN_DAYS,
  QUIET_STALE_DAYS,
  ROLE_TYPES,
  STAGE_CATEGORIES,
  ARCHIVE_REASONS,
  REVIEW_DECISIONS,
} from "../../../src/applications/types"
export type {
  ApplicationActions,
  ApplicationBoard,
  ApplicationDetails,
  ApplicationEvent,
  ApplicationFields,
  ApplicationStage,
  ArchiveReason,
  BoardField,
  JobCandidate,
  JobLinkOptions,
  JobLinkResult,
  PreparationField,
  QuietApplication,
  QuietApplications,
  QuietResolution,
  QuietSkipped,
  ReviewDecision,
  ReviewItem,
  RoleType,
  StageCategory,
  TrackedApplication,
} from "../../../src/applications/types"

type ReviewResults = {
  "link/options": JobLinkOptions
  link: JobLinkResult
  "portal-link": PortalLinkResult
  review: { items: ReviewItem[] }
  "review/resolve": { item: ReviewItem | null }
  "review/reconcile": { items: ReviewItem[]; fixed: number[] }
  quiet: QuietApplications
  "quiet/resolve": QuietResolution
}
type ActionResults = {
  [K in keyof ApplicationActions]: K extends keyof ReviewResults
    ? ReviewResults[K]
    : K extends "details"
    ? ApplicationDetails
    : K extends "stages/reorder"
      ? ApplicationStage[]
      : K extends `stages/${string}`
        ? ApplicationStage
        : TrackedApplication
}
export function boardAction<K extends keyof ApplicationActions>(
  action: K,
  body: ApplicationActions[K],
): Promise<ActionResults[K]> {
  return request<ActionResults[K]>(`application-board/${action}`, body)
}
/** Read path of the quiet-application scan; the default threshold has no query. */
export function quietPath(days: number) {
  return `application-board/quiet${days === QUIET_STALE_DAYS ? "" : `?days=${days}`}`
}
export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}
export function matchesApplication(
  application: TrackedApplication,
  query: string,
) {
  return normalizeSearch(
    [
      application.company_name,
      application.role_title,
      application.role_type?.replaceAll("_", "-"),
      ...application.stack,
    ]
      .filter(Boolean)
      .join(" "),
  ).includes(normalizeSearch(query))
}
export function faviconUrl(
  application: Pick<TrackedApplication, "company_url" | "external_url">,
) {
  try {
    const base = new URL(application.company_url || application.external_url)
    return ["http:", "https:"].includes(base.protocol)
      ? new URL("/favicon.ico", base).href
      : undefined
  } catch {
    return undefined
  }
}
export function localDateTime(value: string) {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
