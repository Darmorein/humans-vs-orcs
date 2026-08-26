import { ASSET_MANIFEST_V2 } from './entries';
import type { AssetEntry, AssetManifestV2, ManifestValidationResult } from './Types';
import { validateManifest } from './Validate';
import { runManifestGameplayChecks } from './diagnostics';

/**
 * Runtime registry of resolved Manifest v2 entries.
 * Loaded once during asset boot; used by SpriteMap / rendering for scale & pivot.
 */
export class AssetManifestRegistry {
  private byId = new Map<string, AssetEntry>();
  private byTerrainType = new Map<string, AssetEntry>();
  private validation: ManifestValidationResult | null = null;

  /** Validate + register. Throws on schema errors. */
  public load(raw: AssetManifestV2 = ASSET_MANIFEST_V2): ManifestValidationResult {
    const result = validateManifest(raw);
    this.validation = result;

    for (const w of result.warnings) {
      console.warn(`[AssetManifest] ${w.id ?? '?'}: ${w.message}`);
    }
    if (!result.ok) {
      for (const e of result.errors) {
        console.error(`[AssetManifest] ${e.id ?? '?'}: ${e.message}`);
      }
      throw new Error(`Asset Manifest v2 validation failed (${result.errors.length} errors)`);
    }

    this.byId.clear();
    this.byTerrainType.clear();
    for (const entry of result.entries) {
      this.byId.set(entry.id, entry);
      if (
        entry.category === 'terrain' &&
        entry.terrainType &&
        !this.byTerrainType.has(entry.terrainType)
      ) {
        this.byTerrainType.set(entry.terrainType, entry);
      }
    }

    console.info(
      `[AssetManifest] v${raw.version} loaded: ${result.entries.length} assets` +
        (result.warnings.length ? `, ${result.warnings.length} warnings` : ''),
    );
    runManifestGameplayChecks();
    return result;
  }

  public get(id: string): AssetEntry | undefined {
    return this.byId.get(id);
  }

  public has(id: string): boolean {
    return this.byId.has(id);
  }

  public all(): AssetEntry[] {
    return [...this.byId.values()];
  }

  /** First terrain asset tagged with this gameplay terrainType. */
  public getByTerrainType(terrainType: string): AssetEntry | undefined {
    return this.byTerrainType.get(terrainType);
  }

  public getValidation(): ManifestValidationResult | null {
    return this.validation;
  }
}

/** Shared registry used by AssetManager / SpriteMap. */
export const assetManifest = new AssetManifestRegistry();
