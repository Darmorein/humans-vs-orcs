import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { ASSET_MANIFEST_V2 } = await server.ssrLoadModule(
    '/src/Assets/Manifest/entries.ts',
  );
  const { validateManifest } = await server.ssrLoadModule(
    '/src/Assets/Manifest/Validate.ts',
  );
  const result = validateManifest(ASSET_MANIFEST_V2);

  for (const entry of result.entries) {
    const publicPath = join(process.cwd(), 'public', entry.src.replace(/^\//, ''));
    if (!existsSync(publicPath)) {
      result.errors.push({
        level: 'error',
        id: entry.id,
        message: `Missing public asset file: ${entry.src}`,
      });
      result.ok = false;
    }

    if (entry.teamColorMask) {
      const maskPath = join(process.cwd(), 'public', entry.teamColorMask.src.replace(/^\//, ''));
      if (!existsSync(maskPath)) {
        result.errors.push({
          level: 'error',
          id: entry.id,
          message: `Missing team-color mask file: ${entry.teamColorMask.src}`,
        });
        result.ok = false;
      }
    }
  }

  for (const warning of result.warnings) {
    console.warn(`[AssetManifest] ${warning.id ?? '?'}: ${warning.message}`);
  }
  for (const error of result.errors) {
    console.error(`[AssetManifest] ${error.id ?? '?'}: ${error.message}`);
  }

  if (!result.ok) {
    process.exitCode = 1;
  } else {
    console.info(
      `[AssetManifest] v${ASSET_MANIFEST_V2.version} valid: ` +
        `${result.entries.length} assets, ${result.warnings.length} warnings`,
    );
  }
} finally {
  await server.close();
}
