import { ASSET_MANIFEST_V2 } from './Manifest/entries';

/**
 * Legacy path map derived from Manifest v2 (single source of truth for `src`).
 * Prefer `assetManifest.get(id)` for metadata; use these keys with `assets.get`.
 */
export const ASSET_URLS = Object.fromEntries(
  ASSET_MANIFEST_V2.assets.map((a) => [a.id, a.src]),
) as Record<(typeof ASSET_MANIFEST_V2.assets)[number]['id'], string>;

export type AssetKey = keyof typeof ASSET_URLS;
