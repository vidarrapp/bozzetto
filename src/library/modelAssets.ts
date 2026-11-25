import { BASE_MESHES, BASE_MESH_GROUPS, baseMeshThumbUrl, type BaseMeshInfo } from '../sculpt/bridge/basemeshes';
import { FIGURES } from '../armature/figures';
import { RIG_PRESETS } from '../armature/presets';
import type { PrimitiveKind } from '../sculpt/bridge/SculptSession';
import type { Asset } from './assets';

/**
 * The models the Create choices (Scene panel's menu and empty state) and the Asset library's Models
 * tab are both built from: the primitives, the armatures and the base meshes, in these groups and
 * this order. What choosing one does is the page's (an object added, the armature set).
 */
export type ModelKind = 'primitive' | 'armature' | 'basemesh';

export interface ModelAsset extends Asset {
  kind: ModelKind;
  /** A base mesh's own facts (its note, size and author), for its tile's tooltip. */
  info?: BaseMeshInfo;
}

export interface ModelGroup {
  /** 'primitives', 'armatures', or the base-mesh group ('body', 'head', 'part'). */
  id: string;
  title: string;
  /** The group heading's aside. */
  aside?: string;
  /** A base-mesh group is a sub-heading of the Base meshes section. */
  sub?: boolean;
  items: ModelAsset[];
}

export const PRIMITIVES: ReadonlyArray<{ id: PrimitiveKind; label: string }> = [
  { id: 'sphere', label: 'Sphere' },
  { id: 'cube', label: 'Cube' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'torus', label: 'Torus' },
  { id: 'cone', label: 'Cone' },
  { id: 'capsule', label: 'Capsule' },
  { id: 'plane', label: 'Plane' },
];

/** Where a primitive tile's picture is (tools/render-armature-thumbs.mjs makes them too). */
export function primitiveThumbUrl(id: string): string {
  return `/assets/primitives/thumbs/${id}.png`;
}

/** Where an armature tile's picture is (tools/render-armature-thumbs.mjs makes them). */
export function armatureThumbUrl(id: string): string {
  return `/assets/armature/thumbs/${id}.png`;
}

/** One armature the Create choices offer: each mannequin and placeholder rig the Armature tab's Preset select lists. */
export interface ArmatureChoice {
  id: string;
  label: string;
}

/** The armatures on offer, in the Preset select's order. */
export function armatureChoices(): ArmatureChoice[] {
  return [...RIG_PRESETS, ...FIGURES].map((p) => ({ id: p.id, label: p.label }));
}

/** The groups, in order: Primitives, Armatures, then the base meshes by their groups. */
export function modelGroups(): ModelGroup[] {
  const out: ModelGroup[] = [
    { id: 'primitives', title: 'Primitives', items: PRIMITIVES.map((p) => ({ id: p.id, label: p.label, kind: 'primitive' as const, thumb: primitiveThumbUrl(p.id) })) },
    {
      id: 'armatures',
      title: 'Armatures',
      items: armatureChoices().map((a) => ({ id: a.id, label: a.label, kind: 'armature' as const, thumb: armatureThumbUrl(a.id) })),
    },
  ];
  for (const { group, title } of BASE_MESH_GROUPS) {
    out.push({
      id: group,
      title,
      sub: true,
      items: BASE_MESHES.filter((b) => b.group === group).map((b) => ({ id: b.id, label: b.label, kind: 'basemesh' as const, thumb: baseMeshThumbUrl(b.id), info: b })),
    });
  }
  return out;
}
