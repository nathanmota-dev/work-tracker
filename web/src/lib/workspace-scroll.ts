import { useLayoutEffect, useRef } from "react"

/** Navigation-only cache: never writes scroll positions to browser storage. */
export function useNavigationScroll(path: string) {
  const positions = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const container = document.querySelector<HTMLElement>("[data-workspace-scroll]")
    if (!container) return
    const top = positions.current.get(path) ?? 0
    let lastTop = top
    const remember = () => { lastTop = container.scrollTop }
    container.addEventListener("scroll", remember)
    const restore = () => { container.scrollTop = top }
    restore()
    // Records arrive asynchronously after a route mounts.
    const observer = new MutationObserver(restore)
    observer.observe(container, { childList: true, subtree: true })
    const stop = () => observer.disconnect()
    container.addEventListener("wheel", stop, { once: true })
    container.addEventListener("pointerdown", stop, { once: true })
    container.addEventListener("keydown", stop, { once: true })
    const timer = setTimeout(stop, 1500)
    const cache = positions.current
    return () => {
      cache.set(path, lastTop)
      container.removeEventListener("scroll", remember)
      clearTimeout(timer); stop()
      container.removeEventListener("wheel", stop)
      container.removeEventListener("pointerdown", stop)
      container.removeEventListener("keydown", stop)
    }
  }, [path])
}
