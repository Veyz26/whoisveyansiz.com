"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// A more realistic procedural night sky: stars coloured by stellar temperature
// (blue→white→yellow→orange→red, weighted toward the cooler/dimmer majority),
// a handful of bright "hero" stars, and a tilted Milky Way band with faint
// patchy nebulosity. Everything is generated in-browser (canvas sprite, no
// external textures) so it stays within the site's strict CSP.

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const STAR_COLORS: Array<[number, number, number]> = [
  [0.62, 0.72, 1.0], // hot blue
  [0.8, 0.86, 1.0], // blue-white
  [1, 1, 1], // white
  [1, 0.96, 0.86], // yellow-white (sun-like)
  [1, 0.85, 0.62], // orange
  [1, 0.72, 0.52], // cool red
];

function pickColor(): [number, number, number] {
  const r = Math.random();
  if (r < 0.04) return STAR_COLORS[0];
  if (r < 0.12) return STAR_COLORS[1];
  if (r < 0.36) return STAR_COLORS[2];
  if (r < 0.62) return STAR_COLORS[3];
  if (r < 0.83) return STAR_COLORS[4];
  return STAR_COLORS[5];
}

function makeStarTexture(): THREE.Texture {
  const s = 64;
  const cvs = document.createElement("canvas");
  cvs.width = s;
  cvs.height = s;
  const ctx = cvs.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cvs);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type LayerData = { positions: Float32Array; colors: Float32Array };

function uniformLayer(count: number, radius: number, bright: number): LayerData {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.92 + Math.random() * 0.08);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const c = pickColor();
    const b = bright * (0.5 + Math.pow(Math.random(), 2) * 0.6);
    colors[i * 3] = Math.min(1, c[0] * b);
    colors[i * 3 + 1] = Math.min(1, c[1] * b);
    colors[i * 3 + 2] = Math.min(1, c[2] * b);
  }
  return { positions, colors };
}

function bandLayer(count: number, radius: number, spread: number, bright: number): LayerData {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const lat = Math.max(-1.4, Math.min(1.4, gauss() * spread));
    const cl = Math.cos(lat);
    const r = radius * (0.92 + Math.random() * 0.08);
    positions[i * 3] = r * Math.cos(theta) * cl;
    positions[i * 3 + 1] = r * Math.sin(lat);
    positions[i * 3 + 2] = r * Math.sin(theta) * cl;
    const c = pickColor();
    const b = bright * (0.4 + Math.random() * 0.7);
    colors[i * 3] = Math.min(1, c[0] * b);
    colors[i * 3 + 1] = Math.min(1, c[1] * b);
    colors[i * 3 + 2] = Math.min(1, c[2] * b);
  }
  return { positions, colors };
}

function nebulaLayer(count: number, radius: number, spread: number): LayerData {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette: Array<[number, number, number]> = [
    [0.3, 0.36, 0.6],
    [0.4, 0.3, 0.55],
    [0.5, 0.4, 0.45],
    [0.25, 0.4, 0.5],
  ];
  const clusters = 7;
  const centers: Array<[number, number]> = [];
  for (let k = 0; k < clusters; k++) {
    centers.push([Math.random() * Math.PI * 2, gauss() * spread * 0.5]);
  }
  for (let i = 0; i < count; i++) {
    const cen = centers[Math.floor(Math.random() * clusters)];
    const theta = cen[0] + gauss() * 0.35;
    const lat = Math.max(-1.4, Math.min(1.4, cen[1] + gauss() * spread * 0.7));
    const cl = Math.cos(lat);
    const r = radius * (0.9 + Math.random() * 0.06);
    positions[i * 3] = r * Math.cos(theta) * cl;
    positions[i * 3 + 1] = r * Math.sin(lat);
    positions[i * 3 + 2] = r * Math.sin(theta) * cl;
    const c = palette[Math.floor(Math.random() * palette.length)];
    const b = 0.5 + Math.random() * 0.8;
    colors[i * 3] = c[0] * b;
    colors[i * 3 + 1] = c[1] * b;
    colors[i * 3 + 2] = c[2] * b;
  }
  return { positions, colors };
}

function Layer({
  data,
  size,
  opacity,
  tex,
}: {
  data: LayerData;
  size: number;
  opacity: number;
  tex: THREE.Texture;
}) {
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={tex}
        size={size}
        vertexColors
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function Starfield({ mobile = false }: { mobile?: boolean }) {
  const sky = useRef<THREE.Group>(null);
  const tex = useMemo(makeStarTexture, []);
  const f = mobile ? 0.55 : 1;

  const small = useMemo(() => uniformLayer(Math.round(5200 * f), 300, 0.9), [f]);
  const medium = useMemo(() => uniformLayer(Math.round(1400 * f), 300, 1.1), [f]);
  const bright = useMemo(() => uniformLayer(Math.round(260 * f), 300, 1.5), [f]);
  const bandStars = useMemo(() => bandLayer(Math.round(4200 * f), 300, 0.16, 0.9), [f]);
  const bandCore = useMemo(() => bandLayer(Math.round(2000 * f), 300, 0.07, 1.15), [f]);
  const neb = useMemo(() => nebulaLayer(Math.round(900 * f), 295, 0.14), [f]);

  useFrame((_, dt) => {
    if (sky.current) sky.current.rotation.y += dt * 0.006;
  });

  return (
    <group ref={sky}>
      <Layer data={small} size={0.9} opacity={0.9} tex={tex} />
      <Layer data={medium} size={1.7} opacity={0.95} tex={tex} />
      <Layer data={bright} size={3.0} opacity={1} tex={tex} />

      {/* Milky Way band, tilted across the sky */}
      <group rotation={[0.5, 0.3, 0.65]}>
        <Layer data={neb} size={22} opacity={0.05} tex={tex} />
        <Layer data={bandStars} size={1.0} opacity={0.8} tex={tex} />
        <Layer data={bandCore} size={1.6} opacity={0.9} tex={tex} />
      </group>
    </group>
  );
}
