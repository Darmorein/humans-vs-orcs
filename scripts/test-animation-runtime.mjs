import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const mod = await server.ssrLoadModule('/src/Assets/Animation/animationRuntime.test.ts');
  const results = mod.runAnimationRuntimeTests();
  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.info(`  ok  ${result.name}`);
    } else {
      failed++;
      console.error(`  FAIL ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
    }
  }
  console.info(
    `[AnimationRuntime] ${results.length - failed}/${results.length} passed` +
      (failed ? ` (${failed} failed)` : ''),
  );
  if (failed) process.exitCode = 1;
} finally {
  await server.close();
}
