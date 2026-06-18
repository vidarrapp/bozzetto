/// <reference types="vite/client" />

// Build flag (vite `define`): true in the app builds, false in the single-file
// embed. Gating the reel capture import on it tree-shakes the encoders (and
// their deps) out of the embed, which never exposes the editor-only recorder.
declare const __REEL_CAPTURE__: boolean;
