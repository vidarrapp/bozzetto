import type { LookState } from '../../viewer/Viewer';
import { hexColor } from '../../viewer/color';
import { isProjectId } from '../../net/ids';
import type { SavedLevel, SavedMesh, SavedScene, SceneLink, SculptSettings } from './ScenePersist';
import { DEFAULT_MATERIAL, MATERIAL_ID, type SculptMaterial } from './materials';
import { isCurveId } from './dynamics';
import type { BrushSymmetry } from './symmetry';

/**
 * The one way a scene record comes in: a .bozz file, a shelf entry, a
 * project's file, the autosave. Every field is copied over only if it is
 * what it says it is, unknown fields are left behind, and the result is
 * what the rest of Sculpt reads - so nothing past here has to doubt it.
 *
 * Structure that cannot be mended (arrays of the wrong size, faces that
 * point past the vertices) throws, before anything is swapped in. What
 * can be is mended or dropped: a material with an id that is not one, a
 * colour that is not a colour, a curve that is not a curve, a number that
 * is not finite. Each of those used to throw somewhere later - a numeric
 * material id after the scene was already on screen, a "__proto__" curve
 * in every stroke - and the autosave then kept the record that did it, so
 * every boot after threw again.
 */

/** Utils.TRI_INDEX: the fourth index of a face that is a triangle. */
const TRI_INDEX = 4294967295;
/** Long enough for any name a person types; a file's ten megabytes of one is not a name. */
const MAX_NAME = 200;
/** More materials than anyone makes; a file's million is a denial of service. */
const MAX_MATERIALS = 1024;
/** Tool indices are the vendor's, a few dozen; a key past this is no tool. */
const TOOL_KEY = /^\d{1,3}$/;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** A finite number, clamped to [min, max]; undefined for anything else. */
function num(v: unknown, min = -Infinity, max = Infinity): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const str = (v: unknown, max = MAX_NAME): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : undefined;

function oneOf<T extends string>(v: unknown, options: readonly T[]): T | undefined {
  return options.includes(v as T) ? (v as T) : undefined;
}

/** `#rrggbb`, or undefined for anything that is not a colour. */
const color = (v: unknown): string | undefined => (v === undefined ? undefined : hexColor(v, undefined));

/** Three finite numbers. */
function vec3(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  const out = v.map((x) => num(x));
  return out.every((x) => x !== undefined) ? (out as [number, number, number]) : undefined;
}

/** The fields of `o` that came out defined: absent stays absent, as the record had it. */
function defined<T extends Rec>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** A per-tool table, keyed by vendor tool index, each value through `read`. */
function toolTable<T>(v: unknown, read: (value: unknown) => T | undefined): Record<number, T> | undefined {
  if (!isRec(v)) return undefined;
  const out: Record<number, T> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!TOOL_KEY.test(key)) continue;
    const ok = read(value);
    if (ok !== undefined) out[Number(key)] = ok;
  }
  return out;
}

const fail = (why: string): never => {
  throw new Error(`This scene file is damaged (${why})`);
};

/** A typed array where one belongs: validLevel checks sizes, which a plain array has too. */
const floats = (a: unknown): boolean => a instanceof Float32Array;
const floatsOrNull = (a: unknown): boolean => a === null || a === undefined || a instanceof Float32Array;

function sanitizeLevel(l: SavedLevel, i: number): SavedLevel {
  const n = l.nbVertices;
  if (!Number.isSafeInteger(n) || n <= 0) fail(`level ${i} has no vertices`);
  if (!floats(l.colors) || !floats(l.materials)) fail(`level ${i} has arrays of the wrong kind`);
  if (![l.normals, l.detailsXYZ, l.detailsRGB, l.detailsPBR].every(floatsOrNull)) {
    fail(`level ${i} has arrays of the wrong kind`);
  }
  return {
    nbVertices: n,
    vertices: l.vertices,
    normals: l.normals ?? null,
    colors: l.colors,
    materials: l.materials,
    detailsXYZ: l.detailsXYZ ?? null,
    detailsRGB: l.detailsRGB ?? null,
    detailsPBR: l.detailsPBR ?? null,
  };
}

/**
 * One object. The arrays' sizes were checked against the counts already
 * (validSavedScene); here the counts are checked against each other, and
 * every face against the vertices it names.
 */
