import type { UpdateDriver } from "./app-updates"
import { isNewStable, releaseUrl, UpdateFailure } from "./update-state"

const LATEST_RELEASE = "https://api.github.com/repos/nathanmota-dev/work-tracker/releases/latest"

/** Check-only driver for installs that cannot replace themselves (unpacked, Snap, Flatpak). */
export function createReleaseCheckDriver(installedVersion: string, fetcher: typeof fetch = fetch): UpdateDriver {
  const controller = new AbortController()
  return {
    async check() {
      let response: Response
      try {
        response = await fetcher(LATEST_RELEASE, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "work-tracker-updater" },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        })
      } catch { throw new UpdateFailure("network") }
      if (response.status === 404) return null
      if (!response.ok) throw new UpdateFailure("network")
      const body = await response.json().catch(() => { throw new UpdateFailure("metadata") }) as Record<string, unknown>
      const version = typeof body.tag_name === "string" ? body.tag_name.replace(/^v/, "") : ""
      if (!version) throw new UpdateFailure("metadata")
      if (!isNewStable(version, installedVersion)) return null
      const published = typeof body.published_at === "string" && Number.isFinite(Date.parse(body.published_at)) ? body.published_at : null
      return {
        version,
        releaseDate: published,
        notes: typeof body.body === "string" && body.body ? body.body.slice(0, 20_000) : null,
        url: releaseUrl(version),
      }
    },
    async download() { throw new UpdateFailure("installation") },
    async install() { throw new UpdateFailure("installation") },
    dispose() { controller.abort() },
  }
}
