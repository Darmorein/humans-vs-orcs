/**
 * Development-only simulation diagnostics overlay.
 */
export interface SimDiagnosticsData {
  simTick: number;
  seed: number;
  rngState: number;
  entityCount: number;
  unitCount: number;
  squadCount?: number;
  settlementCount: number;
  commandQueueLength: number;
  lastStateHash: string;
  determinismStatus: string;
  pvpLocalHash?: string;
  pvpRemoteHash?: string;
  pvpLastCompareTick?: number;
}

export function mountSimDiagnostics(getData: () => SimDiagnosticsData): () => void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== '1' && params.get('diagnose') !== '1') {
    return () => undefined;
  }

  const el = document.createElement('div');
  el.id = 'sim-diagnostics';
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'absolute',
    left: '12px',
    bottom: '12px',
    zIndex: '40',
    background: 'rgba(0,0,0,0.78)',
    color: '#d7cfb7',
    font: '12px/1.4 Consolas, monospace',
    padding: '10px 12px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.12)',
    pointerEvents: 'none',
    maxWidth: '380px',
    whiteSpace: 'pre-wrap',
  } as CSSStyleDeclaration);
  document.body.appendChild(el);

  let raf = 0;
  const tick = () => {
    const d = getData();
    const lines = [
      `SIM  tick ${d.simTick}  seed ${d.seed}`,
      `rng ${d.rngState}`,
      `ent ${d.entityCount}  units ${d.unitCount}  squads ${d.squadCount ?? '—'}  settlements ${d.settlementCount}`,
      `queue ${d.commandQueueLength}`,
      `hash ${d.lastStateHash}`,
      `determinism ${d.determinismStatus}`,
    ];
    if (d.pvpLocalHash != null) {
      const synced =
        d.pvpRemoteHash && d.pvpLocalHash === d.pvpRemoteHash
          ? 'SYNCED'
          : d.pvpRemoteHash
            ? 'DESYNC'
            : 'waiting';
      lines.push(
        `pvp local ${d.pvpLocalHash}  remote ${d.pvpRemoteHash ?? '—'}  @${d.pvpLastCompareTick ?? '—'}  ${synced}`,
      );
    }
    el.textContent = lines.join('\n');
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    el.remove();
  };
}
