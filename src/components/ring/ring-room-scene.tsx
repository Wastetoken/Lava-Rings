"use client";

import { Environment, Float, Html, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  Bloom,
  DepthOfField,
  EffectComposer,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import {
  type Dispatch,
  type SetStateAction,
  Suspense,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  ACESFilmicToneMapping,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Texture,
  TextureLoader,
  Vector3,
} from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { LoadingScreen } from "./loading-screen";

const RING_COUNT = 11;
const RING_RADIUS = 4;
const ROOM_ENTRY_DELAY_SECONDS = 0.3;
const INTRO_DURATION_SECONDS = 4;
const DOLLY_PULL_SECONDS = 0.3;
const DOLLY_SETTLE_SECONDS = 0.5;
const OVERVIEW_POSITION = new Vector3(0, 3, 8);
const OVERVIEW_LOOK_AT = new Vector3(0, 1.5, 0);
const INTRO_START = new Vector3(12, 10, 20);
const INTRO_MID = new Vector3(5, 5, 12);
const INTRO_END = new Vector3(0, 3, 8);
const INTRO_LOOK_START = new Vector3(0, 2, 0);
const INTRO_LOOK_END = new Vector3(0, 1.5, 0);
const INSPECT_OFFSET = new Vector3(1.5, 0.5, 2.5);

const ringIds = Array.from({ length: RING_COUNT }, (_, index) =>
  index.toString().padStart(3, "0")
);
const ringModelUrls = ringIds.map((id) => `/ring/${id}.glb`);
const ringTextureUrls = ringIds.map((id) => `/ring/${id}.jpg`);
const islandUrl = "/ring/LavaIsland.glb";

type RoomProps = {
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  zoomed: boolean;
  setZoomed: Dispatch<SetStateAction<boolean>>;
  showForgeCta: boolean;
  onForge: () => void;
  transitioningToForge?: boolean;
};

function RoomCursor() {
  const coreRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let x = window.innerWidth * 0.5;
    let y = window.innerHeight * 0.5;
    let hx = x;
    let hy = y;
    let raf = 0;

    const onMove = (event: MouseEvent) => {
      x = event.clientX;
      y = event.clientY;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      hx += (x - hx) * 0.16;
      hy += (y - hy) * 0.16;

      if (coreRef.current) {
        coreRef.current.style.left = `${x}px`;
        coreRef.current.style.top = `${y}px`;
      }

      if (haloRef.current) {
        haloRef.current.style.left = `${hx}px`;
        haloRef.current.style.top = `${hy}px`;
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <>
      <div
        ref={haloRef}
        className="pointer-events-none absolute left-0 top-0 z-30 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20"
        style={{ boxShadow: "0 0 18px rgba(255,255,255,0.12)" }}
      />
      <div
        ref={coreRef}
        className="pointer-events-none absolute left-0 top-0 z-30 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
        style={{ boxShadow: "0 0 12px rgba(255,255,255,0.6)" }}
      />
    </>
  );
}

function RoomLoader() {
  const { active } = useProgress();
  return active ? <LoadingScreen label="Loading Ring Room..." /> : null;
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function applySurfaceMaterial(scene: Object3D, texture?: Texture, envMapIntensity = 2) {
  scene.traverse((child) => {
    const mesh = child as Mesh;
    if (!("isMesh" in mesh) || !mesh.isMesh) return;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => {
        const cloned = material.clone() as MeshStandardMaterial;
        if (texture) {
          cloned.map = texture;
          cloned.metalness = 0.9;
          cloned.roughness = 0.15;
        }
        cloned.envMapIntensity = envMapIntensity;
        return cloned;
      });
      return;
    }

    const cloned = mesh.material.clone() as MeshStandardMaterial;
    if (texture) {
      cloned.map = texture;
      cloned.metalness = 0.9;
      cloned.roughness = 0.15;
    }
    cloned.envMapIntensity = envMapIntensity;
    mesh.material = cloned;
  });
}

function LavaIsland() {
  const [gltf] = useLoader(GLTFLoader, [islandUrl]) as GLTF[];

  const scene = useMemo(() => {
    const island = clone(gltf.scene);
    applySurfaceMaterial(island, undefined, 0.5);
    return island;
  }, [gltf.scene]);

  return <primitive object={scene} position={[0, -2.5, 0]} scale={1.2} />;
}

function FireGlow() {
  const mainRef = useRef<PointLight>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!mainRef.current) return;

    mainRef.current.intensity = 3 + Math.sin(t * 4) * 0.5 + Math.sin(t * 7) * 0.3;
    mainRef.current.position.y = -1.75 + Math.sin(t * 2) * 0.1;
  });

  return (
    <>
      <pointLight
        ref={mainRef}
        color="#ff4500"
        intensity={3}
        position={[0, -1.75, 0]}
        distance={15}
        decay={2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight color="#ff6600" intensity={2} position={[-0.7, -1.85, -0.2]} distance={10} decay={2} />
      <pointLight color="#ff3300" intensity={1.5} position={[0.5, -1.5, 0.5]} distance={8} decay={2} />
    </>
  );
}

