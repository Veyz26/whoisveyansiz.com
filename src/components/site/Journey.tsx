"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, MeshReflectorMaterial, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";
import { Network, SYSTEMS, rng, type Labels } from "./Network";
import { ContactTerminal } from "./Contact";
import { cvData } from "@/data/cv";

// The scroll journey, in two acts behind the whole page.
//  Space: a night-side planet with the systems network as a constellation of satellites in orbit around it
//  (Start), then close to one of those satellites as it passes (About), then a dive through the atmosphere.
//  The data hall: the camera arrives at the hall and flies down and over its racks, stopping at a server
//  pulled out for maintenance (Experience), a holographic projector (Results), a patch panel (Skills and
//  credentials) and the terminal at the end (Contact).
// Each stop is a section's position on the page, so the scene and the captions always line up.
// Everything is generated in code (no image files), so the strict CSP holds.

const STOPS = ["top", "about", "work", "results", "skills", "contact"];

// --- space ---------------------------------------------------------------------------------------
const PLANET_AT = new THREE.Vector3(0, 0, 0);
const PLANET_R = 14;
const ORBIT_R = 18.5;
const SUN_DIR = new THREE.Vector3(0.85, 0.05, -0.55).normalize();
const SAT_AT: [number, number, number] = [9, 8, 19.5];

// --- the data hall -------------------------------------------------------------------------------
const HALL_START = 6;
const HALL_END = -70;
const CEIL = 4.6;
const RACK_X = 2.25;
const RACK_PITCH = 0.66;
const rackZ = (i: number) => HALL_START - 2 - i * RACK_PITCH;
const WORK_Z = rackZ(23);
const RESULTS_Z = -27;
const SKILLS_Z = rackZ(70);
const FACE = RACK_X - 0.553; // distance of a rack's front face from the aisle's centre line
// The terminal's screen carries the contact form: exactly the form the visitor ends up typing into, drawn onto
// the screen in perspective. So the screen has the form's shape: landscape for the two-column desktop form, and
// on phones a portrait monitor for the stacked one. FORM_* is the form's size in CSS pixels. (This module only
// ever runs in the browser.)
export const PORTRAIT = typeof window !== "undefined" && innerWidth < 768;
export const FORM_W = PORTRAIT ? 360 : 960;
export const FORM_H = PORTRAIT ? 700 : 563;
const SCREEN_Z = HALL_END + 0.66;
const SCREEN_H = PORTRAIT ? 1.9 : 1.5;
const SCREEN_W = (SCREEN_H * FORM_W) / FORM_H;
const SCREEN_Y = PORTRAIT ? 1.62 : 1.5;
// How far in front of the screen the flight ends: where the screen fills about the space the live form takes.
const SCREEN_END = PORTRAIT ? 2.05 : 1.78;
// The live form is centred in the space below the 64px header, a little below the middle of the view, so the
// flight ends slightly above the screen's centre to put the screen exactly where the form will be.
const SCREEN_LIFT = PORTRAIT ? 0.08 : 0.066;
const SCREEN_CORNERS = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) =>
  new THREE.Vector3((x * SCREEN_W) / 2, SCREEN_Y + (y * SCREEN_H) / 2, SCREEN_Z));

// A CSS matrix3d that maps a w x h box onto four screen points (top-left, top-right, bottom-right, bottom-left).
function adj(m: number[]) {
  return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
}
function mulmm(a: number[], b: number[]) {
  const c = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j];
    c[3 * i + j] = s;
  }
  return c;
}
function basis(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
  const m = [x1, x2, x3, y1, y2, y3, 1, 1, 1];
  const a = adj(m);
  const v = [a[0] * x4 + a[1] * y4 + a[2], a[3] * x4 + a[4] * y4 + a[5], a[6] * x4 + a[7] * y4 + a[8]];
  return mulmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}
