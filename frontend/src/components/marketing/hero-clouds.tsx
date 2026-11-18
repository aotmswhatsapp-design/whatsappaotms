"use client";

import { useEffect, useRef } from "react";

/**
 * A volumetric cloud bank behind the hero.
 *
 * One full-screen quad, one `ShaderMaterial`, a single directional light
 * folded into the march as a thin-edge term. There is no volume texture and no
 * model: the fbm is evaluated in the fragment shader, and the depth cue comes
 * from marching through a slab that starts behind the field.
 *
 * Three decisions keep this affordable enough to sit behind a landing page:
 *
 *   1. The canvas is rendered at four tenths of its display size and the
 *      browser upscales it. Clouds are soft, so the upscale is invisible, and
 *      the fragment count drops by more than six times.
 *   2. The loop is capped at 30fps. The bank turns slowly enough that 60 and 30
 *      are indistinguishable, and the cap halves the GPU cost again.
 *   3. Nothing renders while the hero is off screen or the tab is hidden.
 *
 * `three` is imported inside the effect rather than at module scope, so the
 * library never enters the route's initial bundle and cannot delay paint. The
 * canvas is transparent until the first frame lands, and stays transparent if
 * the import fails, the driver refuses a context or the shader will not
 * compile, which makes the hero degrade to its plain field.
 */
const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The march. `STEPS` is injected so a coarse pointer can ask for fewer samples
 * without a second source of truth.
 */
const fragmentShader = (steps: number) => /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform float uAspect;

#define STEPS ${steps}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm(vec3 p) {
  float total = 0.0;
  float amp = 0.5;

  for (int i = 0; i < 4; i++) {
    total += amp * noise(p);
    p = p * 2.03 + vec3(11.3, 7.7, 3.1);
    amp *= 0.5;
  }

  return total;
}

/**
 * One bank, carved rather than grown: a broad fbm body, a finer billow
 * subtracted from it for the puffy edge, and the underside eroded so the bank
 * reads as a deck with a base instead of as fog.
 */
float cloudDensity(vec3 p) {
  vec3 q = p * 0.62 + vec3(uTime * 0.022, uTime * -0.007, uTime * 0.006);

  float body = fbm(q);
  float billow = fbm(q * 2.15 + vec3(19.1, 7.3, 3.7));
  float d = body * 1.32 - billow * 0.46;

  d *= smoothstep(-1.05, -0.30, p.y);

  return d;
}

void main() {
  // World-space position of this pixel on a plane one unit behind the field.
  vec2 st = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);

  vec3 origin = vec3(st * 2.0, -1.6);
  vec3 dir = normalize(vec3(st * 0.55, 1.0));

  // The bank only exists in the upper part of the section: it has to be gone
  // by the time the reader reaches the device.
  float band = smoothstep(0.30, 0.56, vUv.y);

  // And it is dialled back over the column the copy occupies, so the headline
  // and the muted sub-head are never read on a lit cloud.
  // The vertical profile is flat-topped: a plain gaussian still let cloud sit
  // behind the 16px sub-head, which is the most fragile contrast in the
  // section. Written as x*x rather than pow(x, 2.0) because pow with a
  // negative base is undefined in GLSL and some drivers answer with a black
  // frame.
  float nx = (vUv.x - 0.5) / 0.36;
  float ny = clamp(abs(vUv.y - 0.72) - 0.12, 0.0, 1.0) / 0.22;
  float shield = exp(-(nx * nx)) * exp(-(ny * ny));

  float densitySum = 0.0;
  float litSum = 0.0;

  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) / float(STEPS);
    vec3 p = origin + dir * (t * 2.6);

    float d = smoothstep(0.36, 0.60, cloudDensity(p)) * band;

    // Thin parts catch the light, and the top of the bank catches more of it.
    // One term, no second march: at this opacity nobody can tell the difference.
    float lit = clamp(
      pow(max(1.0 - d, 0.0), 1.8) * 0.9 + smoothstep(-0.75, 0.85, p.y) * 0.3,
      0.0, 1.0
    );

    densitySum += d;
    litSum += lit * d;
  }

  // Low absorption on purpose: the core of a cloud has to read as dense rather
  // than as a white patch. Saturation is what turns a volumetric into fog.
  //
  // The shield does not punch a hole in the bank, it pulls the bracket down: the
  // billows keep their shape behind the copy, they just lose opacity and light
  // there, so the pearl headline never sits on a lit cloud and the section does
  // not read as a hole in a cloud field either.
  float alpha = clamp(densitySum * 0.045, 0.0, 0.62) * (1.0 - 0.66 * shield);
  float lit = litSum / max(densitySum, 0.0001) * (1.0 - 0.55 * shield);

  // Shadow sits a shade under the field and high a shade under the paper, so
  // the bank has a body without ever out-shining the headline it sits behind.
  vec3 shadow = vec3(0.024, 0.078, 0.133);
  vec3 high = vec3(0.867, 0.847, 0.804);
  vec3 color = mix(shadow, high, lit);

  // Premultiplied, because that is the context three hands the browser. With
  // a straight colour, a thin cloud carried almost no alpha but its full
  // brightness, and the compositor added the whole of it to the page: the hero
  // washed out to near-white whenever the bank thinned. Multiplying here keeps
  // the contribution proportional to the opacity, so an empty pixel is
  // genuinely empty.
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

