import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { invitationQrRaster, invitationUrl, localPhotoUrl } from './invitation-card';

const token = 'A'.repeat(43);
describe('private invitation card QR', () => {
  it.each(['https://gallery.example.test/', 'https://private.example.test:8502/'])('round-trips the complete invitation including its fragment: %s', base => {
    const url = base + '#family-invite=' + token;
    const raster = invitationQrRaster(url);
    const result = jsQR(raster.pixels, raster.width, raster.width, { inversionAttempts: 'dontInvert' });
    expect(result?.data).toBe(url);
    expect(raster.scale).toBeGreaterThanOrEqual(4);
    for(let y=0;y<4*raster.scale;y++) for(let x=0;x<raster.width;x++) {
      expect(raster.pixels[(y*raster.width+x)*4]).toBe(255);
    }
  });
  it('rejects malformed invitations and third-party photos', () => {
    expect(()=>invitationUrl('http://gallery.example.test/#family-invite='+token)).toThrow();
    expect(()=>invitationUrl('https://gallery.example.test/#family-invite=invalid')).toThrow();
    const origin='https://gallery.example.test';
    expect(localPhotoUrl('/api/remote-media/2/abc-123/preview',origin)).toBe(origin+'/api/remote-media/2/abc-123/preview');
    expect(localPhotoUrl('/previews/photo.webp?v=1',origin)).toBe(origin+'/previews/photo.webp?v=1');
    expect(localPhotoUrl('https://other.example.test/previews/a.webp',origin)).toBeNull();
    expect(localPhotoUrl('/api/originals/1',origin)).toBeNull();
  });
});