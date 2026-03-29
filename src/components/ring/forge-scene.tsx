"use client";

import { LavaShaderCanvas } from "./lava-shader-canvas";

export function ForgeScene() {
  return (
    <section className="relative h-screen w-screen overflow-hidden bg-black">
      <div className="absolute inset-0">
        <LavaShaderCanvas />
      </div>
    </section>
  );
}
