/**
 * Bloom post-processing filter for the Pixi v8 renderer.
 *
 * Replaces the Canvas2D BloomRenderer (blur(12px) + lighter composite) with
 * a single GPU shader pass that:
 *   1. Extracts bright fragments (luminance above a threshold).
 *   2. Applies a fast 9-tap Gaussian blur approximation.
 *   3. Additively composites the bloom contribution back.
 *
 * The result closely matches the Canvas2D bloom at full GPU speed.
 *
 * Usage:
 *   const bloom = new PixiBloomFilter()
 *   stage.filters = [bloom.filter]
 *   bloom.setIntensity(0.6)
 *
 * Tunable uniforms:
 *   - uIntensity: bloom strength (0..1, default 0.6)
 *   - uThreshold: luminance floor below which fragments don't bloom (0..1, default 0.3)
 *   - uBlurSize: texel spread for the blur kernel (default 4.0, roughly matches 12px at half-res)
 */

import { Filter, GlProgram } from 'pixi.js'

// ── Vertex shader ───────────────────────────────────────────────────────
// Standard passthrough -- Filter provides the projection + position.
// `#version 300 es` opts into ES 3.00 syntax (in/out, texture()) — without it
// Pixi v8 falls back to ES 1.00 emulation and this shader fails to compile.
const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`

// ── Fragment shader ─────────────────────────────────────────────────────
const FRAGMENT = `#version 300 es
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uIntensity;
uniform float uThreshold;
uniform float uBlurSize;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);

    // ── 9-tap Gaussian blur (separable approximation in one pass) ────
    // Sample in a cross pattern weighted by a 1D Gaussian kernel.
    // This is cheaper than a true 2D kernel but visually close enough
    // for a bloom effect.
    vec2 texel = uInputSize.zw * uBlurSize;

    // Horizontal samples
    vec4 blur = color * 0.2270270270;
    blur += texture(uTexture, vTextureCoord + vec2(texel.x * 1.3846153846, 0.0)) * 0.3162162162;
    blur += texture(uTexture, vTextureCoord - vec2(texel.x * 1.3846153846, 0.0)) * 0.3162162162;
    blur += texture(uTexture, vTextureCoord + vec2(texel.x * 3.2307692308, 0.0)) * 0.0702702703;
    blur += texture(uTexture, vTextureCoord - vec2(texel.x * 3.2307692308, 0.0)) * 0.0702702703;

    // Vertical samples
    blur += texture(uTexture, vTextureCoord + vec2(0.0, texel.y * 1.3846153846)) * 0.3162162162;
    blur += texture(uTexture, vTextureCoord - vec2(0.0, texel.y * 1.3846153846)) * 0.3162162162;
    blur += texture(uTexture, vTextureCoord + vec2(0.0, texel.y * 3.2307692308)) * 0.0702702703;
    blur += texture(uTexture, vTextureCoord - vec2(0.0, texel.y * 3.2307692308)) * 0.0702702703;

    // Normalize (we summed horizontal center + 4 horizontal + 4 vertical = 9 taps,
    // but the center was counted once. Total weight ~1.567 for horizontal,
    // plus 0.773 for vertical = ~2.34. Divide to normalize.)
    blur /= 2.34;

    // ── Bright-pass: extract fragments above the luminance threshold ──
    float lum = dot(blur.rgb, vec3(0.299, 0.587, 0.114));
    float bright = smoothstep(uThreshold, uThreshold + 0.2, lum);

    // ── Additive composite ───────────────────────────────────────────
    vec4 bloom = blur * bright * uIntensity;
    finalColor = color + bloom;
}
`

/**
 * Pixi v8 bloom post-processing filter.
 * Wraps a custom GLSL filter with a `setIntensity()` API matching
 * the Canvas2D BloomRenderer.
 */
export class PixiBloomFilter {
  readonly filter: Filter
  private intensity: number

  constructor(intensity = 0.6) {
    this.intensity = Math.max(0, Math.min(1, intensity))

    const glProgram = GlProgram.from({
      vertex: VERTEX,
      fragment: FRAGMENT,
    })

    this.filter = new Filter({
      glProgram,
      resources: {
        bloomUniforms: {
          uIntensity: { value: this.intensity, type: 'f32' },
          uThreshold: { value: 0.3, type: 'f32' },
          uBlurSize: { value: 4.0, type: 'f32' },
        },
      },
      // The bloom blur extends beyond the source rect
      padding: 16,
      // Half resolution for performance (matches Canvas2D bloom's 0.5 scale)
      resolution: 0.5,
    })
  }

  /** Set bloom intensity (0..1). Matches BloomRenderer.setIntensity API. */
  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity))
    this.filter.resources.bloomUniforms.uniforms.uIntensity = this.intensity
  }

  /** Get current bloom intensity. */
  getIntensity(): number {
    return this.intensity
  }

  /** Set the luminance threshold below which fragments don't bloom. */
  setThreshold(threshold: number): void {
    this.filter.resources.bloomUniforms.uniforms.uThreshold = Math.max(0, Math.min(1, threshold))
  }

  /** Set blur kernel spread (in texels). Higher = wider bloom. */
  setBlurSize(size: number): void {
    this.filter.resources.bloomUniforms.uniforms.uBlurSize = Math.max(0, size)
  }

  /** Release GPU resources. */
  dispose(): void {
    this.filter.destroy()
  }
}