function sanitizeMesh(m: SavedMesh, index: number): SavedMesh {
  if (!Number.isSafeInteger(m.nbBaseFaces) || m.nbBaseFaces <= 0) fail(`object ${index + 1} has no faces`);
  if (!Number.isInteger(m.sel)) fail(`object ${index + 1} selects no level`);
  const levels = m.levels.map(sanitizeLevel);
  const nbV = levels[0].nbVertices;
  const faces = m.baseFaces;
  for (let i = 0; i < faces.length; i++) {
    const v = faces[i];
    if (v >= nbV && !(i % 4 === 3 && v === TRI_INDEX)) fail(`object ${index + 1} has a face past its vertices`);
  }
  // A matrix that is not finite puts the object nowhere, and the camera
  // framing it with it: such an object comes back untransformed instead.
  const matrix = Array.prototype.every.call(m.matrix, (x: unknown) => typeof x === 'number' && Number.isFinite(x))
    ? Float32Array.from(m.matrix)
    : new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return defined({
    name: str(m.name),
    nbBaseFaces: m.nbBaseFaces,
    baseFaces: faces,
    levels,
    sel: m.sel,
    matrix,
    sym: vec3(m.sym),
    materialId: typeof m.materialId === 'string' && MATERIAL_ID.test(m.materialId) ? m.materialId : undefined,
    visible: bool(m.visible),
    locked: bool(m.locked),
    painted: bool(m.painted),
  });
}

/**
 * The material list: ids that are ids, once each, colours and values that
 * are colours and values. A material that cannot be read is left out, and
 * an object that used it falls back to the first, as a v3 scene's do.
 */