function quadToCss(w: number, h: number, p: { x: number; y: number }[]) {
  const t = mulmm(basis(p[0].x, p[0].y, p[1].x, p[1].y, p[3].x, p[3].y, p[2].x, p[2].y), adj(basis(0, 0, w, 0, 0, h, w, h)));
  for (let i = 0; i < 9; i++) t[i] /= t[8];
  return `matrix3d(${t[0]},${t[3]},0,${t[6]},${t[1]},${t[4]},0,${t[7]},0,0,1,0,${t[2]},${t[5]},0,${t[8]})`;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// The page's palette (globals.css, switchable with ?palette=), so the scene's accents follow it: the accent,
// the screen/hologram colour and the page ground. Hardware status LEDs keep their real-world colours.
const pc = (name: string, fallback: string) =>
  (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;
const ACCENT = () => pc("--c-accent", "#ff6b5b");
const SCREEN = () => pc("--c-screen", "#7ee8f0");
const rgba = (hex: string, a: number) => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`;
};

// Camera routes. Space: the planet and its constellation, past the constellation, beside the satellite, the dive
// into the atmosphere. Hall: entry, then each stop with a
// fly-over above the racks between them. Points are spaced evenly in the curve's t.
function routes(wide: boolean) {
  return {
    space: {
      pos: new THREE.CatmullRomCurve3([wide ? v(0, 6, 50) : v(0, -2, 66), v(8, 9, 38), v(13.5, 10.5, 26), v(3.6, 3.6, 15.4)]),
      look: new THREE.CatmullRomCurve3([wide ? v(-15, 2, 0) : v(0, -15, 0), v(-2, 3, 0), v(6.5, 5.5, 13), v(0, 0, 0)]),
    },
    hall: {
      pos: new THREE.CatmullRomCurve3([
        v(0, 1.7, 11), v(0.62, 1.78, WORK_Z + 0.95), v(0, 3.75, -18), v(0, 1.95, RESULTS_Z + 5.2),
        v(-0.3, 3.75, -35), v(-0.15, 1.6, SKILLS_Z + 2.2), v(0, 3.2, -55), v(0, SCREEN_Y + SCREEN_LIFT, SCREEN_Z + SCREEN_END),
      ]),
      look: new THREE.CatmullRomCurve3([
        v(0, 1.5, 0), v(1.5, 1.22, WORK_Z - 0.05), v(0, 2.4, -30), v(0, 1.45, RESULTS_Z),
        v(0, 2.3, -46), v(-1.65, 1.35, SKILLS_Z), v(0, 1.8, -66), v(0, SCREEN_Y + SCREEN_LIFT, SCREEN_Z - 2),
      ]),
    },
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ================================================================================================
// Space
// ================================================================================================

function Starfield({ count }: { count: number }) {
  const geo = useMemo(() => {
    const rand = rng(3);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    // Real star colours run from blue-white through white to pale orange; most are white.
    const temps = [new THREE.Color("#cfd9ff"), new THREE.Color("#ffffff"), new THREE.Color("#fff1dc"), new THREE.Color("#ffd2a8")];
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 180 + rand() * 120;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      const c = temps[rand() < 0.62 ? 1 : Math.floor(rand() * 4)].clone().multiplyScalar(0.4 + rand() * 0.6);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, [count]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors transparent opacity={0.95} depthWrite={false} toneMapped={false} fog={false} />
    </points>
  );
}

const NOISE = /* glsl */ `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+2.0*C.xxx; vec3 x3=x0-1.0+3.0*C.xxx;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.5,f=0.0;for(int i=0;i<5;i++){f+=a*snoise(p);p*=2.03;a*=0.5;}return f;}
`;

// A night-side planet: continents, ice caps and drifting cloud, a thin sunlit crescent, and city lights
// clustered on land across the dark side.
function Planet({ still }: { still: boolean }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vP; varying vec3 vWN; varying vec3 vW;
      void main(){ vP = position; vWN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vP; varying vec3 vWN; varying vec3 vW;
      void main(){
        vec3 p = normalize(vP);
        float h = fbm(p * 1.7);
        float land = smoothstep(0.03, 0.09, h);
        float ice = smoothstep(0.8, 0.9, abs(p.y));
        vec3 ocean = vec3(0.02, 0.07, 0.16);
        vec3 ground = mix(vec3(0.11, 0.13, 0.07), vec3(0.26, 0.21, 0.13), smoothstep(0.1, 0.4, h));
        vec3 surf = mix(mix(ocean, ground, land), vec3(0.86, 0.89, 0.93), ice);
        float clouds = smoothstep(0.12, 0.6, fbm(p * 3.2 + vec3(uTime * 0.008, 0.0, 0.0)));
        vec3 N = normalize(vWN);
        float ndl = dot(N, uSun);
        float dayAmt = smoothstep(-0.06, 0.22, ndl);
        vec3 day = surf * (0.08 + 1.25 * max(ndl, 0.0));
        day = mix(day, vec3(0.95), clouds * 0.6 * max(ndl, 0.0));
        float city = smoothstep(0.74, 0.92, snoise(p * 30.0) * 0.5 + 0.5) * smoothstep(0.05, 0.4, fbm(p * 5.0 + 7.0));
        vec3 lights = vec3(1.0, 0.63, 0.3) * 2.4 * city * land * (1.0 - ice) * (1.0 - dayAmt) * (1.0 - clouds * 0.7);
        vec3 col = mix(surf * 0.015 + vec3(0.004, 0.006, 0.02), day, dayAmt) + lights;
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vec3(0.25, 0.48, 1.0) * rim * (0.12 + 0.9 * smoothstep(-0.3, 0.4, ndl));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }), []);
  const atmo = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `
      varying vec3 vWN; varying vec3 vW;
      void main(){ vWN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; varying vec3 vWN; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vWN);
        float i = pow(max(0.0, 0.72 + dot(N, V)), 4.0);
        float lit = smoothstep(-0.35, 0.45, dot(N, uSun));
        gl_FragColor = vec4(vec3(0.3, 0.55, 1.0) * i * (0.15 + 1.4 * lit), i);
      }`,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);
  const planet = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
    if (!still && planet.current) planet.current.rotation.y += dt * 0.004;
  });
  return (
    <group position={PLANET_AT}>
      <mesh ref={planet} material={mat}><sphereGeometry args={[PLANET_R, 128, 96]} /></mesh>
      <mesh material={atmo}><sphereGeometry args={[PLANET_R * 1.06, 96, 64]} /></mesh>
    </group>
  );
}

// The sun, just past the planet's edge, for a sunrise on the limb.
function Sun() {
  const at = useMemo(() => PLANET_AT.clone().addScaledVector(SUN_DIR, 260), []);
  return (
    <mesh position={at}>
      <sphereGeometry args={[3.2, 32, 32]} />
      <meshBasicMaterial color={new THREE.Color("#fff3d6").multiplyScalar(6)} toneMapped={false} fog={false} />
    </mesh>
  );
}

function solarCells() {
  return canvasTexture(256, 96, (g) => {
    g.fillStyle = "#0b1a3a"; g.fillRect(0, 0, 256, 96);
    for (let x = 0; x < 256; x += 16) for (let y = 0; y < 96; y += 16) {
      g.fillStyle = (x / 16 + y / 16) % 2 ? "#13285a" : "#112452"; g.fillRect(x + 1, y + 1, 14, 14);
    }
    g.strokeStyle = "#7f8db0"; g.lineWidth = 2; g.strokeRect(1, 1, 254, 94);
  });
}

// A communications satellite: foil-wrapped body, two solar wings and a dish, turning slowly as it passes.
function Satellite({ still }: { still: boolean }) {
  const g = useRef<THREE.Group>(null);
  const cells = useMemo(solarCells, []);
  useFrame(({ clock }) => {
    if (!g.current || still) return;
    const t = clock.elapsedTime;
    g.current.rotation.y = t * 0.08;
    g.current.rotation.z = Math.sin(t * 0.2) * 0.12;
    g.current.position.y = SAT_AT[1] + Math.sin(t * 0.3) * 0.15;
  });
  const foil = { color: "#c9a14a", metalness: 1, roughness: 0.32 };
  return (
    <group ref={g} position={SAT_AT} rotation={[0.3, 0, 0.1]}>
      <mesh><boxGeometry args={[0.55, 0.55, 0.85]} /><meshStandardMaterial {...foil} /></mesh>
      <mesh position={[0, 0.3, 0]}><boxGeometry args={[0.5, 0.06, 0.8]} /><meshStandardMaterial color="#d9dde5" metalness={0.6} roughness={0.4} /></mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * 0.62, 0, 0]}><boxGeometry args={[0.4, 0.03, 0.03]} /><meshStandardMaterial color="#9aa1ad" metalness={0.8} roughness={0.3} /></mesh>
          <mesh position={[s * 1.75, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.9, 0.62]} />
            <meshStandardMaterial map={cells} metalness={0.5} roughness={0.35} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -0.45, 0.2]} rotation={[0.6, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.05, 0.12, 32, 1, true]} />
        <meshStandardMaterial color="#e8eaee" metalness={0.3} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.47]}><cylinderGeometry args={[0.02, 0.02, 0.3, 8]} /><meshStandardMaterial color="#c8ccd4" /></mesh>
    </group>
  );
}

// ================================================================================================
// The data hall
// ================================================================================================

// The front of a 42U rack: server faces with vents, handles and the odd blank panel.
function rackFace() {
  const rand = rng(11);
  return canvasTexture(128, 512, (g) => {
    g.fillStyle = "#0d1017"; g.fillRect(0, 0, 128, 512);
    g.fillStyle = "#1a1f2a"; g.fillRect(4, 4, 120, 504);
    let y = 8;
    while (y < 500) {
      const u = rand() < 0.2 ? 2 : 1;
      const h = u * 11.6;
      const blank = rand() < 0.12;
      g.fillStyle = blank ? "#12151c" : rand() < 0.5 ? "#232a37" : "#1e2430";
      g.fillRect(8, y, 112, h - 1.5);
      if (!blank) {
        g.fillStyle = "#0b0d12";
        for (let x = 14; x < 84; x += 3.2) for (let vy = y + 2.5; vy < y + h - 3; vy += 3) g.fillRect(x, vy, 1.6, 1.6);
        g.fillStyle = "#3a4252"; g.fillRect(10, y + 2, 2, h - 5); g.fillRect(116, y + 2, 2, h - 5);
      }
      y += h;
    }
  });
}

// Raised-floor tiles; every other row in the aisle is perforated for cold air.
function floorTiles() {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = "#12172a"; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x = i * 256, y = j * 256;
      g.fillStyle = (i + j) % 2 ? "#151b31" : "#131830"; g.fillRect(x + 3, y + 3, 250, 250);
      if (j === 0) {
        g.fillStyle = "#0b0f1f";
        for (let a = x + 20; a < x + 240; a += 12) for (let b = y + 20; b < y + 240; b += 12) g.fillRect(a, b, 4, 4);
      }
    }
  });
}

// The terminal's screen: a dark glass with scan lines and a glow at its centre. When the camera arrives, the
// contact form appears on it (it's part of the page, so it stays sharp and usable).
function terminalScreen() {
  return canvasTexture(1024, 600, (g) => {
    const glow = g.createRadialGradient(512, 320, 40, 512, 320, 560);
    glow.addColorStop(0, "#14204a"); glow.addColorStop(1, "#060917");
    g.fillStyle = glow; g.fillRect(0, 0, 1024, 600);
    g.fillStyle = rgba(SCREEN(), 0.05);
    for (let y = 0; y < 600; y += 4) g.fillRect(0, y, 1024, 1);
    g.fillStyle = rgba(SCREEN(), 0.18); g.fillRect(0, 0, 1024, 6);
  });
}

function DataHall({ mobile, still }: { mobile: boolean; still: boolean }) {
  const perRow = Math.floor((HALL_START - HALL_END - 6) / RACK_PITCH);
  const ledsPerRack = mobile ? 10 : 18;
  const racks = useRef<THREE.InstancedMesh>(null);
  const faces = useRef<THREE.InstancedMesh>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const strips = useRef<THREE.InstancedMesh>(null);
  const cones = useRef<THREE.InstancedMesh>(null);
  const faceTex = useMemo(rackFace, []);
  const floorTex = useMemo(() => {
    const t = floorTiles();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 76);
    return t;
  }, []);
  const screenTex = useMemo(terminalScreen, []);
  const exitTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0d5c33"; g.fillRect(0, 0, 256, 96);
    g.fillStyle = "#c9ffe0"; g.font = "700 58px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("EXIT", 128, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  const rackList = useMemo(() => {
    const out: { x: number; z: number; side: 1 | -1 }[] = [];
    for (const side of [1, -1] as const) for (let i = 0; i < perRow; i++) out.push({ x: side * RACK_X, z: rackZ(i), side });
    return out;
  }, [perRow]);

  const ledList = useMemo(() => {
    const rand = rng(5);
    const palette = [new THREE.Color("#4fe3c1"), new THREE.Color("#4fe3c1"), new THREE.Color("#7ee8f0"), new THREE.Color("#ffb347"), new THREE.Color("#ff6b5b")];
    return rackList.flatMap((r) =>
      Array.from({ length: ledsPerRack }, () => ({
        x: r.x - r.side * 0.556, y: 0.15 + Math.floor(rand() * 40) * 0.046, z: r.z + (rand() - 0.5) * 0.4,
        c: palette[Math.floor(rand() * (rand() < 0.85 ? 3 : 5))].clone().multiplyScalar(1.3),
        rate: 0.6 + rand() * 6, phase: rand() * 10, steady: rand() < 0.55,
      })));
  }, [rackList, ledsPerRack]);

  const stripZ = useMemo(() => {
    const out: number[] = [];
    for (let z = HALL_START - 1; z > HALL_END; z -= 2.4) out.push(z);
    return out;
  }, []);

  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    rackList.forEach((r, i) => {
      racks.current!.setMatrixAt(i, m.makeTranslation(r.x, 1.06, r.z));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.side === 1 ? -Math.PI / 2 : Math.PI / 2);
      faces.current!.setMatrixAt(i, m.compose(new THREE.Vector3(r.x - r.side * 0.553, 1.06, r.z), q, s));
    });
    racks.current!.instanceMatrix.needsUpdate = true;
    faces.current!.instanceMatrix.needsUpdate = true;
    ledList.forEach((l, i) => {
      leds.current!.setMatrixAt(i, m.makeTranslation(l.x, l.y, l.z));
      leds.current!.setColorAt(i, l.c);
    });
    leds.current!.instanceMatrix.needsUpdate = true;
    stripZ.forEach((z, i) => {
      strips.current!.setMatrixAt(i, m.makeTranslation(0, CEIL - 0.12, z));
      cones.current?.setMatrixAt(i, m.makeTranslation(0, CEIL / 2 - 0.1, z));
    });
    strips.current!.instanceMatrix.needsUpdate = true;
    if (cones.current) cones.current.instanceMatrix.needsUpdate = true;
  }, [rackList, ledList, stripZ]);

  // Status lights: most hold steady, the rest flicker with disk and network activity.
  const off = useMemo(() => new THREE.Color("#10131c"), []);
  const tick = useRef(0);
  useFrame(({ clock }) => {
    if (still || !leds.current) return;
    if ((tick.current = (tick.current + 1) % 3) !== 0) return;
    const t = clock.elapsedTime;
    ledList.forEach((l, i) => {
      if (!l.steady) leds.current!.setColorAt(i, Math.sin(t * l.rate + l.phase) > 0.2 ? l.c : off);
    });
    leds.current.instanceColor!.needsUpdate = true;
  });

  const length = HALL_START - HALL_END;
  const mid = (HALL_START + HALL_END) / 2;
  const lights = useMemo(() => {
    const out: number[] = [];
    for (let z = HALL_START - 4; z > HALL_END; z -= mobile ? 14 : 9) out.push(z);
    return out;
  }, [mobile]);

  return (
    <group>
      {/* Floor: raised tiles, reflective on bigger screens. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, mid]}>
        <planeGeometry args={[7.2, length]} />
        {mobile ? (
          <meshStandardMaterial map={floorTex} roughness={0.45} metalness={0.4} />
        ) : (
          <MeshReflectorMaterial map={floorTex} blur={[320, 90]} resolution={1024} mixBlur={1} mixStrength={7}
            roughness={0.55} depthScale={1} minDepthThreshold={0.4} maxDepthThreshold={1.4} metalness={0.5} mirror={0.6} />
        )}
      </mesh>
      {/* Ceiling, side walls, the end wall, and the entrance wall with the aisle as its doorway. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CEIL, mid]}>
        <planeGeometry args={[7.2, length]} />
        <meshStandardMaterial color="#0a0d1a" roughness={0.9} />
      </mesh>
      {[-3.6, 3.6].map((x) => (
        <mesh key={x} rotation={[0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]} position={[x, CEIL / 2, mid]}>
          <planeGeometry args={[length, CEIL]} />
          <meshStandardMaterial color="#0b0f1f" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, CEIL / 2, HALL_END]}>
        <planeGeometry args={[7.2, CEIL]} />
        <meshStandardMaterial color="#070a14" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 2.55, CEIL / 2, HALL_START]}>
          <planeGeometry args={[2.1, CEIL]} />
          <meshStandardMaterial color="#0b0f1f" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Racks. */}
      <instancedMesh ref={racks} args={[undefined, undefined, rackList.length]}>
        <boxGeometry args={[1.1, 2.12, 0.62]} />
        <meshStandardMaterial color="#141822" metalness={0.75} roughness={0.38} />
      </instancedMesh>
      <instancedMesh ref={faces} args={[undefined, undefined, rackList.length]}>
        <planeGeometry args={[0.6, 2.08]} />
        <meshStandardMaterial map={faceTex} metalness={0.55} roughness={0.42} />
      </instancedMesh>
      <instancedMesh ref={leds} args={[undefined, undefined, ledList.length]}>
        <boxGeometry args={[0.008, 0.009, 0.018]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Wire-basket trays above each row carrying black and grey power and copper bundles, a yellow fibre
          channel above the right-hand row, and red sprinkler pipes along the ceiling. */}
      {[-RACK_X, RACK_X].map((x) => (
        <group key={x}>
          <mesh position={[x, 2.48, mid]}>
            <boxGeometry args={[0.7, 0.03, length]} />
            <meshStandardMaterial color="#5b6170" metalness={0.9} roughness={0.35} />
          </mesh>
          {[-0.33, 0.33].map((o) => (
            <mesh key={o} position={[x + o, 2.53, mid]}>
              <boxGeometry args={[0.02, 0.1, length]} />
              <meshStandardMaterial color="#5b6170" metalness={0.9} roughness={0.35} />
            </mesh>
          ))}
          {[["#15171c", 0.07], ["#1d2026", 0.06], ["#2b2f37", 0.05], ["#15171c", 0.065]].map(([c, r], i) => (
            <mesh key={i} position={[x - 0.21 + i * 0.14, 2.52 + (r as number), mid]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[r as number, r as number, length, 10]} />
              <meshStandardMaterial color={c as string} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[RACK_X, 2.95, mid]}>
        <boxGeometry args={[0.32, 0.12, length]} />
        <meshStandardMaterial color="#8f7630" roughness={0.8} metalness={0.05} />
      </mesh>
      {[-1.3, 1.3].map((x) => (
        <mesh key={x} position={[x, CEIL - 0.28, mid]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, length, 12]} />
          <meshStandardMaterial color="#9b2a22" roughness={0.45} metalness={0.3} />
        </mesh>
      ))}

      {/* Overhead light strips, the light they throw, and a faint beam with dust drifting in it. */}
      <instancedMesh ref={strips} args={[undefined, undefined, stripZ.length]}>
        <boxGeometry args={[0.16, 0.03, 1.5]} />
        <meshBasicMaterial color={new THREE.Color("#dbe4ff").multiplyScalar(2.4)} toneMapped={false} />
      </instancedMesh>
      {!mobile && (
        <instancedMesh ref={cones} args={[undefined, undefined, stripZ.length]}>
          <cylinderGeometry args={[0.1, 0.85, CEIL - 0.2, 24, 1, true]} />
          <meshBasicMaterial color="#9fb0ff" transparent opacity={0.012} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
      <Dust count={mobile ? 300 : 900} still={still} />
      {lights.map((z) => (
        <pointLight key={z} position={[0, CEIL - 0.3, z]} color="#b8c4ff" intensity={mobile ? 14 : 10} distance={13} decay={2} />
      ))}

      <ServerSled still={still} />
      <Hologram still={still} />
      <Credentials still={still} />

      {/* The terminal at the end of the aisle: a monitor on a stand, on a console desk with a keyboard, and an
          exit sign above. */}
      <mesh position={[0, 0.57, HALL_END + 0.95]}>
        <boxGeometry args={[3.2, 0.05, 0.9]} />
        <meshStandardMaterial color="#1a1f2c" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-1.55, 1.55].map((x) => (
        <mesh key={x} position={[x, 0.27, HALL_END + 0.95]}>
          <boxGeometry args={[0.05, 0.55, 0.86]} />
          <meshStandardMaterial color="#141822" metalness={0.6} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[0, (0.61 + SCREEN_Y - SCREEN_H / 2) / 2, HALL_END + 0.62]}>
        <boxGeometry args={[0.16, SCREEN_Y - SCREEN_H / 2 - 0.61 + 0.06, 0.08]} />
        <meshStandardMaterial color="#141822" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.605, HALL_END + 0.62]}>
        <boxGeometry args={[0.6, 0.02, 0.3]} />
        <meshStandardMaterial color="#141822" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.607, HALL_END + 1.15]}>
        <boxGeometry args={[0.95, 0.022, 0.3]} />
        <meshStandardMaterial color="#0f131d" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[0, CEIL - 0.45, HALL_END + 0.02]}>
        <planeGeometry args={[0.44, 0.16]} />
        <meshBasicMaterial map={exitTex} toneMapped={false} />
      </mesh>
      <mesh position={[0, SCREEN_Y, HALL_END + 0.6]}>
        <boxGeometry args={[SCREEN_W + 0.14, SCREEN_H + 0.12, 0.08]} />
        <meshStandardMaterial color="#151a28" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, SCREEN_Y, HALL_END + 0.65]}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshBasicMaterial map={screenTex} toneMapped={false} />
      </mesh>
      <pointLight position={[0, SCREEN_Y, HALL_END + 2]} color={SCREEN()} intensity={4} distance={6} />
    </group>
  );
}

function Dust({ count, still }: { count: number; still: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const rand = rng(9);
    const p = new Float32Array(count * 3);
    // Kept clear of the terminal, where the camera ends up close enough for a speck to fill the view.
    for (let i = 0; i < count; i++) p.set([(rand() - 0.5) * 3, rand() * CEIL, HALL_START - rand() * (HALL_START - HALL_END - 6)], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useFrame(({ clock }) => {
    if (!still && ref.current) {
      ref.current.position.y = Math.sin(clock.elapsedTime * 0.15) * 0.12;
      ref.current.position.x = Math.sin(clock.elapsedTime * 0.11) * 0.08;
    }
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#c8d2ff" size={0.012} sizeAttenuation transparent opacity={0.45} depthWrite={false} />
    </points>
  );
}

// Experience: a 2U server pulled out on its rails with the lid off: drive bays, fans, two CPUs under finned
// heatsinks, banks of memory and twin power supplies.
function ServerSled({ still }: { still: boolean }) {
  const fans = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (!still && fans.current) fans.current.children.forEach((f) => { f.rotation.x += dt * 22; }); });
  const metal = { color: "#9097a3", metalness: 0.85, roughness: 0.32 };
  const dark = { color: "#1b1f27", metalness: 0.6, roughness: 0.45 };
  // The right row's faces are at x = FACE; the sled is out by 0.55 towards the aisle.
  const cx = FACE + 0.4 - 0.55;
  return (
    <group position={[cx, 1.25, WORK_Z]}>
      <mesh position={[0, -0.034, 0]}><boxGeometry args={[0.8, 0.02, 0.48]} /><meshStandardMaterial {...metal} /></mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0, 0, s * 0.235]}><boxGeometry args={[0.8, 0.07, 0.01]} /><meshStandardMaterial {...metal} /></mesh>
          <mesh position={[0.4, -0.02, s * 0.255]}><boxGeometry args={[0.9, 0.02, 0.02]} /><meshStandardMaterial color="#c3c8d1" metalness={0.9} roughness={0.25} /></mesh>
        </group>
      ))}
      {/* Front bezel with drive bays and status lights. */}
      <mesh position={[-0.4, 0, 0]}><boxGeometry args={[0.012, 0.088, 0.48]} /><meshStandardMaterial {...dark} /></mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <group key={i} position={[-0.37, 0.005, -0.2 + i * 0.057]}>
          <mesh><boxGeometry args={[0.05, 0.06, 0.05]} /><meshStandardMaterial color="#2a303b" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[-0.027, 0.022, 0.015]}><boxGeometry args={[0.004, 0.006, 0.006]} /><meshBasicMaterial color={new THREE.Color(i === 5 ? "#ffb347" : "#4fe3c1").multiplyScalar(2.5)} toneMapped={false} /></mesh>
        </group>
      ))}
      {/* Motherboard. */}
      <mesh position={[0.08, -0.02, 0]}><boxGeometry args={[0.52, 0.004, 0.44]} /><meshStandardMaterial color="#0f3b2b" roughness={0.6} metalness={0.2} /></mesh>
      {/* Fan wall. */}
      <group ref={fans}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} position={[-0.22, 0.01, -0.2 + i * 0.08]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.03, 0.03, 0.035, 5]} />
            <meshStandardMaterial color="#20252e" metalness={0.4} roughness={0.5} />
          </mesh>
        ))}
      </group>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[-0.22, 0.01, -0.2 + i * 0.08]}><boxGeometry args={[0.04, 0.07, 0.072]} /><meshStandardMaterial color="#14181f" transparent opacity={0.55} /></mesh>
      ))}
      {/* Two CPUs under finned heatsinks. */}
      {[-0.08, 0.08].map((z) => (
        <group key={z} position={[0.02, 0, z]}>
          <mesh position={[0, -0.012, 0]}><boxGeometry args={[0.11, 0.012, 0.11]} /><meshStandardMaterial color="#c9a14a" metalness={1} roughness={0.3} /></mesh>
          {Array.from({ length: 16 }, (_, i) => (
            <mesh key={i} position={[0, 0.015, -0.05 + i * 0.0066]}><boxGeometry args={[0.1, 0.045, 0.0022]} /><meshStandardMaterial color="#c7ccd5" metalness={0.9} roughness={0.25} /></mesh>
          ))}
        </group>
      ))}
      {/* Memory: four banks of DIMMs either side of the CPUs. */}
      {[-0.19, -0.15, 0.15, 0.19].map((z0) =>
        Array.from({ length: 4 }, (_, i) => (
          <mesh key={`${z0}-${i}`} position={[0.02, 0.0, z0 + (i - 1.5) * 0.009]}>
            <boxGeometry args={[0.13, 0.034, 0.003]} />
            <meshStandardMaterial color="#121418" metalness={0.4} roughness={0.5} />
          </mesh>
        )))}
      {/* Twin power supplies at the back. */}
      {[-0.13, 0.13].map((z) => (
        <mesh key={z} position={[0.32, 0.0, z]}><boxGeometry args={[0.14, 0.05, 0.1]} /><meshStandardMaterial color="#aab0ba" metalness={0.85} roughness={0.35} /></mesh>
      ))}
      <pointLight position={[-0.5, 0.55, 0.1]} color="#e6ecff" intensity={4} distance={2.4} />
    </group>
  );
}

// Results: a floor projector throwing a holographic chart: a beam of light with bars inside it, falling from
// one side round to the other, and two rings of light turning slowly.
function Hologram({ still }: { still: boolean }) {
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const bars = useRef<THREE.Group>(null);
  const heights = [1.0, 0.92, 0.86, 0.74, 0.66, 0.57, 0.49, 0.42, 0.36];
  useFrame(({ clock }, dt) => {
    if (still) return;
    if (ringA.current) ringA.current.rotation.z += dt * 0.4;
    if (ringB.current) ringB.current.rotation.z -= dt * 0.25;
    if (bars.current) {
      bars.current.rotation.y += dt * 0.15;
      const flicker = 0.38 + Math.sin(clock.elapsedTime * 13) * 0.03 + Math.sin(clock.elapsedTime * 3.1) * 0.04;
      bars.current.children.forEach((b) => (((b as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = flicker));
    }
  });
  const cyan = new THREE.Color(SCREEN());
  const accent = new THREE.Color(ACCENT());
  return (
    <group position={[0, 0, RESULTS_Z]}>
      <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[0.55, 0.62, 0.08, 48]} /><meshStandardMaterial color="#1b2030" metalness={0.85} roughness={0.3} /></mesh>
      <mesh position={[0, 0.085, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.48, 0.012, 8, 64]} /><meshBasicMaterial color={accent.clone().multiplyScalar(2.5)} toneMapped={false} /></mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.85, 0.5, 2.2, 48, 1, true]} />
        <meshBasicMaterial color={cyan} transparent opacity={0.05} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={bars} position={[0, 0.45, 0]}>
        {heights.map((h, i) => {
          const a = (i / heights.length) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.42, h / 2, Math.sin(a) * 0.42]}>
              <boxGeometry args={[0.09, h, 0.09]} />
              <meshBasicMaterial color={(i > 6 ? accent.clone() : cyan.clone()).multiplyScalar(1.6)}
                transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      <mesh ref={ringA} position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.7, 0.006, 6, 96]} />
        <meshBasicMaterial color={cyan.clone().multiplyScalar(2)} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <mesh ref={ringB} position={[0, 1.65, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.82, 0.005, 6, 96]} />
        <meshBasicMaterial color={cyan.clone().multiplyScalar(2)} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.2, 0]} color={cyan} intensity={3} distance={4} />
    </group>
  );
}

// Skills and credentials: a hologram in the aisle facing the camera, one glowing badge per certification
// (exam-based ones only, from the CV), with the core tools running along a ticker underneath.
const CRED_SHOWN = ["AWS Certified Solutions Architect – Associate", "Kubernetes and Cloud Native Associate (KCNA)",
  "AWS Certified Cloud Practitioner", "LPI Linux Essentials", "ITIL 4 Foundation"];
const CORE_TOOLS = ["Microsoft Azure", "Azure DevOps", "GitLab CI/CD", "PowerShell", "Ansible", "Windows Server",
  "Red Hat Enterprise Linux", "VMware", "Docker", "AWS", "Kubernetes", "Python", "Terraform (learning)"];
const ISSUER: Record<string, string> = { AWS: "AWS", "Linux Foundation": "LINUX FOUNDATION", "Linux Professional Institute": "LPI", PeopleCert: "PEOPLECERT" };

function fonts() {
  const cs = getComputedStyle(document.documentElement);
  return { body: getComputedStyle(document.body).fontFamily, display: cs.getPropertyValue("--font-display").trim() || "sans-serif" };
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
  }
  return [...lines, line];
}

function badgeTexture(name: string, issuer: string, year: string) {
  return canvasTexture(640, 400, (g) => {
    const { body, display } = fonts();
    g.clearRect(0, 0, 640, 400);
    g.fillStyle = "rgba(8, 18, 40, 0.9)";
    g.strokeStyle = rgba(SCREEN(), 0.9);
    g.lineWidth = 3;
    g.beginPath(); g.roundRect(6, 6, 628, 388, 18); g.fill(); g.stroke();
    // A hexagon seal on the left.
    const cx = 110, cy = 200, r = 70;
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    g.closePath(); g.strokeStyle = ACCENT(); g.lineWidth = 4; g.stroke();
    g.fillStyle = rgba(ACCENT(), 0.12); g.fill();
    g.fillStyle = pc("--c-bone", "#eef0fb"); g.font = `600 26px ${body}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(year, cx, cy);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = SCREEN(); g.font = `400 20px ${display}`;
    g.fillText(issuer, 214, 112);
    g.fillStyle = pc("--c-bone", "#eef0fb"); g.font = `600 38px ${body}`;
    wrap(g, name, 390).slice(0, 4).forEach((l, i) => g.fillText(l, 214, 168 + i * 46));
  });
}

