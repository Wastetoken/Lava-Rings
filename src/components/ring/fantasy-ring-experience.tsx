"use client";

import { AnimatePresence, motion } from "framer-motion";
import { startTransition, useEffect, useRef, useState } from "react";
import { FluidSimCanvas } from "./fluid-sim-canvas";
import { ForgeScene } from "./forge-scene";
import { HeroScene } from "./hero-scene";
import { RingRoomScene } from "./ring-room-scene";
import type { SceneStage } from "./types";

const TOTAL_RINGS = 11;
const FORGE_MOUNT_DELAY_MS = 700;
const FORGE_OVERLAY_CLEAR_MS = 2800;
const heroTransition = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 1.2, ease: "easeInOut" as const } },
};
const roomTransition = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 2, delay: 0.3, ease: "easeOut" as const },
  },
  exit: { opacity: 0, transition: { duration: 1, ease: "easeInOut" as const } },
};

export default function FantasyRingExperience() {
  const [scene, setScene] = useState<SceneStage>("hero");
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [forgeOverlay, setForgeOverlay] = useState(false);
  const timeoutIdsRef = useRef<number[]>([]);

  const showForgeCta = visited.size === TOTAL_RINGS && scene === "room";

  useEffect(() => {
    if (scene !== "room" && scene !== "forge-transition") return;

    setVisited((current) => {
      if (current.has(activeIndex)) return current;
      const next = new Set(current);
      next.add(activeIndex);
      return next;
    });
  }, [activeIndex, scene]);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  const clearForgeTimers = () => {
    timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutIdsRef.current = [];
  };

  const enterRoom = () => {
    startTransition(() => {
      setScene("room");
    });
  };

  const enterForge = () => {
    clearForgeTimers();
    setZoomed(false);
    setForgeOverlay(true);
    setScene("forge-transition");

    timeoutIdsRef.current = [
      window.setTimeout(() => {
        startTransition(() => {
          setScene("forge");
        });
      }, FORGE_MOUNT_DELAY_MS),
      window.setTimeout(() => {
        setForgeOverlay(false);
      }, FORGE_OVERLAY_CLEAR_MS),
    ];
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-[#f4efe6]">
      <AnimatePresence mode="wait" initial={false}>
        {scene === "hero" ? (
          <motion.div key="hero-scene" {...heroTransition} className="absolute inset-0">
            <HeroScene onEnter={enterRoom} />
          </motion.div>
        ) : null}

        {scene === "room" || scene === "forge-transition" ? (
          <motion.div key="ring-room-scene" {...roomTransition} className="absolute inset-0">
            <RingRoomScene
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              zoomed={zoomed}
              setZoomed={setZoomed}
              showForgeCta={showForgeCta}
              onForge={enterForge}
              transitioningToForge={scene === "forge-transition"}
            />
          </motion.div>
        ) : null}

        {scene === "forge" ? <ForgeScene key="forge-scene" /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {forgeOverlay ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.32, ease: "easeOut" } }}
            exit={{ opacity: 0, transition: { duration: 1.45, ease: "easeInOut" } }}
            className="pointer-events-none absolute inset-0 z-40"
          >
            <FluidSimCanvas
              palette="fire"
              autoBurst
              overlayOpacity={1}
              splatRadiusScale={1.7}
              directionalForceScale={4.2}
              curlStrength={92}
              velocityDissipation={0.992}
              className="absolute inset-0 h-full w-full"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
