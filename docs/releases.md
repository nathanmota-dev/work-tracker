# Releases and in-app updates

Work Tracker ships as a Linux AppImage on GitHub Releases. Installed AppImages
update themselves with `electron-updater` using `latest-linux.yml` from the
latest release.

## Publishing a release

1. Bump `version` in `package.json` and `package-lock.json` (stable `X.Y.Z` only;
   pre-releases are ignored by the updater).
2. Write `docs/release-notes/X.Y.Z.md`; it becomes the release description and is
   shown in **Settings → Updates**.
3. Merge to `main`, then push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The **Release** workflow builds the AppImage, checks the feed, smoke-tests it
   and waits for approval of the `release` environment (GitHub → Settings →
   Environments → `release`, add yourself as a required reviewer once).
5. After approval it publishes the release and verifies the public
   `latest-linux.yml` and AppImage without credentials.

`workflow_dispatch` runs the build and checks only; nothing is published.
The repository must be public for the updater to read releases without a token.

## How the app updates

- Only an AppImage (`APPIMAGE` set) can update itself. Development runs, the
  unpacked build under `~/.local/opt/work-tracker`, Snap and Flatpak show
  "unavailable" in **Settings → Updates**.
- A check runs about every 12 hours and on demand. Failed checks retry after
  5 minutes, 30 minutes and 2 hours and are never reported as "up to date".
  An automatic check only announces the update; downloading is explicit.
- The download is verified against the `sha512` in the feed before and after
  staging, then the running AppImage is replaced atomically (same directory,
  rename). If anything fails the installed file is untouched.
- The AppImage must be writable by the user. Data in `~/.work-tracker` is never
  modified by an update.
- State (last check, next check, known release) is kept in `updates.json` under
  the Electron user data directory.
