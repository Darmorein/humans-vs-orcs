import { createServer } from 'vite';

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
