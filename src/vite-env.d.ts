/// <reference types="vite/client" />

/** "0.5.3 (2e735c6)": injected at build time (scripts/app-version.mjs). */
declare const __BOZZETTO_VERSION__: string;

/** The files host's origin, VITE_MEDIA_ORIGIN at build time, or '' (vite.config.ts). */
declare const __BOZZETTO_MEDIA_ORIGIN__: string;

/**
 * The QuadriFlow build's content hash (public/quadriflow/, vite.config.ts),
 * asked for as ?v=, so the worker's runtime cache keeps one copy a build.
 */
declare const __QUADRIFLOW_VERSION__: string;
