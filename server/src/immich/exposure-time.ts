/** Immich exposes shutter speed as a decimal or a fraction of a second. */
export function parseImmichExposureTime(input: unknown): number | undefined {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : undefined;
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  const match = /^(\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(\d+(?:\.\d+)?|\.\d+))?(?:\s*s)?$/i.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[1]) / (match[2] === undefined ? 1 : Number(match[2]));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}