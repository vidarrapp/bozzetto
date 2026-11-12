/**
 * Everything the app ships that is not Bozzetto's own, for the About and
 * credits topic. THIRD_PARTY_NOTICES.md is the full legal text and stays
 * the record: each name here is a heading there (a bracket after it left
 * out), and an e2e check reads that file and fails when one is missing.
 */
export interface Credit {
  /** The heading in THIRD_PARTY_NOTICES.md, without its bracket. */
  name: string;
  /** What Bozzetto uses it for. */
  use: string;
  licence: string;
  /** Where to find it, or its licence text. */
  url?: string;
  /** More that the licence or the maker asks to be said. */
  note?: string;
}

export interface CreditGroup {
  /** The "##" heading in THIRD_PARTY_NOTICES.md. */
  title: string;
  credits: Credit[];
}

export const CREDIT_GROUPS: CreditGroup[] = [
  {
    title: 'Code',
    credits: [
      {
        name: 'three.js',
        use: 'Draws everything on screen, on WebGPU or WebGL 2.',
        licence: 'MIT, copyright three.js authors',
        url: 'https://threejs.org/',
      },
      {
        name: 'SculptGL',
        use: "Sculpt mode's editing core, by Stéphane Ginier, vendored in this app and modified.",
        licence: 'MIT',
        url: 'https://github.com/stephomi/sculptgl',
      },
      {
        name: 'gl-matrix',
        use: 'The vector and matrix maths of the SculptGL core, by Brandon Jones and Colin MacKenzie IV.',
        licence: 'MIT',
        url: 'https://glmatrix.net',
      },
      {
        name: 'gifenc',
        use: 'Saves GIF files, by Matt DesLauriers.',
        licence: 'MIT',
        url: 'https://github.com/mattdesl/gifenc',
      },
      {
        name: 'Mediabunny',
        use: 'Saves MP4 files, by Vanilagy and contributors. Used unmodified.',
        licence: 'Mozilla Public License 2.0',
        url: 'https://mediabunny.dev/',
      },
      {
        name: 'Uicons by Flaticon',
        use: "The icons of the Sculpt toolbar and panels (the solid straight set), and the Flatten icon, Flaticon's scraper icon.",
        licence: 'Flaticon License, free of charge with attribution',
        url: 'https://www.flaticon.com/uicons',
        note: 'Icons: Uicons by Flaticon.',
      },
      {
        name: 'SimpleWebAuthn',
        use: 'Passkey sign-in, by Matthew Miller.',
        licence: 'MIT',
        url: 'https://simplewebauthn.dev/',
      },
      {
        name: 'client-zip',
        use: 'Builds the zip files of Download my data and of frames, by David Junger.',
        licence: 'MIT',
        url: 'https://github.com/Touffy/client-zip',
      },
      {
        name: 'QuadriFlow',
        use: 'Runs Quad remesh, compiled to WebAssembly. By Jingwei Huang, Yichao Zhou, Matthias Niessner, Jonathan Shewchuk and Leonidas Guibas.',
        licence: 'BSD-3-Clause',
        url: 'https://github.com/hjwdzh/QuadriFlow',
      },
      {
        name: 'LEMON 1.3.1',
        use: "The graph library behind QuadriFlow's flow solvers, compiled in with it.",
        licence: 'Boost Software License 1.0',
        url: 'https://lemon.cs.elte.hu/',
      },
      {
        name: 'pcg32',
        use: "Wenzel Jakob's small version of Melissa O'Neill's PCG random number generator, compiled in with QuadriFlow.",
        licence: 'Apache License 2.0',
        url: 'https://github.com/wjakob/pcg32',
      },
      {
        name: 'Eigen 3.4.0',
        use: 'The linear algebra templates QuadriFlow is written in, compiled in from their headers.',
        licence: 'Mozilla Public License 2.0 (only the parts under it are used)',
        url: 'https://eigen.tuxfamily.org',
      },
      {
        name: 'Boost Graph Library',
        use: 'The maximum flow solver QuadriFlow uses, with the Boost headers it includes.',
        licence: 'Boost Software License 1.0',
        url: 'https://www.boost.org',
      },
      {
        name: "Emscripten's runtime",
        use: 'Compiles QuadriFlow to WebAssembly. The loader is its JavaScript runtime, and the wasm carries the parts of its system libraries the code uses: musl, libc++, libc++abi and compiler-rt.',
        licence: 'MIT or University of Illinois/NCSA (Emscripten, musl); Apache-2.0 with the LLVM exception (libc++, libc++abi, compiler-rt)',
        url: 'https://emscripten.org',
      },
      {
        name: 'Not compiled in',
        use: "QuadriFlow's parallel stable sort (3rd/pss, Intel, BSD-3-Clause) and its SAT solver (MapleCOMSPS_LRB) are not in what ships.",
        licence: 'Not applicable',
      },
      {
        name: 'Bundled with the Functions',
        use: "The server side of passkeys brings @peculiar/asn1-schema, @peculiar/asn1-x509, @peculiar/x509, asn1js, reflect-metadata and tslib. They run on the servers and ship to no user.",
        licence: 'MIT, BSD-3-Clause, Apache-2.0 and 0BSD',
      },
      {
        name: 'Workbox',
        use: 'The service worker that keeps the installed web app working offline, by Google, built in by vite-plugin-pwa.',
        licence: 'MIT',
        url: 'https://developer.chrome.com/docs/workbox',
      },
    ],
  },
  {
    title: 'Fonts',
    credits: [
      {
        name: 'Fonts',
        use: 'Familjen Grotesk and Martian Mono are the typefaces of the interface.',
        licence: 'SIL Open Font License 1.1',
        url: 'https://openfontlicense.org',
        note: 'Familjen Grotesk: The Familjen Grotesk Project Authors. Martian Mono: The Martian Mono Project Authors.',
      },
    ],
  },
  {
    title: 'Models and images',
    credits: [
      {
        name: 'Human Base Meshes (Blender Studio)',
        use: 'The base meshes of the Create menu and the mannequins of Armature mode. Made by Dan Ulrich, Julien Kaspar, Paul Kotelevets and Tonatiuh de San Julián.',
        licence: 'CC0 1.0 (public domain dedication)',
        url: 'https://www.blender.org/download/demo-files/#asset-bundles',
      },
      {
        name: 'Environment maps (HDRIs)',
        use: 'The six environment maps of the Render panel, from Poly Haven: Neutral studio, Photo studio, Soft overcast, Warm interior, Garage and Outdoor plaza.',
        licence: 'CC0 1.0 (public domain dedication)',
        url: 'https://polyhaven.com/hdris',
      },
      {
        name: 'Other images',
        use: "The matcaps vr01.png to vr10.png are the owner's own work. The clay matcap is generated by the project's sample script.",
        licence: "The owner's own work",
      },
    ],
  },
];
