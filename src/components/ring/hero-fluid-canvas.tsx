"use client";

import { useEffect, useRef } from "react";

type HeroFluidCanvasProps = {
  simResolution?: number;
  dyeResolution?: number;
  densityDissipation?: number;
  velocityDissipation?: number;
  pressure?: number;
  pressureIterations?: number;
  curl?: number;
  splatRadius?: number;
  splatForce?: number;
  className?: string;
};

type Fbo = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  attach: (id: number) => number;
};

type DoubleFbo = {
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  read: Fbo;
  write: Fbo;
  swap: () => void;
};

export function HeroFluidCanvas({
  simResolution = 180,
  dyeResolution = 500,
  densityDissipation = 0.99,
  velocityDissipation = 0.99,
  pressure = 1,
  pressureIterations = 18,
  curl = 60,
  splatRadius = 0.14,
  splatForce = 500,
  className,
}: HeroFluidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetCanvas = canvas;

    const cfg = {
      SIM_RESOLUTION: simResolution,
      DYE_RESOLUTION: dyeResolution,
      DENSITY_DISSIPATION: densityDissipation,
      VELOCITY_DISSIPATION: velocityDissipation,
      PRESSURE: pressure,
      PRESSURE_ITERATIONS: pressureIterations,
      CURL: curl,
      SPLAT_RADIUS: splatRadius,
      SPLAT_FORCE: splatForce,
    };

    const params = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    } as const;

    const initialGl =
      (targetCanvas.getContext("webgl2", params) as WebGL2RenderingContext | null) ??
      ((targetCanvas.getContext("webgl", params) ||
        targetCanvas.getContext("experimental-webgl", params)) as WebGL2RenderingContext | null);

    if (!initialGl) return;
    const gl = initialGl;

    const isWebGL2 = targetCanvas.getContext("webgl2", params) != null;
    let halfFloatExt: OES_texture_half_float | null = null;
    let supportLinearFiltering: OES_texture_float_linear | OES_texture_half_float_linear | null =
      null;

    if (isWebGL2) {
      gl.getExtension("EXT_color_buffer_float");
      supportLinearFiltering = gl.getExtension("OES_texture_float_linear");
    } else {
      halfFloatExt = gl.getExtension("OES_texture_half_float");
      supportLinearFiltering = gl.getExtension("OES_texture_half_float_linear");
    }

    gl.clearColor(0, 0, 0, 0);
    const halfFloatTexType = isWebGL2
      ? gl.HALF_FLOAT
      : halfFloatExt
        ? halfFloatExt.HALF_FLOAT_OES
        : gl.UNSIGNED_BYTE;

    function supportRenderTextureFormat(
      internalFormat: number,
      format: number,
      type: number
    ) {
      const texture = gl.createTexture();
      const fbo = gl.createFramebuffer();
      if (!texture || !fbo) return false;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      return status;
    }

    function getSupportedFormat(internalFormat: number, format: number, type: number) {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        if (internalFormat === (gl as WebGL2RenderingContext).R16F) {
          return getSupportedFormat((gl as WebGL2RenderingContext).RG16F, (gl as WebGL2RenderingContext).RG, type);
        }
        if (internalFormat === (gl as WebGL2RenderingContext).RG16F) {
          return getSupportedFormat((gl as WebGL2RenderingContext).RGBA16F, gl.RGBA, type);
        }
        return null;
      }
      return { internalFormat, format };
    }

    const formatRGBA = isWebGL2
      ? getSupportedFormat((gl as WebGL2RenderingContext).RGBA16F, gl.RGBA, halfFloatTexType)
      : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
    const formatRG = isWebGL2
      ? getSupportedFormat((gl as WebGL2RenderingContext).RG16F, (gl as WebGL2RenderingContext).RG, halfFloatTexType)
      : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
    const formatR = isWebGL2
      ? getSupportedFormat((gl as WebGL2RenderingContext).R16F, (gl as WebGL2RenderingContext).RED, halfFloatTexType)
      : getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);

    if (!formatRGBA || !formatRG || !formatR) return;
    const rgba = formatRGBA;
    const rg = formatRG;
    const r = formatR;

    const baseVertexShader = `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    const copyShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; void main(){ gl_FragColor = texture2D(uTexture, vUv); }`;
    const clearShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value; void main(){ gl_FragColor = value * texture2D(uTexture, vUv); }`;
    const displayShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uTexture; void main(){ vec3 c = texture2D(uTexture, vUv).rgb; float a = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c, a); }`;
    const splatShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius; void main(){ vec2 p = vUv - point.xy; p.x *= aspectRatio; vec3 splat = exp(-dot(p, p) / radius) * color; vec3 base = texture2D(uTarget, vUv).xyz; gl_FragColor = vec4(base + splat, 1.0); }`;
    const advectionShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;
      vec4 bilerp(sampler2D sam, vec2 uv, vec2 tSize) {
        vec4 st;
        st.xy = floor(uv / tSize - 0.5) + 0.5;
        st.zw = st.xy + 1.0;
        vec4 uvCoords = st * tSize.xyxy;
        vec4 a = texture2D(sam, uvCoords.xy);
        vec4 b = texture2D(sam, uvCoords.zy);
        vec4 c = texture2D(sam, uvCoords.xw);
        vec4 d = texture2D(sam, uvCoords.zw);
        vec2 f = fract(uv / tSize - 0.5);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          gl_FragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          gl_FragColor = dissipation * texture2D(uSource, coord);
        #endif
        gl_FragColor.a = 1.0;
      }
    `;
    const divergenceShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity; void main(){ float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x; float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y; vec2 C = texture2D(uVelocity, vUv).xy; if(vL.x < 0.0){ L = -C.x; } if(vR.x > 1.0){ R = -C.x; } if(vT.y > 1.0){ T = -C.y; } if(vB.y < 0.0){ B = -C.y; } float div = 0.5 * (R - L + T - B); gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }`;
    const curlShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity; void main(){ float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y; float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x; float vorticity = R - L - T + B; gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0); }`;
    const vorticityShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt; void main(){ float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x; float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x; float C = texture2D(uCurl, vUv).x; vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0; vec2 vel = texture2D(uVelocity, vUv).xy; gl_FragColor = vec4(vel + force * dt, 0.0, 1.0); }`;
    const pressureShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uPressure; uniform sampler2D uDivergence; void main(){ float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x; float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x; float divergence = texture2D(uDivergence, vUv).x; float p = (L + R + B + T - divergence) * 0.25; gl_FragColor = vec4(p, 0.0, 0.0, 1.0); }`;
    const gradientSubtractShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uPressure; uniform sampler2D uVelocity; void main(){ float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x; float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x; vec2 vel = texture2D(uVelocity, vUv).xy; vel.xy -= vec2(R - L, T - B); gl_FragColor = vec4(vel, 0.0, 1.0); }`;

    function addKeywords(source: string, keywords?: string[] | null) {
      if (!keywords) return source;
      return `${keywords.map((keyword) => `#define ${keyword}\n`).join("")}${source}`;
    }

    function compileShader(type: number, source: string, keywords?: string[] | null) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("shader");
      gl.shaderSource(shader, addKeywords(source, keywords));
      gl.compileShader(shader);
      return shader;
    }

    function createProgram(vertSrc: string, fragSrc: string, keywords?: string[] | null) {
      const program = gl.createProgram();
      if (!program) throw new Error("program");
      gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertSrc, keywords));
      gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragSrc, keywords));
      gl.linkProgram(program);
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < uniformCount; i += 1) {
        const activeUniform = gl.getActiveUniform(program, i);
        if (!activeUniform) continue;
        uniforms[activeUniform.name] = gl.getUniformLocation(program, activeUniform.name);
      }
      return { program, uniforms };
    }

    const programs = {
      copy: createProgram(baseVertexShader, copyShader),
      clear: createProgram(baseVertexShader, clearShader),
      display: createProgram(baseVertexShader, displayShader),
      splat: createProgram(baseVertexShader, splatShader),
      advection: createProgram(
        baseVertexShader,
        advectionShader,
        supportLinearFiltering ? null : ["MANUAL_FILTERING"]
      ),
      divergence: createProgram(baseVertexShader, divergenceShader),
      curl: createProgram(baseVertexShader, curlShader),
      vorticity: createProgram(baseVertexShader, vorticityShader),
      pressure: createProgram(baseVertexShader, pressureShader),
      gradientSubtract: createProgram(baseVertexShader, gradientSubtractShader),
    };

    const arrayBuffer = gl.createBuffer();
    const elementBuffer = gl.createBuffer();
    if (!arrayBuffer || !elementBuffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, arrayBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
      gl.STATIC_DRAW
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 0, 2, 3]),
      gl.STATIC_DRAW
    );
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    const blit = (target: Fbo | null, clear = false) => {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (clear) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };

    function createFBO(
      w: number,
      h: number,
      internalFormat: number,
      format: number,
      type: number,
      param: number
    ): Fbo {
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      const fbo = gl.createFramebuffer();
      if (!texture || !fbo) throw new Error("fbo");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX: 1 / w,
        texelSizeY: 1 / h,
        attach(id: number) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        },
      };
    }

    function createDoubleFBO(
      w: number,
      h: number,
      internalFormat: number,
      format: number,
      type: number,
      param: number
    ): DoubleFbo {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() {
          return fbo1;
        },
        get write() {
          return fbo2;
        },
        swap() {
          const temp = fbo1;
          fbo1 = fbo2;
          fbo2 = temp;
        },
      };
    }

    function resizeFBO(
      target: Fbo,
      w: number,
      h: number,
      internalFormat: number,
      format: number,
      type: number,
      param: number
    ) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param);
      const { program, uniforms } = programs.copy;
      gl.useProgram(program);
      gl.uniform1i(uniforms.uTexture, target.attach(0));
      blit(newFBO);
      return newFBO;
    }

    function resizeDoubleFBO(
      target: DoubleFbo,
      w: number,
      h: number,
      internalFormat: number,
      format: number,
      type: number,
      param: number
    ) {
      if (target.width === w && target.height === h) return target;
      let fbo1 = resizeFBO(target.read, w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: 1 / w,
        texelSizeY: 1 / h,
        get read() {
          return fbo1;
        },
        get write() {
          return fbo2;
        },
        swap() {
          const temp = fbo1;
          fbo1 = fbo2;
          fbo2 = temp;
        },
      };
    }

    function getResolution(resolution: number) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspectRatio);
      return gl.drawingBufferWidth > gl.drawingBufferHeight
        ? { width: max, height: min }
        : { width: min, height: max };
    }

    const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    let density: DoubleFbo;
    let velocity: DoubleFbo;
    let divergenceFBO: Fbo;
    let curlFBO: Fbo;
    let pressureFBO: DoubleFbo;

    function initFramebuffers() {
      const simRes = getResolution(cfg.SIM_RESOLUTION);
      const dyeRes = getResolution(cfg.DYE_RESOLUTION);
      if (!density) {
        density = createDoubleFBO(
          dyeRes.width,
          dyeRes.height,
          rgba.internalFormat,
          rgba.format,
          halfFloatTexType,
          filtering
        );
        velocity = createDoubleFBO(
          simRes.width,
          simRes.height,
          rg.internalFormat,
          rg.format,
          halfFloatTexType,
          filtering
        );
        divergenceFBO = createFBO(
          simRes.width,
          simRes.height,
          r.internalFormat,
          r.format,
          halfFloatTexType,
          gl.NEAREST
        );
        curlFBO = createFBO(
          simRes.width,
          simRes.height,
          r.internalFormat,
          r.format,
          halfFloatTexType,
          gl.NEAREST
        );
        pressureFBO = createDoubleFBO(
          simRes.width,
          simRes.height,
          r.internalFormat,
          r.format,
          halfFloatTexType,
          gl.NEAREST
        );
      } else {
        density = resizeDoubleFBO(
          density,
          dyeRes.width,
          dyeRes.height,
          rgba.internalFormat,
          rgba.format,
          halfFloatTexType,
          filtering
        );
        velocity = resizeDoubleFBO(
          velocity,
          simRes.width,
          simRes.height,
          rg.internalFormat,
          rg.format,
          halfFloatTexType,
          filtering
        );
        divergenceFBO = resizeFBO(
          divergenceFBO,
          simRes.width,
          simRes.height,
          r.internalFormat,
          r.format,
          halfFloatTexType,
          gl.NEAREST
        );
        curlFBO = resizeFBO(
          curlFBO,
          simRes.width,
          simRes.height,
          r.internalFormat,
          r.format,
          halfFloatTexType,
          gl.NEAREST
        );
        pressureFBO = resizeDoubleFBO(
          pressureFBO,
          simRes.width,
          simRes.height,
          r.internalFormat,
          r.format,
          halfFloatTexType,
          gl.NEAREST
        );
      }
    }

    function resizeCanvas() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (targetCanvas.width === w && targetCanvas.height === h) return false;
      targetCanvas.width = w;
      targetCanvas.height = h;
      return true;
    }

    function step(dt: number) {
      gl.disable(gl.BLEND);

      {
        const { program, uniforms } = programs.curl;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(uniforms.uVelocity, velocity.read.attach(0));
        blit(curlFBO);
      }

      {
        const { program, uniforms } = programs.vorticity;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(uniforms.uCurl, curlFBO.attach(1));
        gl.uniform1f(uniforms.curl, cfg.CURL);
        gl.uniform1f(uniforms.dt, dt);
        blit(velocity.write);
        velocity.swap();
      }

      {
        const { program, uniforms } = programs.divergence;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(uniforms.uVelocity, velocity.read.attach(0));
        blit(divergenceFBO);
      }

      {
        const { program, uniforms } = programs.clear;
        gl.useProgram(program);
        gl.uniform1i(uniforms.uTexture, pressureFBO.read.attach(0));
        gl.uniform1f(uniforms.value, cfg.PRESSURE);
        blit(pressureFBO.write);
        pressureFBO.swap();
      }

      {
        const { program, uniforms } = programs.pressure;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(uniforms.uDivergence, divergenceFBO.attach(0));
        for (let i = 0; i < cfg.PRESSURE_ITERATIONS; i += 1) {
          gl.uniform1i(uniforms.uPressure, pressureFBO.read.attach(1));
          blit(pressureFBO.write);
          pressureFBO.swap();
        }
      }

      {
        const { program, uniforms } = programs.gradientSubtract;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(uniforms.uPressure, pressureFBO.read.attach(0));
        gl.uniform1i(uniforms.uVelocity, velocity.read.attach(1));
        blit(velocity.write);
        velocity.swap();
      }

      {
        const { program, uniforms } = programs.advection;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!supportLinearFiltering) {
          gl.uniform2f(uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
        }
        const velocityId = velocity.read.attach(0);
        gl.uniform1i(uniforms.uVelocity, velocityId);
        gl.uniform1i(uniforms.uSource, velocityId);
        gl.uniform1f(uniforms.dt, dt);
        gl.uniform1f(uniforms.dissipation, cfg.VELOCITY_DISSIPATION);
        blit(velocity.write);
        velocity.swap();
      }

      {
        const { program, uniforms } = programs.advection;
        gl.useProgram(program);
        gl.uniform2f(uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!supportLinearFiltering) {
          gl.uniform2f(uniforms.dyeTexelSize, density.texelSizeX, density.texelSizeY);
        }
        gl.uniform1i(uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(uniforms.uSource, density.read.attach(1));
        gl.uniform1f(uniforms.dt, dt);
        gl.uniform1f(uniforms.dissipation, cfg.DENSITY_DISSIPATION);
        blit(density.write);
        density.swap();
      }
    }

    function splatFn(
      x: number,
      y: number,
      dx: number,
      dy: number,
      color: { r: number; g: number; b: number }
    ) {
      const { program, uniforms } = programs.splat;
      gl.useProgram(program);
      gl.uniform1i(uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(uniforms.aspectRatio, targetCanvas.width / targetCanvas.height);
      gl.uniform2f(uniforms.point, x / targetCanvas.width, 1 - y / targetCanvas.height);
      gl.uniform3f(uniforms.color, dx, -dy, 0);
      const ar = targetCanvas.width / targetCanvas.height;
      const correctedRadius =
        ar > 1 ? (cfg.SPLAT_RADIUS / 100) * ar : cfg.SPLAT_RADIUS / 100;
      gl.uniform1f(uniforms.radius, correctedRadius);
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(uniforms.uTarget, density.read.attach(0));
      gl.uniform3f(uniforms.color, color.r, color.g, color.b);
      blit(density.write);
      density.swap();
    }

    function render() {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      const { program, uniforms } = programs.display;
      gl.useProgram(program);
      gl.uniform1i(uniforms.uTexture, density.read.attach(0));
      blit(null);
    }

    const pointer = {
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      moved: false,
      down: false,
      initialized: false,
    };
    const color = { r: 1, g: 1, b: 1 };

    function updatePointer(posX: number, posY: number) {
      if (!pointer.initialized) {
        pointer.x = posX;
        pointer.y = posY;
        pointer.initialized = true;
      }
      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x = posX;
      pointer.y = posY;
      pointer.dx = (posX - prevX) * 5;
      pointer.dy = (posY - prevY) * 5;
      pointer.moved = Math.abs(pointer.dx) > 0 || Math.abs(pointer.dy) > 0;
    }

    const handleMouseMove = (event: MouseEvent) => {
      updatePointer(event.clientX, event.clientY);
      pointer.down = true;
    };
    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (!touch) return;
      updatePointer(touch.clientX, touch.clientY);
      pointer.down = true;
    };
    const handleTouchStart = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (!touch) return;
      pointer.x = touch.clientX;
      pointer.y = touch.clientY;
      pointer.down = true;
      pointer.moved = true;
      pointer.initialized = true;
      splatFn(
        touch.clientX,
        touch.clientY,
        ((Math.random() - 0.5) * cfg.SPLAT_FORCE) / 26.67,
        ((Math.random() - 0.5) * cfg.SPLAT_FORCE) / 26.67,
        color
      );
    };
    const handleTouchEnd = () => {
      pointer.down = false;
    };
    const handleMouseLeave = () => {
      pointer.down = false;
    };
    const handleResize = () => {
      if (resizeCanvas()) initFramebuffers();
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("resize", handleResize);

    resizeCanvas();
    initFramebuffers();

    let lastTime = Date.now();
    let animationFrame = 0;
    const update = () => {
      if (resizeCanvas()) initFramebuffers();
      const now = Date.now();
      let dt = (now - lastTime) / 1000;
      dt = Math.min(dt, 0.016666);
      lastTime = now;

      if (pointer.down) {
        const forceX = pointer.moved ? pointer.dx : (Math.random() - 0.5) * 30;
        const forceY = pointer.moved ? pointer.dy : (Math.random() - 0.5) * 30;
        splatFn(
          pointer.x,
          pointer.y,
          (forceX * cfg.SPLAT_FORCE) / 1000,
          (forceY * cfg.SPLAT_FORCE) / 1000,
          color
        );
        pointer.moved = false;
      }

      step(dt);
      render();
      animationFrame = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", handleResize);
    };
  }, [
    curl,
    densityDissipation,
    dyeResolution,
    pressure,
    pressureIterations,
    simResolution,
    splatForce,
    splatRadius,
    velocityDissipation,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        mixBlendMode: "difference",
        pointerEvents: "none",
      }}
    />
  );
}