function Ring({
  index,
  gltfScene,
  texture,
  active,
  onSelect,
  register,
}: {
  index: number;
  gltfScene: Object3D;
  texture: Texture;
  active: boolean;
  onSelect: (index: number) => void;
  register: (index: number, ref: Group | null) => void;
}) {
  const ref = useRef<Group>(null);

  const scene = useMemo(() => {
    const instance = clone(gltfScene);
    texture.flipY = false;
    applySurfaceMaterial(instance, texture, 2);
    return instance;
  }, [gltfScene, texture]);

  useEffect(() => {
    register(index, ref.current);
    return () => register(index, null);
  }, [index, register]);

  useFrame((_, delta) => {
    if (!ref.current) return;

    ref.current.rotation.y += delta * 0.3;

    const targetScale = active ? 1 : 0.7;
    const ease = 1 - Math.exp(-delta * 8);
    ref.current.scale.x = MathUtils.lerp(ref.current.scale.x, targetScale, ease);
    ref.current.scale.y = MathUtils.lerp(ref.current.scale.y, targetScale, ease);
    ref.current.scale.z = MathUtils.lerp(ref.current.scale.z, targetScale, ease);
  });

  const angle = (index / RING_COUNT) * Math.PI * 2;
  const x = Math.sin(angle) * RING_RADIUS;
  const z = Math.cos(angle) * RING_RADIUS;

  return (
    <group position={[x, 1.5, z]} onClick={() => onSelect(index)}>
      <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
        <group ref={ref}>
          <primitive object={scene} />
        </group>
      </Float>
    </group>
  );
}

function Carousel({
  activeIndex,
  setActiveIndex,
  zoomed,
  setZoomed,
  ringRefs,
}: {
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  zoomed: boolean;
  setZoomed: Dispatch<SetStateAction<boolean>>;
  ringRefs: React.MutableRefObject<Array<Group | null>>;
}) {
  const ref = useRef<Group>(null);
  const gltfs = useLoader(GLTFLoader, ringModelUrls) as GLTF[];
  const textures = useLoader(TextureLoader, ringTextureUrls);

  useFrame((_, delta) => {
    if (!ref.current) return;

    const targetRotation = -(activeIndex / RING_COUNT) * Math.PI * 2;
    const diff = targetRotation - ref.current.rotation.y;
    ref.current.rotation.y += diff * delta * 3;
  });

  return (
    <group ref={ref}>
      {gltfs.map((gltf, index) => (
        <Ring
          key={ringIds[index]}
          index={index}
          gltfScene={gltf.scene}
          texture={textures[index]}
          active={activeIndex === index}
          onSelect={(selected) => {
            if (selected === activeIndex) {
              setZoomed(!zoomed);
              return;
            }

            setZoomed(false);
            setActiveIndex(selected);
          }}
          register={(itemIndex, group) => {
            ringRefs.current[itemIndex] = group;
          }}
        />
      ))}
    </group>
  );
}

