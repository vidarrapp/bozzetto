import GTAONode from 'three/examples/jsm/tsl/display/GTAONode.js';
import type { Camera, Node, NodeBuilder, UniformNode } from 'three/webgpu';
import {
  Fn,
  Loop,
  PI,
  acos,
  add,
  clamp,
  cos,
  cross,
  div,
  dot,
  float,
  getScreenPosition,
  getViewPosition,
  int,
  length,
  logarithmicDepthToViewZ,
  mat3,
  max,
  mix,
  mul,
  nodeObject,
  normalize,
  pow,
  sin,
  sqrt,
  sub,
  textureSize,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
} from 'three/tsl';

/** What three's GTAONode keeps to itself, and this subclass's shader needs. */
interface GTAOInternals {
  depthNode: Node;
  normalNode: Node;
  _cameraNear: Node;
  _cameraFar: Node;
  _cameraProjectionMatrix: Node;
  _cameraProjectionMatrixInverse: Node;
  _noiseNode: Node;
  _temporalDirection: Node;
  _material: { fragmentNode: Node; needsUpdate: boolean };
  _textureNode: Node;
}

// TSL's generated typings are far narrower than what the node system
// accepts at run time; the shader below is three's own, so it is written
// against loose types rather than cast at every call.
type N = any;
const loop: N = Loop;
const texSize: N = textureSize;

/**
 * three's Ground-Truth AO (r184) with one thing changed: how far a sample
 * may be from the point it shades and still count as an occluder.
 *
 * three counts a sample in full whenever its view-space depth is within
 * `thickness` of the point, and not at all past it. That binary test drew
 * the "ugly black outlines" (owner report): the floor beside a sphere and
 * the cheek behind an ear took the full weight of an occluder that stood
 * well clear of them, so a hard-edged band traced each silhouette, and the
 * effect stopped dead where the depth gap crossed the threshold (the
 * "cut-off" seen across the walls of a box room). Here a sample counts by
 * its 3D distance instead, in full out to `1 - falloff` of the radius and
 * fading to nothing at the radius, as Intel's XeGTAO does. An occluder
 * beyond the radius in any direction - in front, behind or to the side -
 * no longer darkens anything, and the term fades out instead of ending.
 *
 * The rest - the horizon search, the slice integral, the step falloff, the
 * noise - is three's code as it stands, so `thickness` goes unused.
 */
class SoftGTAONode extends GTAONode {
  /**
   * The outer fraction of the radius over which an occluder fades out
   * (0..1). XeGTAO fades over 0.6 of it; with three's sampling that found
   * about 40% of the occlusion the old test did at the same radius in a box
   * room, part of the difference the old halos and part real. Over 0.35 a
   * radius reaches about as far as it used to, without the edge.
   */
  readonly falloff: UniformNode<'float', number> = uniform(0.35) as unknown as UniformNode<'float', number>;

  /**
   * Leave the AO texture as the last pass drew it (Viewer.updateFrameMode).
   * Under a stroke the camera holds still, so last frame's occlusion is
   * this frame's everywhere but under the brush, and skipping the pass is
   * the whole of its cost. Only the pass is skipped: nothing in the graph
   * changes, so nothing is rebuilt, recompiled or reallocated either way.
   */
  skip = false;
  /** Passes drawn since the viewer was built (the latency suite counts them). */
  renders = 0;

  override updateBefore(frame: Parameters<GTAONode['updateBefore']>[0]): boolean | undefined {
    // undefined, not false: false asks the frame to try the node again.
    if (this.skip) return undefined;
    this.renders++;
    return super.updateBefore(frame);
  }

