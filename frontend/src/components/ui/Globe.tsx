import React, { useEffect, useRef } from "react";
import createGlobe, { type COBEOptions } from "cobe";
import { cn } from "../../lib/utils";

const GLOBE_CONFIG: COBEOptions = {
  width: 800,
  height: 800,
  onRender: () => {},
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.3,
  dark: 0,
  diffuse: 0.4,
  mapSamples: 16000,
  mapBrightness: 1.2,
  baseColor: [1, 1, 1],
  markerColor: [27 / 255, 118 / 255, 94 / 255],
  glowColor: [1, 1, 1],
  markers: [
    { location: [-6.2088, 106.8456], size: 0.08 }, // Jakarta
    { location: [21.4225, 39.8262], size: 0.09 }, // Mecca
    { location: [24.7136, 46.6753], size: 0.07 }, // Saudi Arabia
    { location: [41.0082, 28.9784], size: 0.06 }, // Turkey
    { location: [3.139, 101.6869], size: 0.06 }, // Malaysia
    { location: [25.2048, 55.2708], size: 0.06 }, // UAE
    { location: [40.7128, -74.006], size: 0.05 }, // NYC
    { location: [51.5074, -0.1278], size: 0.05 }, // London
    { location: [35.6762, 139.6503], size: 0.06 }, // Tokyo
  ],
};

export function Globe({
  className,
  config = GLOBE_CONFIG,
}: {
  className?: string;
  config?: COBEOptions;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerInteracting = useRef<number | null>(null);
  const pointerDelta = useRef(0);
  const phiRef = useRef(0);
  const widthRef = useRef(0);

  useEffect(() => {
    let currentPhiOffset = 0;

    const onResize = () => {
      if (canvasRef.current) {
        widthRef.current = canvasRef.current.offsetWidth;
      }
    };
    window.addEventListener("resize", onResize);
    onResize();

    if (!canvasRef.current) return;

    const globe = createGlobe(canvasRef.current, {
      ...config,
      width: (widthRef.current * 2) || 800,
      height: (widthRef.current * 2) || 800,
      onRender: (state) => {
        if (!pointerInteracting.current) {
          phiRef.current += 0.005;
        }
        currentPhiOffset += (pointerDelta.current - currentPhiOffset) * 0.08;
        state.phi = phiRef.current + currentPhiOffset;
        state.width = (widthRef.current * 2) || 800;
        state.height = (widthRef.current * 2) || 800;
      },
    });

    setTimeout(() => {
      if (canvasRef.current) canvasRef.current.style.opacity = "1";
    }, 50);

    return () => {
      globe.destroy();
      window.removeEventListener("resize", onResize);
    };
  }, [config]);

  return (
    <div
      className={cn(
        "relative mx-auto aspect-square w-full max-w-[440px] flex items-center justify-center",
        className
      )}
    >
      <canvas
        className="w-full h-full opacity-0 transition-opacity duration-500 contain-[layout_paint_size] cursor-grab active:cursor-grabbing"
        ref={canvasRef}
        onPointerDown={(e) => {
          pointerInteracting.current = e.clientX;
        }}
        onPointerUp={() => {
          pointerInteracting.current = null;
        }}
        onPointerOut={() => {
          pointerInteracting.current = null;
        }}
        onMouseMove={(e) => {
          if (pointerInteracting.current !== null) {
            const delta = (e.clientX - pointerInteracting.current) / 300;
            pointerDelta.current += delta;
            pointerInteracting.current = e.clientX;
          }
        }}
        onTouchMove={(e) => {
          if (e.touches[0] && pointerInteracting.current !== null) {
            const delta = (e.touches[0].clientX - pointerInteracting.current) / 300;
            pointerDelta.current += delta;
            pointerInteracting.current = e.touches[0].clientX;
          }
        }}
      />
    </div>
  );
}
