/**
 * The placeholder rigs the Preset select and the Scene panel's Create choices offer, as data
 * alone: the page reads this without loading Armature's code (rig.ts re-exports it).
 */
export const RIG_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'placeholder-male', label: 'Male (placeholder blocks)' },
  { id: 'placeholder-female', label: 'Female (placeholder blocks)' },
];
