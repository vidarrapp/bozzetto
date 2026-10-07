# Desktop app: building and releasing

Downloading and using the app is in the [README](../README.md#desktop-app), running the web app from source in [development.md](development.md), and deploying it in [deployment.md](deployment.md).

## Building

```bash
npm run desktop        # build and run
npm run dist:desktop   # package for the host platform, into release/
```

Each installer format has to be built on (or for) its own platform:

| Target | Where it builds | Notes |
| --- | --- | --- |
| Linux AppImage | anywhere | `npx electron-builder --linux AppImage` |
| Windows portable | anywhere | `npx electron-builder --win --dir` gives `release/win-unpacked` with `Bozzetto.exe` — zip and ship |
| Windows installer | Windows, or Linux with wine | `npx electron-builder --win nsis`; without wine it fails with `spawn wine ENOENT` |
| macOS dmg | macOS only | Apple's tooling cannot be cross-run |

The app carries its licence and the credits for what it bundles:
`LICENSE` and `THIRD_PARTY_NOTICES.md` sit in its resources folder
(`Bozzetto.app/Contents/Resources` on macOS, `resources` beside the program
on Windows and Linux).

## Fuses

The packaged app does not run as Node when `ELECTRON_RUN_AS_NODE` is set,
ignores `NODE_OPTIONS` and `--inspect`, loads its code from its own archive
only, checks that archive on macOS and Windows before using it, keeps its
cookies (the server sign-in among them) encrypted on disk, and gives `file:`
pages no extra rights. These are Electron's fuses, set under
`build.electronFuses` in `package.json`; the desktop suite, given a packaged
build with `--app`, reads them back from the binary. Builds are unsigned, so
the build signs the Mac app ad hoc again after setting them, as a Mac needs to
open it.

## Releasing

`.github/workflows/release.yml` builds all three platforms and attaches the
installers to a GitHub Release. The version comes from `package.json`, and the
tag must match it. Releases are made from `main` only. Either push the tag:

```bash
npm version 0.1.0        # bumps package.json and commits and tags v0.1.0
git push --follow-tags   # the tag push starts the release build
```

or run **Release desktop** from the **Actions** tab on `main` with the version
filled in, and the workflow tags `main` itself. A pushed tag whose commit is
not on `main`, or a version filled in on any other branch, stops the run
before anything is built.

The workflow opens a draft release and builds on all three platforms. A
separate job then signs build provenance for every installer, and the last
one puts the installers and a `SHA256SUMS` file on the draft and publishes
the release once all of them are there (a failure anywhere leaves it a draft
to look at). A file already on a release is never replaced, and a published
release is never changed: to fix one, release a new version. The macOS build
is universal, one app for Apple Silicon and Intel. The site's Install card
reads the latest published release, so it picks the new version up on its
own; edit the generated notes on GitHub whenever you like.

Run it from the **Actions** tab with the version left empty to test a build,
from any branch; that path publishes nothing and leaves the installers as
downloadable artifacts, attested like a release's. No secrets to configure:
it uses the token Actions provides, and only the two jobs that write the
release can write with it. The builders can only read the repository, run no
install scripts, and give electron-builder no token at all.

To check a download, compare its SHA-256 with its line in the release's
`SHA256SUMS`, and verify its provenance with the
[GitHub CLI](https://cli.github.com/), which also shows the commit and the
workflow run that built it:

```bash
sha256sum Bozzetto-0.1.0.AppImage    # macOS: shasum -a 256 <file>; Windows: Get-FileHash <file>
gh attestation verify Bozzetto-0.1.0.AppImage -R vidarrapp/bozzetto
```

Builds are unsigned. macOS Gatekeeper and Windows SmartScreen will warn until
you add a Developer ID certificate and notarization (macOS) or a code-signing
certificate (Windows). For signing in CI, set `CSC_LINK` and
`CSC_KEY_PASSWORD` as repository secrets, pass them to the workflow's
Package step, and drop the `CSC_IDENTITY_AUTO_DISCOVERY: false` line there.

## Known issue: a stall after signing in

After signing in to a server, the app can stop responding for a few minutes on
some machines when v-sync is off. Turning **V-sync** on under
**Edit → Preferences → Desktop** avoids it, and the README tells users so.

It is open. With `--disable-frame-rate-limit` (v-sync off) the main process's
UI thread blocks, in a wait inside Chromium, once the sign-in window is
destroyed after input or a second copy's file handoff has reached the app, for
a minute and a half to over four. DevTools, which the desktop suite drives the
app through, blocks with it, so the suite runs the packaged app with V-sync on,
unlike a new install; the page itself carries on and has its answer. It has
been reproduced only under Xvfb with SwiftShader, and 0.5.4 does the same.

What would confirm it on real hardware: v-sync off, a `.bozz` double-clicked
into the running app, then **Server → Sign In**. The app stops answering
(menus, Save) once the sign-in window has closed, and the same steps with
V-sync on do not. We are looking for reports of this from real hardware.