function sanitizeMaterials(v: unknown): SculptMaterial[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: SculptMaterial[] = [];
  for (const m of v.slice(0, MAX_MATERIALS)) {
    if (!isRec(m) || typeof m.id !== 'string' || !MATERIAL_ID.test(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({
      id: m.id,
      name: str(m.name) || `Material ${m.id.slice(1)}`,
      albedo: hexColor(m.albedo, DEFAULT_MATERIAL.albedo),
      roughness: num(m.roughness, 0, 1) ?? DEFAULT_MATERIAL.roughness,
      metalness: num(m.metalness, 0, 1) ?? DEFAULT_MATERIAL.metalness,
    });
  }
  return out.length ? out : undefined;
}

/** The brush workspace: each table's entries as the readers expect them. */
function sanitizeSettings(v: unknown): SculptSettings | undefined {
  if (!isRec(v)) return undefined;
  const sized = (x: unknown): number | undefined => {
    const n = num(x);
    return n !== undefined && n > 0 ? n : undefined;
  };
  return defined({
    worldScale: v.worldScale === true,
    worldRadius: sized(v.worldRadius),
    radius: toolTable(v.radius, sized),
    dynamics: toolTable(v.dynamics, (d) =>
      isRec(d)
        ? defined({
            size: num(d.size, 0, 1),
            strength: num(d.strength, 0, 1),
            sizeCurve: isCurveId(d.sizeCurve) ? d.sizeCurve : undefined,
            strengthCurve: isCurveId(d.strengthCurve) ? d.strengthCurve : undefined,
            // The switches scenes from before the amounts carry (dynamics.load).
            sizeOn: bool(d.sizeOn),
            strengthOn: bool(d.strengthOn),
          })
        : undefined,
    ) as SculptSettings['dynamics'],
    paintColor: color(v.paintColor),
    spacing: toolTable(v.spacing, sized),
    alphas: toolTable(v.alphas, (a) => (a === null ? null : str(a, 64))),
    rakeAlpha: str(v.rakeAlpha, 64),
    symmetry: toolTable(v.symmetry, (s): BrushSymmetry | undefined => {
      if (!isRec(s)) return undefined;
      const axis = oneOf(s.axis, ['x', 'y', 'z'] as const);
      const on = bool(s.on);
      return axis !== undefined && on !== undefined ? { on, axis } : undefined;
    }),
  });
}

/** A saved light: the fields a light has, each only when it is what it says. */
function sanitizeLight(v: unknown): Rec | undefined {
  if (!isRec(v)) return undefined;
  return defined({
    enabled: bool(v.enabled),
    intensity: num(v.intensity, 0),
    color: color(v.color),
    azimuth: num(v.azimuth),
    elevation: num(v.elevation),
    castShadow: bool(v.castShadow),
    softness: num(v.softness, 0),
  });
}

/**
 * A saved look, reduced to the fields a look has. The viewer checks each
 * value again as it applies it - manifests and armature files come in that
 * way without passing here - so this is the part that keeps a file's
 * extra fields out of the record the autosave writes back.
 */
export function sanitizeLook(v: unknown): Partial<LookState> | undefined {
  if (!isRec(v)) return undefined;
  const sub = (x: unknown): Rec => (isRec(x) ? x : {});
  const light = sub(v.lighting);
  const ambient = sub(light.ambient);
  const material = sub(v.material);
  const env = sub(v.environment);
  const ao = sub(v.ao);
  const sculptAO = sub(v.sculptAO);
  const stage = sub(v.presentation);
  const camera = sub(v.camera);
  const dof = sub(camera.dof);
  const section = (o: Rec): Rec | undefined => (Object.keys(o).length ? o : undefined);
  return defined({
    lighting: isRec(v.lighting)
      ? defined({
          key: sanitizeLight(light.key),
          fill: sanitizeLight(light.fill),
          rim: sanitizeLight(light.rim),
          ambient: isRec(light.ambient)
            ? defined({ intensity: num(ambient.intensity, 0), sky: color(ambient.sky), ground: color(ambient.ground) })
            : undefined,
          rigRotation: num(light.rigRotation),
          shadowsMaster: bool(light.shadowsMaster),
        })
      : undefined,
    material: section(
      defined({
        albedo: color(material.albedo),
        roughness: num(material.roughness, 0, 1),
        metalness: num(material.metalness, 0, 1),
        flatShading: bool(material.flatShading),
        matcapIndex: num(material.matcapIndex, 0, 1000),
      }),
    ),
    environment: isRec(v.environment)
      ? defined({
          v: num(env.v),
          // Kept when null: null is "no environment", which a look can say.
          id: env.id === null ? null : str(env.id, 64),
          intensity: num(env.intensity, 0),
          background: oneOf(env.background, ['theme', 'color', 'hdri'] as const),
          bgColor: color(env.bgColor),
          rotation: num(env.rotation),
          blur: num(env.blur, 0, 1),
          bgBrightness: num(env.bgBrightness, 0),
        })
      : undefined,
    ao: section(defined({ enabled: bool(ao.enabled), intensity: num(ao.intensity, 0), radius: num(ao.radius, 0) })),
    sculptAO: section(defined({ strength: num(sculptAO.strength, 0), radius: num(sculptAO.radius, 0) })),
    presentation: section(
      defined({
        ground: oneOf(stage.ground, ['off', 'shadow', 'floor', 'pedestal'] as const),
        color: color(stage.color),
        roughness: num(stage.roughness, 0, 1),
        metalness: num(stage.metalness, 0, 1),
        pedestalScale: num(stage.pedestalScale, 0.01),
      }),
    ),
    camera: isRec(v.camera)
      ? defined({
          autoFrame: bool(camera.autoFrame),
          position: vec3(camera.position),
          target: vec3(camera.target),
          focalLength: num(camera.focalLength, 1, 10000),
          dof: isRec(camera.dof)
            ? defined({
                enabled: bool(dof.enabled),
                fStop: num(dof.fStop, 0.1),
                focus: num(dof.focus),
                focusPoint: vec3(dof.focusPoint),
              })
            : undefined,
        })
      : undefined,
    materialMode: str(v.materialMode, 32),
    toneMapping: oneOf(v.toneMapping, ['none', 'neutral', 'agx', 'cinematic'] as const),
  }) as Partial<LookState>;
}

function sanitizeLink(v: unknown): SceneLink | undefined {
  if (!isRec(v) || !isProjectId(v.id)) return undefined;
  return { id: v.id, title: str(v.title) ?? v.id, ...(v.scope === 'admin' ? { scope: 'admin' as const } : {}) };
}

/**
 * A structurally valid record (validSavedScene) as Sculpt may use it.
 * Throws when it cannot be mended; see the module comment.
 */
export function sanitizeScene(scene: SavedScene): SavedScene {
  const meshes = scene.meshes.map(sanitizeMesh);
  if (!Number.isInteger(scene.active)) fail('no object is selected');
  return defined({
    v: scene.v,
    savedAt: num(scene.savedAt, 0) ?? Date.now(),
    meshes,
    active: scene.active,
    symmetry: scene.symmetry !== false,
    look: sanitizeLook(scene.look) as LookState | undefined,
    materials: sanitizeMaterials(scene.materials),
    settings: sanitizeSettings(scene.settings),
    project: sanitizeLink(scene.project),
    unsent: isProjectId(scene.unsent) ? scene.unsent : undefined,
  });
}
