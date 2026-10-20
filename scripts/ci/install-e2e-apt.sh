#!/usr/bin/env bash
set -euo pipefail

# Playwright's Ubuntu 24.04 Chromium + tools packages, followed by Electron/LaTeX.
# Keep this list aligned with the locked Playwright version (test:infra checks it).
packages=(
  xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6
  xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic
  fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64
  libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
  xauth libgtk-3-0t64 latexmk texlive-latex-base poppler-utils
)

if [[ "${1:-}" == --packages ]]; then
  echo "${packages[*]}"
  exit 0
fi

cache_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/electron-e2e-apt"
state_archive="$cache_dir/tex-state.tar"

install_packages() {
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
}

probe_dependencies() {
  local tool probe_dir
  for tool in xvfb-run xauth latexmk pdflatex pdfinfo pdftotext; do
    command -v "$tool" >/dev/null || return 1
  done
  probe_dir="$(mktemp -d "$RUNNER_TEMP/e2e-tex-probe.XXXXXX")"
  printf '%s\n' '\documentclass{article}\begin{document}E2E cache probe\end{document}' > "$probe_dir/probe.tex"
  if ! (cd "$probe_dir" && latexmk -pdf -interaction=nonstopmode -halt-on-error probe.tex > build.log 2>&1 &&
    pdfinfo probe.pdf >/dev/null && pdftotext probe.pdf probe.txt && test -s probe.txt); then
    cat "$probe_dir/build.log"
    rm -rf "$probe_dir"
    return 1
  fi
  rm -rf "$probe_dir"
}

# Package files alone omit generated TeX formats, configuration and font caches.
if [[ "${APT_CACHE_OUTCOME:-failure}" == success && "${APT_CACHE_HIT:-false}" == true && "${TEX_CACHE_HIT:-false}" == true ]]; then
  if sudo tar -xf "$state_archive" -C / && sudo ldconfig && probe_dependencies; then
    echo 'Validated system dependencies restored from cache.'
    exit 0
  fi
  echo '::warning::Cached system dependencies are unusable; retrying with apt.'
fi

# A successful cold action already ran apt and configured the packages. Every
# partial/failed restore goes through apt again before creating a fresh snapshot.
if [[ "${APT_CACHE_OUTCOME:-failure}" != success || "${APT_CACHE_HIT:-false}" == true ]]; then
  install_packages
fi
if ! probe_dependencies; then
  install_packages
  probe_dependencies
fi
mkdir -p "$cache_dir"
sudo tar -cf "$state_archive" -C / etc/texmf var/lib/texmf var/cache/fontconfig etc/fonts/conf.d
sudo chmod a+r "$state_archive"