function Credentials({ still }: { still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const cards = useRef<THREE.Group>(null);
  const ticker = useRef<THREE.Texture | null>(null);
  const [ready, setReady] = useState(0);
  useEffect(() => { document.fonts?.ready.then(() => setReady((n) => n + 1)); }, []);
  const certs = useMemo(() => cvData.certifications.filter((c) => CRED_SHOWN.includes(c.name))
    .sort((a, b) => CRED_SHOWN.indexOf(a.name) - CRED_SHOWN.indexOf(b.name)), []);
  const textures = useMemo(() => certs.map((c) => badgeTexture(c.name.replace(" (KCNA)", ""), ISSUER[c.issuer] ?? c.issuer.toUpperCase(), c.year)), [certs, ready]);
  const title = useMemo(() => canvasTexture(1024, 96, (g) => {
    const { display } = fonts();
    g.fillStyle = SCREEN(); g.font = `400 54px ${display}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("CERTIFIED", 512, 50);
  }), [ready]);
  const tickerTex = useMemo(() => {
    const t = canvasTexture(2048, 64, (g) => {
      const { body } = fonts();
      g.fillStyle = pc("--c-bone", "#eef0fb"); g.font = `500 30px ${body}`; g.textBaseline = "middle";
      let x = 10;
      while (x < 2048) for (const tool of CORE_TOOLS) { g.fillText(tool, x, 34); x += g.measureText(tool).width + 24; g.fillStyle = ACCENT(); g.fillText("/", x - 16, 34); g.fillStyle = pc("--c-bone", "#eef0fb"); x += 12; }
    });
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(0.5, 1);
    ticker.current = t;
    return t;
  }, [ready]);

  // Placed along the camera's line of sight at this stop, a little right of centre so the caption card
  // doesn't cover it, and turned to face the camera.
  const place = useMemo(() => {
    const from = v(-0.15, 1.6, SKILLS_Z + 2.2), to = v(-1.65, 1.35, SKILLS_Z);
    const d = to.clone().sub(from).normalize();
    const right = d.clone().cross(v(0, 1, 0)).normalize();
    const at = from.clone().add(d.clone().multiplyScalar(PORTRAIT ? 2.1 : 1.75)).add(right.multiplyScalar(PORTRAIT ? 0 : 0.4)).add(v(0, PORTRAIT ? 0.24 : 0.06, 0));
    return { at, from };
  }, []);
  useEffect(() => { group.current?.lookAt(place.from); }, [place]);

  const cols = PORTRAIT ? 2 : 3, W = 0.62, H = 0.39, gap = 0.06;
  const layout = certs.map((_, i) => {
    const row = Math.floor(i / cols), inRow = Math.min(cols, certs.length - row * cols), col = i % cols;
    return [(col - (inRow - 1) / 2) * (W + gap), -row * (H + gap)];
  });
  const rows = Math.ceil(certs.length / cols);
  const top = ((rows - 1) * (H + gap)) / 2;

  useFrame(({ clock }, dt) => {
    if (still) return;
    if (ticker.current) ticker.current.offset.x = (ticker.current.offset.x + dt * 0.02) % 1;
    cards.current?.children.forEach((c, i) => {
      c.position.z = Math.sin(clock.elapsedTime * 0.8 + i * 1.3) * 0.02;
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 + Math.sin(clock.elapsedTime * 11 + i) * 0.04;
    });
  });
  return (
    <group ref={group} position={place.at} scale={PORTRAIT ? 0.5 : 0.78}>
      <mesh position={[0, top + H / 2 + 0.16, 0]}>
        <planeGeometry args={[1.1, 0.1]} />
        <meshBasicMaterial map={title} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <group ref={cards} position={[0, top, 0]}>
        {textures.map((t, i) => (
          <mesh key={i} position={[layout[i][0], layout[i][1], 0]}>
            <planeGeometry args={[W, H]} />
            <meshBasicMaterial map={t} transparent opacity={0.92} toneMapped={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, top - (rows - 1) * (H + gap) - H / 2 - 0.12, 0]}>
        <planeGeometry args={[PORTRAIT ? 1.3 : 2.0, 0.065]} />
        <meshBasicMaterial map={tickerTex} transparent opacity={0.85} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* Emitter light falling on the racks around it. */}
      <pointLight position={[0, 0, 0.5]} color={SCREEN()} intensity={2.2} distance={3} />
    </group>
  );
}

// ================================================================================================
// Camera
// ================================================================================================

// Flies the camera along the routes as the page scrolls, banking into turns. Switches between space and the
// hall halfway through the dive, behind a brief dip to dark.
type ScreenMode = "off" | "screen" | "live";

function CameraRig({ wide, labelsBox, dip, space, hall, still, form, onMode }: {
  wide: boolean; labelsBox: React.RefObject<HTMLDivElement | null>; dip: React.RefObject<HTMLDivElement | null>;
  space: React.RefObject<THREE.Group | null>; hall: React.RefObject<THREE.Group | null>; still: boolean;
  form: React.RefObject<HTMLDivElement | null>; onMode: (m: ScreenMode) => void;
}) {
  const { camera, scene, size } = useThree();
  const screenMode = useRef<ScreenMode>("off");
  const corner = useMemo(() => new THREE.Vector3(), []);
  const pts = useMemo(() => SCREEN_CORNERS.map(() => ({ x: 0, y: 0 })), []);
  const anchors = useRef<number[]>([]);
  const r = useMemo(() => routes(wide), [wide]);
  const look = useRef(new THREE.Vector3(-15, 2, 0));
  const target = useMemo(() => new THREE.Vector3(), []);
  const targetLook = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const mode = useRef<"space" | "hall" | null>(null);
  const roll = useRef(0);
  const lastYaw = useRef(0);
  const cutKey = useRef("");
  const cutFade = useRef(0);

  useEffect(() => {
    if (!PORTRAIT) { (camera as THREE.PerspectiveCamera).clearViewOffset(); (camera as THREE.PerspectiveCamera).updateProjectionMatrix(); }
  }, [camera]);

  useEffect(() => {
    const measure = () => {
      anchors.current = STOPS.map((id) => {
        const el = document.getElementById(id);
        if (!el) return 0;
        const b = el.getBoundingClientRect();
        return Math.max(0, b.top + scrollY + b.height / 2 - innerHeight / 2);
      });
      anchors.current[0] = 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    addEventListener("resize", measure);
    return () => { ro.disconnect(); removeEventListener("resize", measure); };
  }, []);

  useFrame(({ clock }, dt) => {
    const a = anchors.current;
    if (!a.length) return;
    const y = scrollY;
    let i = 0;
    while (i < a.length - 2 && y >= a[i + 1]) i++;
    const raw = Math.min(1, Math.max(0, (y - a[i]) / Math.max(1, a[i + 1] - a[i])));
    // With reduced motion the camera doesn't fly: it holds at the nearest stop and cuts to the next one through
    // a short fade to dark.
    const s = still ? (raw < 0.5 ? 0 : 1) : raw;
    if (still) {
      const key = `${i}:${s}`;
      if (key !== cutKey.current) { if (cutKey.current) cutFade.current = 1; cutKey.current = key; }
      cutFade.current = Math.max(0, cutFade.current - dt / 0.3);
    }

    // Which route, and how far along it.
    let route: "space" | "hall";
    let t: number;
    let dark = 0;
    if (i === 0) { route = "space"; t = (smooth(s) * 2) / 3; }
    else if (i === 1) {
      if (s < 0.5) { route = "space"; t = 2 / 3 + smooth(s * 2) / 3; }
      else { route = "hall"; t = smooth((s - 0.5) * 2) / 7; }
      dark = Math.max(0, 1 - Math.abs(s - 0.5) / 0.14);
    } else { route = "hall"; t = (2 * (i - 1) - 1 + smooth(s) * 2) / 7; }

    const curve = route === "space" ? r.space : r.hall;
    curve.pos.getPoint(t, target);
    curve.look.getPoint(t, targetLook);
    if (!still) target.y += Math.sin(clock.elapsedTime * 0.6) * 0.025;

    if (route !== mode.current) {
      const first = mode.current === null;
      mode.current = route;
      if (!first || route === "hall") { camera.position.copy(target); look.current.copy(targetLook); }
      dispatchEvent(new CustomEvent("journey:route", { detail: route }));
      if (space.current) space.current.visible = route === "space";
      if (hall.current) hall.current.visible = route === "hall";
      if (scene.fog instanceof THREE.Fog) { scene.fog.near = route === "hall" ? 10 : 400; scene.fog.far = route === "hall" ? 46 : 900; }
    }
    const f = still ? 1 : 1 - Math.exp(-dt * 5);
    camera.position.lerp(target, f);
    look.current.lerp(targetLook, f);
    camera.lookAt(look.current);

    // Bank into turns, like a camera drone.
    camera.getWorldDirection(fwd);
    const yaw = Math.atan2(fwd.x, -fwd.z);
    const rate = dt > 0 ? (yaw - lastYaw.current) / dt : 0;
    lastYaw.current = yaw;
    const want = still ? 0 : THREE.MathUtils.clamp(-rate * 0.35, -0.3, 0.3);
    roll.current += (want - roll.current) * Math.min(1, dt * 4);
    camera.rotateZ(roll.current);

    if (labelsBox.current) labelsBox.current.style.opacity = String(Math.max(0, 1 - y / (innerHeight * 0.45)));
    if (dip.current) dip.current.style.opacity = String(Math.max(dark, cutFade.current));

    // The contact form is the picture on the terminal's screen: drawn onto it in perspective from the far end
    // of the hall, growing as the camera flies in. Over the last stretch of scroll its corners glide from the
    // screen to where the live form sits, so the picture becomes the form without a cut; at the end it's live.
    const el = form.current;
    if (!el) return;
    const last = route === "hall" && i === a.length - 2;
    const glide = last ? smooth(Math.min(1, Math.max(0, ((still ? s : raw) - 0.72) / 0.24))) : 0;
    let next: ScreenMode = "off";
    let css = "";
    let opacity = 1;
    camera.updateMatrixWorld();
    const dist = camera.position.distanceTo(corner.set(0, SCREEN_Y, SCREEN_Z));
    if (route === "hall" && dist < 42) {
      let inFront = true;
      SCREEN_CORNERS.forEach((c, k) => {
        corner.copy(c).applyMatrix4(camera.matrixWorldInverse);
        if (corner.z > -0.1) inFront = false;
        corner.copy(c).project(camera);
        pts[k].x = (corner.x * 0.5 + 0.5) * size.width;
        pts[k].y = (-corner.y * 0.5 + 0.5) * size.height;
      });
      if (inFront || glide >= 1) {
        // Where the live form sits: centred below the header, clear of the progress rail on wide screens.
        const fit = PORTRAIT
          ? Math.min((size.width - 24) / FORM_W, (size.height - 88) / FORM_H)
          : Math.min((size.width - 192) / FORM_W, (size.height - 120) / FORM_H);
        const x0 = (size.width - FORM_W * fit) / 2, y0 = 64 + (size.height - 64 - FORM_H * fit) / 2;
        if (glide >= 1) {
          next = "live";
          css = `translate(${x0}px, ${y0}px) scale(${fit})`;
        } else {
          next = "screen";
          const goal = [[x0, y0], [x0 + FORM_W * fit, y0], [x0 + FORM_W * fit, y0 + FORM_H * fit], [x0, y0 + FORM_H * fit]];
          pts.forEach((p, k) => { p.x += (goal[k][0] - p.x) * glide; p.y += (goal[k][1] - p.y) * glide; });
          css = quadToCss(FORM_W, FORM_H, pts);
          opacity = Math.min(1, (42 - dist) / 14);
        }
      }
    }
    // On phones the picture sits higher so the caption sheet doesn't cover it; that shift eases out as the form
    // glides in, so the screen is centred when it becomes the form.
    if (PORTRAIT) {
      const off = size.height * 0.16 * (1 - glide);
      const cam = camera as THREE.PerspectiveCamera;
      if (Math.abs((cam.view?.offsetY ?? 0) - off) > 0.5 || cam.view?.fullHeight !== size.height) {
        cam.setViewOffset(size.width, size.height, 0, off, size.width, size.height);
        cam.updateProjectionMatrix();
      }
    }
    if (next !== screenMode.current) {
      screenMode.current = next;
      el.dataset.mode = next;
      el.style.visibility = next === "off" ? "hidden" : "visible";
      if (next === "live") dispatchEvent(new CustomEvent("journey:contact"));
      onMode(next);
    }
    if (next !== "off") {
      el.style.transform = css;
      el.style.opacity = String(opacity);
    }
  });
  return null;
}

function webgl() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.18;
    return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
}

export function Journey() {
  const [ok] = useState(webgl);
  const [still] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [mobile] = useState(() => innerWidth < 768);
  const [wide, setWide] = useState(() => innerWidth >= 1024);
  const labels: Labels = useRef<(HTMLSpanElement | null)[]>([]);
  const labelsBox = useRef<HTMLDivElement>(null);
  const dip = useRef<HTMLDivElement>(null);
  const space = useRef<THREE.Group>(null);
  const hall = useRef<THREE.Group>(null);
  const form = useRef<HTMLDivElement>(null);
  const [screenMode, setScreenMode] = useState<ScreenMode>("off");
  const [dpr, setDpr] = useState(() => (innerWidth < 768 ? 1.25 : 1.6));
  // No rendering while the tab is in the background.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const v = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, []);
  useEffect(() => {
    // Tells the page the screen exists, so the plain fallback form is hidden.
    if (ok) document.documentElement.dataset.webgl = "";
  }, [ok]);
  useEffect(() => {
    const r = () => setWide(innerWidth >= 1024);
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, []);
  if (!ok) return null;
  return (
    <div className="fixed inset-0 z-[1]">
      <div className="absolute inset-0" role="img"
        aria-label={`A journey from a planet at night, ringed by a constellation of the systems Veyansiz works with (${SYSTEMS.join(", ")}), into a data hall.`}>
      <Canvas dpr={dpr} camera={{ position: [0, 6, 50], fov: 55, near: 0.05, far: 700 }}
        frameloop={visible ? "always" : "never"}
        gl={{ antialias: !mobile, powerPreference: "high-performance" }}>
        {/* Drops the resolution on devices that can't keep up, and while the frame rate is recovering. */}
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(mobile ? 1.25 : 1.6)} />
        <AdaptiveDpr pixelated={false} />
        <color attach="background" args={[new THREE.Color(pc("--c-space", "#0b1026")).multiplyScalar(0.6)]} />
        <fog attach="fog" args={[pc("--c-space", "#0b1026"), 400, 900]} />
        <ambientLight intensity={0.22} />
        <hemisphereLight args={["#3a4580", "#05070f", 0.45]} />
        <Environment />
        <Starfield count={mobile ? 1200 : 2600} />
        <group ref={space}>
          <directionalLight position={SUN_DIR.clone().multiplyScalar(50).toArray()} intensity={2.6} color="#fff1dc" />
          <Network labels={labels} still={still} position={PLANET_AT.toArray() as [number, number, number]} radius={ORBIT_R} planetRadius={PLANET_R * 1.03} />
          <Planet still={still} />
          <Sun />
          <Satellite still={still} />
        </group>
        <group ref={hall} visible={false}>
          <DataHall mobile={mobile} still={still} />
        </group>
        <CameraRig wide={wide} labelsBox={labelsBox} dip={dip} space={space} hall={hall} still={still} form={form} onMode={setScreenMode} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={mobile ? 0.65 : 0.8} luminanceThreshold={0.7} luminanceSmoothing={0.2} radius={0.6} />
          <Noise opacity={0.03} />
          <Vignette offset={0.28} darkness={0.75} />
        </EffectComposer>
      </Canvas>
      </div>
      <div ref={dip} aria-hidden className="pointer-events-none absolute inset-0 bg-space opacity-0" />
      <div ref={labelsBox} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {SYSTEMS.map((s, i) => (
          <span key={s} ref={(el) => { labels.current[i] = el; }} className="map-label">{s}</span>
        ))}
      </div>
      <div ref={form} className="screen-ui" data-mode="off" style={{ width: FORM_W, height: FORM_H }}>
        <ContactTerminal live={screenMode === "live"} compact={PORTRAIT} fill headingId="contact-screen-title" />
      </div>
    </div>
  );
}