  override setup(builder: NodeBuilder): N {
    const self = this as unknown as GTAOInternals & GTAONode;
    const uvNode: N = uv();

    const sampleDepth = (at: N): N => {
      const depth: N = (self.depthNode as N).sample(at).r;
      if ((builder as N).renderer.logarithmicDepthBuffer === true) {
        const viewZ = logarithmicDepthToViewZ(depth, self._cameraNear as N, self._cameraFar as N);
        return viewZToPerspectiveDepth(viewZ, self._cameraNear as N, self._cameraFar as N);
      }
      return depth;
    };
    const sampleNoise = (at: N): N => (self._noiseNode as N).sample(at);
    const sampleNormal = (at: N): N => (self.normalNode as N).sample(at).rgb.normalize();
    const falloff = this.falloff as N;

    const occlusion = Fn(() => {
      const depth: N = sampleDepth(uvNode).toVar();
      depth.greaterThanEqual(1.0).discard();

      const viewPosition: N = getViewPosition(uvNode, depth, self._cameraProjectionMatrixInverse as N).toVar();
      const viewNormal: N = sampleNormal(uvNode).toVar();
      const radiusToUse: N = this.radius;

      const noiseResolution: N = texSize(self._noiseNode, 0);
      let noiseUv: N = vec2(uvNode.x, uvNode.y.oneMinus());
      noiseUv = noiseUv.mul((this.resolution as N).div(noiseResolution));
      const noiseTexel: N = sampleNoise(noiseUv);
      const randomVec: N = noiseTexel.xyz.mul(2.0).sub(1.0);
      const tangent: N = vec3(randomVec.xy, 0.0).normalize();
      const bitangent: N = vec3(tangent.y.mul(-1.0), tangent.x, 0.0);
      const kernelMatrix: N = mat3(tangent, bitangent, vec3(0.0, 0.0, 1.0));

      const samples: N = this.samples;
      const DIRECTIONS: N = samples.lessThan(30).select(3, 5).toVar();
      const STEPS: N = add(samples, DIRECTIONS.sub(1)).div(DIRECTIONS).toVar();
      const ao: N = float(0).toVar();

      loop({ start: int(0), end: DIRECTIONS, type: 'int', condition: '<' }, ({ i }: N) => {
        const angle: N = float(i).div(float(DIRECTIONS)).mul(PI).add(self._temporalDirection as N).toVar();
        const sampleDir: N = vec4(cos(angle), sin(angle), 0, add(0.5, mul(0.5, noiseTexel.w)));
        sampleDir.xyz = normalize(kernelMatrix.mul(sampleDir.xyz));

        const viewDir: N = normalize(viewPosition.xyz.negate()).toVar();
        const sliceBitangent: N = normalize(cross(sampleDir.xyz, viewDir)).toVar();
        const sliceTangent: N = cross(sliceBitangent, viewDir);
        const normalInSlice: N = normalize(viewNormal.sub(sliceBitangent.mul(dot(viewNormal, sliceBitangent))));
        const tangentToNormalInSlice: N = cross(normalInSlice, sliceBitangent).toVar();
        const cosHorizons: N = vec2(
          dot(viewDir, tangentToNormalInSlice),
          dot(viewDir, tangentToNormalInSlice.negate()),
        ).toVar();

        loop({ end: STEPS, type: 'int', name: 'j', condition: '<' }, ({ j }: N) => {
          const sampleViewOffset: N = sampleDir.xyz
            .mul(radiusToUse)
            .mul(sampleDir.w)
            .mul(pow(div(float(j).add(1.0), float(STEPS)), this.distanceExponent as N));
          const stepWeight: N = mix(1.0, float(2.0).div(float(j).add(2)), this.distanceFallOff as N);

          // Both ways along the slice, as three marches them.
          const march = (offset: N, horizon: N): void => {
            const screen: N = getScreenPosition(viewPosition.add(offset), self._cameraProjectionMatrix as N).toVar();
            const depthAt: N = sampleDepth(screen).toVar();
            const sceneView: N = getViewPosition(screen, depthAt, self._cameraProjectionMatrixInverse as N).toVar();
            const delta: N = sceneView.sub(viewPosition).toVar();
            const dist: N = length(delta).toVar();
            // CHANGED: three gates this on `abs( delta.z ).lessThan( thickness )`.
            const reach: N = clamp(radiusToUse.sub(dist).div(radiusToUse.mul(falloff).max(1e-6)), 0, 1);
            const sampleCosHorizon: N = dot(viewDir, delta.div(dist.max(1e-6)));
            horizon.addAssign(max(0, mul(sampleCosHorizon.sub(horizon), stepWeight.mul(reach))));
          };
          march(sampleViewOffset, cosHorizons.x);
          march(sampleViewOffset.negate(), cosHorizons.y);
        });

        const sinHorizons: N = sqrt(sub(1.0, cosHorizons.mul(cosHorizons))).toVar();
        const nx: N = dot(normalInSlice, sliceTangent);
        const ny: N = dot(normalInSlice, viewDir);
        const nxb: N = mul(
          0.5,
          acos(cosHorizons.y)
            .sub(acos(cosHorizons.x))
            .add(sinHorizons.x.mul(cosHorizons.x).sub(sinHorizons.y.mul(cosHorizons.y))),
        );
        const nyb: N = mul(0.5, sub(2.0, cosHorizons.x.mul(cosHorizons.x)).sub(cosHorizons.y.mul(cosHorizons.y)));
        ao.addAssign(nx.mul(nxb).add(ny.mul(nyb)));
      });

      ao.assign(clamp(ao.div(DIRECTIONS), 0, 1));
      ao.assign(pow(ao, this.scale as N));
      return ao;
    });

    self._material.fragmentNode = (occlusion() as N).context((builder as N).getSharedContext());
    self._material.needsUpdate = true;
    return self._textureNode;
  }
}

/** GTAO with a distance falloff in place of three's thickness test (see SoftGTAONode). */
export function softAo(depthNode: Node, normalNode: Node, camera: Camera): SoftGTAONode {
  return new SoftGTAONode(nodeObject(depthNode as N) as N, nodeObject(normalNode as N) as N, camera);
}

export type { SoftGTAONode };
