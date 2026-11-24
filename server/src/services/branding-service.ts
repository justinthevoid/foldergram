import { z } from 'zod';
import sharp from 'sharp';
import { appSettingsRepository } from '../db/repositories.js';

const key = 'app.gallery-branding';
const schema = z.object({
  name: z.string().trim().min(1).max(60),
  photographer: z.string().trim().max(80),
  bio: z.string().trim().max(400),
  logo: z.string().max(70000).regex(/^(?:|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2})$/)
}).strict();
export type Branding = z.infer<typeof schema>;
const defaults: Branding = { name: 'Foldergram', photographer: '', bio: '', logo: '' };

export function getBranding(): Branding {
  try {
    const parsed = schema.safeParse(JSON.parse(appSettingsRepository.get(key) ?? 'null'));
    if (parsed.success) return parsed.data;
  } catch { /* Retain the original branding when stored settings are invalid. */ }
  return { ...defaults };
}

export function getPublicBranding() {
  const { name, logo } = getBranding();
  return { name, logo };
}

export async function saveBranding(input: unknown): Promise<Branding> {
  const value = schema.parse(input);
  if (value.logo) {
    // Decode only bounded raster inputs, remove metadata, and persist our own WebP.
    const bytes = Buffer.from(value.logo.split(',')[1]!, 'base64');
    const image = sharp(bytes, { limitInputPixels: 1048576, animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      throw new Error('Logo must be a JPEG, PNG or WebP image.');
    }
    const output = await image.rotate().resize(160, 160, { fit: 'contain', background: '#00000000' })
      .webp({ quality: 80 }).toBuffer();
    value.logo = 'data:image/webp;base64,' + output.toString('base64');
    schema.parse(value);
  }
  appSettingsRepository.set(key, JSON.stringify(value));
  return value;
}