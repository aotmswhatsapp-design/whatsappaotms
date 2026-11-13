"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const VERTEX_SOURCE = `
  attribute vec4 a_position;
  void main() {
    gl_Position = a_position;
  }
`;

const FRAGMENT_SOURCE = `
precision mediump float;

uniform vec2 iResolution;
uniform float iTime;
uniform vec2 iMouse;
uniform vec3 u_color;

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 centeredUV = (2.0 * fragCoord - iResolution.xy) / min(iResolution.x, iResolution.y);

    float time = iTime * 0.5;

    // Mouse arrives normalised to 0..1, remapped to -1..1 for the ripple.
    vec2 mouse = iMouse / iResolution;
    vec2 rippleCenter = 2.0 * mouse - 1.0;

    vec2 distortion = centeredUV;
    // Wavy, smokey domain warp.
    for (float i = 1.0; i < 8.0; i++) {
        distortion.x += 0.5 / i * cos(i * 2.0 * distortion.y + time + rippleCenter.x * 3.1415);
        distortion.y += 0.5 / i * cos(i * 2.0 * distortion.x + time + rippleCenter.y * 3.1415);
    }

    float wave = abs(sin(distortion.x + distortion.y + time));
    float glow = smoothstep(0.9, 0.2, wave);

    fragColor = vec4(u_color * glow, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

/** Time the shader freezes on when the visitor asks for reduced motion. */
const STILL_TIME = 11.5;

type SmokeyBackgroundProps = {
  /**
   * Sheen colour as `#rrggbb`, composited with `screen` over the orange plate.
   * Darker values lift the plate less, so the smoke stays a suggestion.
   */
  color?: string;
  blur?: "none" | "sm" | "md" | "lg";
  className?: string;
};

const blurClass: Record<NonNullable<SmokeyBackgroundProps["blur"]>, string> = {
  none: "backdrop-blur-none",
  sm: "backdrop-blur-sm",
  md: "backdrop-blur-md",
  lg: "backdrop-blur-lg",
};

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return [0, 0, 0];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compilation failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * WebGL "smokey" field screened over a brand-orange plate. The shader is black
 * wherever the glow is zero, and `screen` leaves the plate untouched there, so
 * only the ridges show — as a soft sheen drifting across the orange rather than
 * the dark sheet the shader produces on its own.
 *
 * The pointer never touches React state: it lands in a ref that the animation
 * frame reads, which keeps the loop from being torn down and rebuilt (and
 * re-compiled) on every mouse move.
 */
export function SmokeyBackground({
  color = "#ea580c",
  blur = "sm",
  className,
}: SmokeyBackgroundProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    // No WebGL: the plate behind the canvas is already the fallback.
    if (!gl) return;

    const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link failed:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uTime = gl.getUniformLocation(program, "iTime");
    const uMouse = gl.getUniformLocation(program, "iMouse");
    const uColor = gl.getUniformLocation(program, "u_color");

    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(uColor, r, g, b);

    // Device pixels keep the wave scale identical on a retina and a 1x display.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frame = 0;
    let startedAt = 0;

    const draw = (now: number) => {
      frame = 0;
      if (!startedAt) startedAt = now;

      const pointer = pointerRef.current;
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, still ? STILL_TIME : (now - startedAt) / 1000);
      gl.uniform2f(
        uMouse,
        (pointer?.x ?? 0.5) * canvas.width,
        (pointer?.y ?? 0.5) * canvas.height,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!still) frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (frame) return;
      frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerRef.current = {
        x: (event.clientX - rect.left) / rect.width,
        // WebGL's origin is bottom-left, so flip the vertical axis.
        y: (rect.bottom - event.clientY) / rect.height,
      };
    };

    const onPointerLeave = () => {
      pointerRef.current = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      start();
    };

    resize();
    start();

    const observer = new ResizeObserver(() => {
      resize();
      if (still) start();
    });
    observer.observe(canvas);

    // Listen on the window, not the canvas: the surface sits behind the form and
    // never takes pointer events, but the ripple should still follow the cursor.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [color]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden bg-[#ea580c]",
        className,
      )}
    >
      {/* Brand-orange plate with a warm highlight at the top so the field has
          depth instead of reading as flat paint. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(130%_100%_at_50%_0%,#f97316_0%,#ea580c_42%,#cf4e0c_100%)]"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full mix-blend-screen"
      />
      {/* Edges settle a little deeper, but stay in the orange family. Pushing
          this toward black is what turns a bright field brown. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(115%_95%_at_50%_45%,transparent_50%,rgba(88,28,5,0.45)_100%)]"
      />
      <div aria-hidden="true" className={cn("absolute inset-0", blurClass[blur])} />
    </div>
  );
}