function BackgroundPlane({ onUnzoom }: { onUnzoom: () => void }) {
  return (
    <mesh position={[0, 0, -15]} onClick={onUnzoom}>
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

function CameraRig({
  activeIndex,
  zoomed,
  ringRefs,
}: {
  activeIndex: number;
  zoomed: boolean;
  ringRefs: React.MutableRefObject<Array<Group | null>>;
}) {
  const { camera } = useThree();
  const perspectiveCamera = camera as PerspectiveCamera;
  const introElapsed = useRef(-ROOM_ENTRY_DELAY_SECONDS);
  const dollyElapsed = useRef(DOLLY_PULL_SECONDS + DOLLY_SETTLE_SECONDS);
  const previousZoomed = useRef(zoomed);
  const currentLookAt = useRef(OVERVIEW_LOOK_AT.clone());
  const ringPosition = useMemo(() => new Vector3(), []);
  const currentFov = useRef(45);

  useFrame((_, delta) => {
    if (previousZoomed.current !== zoomed) {
      previousZoomed.current = zoomed;
      dollyElapsed.current = 0;
    }

    if (introElapsed.current < 0) {
      introElapsed.current = Math.min(0, introElapsed.current + delta);
      perspectiveCamera.position.copy(INTRO_START);
      currentLookAt.current.copy(INTRO_LOOK_START);
      perspectiveCamera.lookAt(currentLookAt.current);
      currentFov.current = 48;
      perspectiveCamera.fov = currentFov.current;
      perspectiveCamera.updateProjectionMatrix();
      return;
    }

    if (introElapsed.current < INTRO_DURATION_SECONDS) {
      introElapsed.current = Math.min(INTRO_DURATION_SECONDS, introElapsed.current + delta);
      const progress = easeInOutCubic(introElapsed.current / INTRO_DURATION_SECONDS);
      const first = INTRO_START.clone().lerp(INTRO_MID, progress);
      const second = INTRO_MID.clone().lerp(INTRO_END, progress);

      perspectiveCamera.position.copy(first.lerp(second, progress));
      currentLookAt.current.copy(
        INTRO_LOOK_START.clone().lerp(INTRO_LOOK_END, progress)
      );
      perspectiveCamera.lookAt(currentLookAt.current);
      currentFov.current = MathUtils.lerp(48, 45, progress);
      perspectiveCamera.fov = currentFov.current;
      perspectiveCamera.updateProjectionMatrix();
      return;
    }

    let targetPosition = OVERVIEW_POSITION.clone();
    let targetLookAt = OVERVIEW_LOOK_AT.clone();
    let targetFov = 45;

    const activeRing = ringRefs.current[activeIndex];
    if (zoomed && activeRing) {
      activeRing.getWorldPosition(ringPosition);
      targetLookAt = ringPosition.clone();
      targetPosition = ringPosition
        .clone()
        .add(INSPECT_OFFSET)
        .add(new Vector3(0.15, 0.05, -0.35));
      targetFov = 36;
    }

    if (dollyElapsed.current < DOLLY_PULL_SECONDS + DOLLY_SETTLE_SECONDS) {
      dollyElapsed.current = Math.min(
        DOLLY_PULL_SECONDS + DOLLY_SETTLE_SECONDS,
        dollyElapsed.current + delta
      );

      const sourcePosition = zoomed ? OVERVIEW_POSITION.clone() : targetPosition.clone();
      const sourceLookAt = zoomed ? OVERVIEW_LOOK_AT.clone() : targetLookAt.clone();
      const pullBackPosition = sourcePosition.clone().add(new Vector3(0, 0, 1.2));

      let stagedPosition = sourcePosition;
      let stagedLookAt = sourceLookAt;
      let stagedFov = zoomed ? 45 : 36;

      if (dollyElapsed.current <= DOLLY_PULL_SECONDS) {
        const pullProgress = dollyElapsed.current / DOLLY_PULL_SECONDS;
        stagedPosition = sourcePosition
          .clone()
          .lerp(pullBackPosition, easeInOutCubic(pullProgress));
      } else {
        const settleProgress =
          (dollyElapsed.current - DOLLY_PULL_SECONDS) / DOLLY_SETTLE_SECONDS;
        const easedSettle = easeInOutCubic(settleProgress);
        stagedPosition = pullBackPosition.clone().lerp(targetPosition, easedSettle);
        stagedLookAt = sourceLookAt.clone().lerp(targetLookAt, easedSettle);
        stagedFov = MathUtils.lerp(zoomed ? 45 : 36, targetFov, easedSettle);
      }

      perspectiveCamera.position.lerp(stagedPosition, 1 - Math.exp(-delta * 3));
      currentLookAt.current.lerp(stagedLookAt, 1 - Math.exp(-delta * 3));
      perspectiveCamera.lookAt(currentLookAt.current);
      currentFov.current = MathUtils.lerp(
        currentFov.current,
        stagedFov,
        1 - Math.exp(-delta * 4)
      );
      perspectiveCamera.fov = currentFov.current;
      perspectiveCamera.updateProjectionMatrix();
      return;
    }

    perspectiveCamera.position.lerp(targetPosition, 1 - Math.exp(-delta * 1.8));
    currentLookAt.current.lerp(targetLookAt, 1 - Math.exp(-delta * 1.8));
    perspectiveCamera.lookAt(currentLookAt.current);
    currentFov.current = MathUtils.lerp(
      currentFov.current,
      targetFov,
      1 - Math.exp(-delta * 4)
    );
    perspectiveCamera.fov = currentFov.current;
    perspectiveCamera.updateProjectionMatrix();
  });

  return null;
}

function SceneContent({
  activeIndex,
  setActiveIndex,
  zoomed,
  setZoomed,
}: {
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  zoomed: boolean;
  setZoomed: Dispatch<SetStateAction<boolean>>;
}) {
  const ringRefs = useRef<Array<Group | null>>([]);

  return (
    <>
      <color attach="background" args={["#050505"]} />
      <fog attach="fog" args={["#000000", 5, 35]} />
      <ambientLight intensity={0.08} color="#1a0a00" />
      <directionalLight
        position={[5, 8, -5]}
        intensity={0.3}
        color="#ff6633"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Environment preset="night" background={false} />
      <LavaIsland />
      <FireGlow />
      <Carousel
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        zoomed={zoomed}
        setZoomed={setZoomed}
        ringRefs={ringRefs}
      />
      <BackgroundPlane onUnzoom={() => setZoomed(false)} />
      <CameraRig activeIndex={activeIndex} zoomed={zoomed} ringRefs={ringRefs} />
      <EffectComposer>
        {zoomed ? (
          <DepthOfField
            focusDistance={0.014}
            focalLength={0.02}
            bokehScale={2.2}
          />
        ) : (
          <></>
        )}
        <Bloom intensity={0.8} luminanceThreshold={0.3} luminanceSmoothing={0.9} />
        <Vignette offset={0.3} darkness={0.8} />
        <ToneMapping />
      </EffectComposer>
    </>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 stroke-white/80"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "left" ? (
        <path d="M14.5 5.5 8 12l6.5 6.5" />
      ) : (
        <path d="M9.5 5.5 16 12l-6.5 6.5" />
      )}
    </svg>
  );
}

