"use client";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black">
      <div className="animate-pulse text-[0.72rem] uppercase tracking-[0.4em] text-white/40">
        {label}
      </div>
    </div>
  );
}
