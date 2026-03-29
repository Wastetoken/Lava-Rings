"use client";

import { useEffect, useRef } from "react";

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `precision highp float;uniform vec3 iRes;uniform float iT;uniform vec4 iM;const float dV=.7,dO=.5,sR=.6;const vec3 ld=normalize(vec3(1.,1.,.5));float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,79.1)))*43758.5453);}vec3 rY(vec3 v,float t){float c=cos(t),s=sin(t);return vec3(v.x*c+v.z*s,v.y,-v.x*s+v.z*c);}vec3 rX(vec3 v,float t){float c=cos(t),s=sin(t);return vec3(v.x,v.y*c-v.z*s,v.y*s+v.z*c);}float noise(in vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.-15.)+10.);float v=mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),u.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),u.x),u.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),u.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),u.x),u.y),u.z);v=v*2.-.5;float cv=abs(cos(v)),sv=abs(sin(v));return mix(sv,cv,sv);}float nL(vec3 p){float f=2.92,v=0.,s=0.;for(int i=0;i<11;i++){float w=1./pow(f,1.);v+=noise(p*f)*w;s+=w;f*=1.3;}return v/s;}float map(vec3 p){vec2 nm=(iM.xy/iRes.xy)*2.-1.;p=rX(p,nm.y*.6+iT/7.);p=rY(p,nm.x*.6+iT/7.);return nL(p+iT/70.)-dO;}vec3 calcN(in vec3 pos,float t){vec2 e=vec2(.0005*t,0.);return normalize(vec3(map(pos+e.xyy)-map(pos-e.xyy),map(pos+e.yxy)-map(pos-e.yxy),map(pos+e.yyx)-map(pos-e.yyx)));}float shRay(vec3 sp,vec3 ld2){float t=0.,sh=40.,mn=1.;for(int r=0;r<8;r++){vec3 p=sp+t*ld2+normalize(sp)/sh;vec3 pp=normalize(p)*sR;float d=length(p)-(sR+map(pp)*dV);mn=min(mn,d);if(d<0.)break;t+=.01;}return smoothstep(0.,2.,mn*sh);}vec3 sky(vec2 uv,float mn){float s1=((1.-nL(vec3(uv*100.+iT/10.,0.)))*10.-8.);float s2=((1.-nL(vec3(uv*30.+iT/20.,3.)))*10.-8.8);vec3 s=max(0.,s1)*vec3(.2,.5,.6)+max(0.,s2)*vec3(1.,.8,.5);s*=(0.-length(uv*.07))*2.;s+=pow(1.-mn,1.)*.2*vec3(1.,.1,.1);return s;}void main(){vec2 fc=gl_FragCoord.xy;vec2 uv=fc*2./iRes.xy-1.;uv.x*=iRes.x/iRes.y;vec3 col=sky(uv,0.);float mn=1.,t=0.;for(int r=0;r<64;r++){vec3 p=vec3(uv,-1.+t);vec3 pp=normalize(p)*sR;float d=length(p)-(sR+map(pp)*dV);mn=min(mn,d);if(d<.01){float rc=float(r)/64.;vec3 n=mix(calcN(pp,.1),calcN(pp,10.),.5);float l1=max(dot(n,-ld),0.)*1.2;if(l1>.21)l1*=shRay(p,ld);l1+=pow(l1,15.)/100.;col=vec3(.4,.5,.6)*l1;col+=max(dot(n,vec3(0.,.5,1.)),0.)*.15*vec3(.4,.5,.7);col+=vec3(2.,.35,.15)*pow(max(0.,-map(pp)+.2),3.)*58.*max(0.,1.-n.z);col+=pow(rc,5.)*vec3(1.,.85,.2);break;}else if(t>4.){col=sky(uv,mn);break;}t+=d;}gl_FragColor=vec4(col,1.);}`;

export function LavaShaderCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const makeShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const program = gl.createProgram();
    const vs = makeShader(gl.VERTEX_SHADER, VERT);
    const fs = makeShader(gl.FRAGMENT_SHADER, FRAG);
    if (!program || !vs || !fs) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const aLoc = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "iRes");
    const uT = gl.getUniformLocation(program, "iT");
    const uM = gl.getUniformLocation(program, "iM");

    let rawX = 0;
    let rawY = 0;
    let smX = 0;
    let smY = 0;
    let raf = 0;

    const scaleForViewport = () => (window.innerWidth < 768 ? 0.45 : 0.55);
    const resize = () => {
      const scale = scaleForViewport();
      canvas.width = Math.round(window.innerWidth * scale);
      canvas.height = Math.round(window.innerHeight * scale);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      rawX = smX = canvas.width * 0.5;
      rawY = smY = canvas.height * 0.5;
    };

    const updatePointer = (clientX: number, clientY: number) => {
      rawX = clientX * (canvas.width / window.innerWidth);
      rawY = (window.innerHeight - clientY) * (canvas.height / window.innerHeight);
    };

    const mouseMove = (event: MouseEvent) => updatePointer(event.clientX, event.clientY);
    const touchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      updatePointer(touch.clientX, touch.clientY);
    };

    const gyro = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return;
      const gx = Math.max(-45, Math.min(45, event.gamma)) / 45;
      const gy = Math.max(-45, Math.min(45, event.beta - 20)) / 45;
      rawX = (gx * 0.5 + 0.5) * canvas.width;
      rawY = (1 - (gy * 0.5 + 0.5)) * canvas.height;
    };

    const requestGyro = () => {
      if (typeof DeviceOrientationEvent === "undefined") return;
      const maybeRequest = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof maybeRequest.requestPermission === "function") {
        void maybeRequest.requestPermission().then((state) => {
          if (state === "granted") {
            window.addEventListener("deviceorientation", gyro, { passive: true });
          }
        });
      } else {
        window.addEventListener("deviceorientation", gyro, { passive: true });
      }
    };

    const start = performance.now();
    let prev = start;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - prev) * 0.001, 0.1);
      prev = now;
      const easing = 1 - Math.pow(0.93, dt * 60);
      smX += (rawX - smX) * easing;
      smY += (rawY - smY) * easing;
      gl.uniform3f(uRes, canvas.width, canvas.height, 1);
      gl.uniform1f(uT, (now - start) * 0.001);
      gl.uniform4f(uM, smX, smY, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", mouseMove, { passive: true });
    window.addEventListener("touchmove", touchMove, { passive: true });
    window.addEventListener("touchstart", requestGyro, { once: true });
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("deviceorientation", gyro);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
