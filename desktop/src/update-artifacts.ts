import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import type { RequestOptions } from "node:http"
import { basename } from "node:path"
import { CancellationToken } from "builder-util-runtime"
import type { UpdateInfo } from "electron-updater"
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor"
import { valid, prerelease } from "semver"
import { UpdateFailure } from "./update-state"

/** Keep only the x64/arm64 AppImage entry with a valid digest, so no incompatible payload is used. */
export function selectUpdate(info: UpdateInfo, arch: string): UpdateInfo {
  if (!info || !valid(info.version) || prerelease(info.version) || !Array.isArray(info.files)) throw new UpdateFailure("metadata")
  const aliases = arch === "x64" ? ["x64", "amd64", "x86_64"] : arch === "arm64" ? ["arm64", "aarch64"] : []
  const file = info.files.find((file) => {
    if (typeof file?.url !== "string" || typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) return false
    const name = basename(file.url)
    return name.toLowerCase().endsWith(".appimage") && aliases.some((nameArch) => new RegExp(`[-_]${nameArch}\\.`, "i").test(name))
  })
  if (!file) throw new UpdateFailure("metadata")
  return { ...info, files: [file], path: file.url, sha512: file.sha512 }
}

/** Each metadata request, including redirects, has an absolute cancellable deadline. */
export class UpdateHttpExecutor extends ElectronHttpExecutor {
  private requests = new Set<CancellationToken>()
  override async request(options: RequestOptions, parent?: CancellationToken, data?: Record<string, unknown> | null) {
    const token = new CancellationToken(parent)
    this.requests.add(token)
    const timer = setTimeout(() => token.cancel(), 30_000)
    try { return await super.request(options, token, data) }
    finally { clearTimeout(timer); this.requests.delete(token); token.dispose() }
  }
  dispose() { for (const token of this.requests) token.cancel(); this.requests.clear() }
}

export async function verifyArtifact(path: string, sha512: string) {
  const hash = createHash("sha512")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest("base64") !== sha512) throw new UpdateFailure("integrity")
}
