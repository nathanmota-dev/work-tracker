#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/create-worktree-local.sh <branch-name> [destination] [start-point]

Creates a task worktree and reuses compatible local dependencies and personal
resume files. The destination defaults to a sibling of this repository and the
start point defaults to main.

Example:
  scripts/create-worktree-local.sh feat/batch-apply
EOF
}

if [[ $# -lt 1 || $# -gt 3 ]]; then
  usage >&2
  exit 2
fi

branch_name=$1
start_point=${3:-main}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(git -C "$script_dir/.." rev-parse --show-toplevel)
repository_name=$(basename -- "$source_root")
branch_slug=${branch_name//\//-}
destination=${2:-"$(dirname -- "$source_root")/${repository_name}-${branch_slug}"}

if [[ ! $branch_name =~ ^(feat|fix|chore|refactor|perf|docs|test|ci|revert)/[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]]; then
  printf 'Invalid branch name: %s\n' "$branch_name" >&2
  printf '%s\n' 'Use <type>/<short-kebab-case-name>, for example feat/batch-apply.' >&2
  exit 2
fi

if [[ $(git -C "$source_root" branch --show-current) != main ]]; then
  printf '%s\n' 'Run this helper from the main worktree.' >&2
  exit 1
fi

if git -C "$source_root" show-ref --verify --quiet "refs/heads/$branch_name"; then
  printf 'Branch already exists: %s\n' "$branch_name" >&2
  exit 1
fi

if [[ -e $destination ]]; then
  printf 'Destination already exists: %s\n' "$destination" >&2
  exit 1
fi

git -C "$source_root" rev-parse --verify --quiet "$start_point^{commit}" >/dev/null || {
  printf 'Invalid start point: %s\n' "$start_point" >&2
  exit 1
}

git -C "$source_root" worktree add -b "$branch_name" "$destination" "$start_point"

copy_directory() {
  local relative_path=$1
  local source_path="$source_root/$relative_path"
  local destination_path="$destination/$relative_path"

  [[ -d $source_path ]] || return 0
  mkdir -p -- "$destination_path"
  cp -a --reflink=auto -- "$source_path/." "$destination_path/"
  printf 'Reused %s\n' "$relative_path"
}

dependencies_reusable=false
if [[ -d $source_root/node_modules ]] && cmp -s "$source_root/package-lock.json" "$destination/package-lock.json"; then
  dependencies_reusable=true
fi

if [[ $dependencies_reusable == true ]]; then
  copy_directory node_modules
  copy_directory web/node_modules
else
  printf '%s\n' 'Dependencies are missing or the lockfile differs; running npm ci.'
  npm --prefix "$destination" ci
fi

copy_directory base/data
copy_directory base/latex
copy_directory coverage
copy_directory out
copy_directory playwright-report
copy_directory release
copy_directory test-results

printf '\nWorktree ready:\n  branch: %s\n  path:   %s\n\nContinue with:\n  cd %q\n' \
  "$branch_name" "$destination" "$destination"
