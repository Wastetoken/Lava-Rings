"use client";

import { useEffect, useRef } from "react";
import type { FluidPalette } from "./types";

type Pointer = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moved: boolean;
  color: [number, number, number];
};

type RenderTarget = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
};

type DoubleFbo = {
  read: RenderTarget;
  write: RenderTarget;
  swap: () => void;
};

const CONFIG = {
  simResolution: 180,
  dyeResolution: 500,
  densityDissipation: 0.99,
  velocityDissipation: 0.99,
  pressureIterations: 18,
  curl: 60,
  splatRadius: 0.14,
  splatForce: 500,
};

const vertexShader = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const clearShader = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
out vec4 fragColor;
void main() {
  fragColor = value * texture(uTexture, vUv);
}`;

const displayShader = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float alpha;
out vec4 fragColor;
void main() {
  vec3 color = texture(uTexture, vUv).rgb;
  float strength = max(max(color.r, color.g), color.b);
  fragColor = vec4(color, strength * alpha);
}`;

const splatShader = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
out vec4 fragColor;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture(uTarget, vUv).xyz;
  fragColor = vec4(base + splat, 1.0);
}`;

const advectionShader = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
out vec4 fragColor;
vec4 bilerp(sampler2D sam, vec2 uv) {
  vec2 st = uv / texelSize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec2 a = (iuv + vec2(0.5, 0.5)) * texelSize;
  vec2 b = (iuv + vec2(1.5, 0.5)) * texelSize;
  vec2 c = (iuv + vec2(0.5, 1.5)) * texelSize;
  vec2 d = (iuv + vec2(1.5, 1.5)) * texelSize;
  return mix(
    mix(texture(sam, a), texture(sam, b), fuv.x),
    mix(texture(sam, c), texture(sam, d), fuv.x),
    fuv.y
  );
}
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
  fragColor = dissipation * bilerp(uSource, coord);
  fragColor.a = 1.0;
}`;

const divergenceShader = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main() {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  float divergence = 0.5 * (R - L + T - B);
  fragColor = vec4(divergence, 0.0, 0.0, 1.0);
}`;

const curlShader = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main() {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float c = R - L - T + B;
  fragColor = vec4(0.5 * c, 0.0, 0.0, 1.0);
}`;