export function RingRoomScene({
  activeIndex,
  setActiveIndex,
  zoomed,
  setZoomed,
  showForgeCta,
  onForge,
  transitioningToForge = false,
}: RoomProps) {
  const cycleBy = (direction: 1 | -1) => {
    setZoomed(false);
    setActiveIndex((current) => (current + direction + RING_COUNT) % RING_COUNT);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (event.key === "ArrowRight" || key === "d") cycleBy(1);
      if (event.key === "ArrowLeft" || key === "a") cycleBy(-1);
      if (event.key === "Escape") setZoomed(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setActiveIndex, setZoomed]);

  useEffect(() => {
    let startX = 0;

    const onTouchStart = (event: TouchEvent) => {
      startX = event.touches[0]?.clientX ?? 0;
    };

    const onTouchEnd = (event: TouchEvent) => {
      const endX = event.changedTouches[0]?.clientX ?? startX;
      const deltaX = endX - startX;

      if (Math.abs(deltaX) < 50) return;
      if (deltaX < 0) cycleBy(1);
      if (deltaX > 0) cycleBy(-1);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [setActiveIndex, setZoomed]);

  useEffect(() => {
    let wheelLock = false;
    let wheelAccumulation = 0;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (wheelLock) return;

      wheelAccumulation += event.deltaY;
      if (Math.abs(wheelAccumulation) < 50) return;

      wheelLock = true;
      cycleBy(wheelAccumulation > 0 ? 1 : -1);
      wheelAccumulation = 0;

      window.setTimeout(() => {
        wheelLock = false;
      }, 240);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [setActiveIndex, setZoomed]);

  return (
    <section
      className="relative h-screen w-screen bg-black"
      style={{
        opacity: transitioningToForge ? 0.34 : 1,
        transform: transitioningToForge ? "scale(1.03)" : "scale(1)",
        filter: transitioningToForge ? "blur(10px)" : "blur(0px)",
        transition: transitioningToForge
          ? "opacity 1.05s ease-out, transform 1.05s ease-out, filter 1.05s ease-out"
          : undefined,
      }}
    >
      <RoomCursor />
      <RoomLoader />

      <Suspense fallback={<LoadingScreen label="Loading Ring Room..." />}>
        <Canvas
          shadows
          camera={{ fov: 45, position: [12, 10, 20] }}
          gl={{
            antialias: true,
            alpha: false,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 0.8,
          }}
          onCreated={({ gl }) => {
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = PCFShadowMap;
            gl.setClearColor(new Color("#050505"));
          }}
        >
          <Suspense fallback={<Html center />}>
            <SceneContent
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              zoomed={zoomed}
              setZoomed={setZoomed}
            />
          </Suspense>
        </Canvas>
      </Suspense>

      <div className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex flex-col items-center gap-5">
        <div
          className="flex items-center gap-5 transition-opacity duration-300"
          style={{ opacity: showForgeCta ? 0 : 1 }}
        >
          <button
            aria-label="Previous ring"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/20 backdrop-blur-sm"
            style={{ cursor: "none" }}
            onClick={() => cycleBy(-1)}
          >
            <Chevron direction="left" />
          </button>
          <div className="text-[0.63rem] uppercase tracking-[0.34em] text-white/40">
            Swipe or use arrows
          </div>
          <button
            aria-label="Next ring"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/20 backdrop-blur-sm"
            style={{ cursor: "none" }}
            onClick={() => cycleBy(1)}
          >
            <Chevron direction="right" />
          </button>
        </div>

        {showForgeCta ? (
          <button
            className="pointer-events-auto rounded-full border border-white/30 bg-transparent px-8 py-3 text-[0.72rem] uppercase tracking-[0.3em] text-white backdrop-blur-sm transition hover:bg-white/10"
            style={{ cursor: "none" }}
            onClick={onForge}
          >
            Enter The Eye Of The Forge
          </button>
        ) : null}
      </div>
    </section>
  );
}
