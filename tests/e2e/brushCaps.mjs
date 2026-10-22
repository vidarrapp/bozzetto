// Flatten and Paint at full pen pressure. The pressure dynamics double a
// brush's strength at a full press, so the 0.75 default reaches 1.5; past
// 1 upstream's Flatten carried a vertex through the plane (a dent later
// dabs skip) and Paint's blend extrapolated past the colour. The bridge
// caps both at 1 (FlattenBrush, PaintBrush in src/sculpt/bridge/tools.ts).
// Each check makes one dab through the live tools on the plane primitive,
// and the same dab through the upstream loop as a control: it must be the
// one that overshoots, or the check proves nothing.
import { openForInput } from './smoke.mjs';

/**
 * In the page: the plane primitive at level 0 alone in reach (everything
 * else moved well aside), symmetry off, and one dab of the current tool at
 * full pressure on the vertex nearest the plane's centre. `prep(mesh, i)`
 * readies the patch before the dab; `upstream` swaps in the vendored loop
 * (`method`) for the dab. Returns what `read(mesh, i)` reads after it.
 */
function dabInPage({ method, upstream, kind }) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(input.currentToolIndex());
  let plane = session.getMeshes().find((m) => m.__brushCapsPlane);
  if (!plane) {
    plane = session.addPrimitive('plane');
    while (session.deleteHighestLevel());
    plane.__brushCapsPlane = true;
    for (const m of session.getMeshes()) if (m !== plane) m.getMatrix()[12] += 50;
  }
  session.setMesh(plane);
  const v = plane.getVertices();
  const n = plane.getNbVertices();
  let centre = 0;
  for (let i = 0, best = Infinity; i < n; i++) {
    const d = v[i * 3] ** 2 + v[i * 3 + 1] ** 2;
    if (d < best) [best, centre] = [d, i];
  }
  const ind = centre * 3;
  // A flat patch, uniformly coloured, with the centre vertex lifted.
  const lift = 0.04;
  for (let i = 0; i < n; i++) v[i * 3 + 2] = 0;
  const c = plane.getColors();
  const old = [0.2, 0.4, 0.9];
  for (let i = 0; i < n; i++) c.set(old, i * 3);
  if (kind === 'flatten') v[ind + 2] = lift;
  plane.updateGeometry();
  plane.updateDuplicateColorsAndMaterials();
  plane.updateBuffers?.();
  const target = [0.9, 0.05, 0.1];
  if (kind === 'paint') tool._color.set(target);

  // Aim at the centre vertex, as the camera sees it.
  const m = plane.getMatrix();
  const p = [v[ind], v[ind + 1], v[ind + 2]];
  const w = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
  const [x, y] = session.getCamera().project(w);

  const symmetry = manager._symmetry;
  const ownLoop = tool[method];
  manager._symmetry = false;
  tool._intensity = 0.75;
  input.dynamics.get(input.currentToolIndex()).strength = 1;
  input.dynamics.get(input.currentToolIndex()).strengthCurve = 'linear';
  tablet.pressure = 1;
  if (upstream) tool[method] = Object.getPrototypeOf(Object.getPrototypeOf(tool))[method];
  let intensity = null;
  try {
    session._mouseX = x;
    session._mouseY = y;
    const hit = manager.start(false);
    const picking = session.getPicking();
    const hitPlane = hit && picking.getMesh() === plane;
    intensity = tool._intensity * tablet.getPressureIntensity();
    tool.makeStroke(x, y, picking, null);
    tool.updateRender();
    manager.end();
    session.getStateManager().cleanNoop();
    const mAr = plane.getMaterials();
    return {
      hitPlane,
      intensity,
      lift,
      z: v[ind + 2],
      old,
      target,
      color: Array.from(c.subarray(ind, ind + 3)),
      material: Array.from(mAr.subarray(ind, ind + 3)),
    };
  } finally {
    if (upstream) tool[method] = ownLoop;
    tablet.pressure = 0.5;
    manager._symmetry = symmetry;
  }
}

const within = (val, a, b, eps = 1e-6) => val >= Math.min(a, b) - eps && val <= Math.max(a, b) + eps;

export const suites = {
  async brushCaps(page, base, t) {
    await openForInput(page, base);

    // Flatten (6): the lifted vertex comes down to the plane, never through it.
    await page.keyboard.press('6');
    const flat = await page.evaluate(dabInPage, { method: 'flatten', upstream: false, kind: 'flatten' });
    t.ok(flat.hitPlane && Math.abs(flat.intensity - 1.5) < 1e-9, `the Flatten dab lands on the plane at slider 0.75, full pressure: intensity ${flat.intensity}`);
    t.ok(flat.z >= -1e-6, `Flatten at full pressure leaves the lifted vertex at or above the plane (z ${flat.z})`);
    t.ok(flat.z < flat.lift * 0.5, `and still brings it most of the way down (z ${flat.z} from ${flat.lift})`);
    const flatUp = await page.evaluate(dabInPage, { method: 'flatten', upstream: true, kind: 'flatten' });
    t.ok(flatUp.z < -1e-4, `control: the upstream loop, same dab, carries it through the plane (z ${flatUp.z})`);

    // Paint (0): every channel ends between the old colour and the paint's.
    await page.keyboard.press('0');
    const settings = await page.evaluate(() => {
      const { session, input } = window.__sculpt;
      const tool = session.getSculptManager().getTool(input.currentToolIndex());
      return { roughness: tool._writeRoughness, metalness: tool._writeMetalness, spacing: tool._spacing, fill: typeof tool.paintAll };
    });
    t.ok(settings.roughness === false && settings.metalness === false && settings.spacing === 0.05 && settings.fill === 'function', `the capped Paint keeps the app's settings: colour only, spacing 0.05, the fill (${JSON.stringify(settings)})`);
    const paint = await page.evaluate(dabInPage, { method: 'paint', upstream: false, kind: 'paint' });
    t.ok(paint.hitPlane && Math.abs(paint.intensity - 1.5) < 1e-9, `the Paint dab lands on the plane at slider 0.75, full pressure: intensity ${paint.intensity}`);
    t.ok(
      paint.color.every((ch, k) => within(ch, paint.old[k], paint.target[k])),
      `Paint at full pressure leaves every channel between the old colour and the paint's (${paint.color.map((ch) => ch.toFixed(4)).join(', ')})`,
    );
    t.ok(paint.color.every((ch, k) => Math.abs(ch - paint.target[k]) < Math.abs(paint.old[k] - paint.target[k]) * 0.5), 'and lays most of the colour down');
    t.ok(within(paint.material[0], 0, 1) && within(paint.material[1], 0, 1), `and roughness and metalness stay in range (${paint.material.slice(0, 2).join(', ')})`);
    const paintUp = await page.evaluate(dabInPage, { method: 'paint', upstream: true, kind: 'paint' });
    t.ok(
      paintUp.color.some((ch, k) => !within(ch, paintUp.old[k], paintUp.target[k], 1e-4)),
      `control: the upstream loop, same dab, paints past the colour (${paintUp.color.map((ch) => ch.toFixed(4)).join(', ')})`,
    );
  },
};
