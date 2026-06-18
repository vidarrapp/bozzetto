import {
  DepthTexture,
  type IUniform,
  MeshBasicMaterial,
  NoBlending,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  UniformsUtils,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BokehShader as BokehShader2 } from 'three/examples/jsm/shaders/BokehShader2.js';

export interface Dof2Quality {
  /** Concentric sample rings — more is smoother but costlier. */
  rings: number;
  /** Samples on the first ring (scaled up per ring). */
  samples: number;
}

/**
 * Realistic depth of field via three.js' BokehShader2 (Martins Upitis' "bokeh
 * v2"). Unlike the simple BokehPass, the circle of confusion is derived from the
 * lens — focal length (mm), f-stop and a focal-plane distance — which fits the
 * viewer's lens-driven camera and gives rounded, gently highlight-bloomed bokeh
 * without v1's highlight ringing.
 *
 * The shader reads raw non-linear depth and linearizes it with the camera clips,
 * so each frame the pass renders scene depth into a DepthTexture (a cheap
 * depth-only override), then composites the bokeh over the colour from the prior
 * passes. The lens uniforms (fstop, focalLength, focalDepth, maxblur) are driven
 * by the Viewer.
 */
export class Dof2Pass extends Pass {
  readonly uniforms: Record<string, IUniform>;
  private readonly material: ShaderMaterial;
  private readonly fsQuad: FullScreenQuad;
  private readonly depthTarget: WebGLRenderTarget;
  private readonly depthMaterial: MeshBasicMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    quality: Dof2Quality = { rings: 3, samples: 4 },
  ) {
    super();

    this.depthTarget = new WebGLRenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) });
    this.depthTarget.texture.name = 'Dof2Pass.scratch';

    // Depth-only override: writes the depth buffer (→ DepthTexture) without
    // shading. Colour is irrelevant — the shader samples the depth texture.
    this.depthMaterial = new MeshBasicMaterial();
    this.depthMaterial.colorWrite = false;
    this.depthMaterial.blending = NoBlending;

    const uniforms: Record<string, IUniform> = UniformsUtils.clone(
      BokehShader2.uniforms as unknown as Record<string, IUniform>,
    );
    uniforms.tDepth.value = this.depthTarget.depthTexture;
    uniforms.manualdof.value = 0; // physical CoC from focalLength/fstop
    uniforms.shaderFocus.value = 0; // use the focalDepth uniform, not a screen point
    uniforms.showFocus.value = 0;
    uniforms.vignetting.value = 0;
    uniforms.depthblur.value = 0;
    uniforms.pentagon.value = 0;
    uniforms.noise.value = 1; // grain masks banding across the blur gradient
    uniforms.dithering.value = 0.0001;
    uniforms.fringe.value = 0.7; // faint chromatic fringing on the bokeh edges
    uniforms.maxblur.value = 1; // overall blur scale; driven per-frame by the Viewer
    this.uniforms = uniforms;

    this.material = new ShaderMaterial({
      defines: { RINGS: quality.rings, SAMPLES: quality.samples },
      uniforms,
      vertexShader: BokehShader2.vertexShader,
      fragmentShader: BokehShader2.fragmentShader,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    // 1. Capture scene depth (background excluded → stays at the far plane).
    const prevBackground = this.scene.background;
    const prevOverride = this.scene.overrideMaterial;
    this.scene.background = null;
    this.scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = prevOverride;
    this.scene.background = prevBackground;

    // 2. Drive the per-frame uniforms from the colour buffer and camera clips.
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.textureWidth.value = readBuffer.width;
    this.uniforms.textureHeight.value = readBuffer.height;
    this.uniforms.znear.value = this.camera.near;
    this.uniforms.zfar.value = this.camera.far;

    // 3. Composite the bokeh over the colour buffer.
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  override setSize(width: number, height: number): void {
    this.depthTarget.setSize(width, height);
    this.uniforms.textureWidth.value = width;
    this.uniforms.textureHeight.value = height;
  }

  override dispose(): void {
    this.depthTarget.dispose();
    this.depthMaterial.dispose();
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
