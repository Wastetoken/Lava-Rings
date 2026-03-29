"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { HeroFluidCanvas } from "./hero-fluid-canvas";

export function HeroScene({ onEnter }: { onEnter: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [canEnter, setCanEnter] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnded = () => {
      setCanEnter(true);
      video.loop = true;
      void video.play();
    };

    video.addEventListener("ended", onEnded);
    void video.play().catch(() => undefined);

    return () => video.removeEventListener("ended", onEnded);
  }, []);

  return (
    <section className="relative h-screen w-screen overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 z-0 h-full w-full object-cover"
        src="/ring/rings.mp4"
        muted
        playsInline
        preload="auto"
      />

      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(circle at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      <div className="absolute inset-0 z-20 flex flex-col justify-between px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-start justify-between text-[0.65rem] uppercase tracking-[0.34em] text-white/45">
          <div className="font-serif text-xl tracking-[0.28em] text-white">
            Eye Of The Forge
          </div>
          <div>A rare collection of rings</div>
        </div>

        <div className="mx-auto flex flex-1 max-w-5xl flex-col items-center justify-center text-center">
          <div className="mb-4 text-[0.72rem] uppercase tracking-[0.42em] text-white/35">
            Which not everyone is given permission to view.
          </div>
          <h1 className="max-w-4xl font-serif text-6xl font-light italic leading-[0.92] text-[#f7f0e8] md:text-[8rem]">
            Eleven relics.
            <br />
            One passage into fire.
          </h1>
          <p className="mt-6 max-w-xl text-[0.8rem] uppercase tracking-[0.28em] text-white/40 md:text-[0.82rem]">
            We invite you to explore this exclusive collection in the forgotten forge.
          </p>
        </div>

        <div className="flex items-end justify-between">
          <div className="text-[0.72rem] uppercase tracking-[0.32em] text-white/28">
            If you are truly meant to harness the power, the ring will choose you.
          </div>
          {canEnter ? (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              onClick={onEnter}
              className="rounded-full border border-white/30 bg-transparent px-8 py-3 text-[0.72rem] uppercase tracking-[0.3em] text-white backdrop-blur-sm transition hover:bg-white/10"
            >
              ENTER
            </motion.button>
          ) : (
            <div className="text-[0.68rem] uppercase tracking-[0.3em] text-white/20">
              Only YOU may..
            </div>
          )}
        </div>
      </div>

      <HeroFluidCanvas className="absolute inset-0 z-30 h-full w-full" />
    </section>
  );
}