const vorticityShader = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
out vec4 fragColor;
void main() {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy;
  fragColor = vec4(velocity + force * dt, 0.0, 1.0);
}`;

const pressureShader = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 fragColor;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + T + B - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const gradientSubtractShader = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity -= vec2(R - L, T - B) * 0.5;
  fragColor = vec4(velocity, 0.0, 1.0);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Shader allocation failed.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log ?? "Shader compile error.");
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  fragmentSource: string
) {
  const program = gl.createProgram();
  if (!program) throw new Error("Program allocation failed.");
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log ?? "Program link error.");
  }

  return {
    program,
    uniforms: new Proxy(
      {},
      {
        get: (_, key) =>
          gl.getUniformLocation(program, key as string) ?? undefined,
      }
    ) as Record<string, WebGLUniformLocation | undefined>,
  };
}

function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number
) {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Texture allocation failed.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    width,
    height,
    0,
    format,
    type,
    null
  );
  return texture;
}

function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number
): RenderTarget {
  const texture = createTexture(
    gl,
    width,
    height,
    internalFormat,
    format,
    type,
    filter
  );
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error("Framebuffer allocation failed.");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  return { texture, fbo, width, height };
}

function createDoubleFbo(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number
): DoubleFbo {
  let read = createRenderTarget(
    gl,
    width,
    height,
    internalFormat,
    format,
    type,
    filter
  );
  let write = createRenderTarget(
    gl,
    width,
    height,
    internalFormat,
    format,
    type,
    filter
  );

  return {
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      const temp = read;
      read = write;
      write = temp;
    },
  };
}

function bindTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  unit: number
) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

function nextColor(palette: FluidPalette): [number, number, number] {
  if (palette === "fire") {
    return [1, 0.18 + Math.random() * 0.42, 0.03 + Math.random() * 0.08];
  }
  return [1, 1, 1];
}

export function FluidSimCanvas({
  palette,
  className,
  autoBurst = false,
  overlayOpacity = 1,
  mixBlendMode = "difference",
  splatRadiusScale = 1,
  directionalForceScale = 1,
  curlStrength = CONFIG.curl,
  velocityDissipation = CONFIG.velocityDissipation,
}: {
  palette: FluidPalette;
  className?: string;
  autoBurst?: boolean;
  overlayOpacity?: number;
  mixBlendMode?: React.CSSProperties["mixBlendMode"];
  splatRadiusScale?: number;
  directionalForceScale?: number;
  curlStrength?: number;
  velocityDissipation?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef({
    autoBurst,
    overlayOpacity,
    palette,
    splatRadiusScale,
    directionalForceScale,
    curlStrength,
    velocityDissipation,
  });
  const pointerRef = useRef<Pointer>({
    x: 0.5,
    y: 0.5,
    dx: 0,
    dy: 0,
    moved: false,
    color: nextColor(palette),
  });

  paramsRef.current = {
    autoBurst,
    overlayOpacity,
    palette,
    splatRadiusScale,
    directionalForceScale,
    curlStrength,
    velocityDissipation,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });

    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return;

    const halfFloat = gl.HALF_FLOAT;
    const programs = {
      clear: createProgram(gl, clearShader),
      display: createProgram(gl, displayShader),
      splat: createProgram(gl, splatShader),
      advection: createProgram(gl, advectionShader),
      divergence: createProgram(gl, divergenceShader),
      curl: createProgram(gl, curlShader),
      vorticity: createProgram(gl, vorticityShader),
      pressure: createProgram(gl, pressureShader),
      gradientSubtract: createProgram(gl, gradientSubtractShader),
    };

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    for (const { program } of Object.values(programs)) {
      const attribute = gl.getAttribLocation(program, "aPosition");
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    }

    let velocity: DoubleFbo;
    let density: DoubleFbo;
    let divergence: RenderTarget;
    let curl: RenderTarget;
    let pressure: DoubleFbo;

    const blit = (target: RenderTarget | null) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);

      const simWidth = CONFIG.simResolution;
      const simHeight = Math.round((CONFIG.simResolution * canvas.height) / canvas.width);
      const dyeWidth = CONFIG.dyeResolution;
      const dyeHeight = Math.round((CONFIG.dyeResolution * canvas.height) / canvas.width);

      velocity = createDoubleFbo(gl, simWidth, simHeight, gl.RG16F, gl.RG, halfFloat, gl.LINEAR);
      density = createDoubleFbo(gl, dyeWidth, dyeHeight, gl.RGBA16F, gl.RGBA, halfFloat, gl.LINEAR);
      divergence = createRenderTarget(gl, simWidth, simHeight, gl.R16F, gl.RED, halfFloat, gl.NEAREST);
      curl = createRenderTarget(gl, simWidth, simHeight, gl.R16F, gl.RED, halfFloat, gl.NEAREST);
      pressure = createDoubleFbo(gl, simWidth, simHeight, gl.R16F, gl.RED, halfFloat, gl.NEAREST);
    };

    const splat = (
      x: number,
      y: number,
      dx: number,
      dy: number,
      color: [number, number, number]
    ) => {
      gl.useProgram(programs.splat.program);
      gl.uniform1f(programs.splat.uniforms.aspectRatio!, canvas.width / canvas.height);
      gl.uniform2f(programs.splat.uniforms.point!, x, y);

      gl.viewport(0, 0, velocity.read.width, velocity.read.height);
      gl.uniform1f(
        programs.splat.uniforms.radius!,
        CONFIG.splatRadius * paramsRef.current.splatRadiusScale
      );
      bindTexture(gl, velocity.read.texture, 0);
      gl.uniform1i(programs.splat.uniforms.uTarget!, 0);
      gl.uniform3f(
        programs.splat.uniforms.color!,
        dx * CONFIG.splatForce * paramsRef.current.directionalForceScale,
        -dy * CONFIG.splatForce * paramsRef.current.directionalForceScale,
        0
      );
      blit(velocity.write);
      velocity.swap();

      gl.viewport(0, 0, density.read.width, density.read.height);
      gl.uniform1f(
        programs.splat.uniforms.radius!,
        CONFIG.splatRadius * paramsRef.current.splatRadiusScale
      );
      bindTexture(gl, density.read.texture, 0);
      gl.uniform1i(programs.splat.uniforms.uTarget!, 0);
      gl.uniform3f(
        programs.splat.uniforms.color!,
        color[0] * 1.35,
        color[1] * 1.35,
        color[2] * 1.35
      );
      blit(density.write);
      density.swap();
    };

    const pointer = pointerRef.current;
    const updatePointer = (clientX: number, clientY: number) => {
      const x = clientX / window.innerWidth;
      const y = 1 - clientY / window.innerHeight;
      pointer.dx = x - pointer.x;
      pointer.dy = y - pointer.y;
      pointer.x = x;
      pointer.y = y;
      pointer.color = nextColor(paramsRef.current.palette);
      pointer.moved = true;
    };

    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event.clientX, event.clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      updatePointer(touch.clientX, touch.clientY);
    };

    resize();

    let raf = 0;
    let last = performance.now();
    let burstTime = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.016);
      last = now;
      burstTime += dt;

      gl.disable(gl.BLEND);

      if (pointer.moved) {
        splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
        pointer.moved = false;
      }

      if (paramsRef.current.autoBurst && burstTime > 0.085) {
        burstTime = 0;
        splat(
          0.2 + Math.random() * 0.6,
          0.2 + Math.random() * 0.6,
          (Math.random() - 0.5) * 0.06,
          (Math.random() - 0.5) * 0.06,
          nextColor("fire")
        );
      }

      gl.viewport(0, 0, curl.width, curl.height);
      gl.useProgram(programs.curl.program);
      gl.uniform2f(programs.curl.uniforms.texelSize!, 1 / velocity.read.width, 1 / velocity.read.height);
      bindTexture(gl, velocity.read.texture, 0);
      gl.uniform1i(programs.curl.uniforms.uVelocity!, 0);
      blit(curl);

      gl.useProgram(programs.vorticity.program);
      gl.uniform2f(programs.vorticity.uniforms.texelSize!, 1 / velocity.read.width, 1 / velocity.read.height);
      gl.uniform1f(programs.vorticity.uniforms.curl!, paramsRef.current.curlStrength);
      gl.uniform1f(programs.vorticity.uniforms.dt!, dt);
      bindTexture(gl, velocity.read.texture, 0);
      gl.uniform1i(programs.vorticity.uniforms.uVelocity!, 0);
      bindTexture(gl, curl.texture, 1);
      gl.uniform1i(programs.vorticity.uniforms.uCurl!, 1);
      blit(velocity.write);
      velocity.swap();

      gl.viewport(0, 0, divergence.width, divergence.height);
      gl.useProgram(programs.divergence.program);
      gl.uniform2f(programs.divergence.uniforms.texelSize!, 1 / velocity.read.width, 1 / velocity.read.height);
      bindTexture(gl, velocity.read.texture, 0);
      gl.uniform1i(programs.divergence.uniforms.uVelocity!, 0);
      blit(divergence);

      gl.useProgram(programs.clear.program);
      bindTexture(gl, pressure.read.texture, 0);
      gl.uniform1i(programs.clear.uniforms.uTexture!, 0);
      gl.uniform1f(programs.clear.uniforms.value!, 0.97);
      blit(pressure.write);
      pressure.swap();

      gl.useProgram(programs.pressure.program);
      gl.uniform2f(programs.pressure.uniforms.texelSize!, 1 / pressure.read.width, 1 / pressure.read.height);
      bindTexture(gl, divergence.texture, 1);
      gl.uniform1i(programs.pressure.uniforms.uDivergence!, 1);
      for (let i = 0; i < CONFIG.pressureIterations; i += 1) {
        bindTexture(gl, pressure.read.texture, 0);
        gl.uniform1i(programs.pressure.uniforms.uPressure!, 0);
        blit(pressure.write);
        pressure.swap();
      }

      gl.useProgram(programs.gradientSubtract.program);
      gl.uniform2f(
        programs.gradientSubtract.uniforms.texelSize!,
        1 / velocity.read.width,
        1 / velocity.read.height
      );
      bindTexture(gl, pressure.read.texture, 0);
      gl.uniform1i(programs.gradientSubtract.uniforms.uPressure!, 0);
      bindTexture(gl, velocity.read.texture, 1);
      gl.uniform1i(programs.gradientSubtract.uniforms.uVelocity!, 1);
      blit(velocity.write);
      velocity.swap();

      gl.viewport(0, 0, velocity.read.width, velocity.read.height);
      gl.useProgram(programs.advection.program);
      gl.uniform2f(programs.advection.uniforms.texelSize!, 1 / velocity.read.width, 1 / velocity.read.height);
      gl.uniform1f(programs.advection.uniforms.dt!, dt);
      gl.uniform1f(
        programs.advection.uniforms.dissipation!,
        paramsRef.current.velocityDissipation
      );
      bindTexture(gl, velocity.read.texture, 0);
      gl.uniform1i(programs.advection.uniforms.uVelocity!, 0);
      bindTexture(gl, velocity.read.texture, 1);
      gl.uniform1i(programs.advection.uniforms.uSource!, 1);
      blit(velocity.write);
      velocity.swap();

      gl.viewport(0, 0, density.read.width, density.read.height);
      gl.uniform2f(programs.advection.uniforms.texelSize!, 1 / density.read.width, 1 / density.read.height);
      gl.uniform1f(programs.advection.uniforms.dissipation!, CONFIG.densityDissipation);
      bindTexture(gl, velocity.read.texture, 0);
      gl.uniform1i(programs.advection.uniforms.uVelocity!, 0);
      bindTexture(gl, density.read.texture, 1);
      gl.uniform1i(programs.advection.uniforms.uSource!, 1);
      blit(density.write);
      density.swap();

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(programs.display.program);
      bindTexture(gl, density.read.texture, 0);
      gl.uniform1i(programs.display.uniforms.uTexture!, 0);
      gl.uniform1f(programs.display.uniforms.alpha!, paramsRef.current.overlayOpacity);
      blit(null);
    };

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ mixBlendMode, opacity: overlayOpacity }}
    />
  );
}