export function HeroClouds() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    const boot = async () => {
      const THREE = await import("three").catch(() => null);
      if (!THREE || disposed) return;

      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
          // A decoration should never wake a discrete GPU on a laptop.
          powerPreference: "low-power",
        });
      } catch {
        return;
      }

      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1);

      const uniforms = {
        uTime: { value: 0 },
        uAspect: { value: 1 },
      };

      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: fragmentShader(coarse ? 18 : 24),
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

      const geometry = new THREE.PlaneGeometry(2, 2);
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(geometry, material));
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      const draw = (now: number) => {
        uniforms.uTime.value = now / 1000;
        renderer.render(scene, camera);
      };

      const resize = () => {
        const { width: cssWidth, height: cssHeight } =
          canvas.getBoundingClientRect();
        if (cssWidth === 0 || cssHeight === 0) return;

        // 0.4 rather than 0.33: the billow edges are the whole point of the
        // shape, and at 0.33 the upscale smoothed them back into haze.
        const width = Math.max(
          140,
          Math.min(Math.round(cssWidth * (coarse ? 0.26 : 0.4)), 720),
        );
        const height = Math.max(
          90,
          Math.round(width * (cssHeight / cssWidth)),
        );

        renderer.setSize(width, height, false);
        uniforms.uAspect.value = cssWidth / cssHeight;

        // Under reduced motion nothing ticks, so a resize has to repaint by
        // hand or the layer would vanish on the next orientation change.
        if (reduceMotion) draw(performance.now());
      };

      resize();

      let frame = 0;
      let last = 0;
      let running = false;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        if (now - last < 32) return;
        last = now;
        draw(now);
      };

      let visible = true;
      const sync = () => {
        const should =
          visible && !reduceMotion && document.visibilityState === "visible";

        if (should && !running) {
          running = true;
          frame = requestAnimationFrame(loop);
        } else if (!should && running) {
          running = false;
          cancelAnimationFrame(frame);
        }
      };

      const observer = new IntersectionObserver(
        (entries) => {
          visible = entries[0]?.isIntersecting ?? false;
          sync();
        },
        { rootMargin: "120px" },
      );
      observer.observe(canvas);

      const onVisibilityChange = () => sync();
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("resize", resize);

      // One frame is always painted, reduced motion included: frozen clouds
      // still beat a hole in the page.
      draw(performance.now());
      canvas.dataset.ready = "true";
      sync();

      teardown = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("resize", resize);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
    };

    void boot().catch(() => {
      // No clouds is a valid hero; a thrown import is not worth a broken page.
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-ready="false"
      className="pointer-events-none absolute inset-0 size-full opacity-0 transition-opacity duration-1000 ease-out [mask-image:linear-gradient(to_bottom,#000_54%,transparent_97%)] data-[ready=true]:opacity-100"
    />
  );
}
