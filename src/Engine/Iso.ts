/** Classic 2:1 isometric projection (world XY stays cartesian for gameplay). */
export const ISO_Y = 0.5;

export function worldToIso(wx: number, wy: number): { x: number; y: number } {
  return {
    x: wx - wy,
    y: (wx + wy) * ISO_Y,
  };
}

export function isoToWorld(ix: number, iy: number): { x: number; y: number } {
  const t = iy / ISO_Y;
  return {
    x: (ix + t) / 2,
    y: (t - ix) / 2,
  };
}

export function isoDepth(x: number, y: number): number {
  return x + y;
}

export function drawIsoDiamond(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  radius: number,
  fill?: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.moveTo(sx, sy - radius);
  ctx.lineTo(sx + radius * 2, sy);
  ctx.lineTo(sx, sy + radius);
  ctx.lineTo(sx - radius * 2, sy);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function drawIsoEllipse(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  radius: number,
  fill?: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.ellipse(sx, sy, radius, radius * ISO_Y, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  radius: number,
  height: number,
  colors: { top: string; left: string; right: string },
) {
  const n = { x: sx, y: sy - radius };
  const e = { x: sx + radius * 2, y: sy };
  const s = { x: sx, y: sy + radius };
  const w = { x: sx - radius * 2, y: sy };

  const nTop = { x: n.x, y: n.y - height };
  const eTop = { x: e.x, y: e.y - height };
  const sTop = { x: s.x, y: s.y - height };
  const wTop = { x: w.x, y: w.y - height };

  ctx.beginPath();
  ctx.moveTo(w.x, w.y);
  ctx.lineTo(s.x, s.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.lineTo(wTop.x, wTop.y);
  ctx.closePath();
  ctx.fillStyle = colors.left;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(s.x, s.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.lineTo(eTop.x, eTop.y);
  ctx.closePath();
  ctx.fillStyle = colors.right;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(nTop.x, nTop.y);
  ctx.lineTo(eTop.x, eTop.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.lineTo(wTop.x, wTop.y);
  ctx.closePath();
  ctx.fillStyle = colors.top;
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w.x, w.y);
  ctx.lineTo(s.x, s.y);
  ctx.lineTo(e.x, e.y);
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.moveTo(w.x, w.y);
  ctx.lineTo(wTop.x, wTop.y);
  ctx.lineTo(nTop.x, nTop.y);
  ctx.lineTo(eTop.x, eTop.y);
  ctx.lineTo(e.x, e.y);
  ctx.moveTo(wTop.x, wTop.y);
  ctx.lineTo(sTop.x, sTop.y);
  ctx.lineTo(eTop.x, eTop.y);
  ctx.stroke();
}

export function drawIsoTree(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  radius: number,
) {
  drawIsoEllipse(ctx, sx, sy, radius * 0.9, 'rgba(0, 0, 0, 0.22)');

  ctx.fillStyle = '#5D4037';
  ctx.beginPath();
  ctx.moveTo(sx - 3, sy);
  ctx.lineTo(sx + 3, sy);
  ctx.lineTo(sx + 2, sy - radius * 1.4);
  ctx.lineTo(sx - 2, sy - radius * 1.4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#1B5E20';
  ctx.beginPath();
  ctx.ellipse(sx, sy - radius * 1.55, radius * 1.15, radius * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2E7D32';
  ctx.beginPath();
  ctx.ellipse(sx - radius * 0.15, sy - radius * 1.85, radius * 0.85, radius * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#43A047';
  ctx.beginPath();
  ctx.ellipse(sx + radius * 0.2, sy - radius * 1.7, radius * 0.55, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawIsoRock(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  radius: number,
) {
  drawIsoEllipse(ctx, sx, sy, radius * 0.85, 'rgba(0, 0, 0, 0.2)');
  drawIsoBox(ctx, sx, sy, radius * 0.45, radius * 0.5, {
    top: '#9E9E9E',
    left: '#616161',
    right: '#757575',
  });
}
