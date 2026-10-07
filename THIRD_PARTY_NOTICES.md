# Third-party notices

Bozzetto itself is MIT-licensed; see [LICENSE](LICENSE). It ships the
third-party code and assets below, in the web app (the site, the installed
app and exported single-file pages) and in the desktop app. Each entry says
what ships, under which licence, and carries the notice text that licence
asks to be kept with copies.

Build tools that do not end up in what ships (TypeScript, Vite, Wrangler,
electron-builder and the rest of `devDependencies`) are not listed.

## Code

### three.js

`three` 0.184.0, <https://threejs.org/>. MIT.

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### SculptGL (vendored, modified)

Sculpt mode's editing core, from <https://github.com/stephomi/sculptgl>,
vendored and modified in `src/sculpt/vendor/` (its licence is
`src/sculpt/vendor/LICENSE`). MIT.

```text
MIT License

Copyright (c) 2019 Stéphane GINIER

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### gl-matrix

`gl-matrix` 3.4.4, <https://glmatrix.net>, used by the SculptGL core. MIT.

```text
Copyright (c) 2015-2025, Brandon Jones, Colin MacKenzie IV.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### gifenc

`gifenc` 1.0.3, <https://github.com/mattdesl/gifenc>, the GIF export. MIT.

```text
The MIT License (MIT)
Copyright (c) 2017 Matt DesLauriers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
```

### Mediabunny

`mediabunny` 1.48.1, <https://mediabunny.dev/>, the MP4 export. Mozilla
Public License 2.0.

```text
Copyright (c) 2026-present, Vanilagy and contributors

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
```

Bozzetto uses Mediabunny unmodified, exactly as published on npm. Its
Source Code Form is available from the project's repository at
<https://github.com/Vanilagy/mediabunny/tree/v1.48.1> and from the npm
package <https://www.npmjs.com/package/mediabunny/v/1.48.1>. The full text of
the licence is at <https://mozilla.org/MPL/2.0/>. The MPL covers Mediabunny's
files only; it does not extend to the rest of Bozzetto.

### Uicons by Flaticon

`@flaticon/flaticon-uicons` 3.3.1, <https://www.flaticon.com/uicons>: the
sculpt toolbar's icon font (solid straight and thin straight). Also
`src/sculpt/ui/icons/flatten.svg`, Flaticon's "scraper" icon (19010200).
Used under the Flaticon License, free of charge with attribution:

**Icons: Uicons by [Flaticon](https://www.flaticon.com/uicons).**

The licence text shipped in the npm package:

```text
Flaticon License

By means of these Terms, the Company grants the User a Flaticon License under which the User is authorized to download, use and modify the Flaticon Content on a device owned or controlled by the User on a non-transferable, limited, exclusive, revocable and worldwide basis for the entire duration of the rights and solely for the purposes and uses authorized under these Terms.

Without prejudice to the provisions set forth in paragraph 3 of this clause, the User of a Flaticon License may use the content in the Flaticon Content, provided that the Flaticon Content is not used in printed or electronic items (e.g. t-shirts, cups, postcards, birthday or greeting cards, invitations, calendars, web models or electronic devices, apps, NFTs, videogames, advertising spots, audiovisual animations) aimed to be resold, in which the Flaticon Content is the main element (because of size, relevance or any other cause, in case of doubt about whether the content is main element, it shall be deemed that the content is main element);

Furthermore, the authorization to use the content in the Flaticon Content shall be free of charge under the Flaticon License where any use thereof by the User is done by duly crediting said content to the Website/Company and, in any event, to the Collaborator, as stated by the Company from time to time. In order to benefit from the Service of using the Flaticon Content without the aforementioned crediting, the User must purchase a subscription (hereinafter the "Premium Subscription") from the Website and download the relevant Flaticon Content during the term of said Premium Subscription. The terms set forth in Section 9 shall apply to the purchase of the Premium Subscription.

Where any content of the Flaticon Content is marked or identified as being for editorial use, or where within the same there are distinctive signs, recognizable products, public buildings, public events or images taken in places where recognizable persons appear in the background, the User shall only be entitled to use it for such editorial use; in other words, for purposes related to exercising freedom of expression and the right to information or for academic or educational purposes. More specifically, this means that the User undertakes not to use said content in any way that could imply a link to any business activity, use in the course of trade or the advertising, promotion or marketing of any product or service. In addition, the User shall ensure that any use for educational purposes is allowed under any legislation which applies and shall fulfill any requirements set forth by such legislation, including, but not limited to, citation obligations or limitations on the extent or purpose of said use. The User shall be directly liable for, and the Company shall not assume any liability resulting from the use for commercial purposes by the User of any content in the Flaticon Content whose use must be limited to editorial use as set forth in this paragraph or as a consequence of any editorial use that is contrary to the legislation which applies.

More information about the Term and Conditions of use on https://www.freepikcompany.com/legal?#nav-flaticon
```

### SimpleWebAuthn

Passkeys are handled by `@simplewebauthn/browser` (in the web app) and
`@simplewebauthn/server` (in the Functions), both by Matthew Miller. MIT.

```text
MIT License

Copyright (c) 2020 Matthew Miller

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### client-zip

"Download my data" and the frames zips are assembled in the browser by
`client-zip`, by David Junger <tffy@free.fr>. MIT.

```text
Copyright 2020 David Junger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Bundled with the Functions (server only)

The Functions bundle brings `@simplewebauthn/server`'s own
dependencies, which run on Cloudflare's servers and ship to no user:
`@peculiar/asn1-schema`, `@peculiar/asn1-x509` and `@peculiar/x509`
(MIT), `asn1js` (BSD-3-Clause), `reflect-metadata` (Apache-2.0) and
`tslib` (0BSD). Their licence texts are in `node_modules/` under each
package.

### Workbox (web app only)

The service worker that keeps the installed web app working offline is
generated by `vite-plugin-pwa` and runs Google's Workbox 7. MIT.

```text
Copyright 2018 Google LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Electron and Chromium (desktop app only)

The desktop app is built on Electron (MIT), which embeds Chromium and the
libraries it uses, each under its own licence. Every desktop build carries
Electron's licence as `LICENSE.electron.txt` and Chromium's as
`LICENSES.chromium.html`: beside the executable on Windows and Linux, and in
`Bozzetto.app/Contents/Resources` on macOS.

## Fonts

Instrument Serif, JetBrains Mono and Manrope, in `public/assets/fonts/`, are
under the SIL Open Font License 1.1. Each font's copyright line and the full
licence are in `public/assets/fonts/licenses/`, which ships beside the fonts
in both apps.

## Models and images

### Human Base Meshes (Blender Studio)

The base meshes in `public/assets/basemeshes/` and the mannequins in
`public/assets/armature/` come from Blender Studio's Human Base Meshes bundle
v1.4.1, <https://www.blender.org/download/demo-files/#asset-bundles>, released
under CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>). CC0
asks for no notice; the credit is given anyway. Made by Dan Ulrich, Julien
Kaspar, Paul Kotelevets and Tonatiuh de San Julián. Each folder's
`LICENSE.txt` says which pieces came from whom and how they were exported.

### Environment maps (HDRIs)

The six environment maps in `public/assets/env/` are from
[Poly Haven](https://polyhaven.com/hdris), published under CC0 1.0
(public domain dedication), resized for the web and saved again from
Adobe Photoshop, which is why two of the files name it. CC0 asks for no
notice; the credit is given anyway.

- `studio-neutral.hdr` (Neutral studio; also precached by the installed web app)
- `studio-photo.hdr` (Photo studio)
- `overcast.hdr` (Soft overcast)
- `interior-warm.hdr` (Warm interior)
- `garage.hdr` (Garage)
- `plaza.hdr` (Outdoor plaza)

### Other images

The matcaps `vr01.png` to `vr10.png` in `public/assets/matcaps/` are the
owner's own work. The rake stencils `rake01.png` to `rake09.png` in
`public/assets/alphas/` are the owner's own edits (see
`src/sculpt/bridge/alphas.ts`).

The clay stencils `clay01.png` and `clay02.png` are the owner's own
photographs, and `clay.png` is generated by `scripts/generate-sample.mjs`.
