/** Browser pinch zoom must not become an app-level photo navigation gesture. */
export function isViewportZoomed(): boolean {
  return typeof window !== 'undefined' && (window.visualViewport?.scale ?? 1) > 1.01;
}
