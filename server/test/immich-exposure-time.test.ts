import { describe, expect, it } from 'vitest';
import { parseImmichExposureTime } from '../src/immich/exposure-time.js';

describe('Immich exposure time', () => {
  it.each([['1/125', 0.008], ['1 / 250 s', 0.004], ['2.5', 2.5], ['.5', 0.5], [30, 30]])('parses %s', (input, expected) => {
    expect(parseImmichExposureTime(input)).toBeCloseTo(expected as number);
  });
  it.each([null, undefined, '', 'unknown', '1/0', '1/125 garbage', '-1', 0, Infinity])('rejects invalid value %s', input => {
    expect(parseImmichExposureTime(input)).toBeUndefined();
  });
});