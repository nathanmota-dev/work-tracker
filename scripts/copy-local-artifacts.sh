#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/copy-local-artifacts.sh <destination> [source]

Copies the unversioned local folders (tool caches, coverage, builds, packaged
releases, CI reports and Playwright evidence) from one worktree of this
repository to another. Each folder is mirrored: files missing from the source
are removed from the destination. The source defaults to the worktree that
holds this script.

Examples:
  # Prepare a new worktree from main.
  scripts/copy-local-artifacts.sh ../work-tracker-feat-batch-apply
  # Bring a verified task worktree's outputs back to main.
  scripts/copy-local-artifacts.sh . ../work-tracker-feat-batch-apply
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
worktree_root() {
  git -C "$1" rev-parse --show-toplevel 2>/dev/null || {
    printf 'Not a Git worktree: %s\n' "$1" >&2
    exit 1
  }
}
common_dir() { (cd -- "$1" && realpath -- "$(git rev-parse --git-common-dir)"); }

destination=$(worktree_root "$1")
source_root=$(worktree_root "${2:-$script_dir/..}")

if [[ $source_root == "$destination" ]]; then
  printf '%s\n' 'Source and destination are the same worktree.' >&2
  exit 1
fi
if [[ $(common_dir "$source_root") != "$(common_dir "$destination")" ]]; then
  printf '%s\n' 'Source and destination must be worktrees of the same repository.' >&2
  exit 1
fi

folders=(.cache coverage out release reports playwright-report test-results)
for folder in "${folders[@]}"; do
  source_path="$source_root/$folder"
  if [[ ! -d $source_path || -L $source_path ]]; then
    printf 'Skipped %s (not in source)\n' "$folder"
    continue
  fi
  mkdir -p -- "$destination/$folder"
  rsync -a --delete -- "$source_path/" "$destination/$folder/"
  printf 'Copied %s\n' "$folder"
done

printf '\nLocal folders copied:\n  from: %s\n  to:   %s\n' "$source_root" "$destination"
