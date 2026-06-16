import { ShaderChunk } from 'three';

/**
 * Optional PCSS (percentage-closer soft shadows) as an A/B alternative to VSM,
 * selected with `?shadows=pcss`. PCF-based, so no variance light-bleed; the
 * penumbra varies with blocker distance and is driven by the per-light
 * shadowRadius (our "Softness") + shadowMapSize, so it's independent of scene
 * scale. Patches the global shadow shader chunk; call installPCSS() before any
 * shadowed material compiles, and use PCFShadowMap (not VSM).
 */
export function shadowMode(): 'vsm' | 'pcss' {
  return new URLSearchParams(location.search).get('shadows') === 'pcss' ? 'pcss' : 'vsm';
}

// Inserted before getShadow(). Uses unpackRGBAToDepth / rand / PI2 from earlier
// chunks. `pcssDisk` is reinitialised per call (cheap, a handful of lights).
const PCSS_GLSL = /* glsl */ `
#ifndef PCSS_SAMPLES
#define PCSS_SAMPLES 16
#define PCSS_RINGS 11
#endif

vec2 pcssDisk[ PCSS_SAMPLES ];

void pcssInit( const in vec2 seed ) {
	float angleStep = PI2 * float( PCSS_RINGS ) / float( PCSS_SAMPLES );
	float inv = 1.0 / float( PCSS_SAMPLES );
	float angle = rand( seed ) * PI2;
	float radius = inv;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		pcssDisk[ i ] = vec2( cos( angle ), sin( angle ) ) * pow( radius, 0.75 );
		radius += inv;
		angle += angleStep;
	}
}

float pcssBlocker( sampler2D shadowMap, vec2 uv, float zReceiver, float searchRadius ) {
	float sum = 0.0;
	float count = 0.0;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		float d = unpackRGBAToDepth( texture2D( shadowMap, uv + pcssDisk[ i ] * searchRadius ) );
		if ( d < zReceiver ) { sum += d; count += 1.0; }
	}
	return count > 0.0 ? sum / count : -1.0;
}

float pcssFilter( sampler2D shadowMap, vec2 uv, float zReceiver, float filterRadius ) {
	float sum = 0.0;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		float d = unpackRGBAToDepth( texture2D( shadowMap, uv + pcssDisk[ i ] * filterRadius ) );
		sum += step( zReceiver, d );
	}
	return sum / float( PCSS_SAMPLES );
}

float PCSS( sampler2D shadowMap, vec2 shadowMapSize, float shadowRadius, vec4 shadowCoord ) {
	vec2 uv = shadowCoord.xy;
	float zReceiver = shadowCoord.z;
	float lightSizeUV = max( shadowRadius, 1.0 ) / shadowMapSize.x;
	pcssInit( uv );
	float avgBlocker = pcssBlocker( shadowMap, uv, zReceiver, lightSizeUV );
	if ( avgBlocker < 0.0 ) return 1.0;
	float penumbra = ( zReceiver - avgBlocker ) / avgBlocker;
	float filterRadius = clamp( penumbra * lightSizeUV * 12.0, lightSizeUV * 0.5, lightSizeUV * 8.0 );
	return pcssFilter( shadowMap, uv, zReceiver, filterRadius );
}
`;

let installed = false;

export function installPCSS(): void {
  if (installed) return;
  installed = true;

  let chunk = ShaderChunk.shadowmap_pars_fragment;
  chunk = chunk.replace(
    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
    `${PCSS_GLSL}\nfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {`,
  );
  // Return PCSS at the top of the PCF branch (the rest becomes dead code).
  chunk = chunk.replace(
    '#if defined( SHADOWMAP_TYPE_PCF )',
    '#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\treturn PCSS( shadowMap, shadowMapSize, shadowRadius, shadowCoord );\n',
  );
  ShaderChunk.shadowmap_pars_fragment = chunk;
}
