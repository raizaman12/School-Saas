import { mkdir } from 'fs/promises';
import path from 'path';
import { env } from '../config/env';

/**
 * Resolves a path inside the configured storage root, creating any missing
 * directories along the way. `segments` are joined under `STORAGE_DIR` —
 * callers should namespace by feature (e.g. `report-card-batches`) to keep
 * different generated-artifact kinds from colliding.
 */
export async function storagePath(...segments: string[]): Promise<string> {
  const full = path.join(env.STORAGE_DIR, ...segments);
  await mkdir(path.dirname(full), { recursive: true });
  return full;
}
