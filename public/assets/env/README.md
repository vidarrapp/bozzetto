# Environment maps (HDRIs)

Drop HDRI environment maps here. They drive **image-based lighting**: diffuse
irradiance + reflections on the Lit (PBR) material, and (optionally) the
background.

## Format & size — what I want

- **Resolution: 2k** (2048×1024 equirectangular). Plenty for lighting — PMREM
  prefilters it down at load anyway. 1k is fine if you want lighter downloads.
- **Format: `.hdr` (Radiance RGBE) preferred.** Roughly half the download size
  of EXR for identical IBL quality, and three.js's most battle-tested env
  loader. **`.exr` is also supported** (picked up by extension) — but EXR files
  are heavier to download, so choose HDR where you can.
- **Source: Poly Haven (CC0)** is ideal — grab the **2k HDR** export.

These are downloaded by *visitors*, so weight matters: a 2k `.hdr` is ~4–10 MB.
The quality tier will skip/limit environments on low-end/mobile.

## Naming

Pick any **3** and name them exactly (so the picker finds them). `.exr` instead
of `.hdr` is fine — keep the same base name.

| File                 | Label          |
| -------------------- | -------------- |
| `studio-neutral.hdr` | Neutral studio |
| `studio-photo.hdr`   | Photo studio   |
| `overcast.hdr`       | Soft overcast  |
| `interior-warm.hdr`  | Warm interior  |
| `garage.hdr`         | Garage         |
| `plaza.hdr`          | Outdoor plaza  |

Upload your 3 here (commit them, or use GitHub's upload), tell me which, and the
environment picker shows them. Entries without a file are hidden automatically.
