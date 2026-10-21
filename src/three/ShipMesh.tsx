import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Coord, PlacedShip } from '../game/types';
import { cellToWorld, PALETTE } from './config';

type Mats = {
  hull: THREE.Material;
  deck: THREE.Material;
  super: THREE.Material;
  gun: THREE.Material;
  accent: THREE.Material;
  boot: THREE.Material;
  light: THREE.Material;
};

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);

// Shared across every ship so re-renders never allocate materials.
const MATS: Record<'player' | 'enemy' | 'sunk', Mats> = {
  player: {
    hull: std({ color: PALETTE.hull, metalness: 0.4, roughness: 0.42 }),
    deck: std({ color: PALETTE.hullDark, metalness: 0.25, roughness: 0.7 }),
    super: std({ color: '#b9c7d4', metalness: 0.35, roughness: 0.38 }),
    gun: std({ color: '#3a4a5b', metalness: 0.45, roughness: 0.4 }),
    accent: std({ color: PALETTE.accent, emissive: PALETTE.accentSoft, emissiveIntensity: 1.1, toneMapped: false }),
    boot: std({ color: '#1b2633', metalness: 0.2, roughness: 0.6 }),
    light: std({ color: '#ffffff', emissive: PALETTE.accent, emissiveIntensity: 2.5, toneMapped: false }),
  },
  enemy: {
    hull: std({ color: '#7a6a72', metalness: 0.4, roughness: 0.45 }),
    deck: std({ color: '#3a2c33', metalness: 0.25, roughness: 0.7 }),
    super: std({ color: '#b8a7ae', metalness: 0.35, roughness: 0.4 }),
    gun: std({ color: '#4a3840', metalness: 0.45, roughness: 0.4 }),
    accent: std({ color: PALETTE.enemy, emissive: PALETTE.enemy, emissiveIntensity: 1.0, toneMapped: false }),
    boot: std({ color: '#2a1a20', metalness: 0.2, roughness: 0.6 }),
    light: std({ color: '#ffffff', emissive: PALETTE.enemy, emissiveIntensity: 2.5, toneMapped: false }),
  },
  sunk: {
    hull: std({ color: '#2b2622', metalness: 0.1, roughness: 0.95 }),
    deck: std({ color: '#171412', metalness: 0.05, roughness: 1 }),
    super: std({ color: '#3a332d', metalness: 0.1, roughness: 0.95 }),
    gun: std({ color: '#1d1a17', metalness: 0.1, roughness: 0.9 }),
    accent: std({ color: '#ff7a1a', emissive: '#ff5a00', emissiveIntensity: 0.9, toneMapped: false }),
    boot: std({ color: '#120f0d', roughness: 1 }),
    light: std({ color: '#140f0c', roughness: 1 }),
  },
};

function ghostMats(valid: boolean): Mats {
  const c = valid ? PALETTE.accent : PALETTE.enemy;
  const m = std({ color: c, emissive: c, emissiveIntensity: 0.7, transparent: true, opacity: 0.5, depthWrite: false });
  return { hull: m, deck: m, super: m, gun: m, accent: m, boot: m, light: m };
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

/** Plan-view hull outline (x = length, y = beam) extruded upward with a soft bevel. */
function hullGeometry(L: number, W: number, H: number, bow: number, sternTaper: number) {
  return cached(`hull:${L}:${W}:${H}:${bow}:${sternTaper}`, () => {
    const s = new THREE.Shape();
    const hl = L / 2;
    const hw = W / 2;
    s.moveTo(-hl, -hw * sternTaper);
    s.quadraticCurveTo(-hl, -hw, -hl + W * 0.25, -hw);
    s.lineTo(hl - bow, -hw);
    s.quadraticCurveTo(hl - bow * 0.25, -hw * 0.8, hl, 0);
    s.quadraticCurveTo(hl - bow * 0.25, hw * 0.8, hl - bow, hw);
    s.lineTo(-hl + W * 0.25, hw);
    s.quadraticCurveTo(-hl, hw, -hl, hw * sternTaper);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: H,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 2,
      curveSegments: 10,
    });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

const box = (w: number, h: number, d: number) => cached(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 12) =>
  cached(`c:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sphere = (r: number) => cached(`s:${r}`, () => new THREE.SphereGeometry(r, 16, 12));

function M({ geo, mat, p, r, s }: { geo: THREE.BufferGeometry; mat: THREE.Material; p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] }) {
  return <mesh geometry={geo} material={mat} position={p} rotation={r} scale={s} castShadow receiveShadow />;
}

/** Twin- or triple-barrel turret; faces +x (bow) unless flipped. */
function Turret({ m, x, y, size = 1, barrels = 2, aft = false }: { m: Mats; x: number; y: number; size?: number; barrels?: number; aft?: boolean }) {
  const len = 0.34 * size;
  return (
    <group position={[x, y, 0]} rotation={[0, aft ? Math.PI : 0, 0]}>
      <M geo={cyl(0.12 * size, 0.14 * size, 0.08 * size, 16)} mat={m.gun} p={[0, 0.04 * size, 0]} />
      <M geo={box(0.2 * size, 0.08 * size, 0.2 * size)} mat={m.super} p={[0.02 * size, 0.11 * size, 0]} />
      {Array.from({ length: barrels }, (_, i) => (
        <M
          key={i}
          geo={cyl(0.018 * size, 0.022 * size, len, 8)}
          mat={m.gun}
          p={[0.1 * size + len / 2, 0.11 * size, (i - (barrels - 1) / 2) * 0.06 * size]}
          r={[0, 0, Math.PI / 2]}
        />
      ))}
    </group>
  );
}

function Mast({ m, x, y, h, beacon = false }: { m: Mats; x: number; y: number; h: number; beacon?: boolean }) {
  return (
    <group position={[x, y, 0]}>
      <M geo={cyl(0.012, 0.022, h, 6)} mat={m.gun} p={[0, h / 2, 0]} />
      <M geo={box(0.02, 0.02, 0.22)} mat={m.gun} p={[0, h * 0.72, 0]} />
      <mesh geometry={sphere(beacon ? 0.03 : 0.018)} material={m.light} position={[0, h + 0.02, 0]} />
    </group>
  );
}

function Funnel({ m, x, y, h = 0.18 }: { m: Mats; x: number; y: number; h?: number }) {
  return (
    <group position={[x, y, 0]}>
      <M geo={cyl(0.07, 0.085, h, 14)} mat={m.super} p={[0, h / 2, 0]} s={[1.3, 1, 1]} />
      <M geo={cyl(0.072, 0.072, 0.03, 14)} mat={m.boot} p={[0, h, 0]} s={[1.3, 1, 1]} />
    </group>
  );
}

function Hull({ m, L, W, H = 0.2, bow }: { m: Mats; L: number; W: number; H?: number; bow: number }) {
  return (
    <>
      <M geo={hullGeometry(L, W, H, bow, 0.72)} mat={m.hull} p={[0, 0.01, 0]} />
      {/* boot-topping band at the waterline */}
      <M geo={hullGeometry(L * 1.005, W * 1.02, 0.05, bow, 0.72)} mat={m.boot} p={[0, -0.03, 0]} />
      {/* glowing sheer line */}
      <M geo={hullGeometry(L * 0.98, W * 1.04, 0.012, bow * 0.98, 0.72)} mat={m.accent} p={[0, H * 0.62, 0]} />
      {/* deck plate */}
      <M geo={hullGeometry(L * 0.94, W * 0.86, 0.02, bow * 0.9, 0.72)} mat={m.deck} p={[0, H + 0.02, 0]} />
    </>
  );
}

function Carrier({ m, L }: { m: Mats; L: number }) {
  const W = 0.62;
  const deckY = 0.42;
  return (
    <>
      <Hull m={m} L={L * 0.92} W={W} H={0.22} bow={0.6} />
      {/* hangar block + overhanging flight deck */}
      <M geo={box(L * 0.78, 0.16, W * 0.82)} mat={m.hull} p={[-0.02, 0.32, 0]} />
      <M geo={box(L * 0.98, 0.04, W * 1.28)} mat={m.deck} p={[0.02, deckY, -0.04]} />
      {/* angled landing deck sponson */}
      <M geo={box(L * 0.42, 0.04, W * 0.42)} mat={m.deck} p={[-L * 0.18, deckY, -W * 0.48]} r={[0, 0.16, 0]} />
      {/* runway centreline + edge lights */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} geometry={box(0.13, 0.006, 0.018)} material={m.accent} position={[-L * 0.42 + i * L * 0.105, deckY + 0.023, -0.06]} />
      ))}
      <mesh geometry={box(L * 0.94, 0.006, 0.01)} material={m.super} position={[0.02, deckY + 0.023, W * 0.5]} />
      <mesh geometry={box(L * 0.94, 0.006, 0.01)} material={m.super} position={[0.02, deckY + 0.023, -W * 0.62]} />
      {/* island on starboard */}
      <group position={[L * 0.08, deckY + 0.02, W * 0.44]}>
        <M geo={box(0.5, 0.22, 0.16)} mat={m.super} p={[0, 0.11, 0]} />
        <M geo={box(0.32, 0.12, 0.14)} mat={m.super} p={[0.04, 0.28, 0]} />
        <mesh geometry={box(0.3, 0.025, 0.145)} material={m.accent} position={[0.04, 0.3, 0]} />
        <Funnel m={m} x={-0.12} y={0.22} h={0.12} />
        <Mast m={m} x={0.08} y={0.34} h={0.3} />
        <M geo={box(0.02, 0.1, 0.16)} mat={m.gun} p={[0.08, 0.6, 0]} />
      </group>
      {/* parked aircraft */}
      {[0.3, 0.12, -0.06].map((f, i) => (
        <group key={i} position={[L * f + 0.12, deckY + 0.04, -W * 0.3]} rotation={[0, 0.5, 0]}>
          <M geo={box(0.16, 0.025, 0.03)} mat={m.super} />
          <M geo={box(0.05, 0.012, 0.15)} mat={m.super} p={[-0.01, 0, 0]} />
        </group>
      ))}
    </>
  );
}

function Battleship({ m, L }: { m: Mats; L: number }) {
  const W = 0.58;
  const y = 0.24;
  return (
    <>
      <Hull m={m} L={L} W={W} H={0.2} bow={0.8} />
      <Turret m={m} x={L * 0.3} y={y} size={1.05} barrels={3} />
      <Turret m={m} x={L * 0.16} y={y + 0.08} size={1.05} barrels={3} />
      <Turret m={m} x={-L * 0.33} y={y} size={1.05} barrels={3} aft />
      {/* raised barbette under superfiring turret */}
      <M geo={cyl(0.13, 0.15, 0.08, 16)} mat={m.hull} p={[L * 0.16, y + 0.04, 0]} />
      {/* stepped superstructure */}
      <M geo={box(0.62, 0.14, 0.36)} mat={m.super} p={[-L * 0.04, y + 0.07, 0]} />
      <M geo={box(0.36, 0.14, 0.28)} mat={m.super} p={[0, y + 0.21, 0]} />
      <M geo={box(0.18, 0.18, 0.2)} mat={m.super} p={[0.05, y + 0.37, 0]} />
      <mesh geometry={box(0.185, 0.025, 0.205)} material={m.accent} position={[0.05, y + 0.42, 0]} />
      <Funnel m={m} x={-L * 0.12} y={y + 0.14} h={0.22} />
      <Mast m={m} x={0.05} y={y + 0.46} h={0.32} />
      {/* secondary guns */}
      {[-1, 1].map((side) => (
        <M key={side} geo={box(0.12, 0.06, 0.08)} mat={m.gun} p={[-L * 0.04, y + 0.03, side * 0.22]} />
      ))}
    </>
  );
}

function Cruiser({ m, L }: { m: Mats; L: number }) {
  const W = 0.5;
  const y = 0.24;
  return (
    <>
      <Hull m={m} L={L} W={W} H={0.19} bow={0.7} />
      <Turret m={m} x={L * 0.3} y={y} size={0.85} barrels={1} />
      <Turret m={m} x={-L * 0.36} y={y} size={0.85} barrels={1} aft />
      {/* vertical launch cells */}
      <group position={[L * 0.14, y + 0.012, 0]}>
        {Array.from({ length: 8 }, (_, i) => (
          <M key={i} geo={box(0.07, 0.02, 0.07)} mat={i % 3 === 0 ? m.accent : m.gun} p={[(i % 4) * 0.085 - 0.13, 0, Math.floor(i / 4) * 0.09 - 0.045]} />
        ))}
      </group>
      {/* angular stealth superstructure */}
      <M geo={box(0.56, 0.18, 0.34)} mat={m.super} p={[-L * 0.08, y + 0.09, 0]} />
      <M geo={box(0.3, 0.12, 0.26)} mat={m.super} p={[-L * 0.04, y + 0.24, 0]} r={[0, 0, 0.12]} />
      <mesh geometry={box(0.18, 0.022, 0.265)} material={m.accent} position={[-L * 0.02, y + 0.26, 0]} />
      {/* radar dome — DeepWiki's all-seeing index */}
      <M geo={sphere(0.085)} mat={m.super} p={[-L * 0.1, y + 0.4, 0]} />
      <Funnel m={m} x={-L * 0.22} y={y + 0.14} h={0.14} />
      <Mast m={m} x={-L * 0.1} y={y + 0.46} h={0.22} />
    </>
  );
}

function Submarine({ m, L }: { m: Mats; L: number }) {
  const R = 0.17;
  const body = L * 0.78;
  return (
    <>
      <M geo={cyl(R, R, body, 24)} mat={m.hull} p={[0, 0.08, 0]} r={[0, 0, Math.PI / 2]} />
      <M geo={sphere(R)} mat={m.hull} p={[body / 2, 0.08, 0]} s={[2.0, 1, 1]} />
      <M geo={sphere(R)} mat={m.hull} p={[-body / 2, 0.08, 0]} s={[2.6, 1, 1]} />
      {/* casing deck */}
      <M geo={box(body * 0.9, 0.03, 0.14)} mat={m.deck} p={[0, 0.08 + R, 0]} />
      <mesh geometry={box(body * 0.92, 0.01, 0.012)} material={m.accent} position={[0, 0.1, R * 1.01]} />
      <mesh geometry={box(body * 0.92, 0.01, 0.012)} material={m.accent} position={[0, 0.1, -R * 1.01]} />
      {/* sail with fairwater planes */}
      <group position={[L * 0.1, 0.08 + R, 0]}>
        <M geo={box(0.36, 0.26, 0.1)} mat={m.super} p={[0, 0.13, 0]} s={[1, 1, 1]} />
        <M geo={box(0.06, 0.018, 0.34)} mat={m.gun} p={[0.04, 0.17, 0]} />
        <M geo={cyl(0.012, 0.012, 0.16, 6)} mat={m.gun} p={[-0.06, 0.34, 0]} />
        <M geo={cyl(0.01, 0.01, 0.12, 6)} mat={m.gun} p={[0.02, 0.32, 0]} />
        <mesh geometry={sphere(0.02)} material={m.light} position={[-0.06, 0.43, 0]} />
      </group>
      {/* cruciform stern planes */}
      <M geo={box(0.14, 0.02, 0.4)} mat={m.gun} p={[-body / 2 - 0.2, 0.08, 0]} />
      <M geo={box(0.14, 0.34, 0.02)} mat={m.gun} p={[-body / 2 - 0.2, 0.12, 0]} />
    </>
  );
}

function Destroyer({ m, L }: { m: Mats; L: number }) {
  const W = 0.42;
  const y = 0.22;
  return (
    <>
      <Hull m={m} L={L} W={W} H={0.17} bow={0.55} />
      <Turret m={m} x={L * 0.26} y={y} size={0.75} barrels={1} />
      <M geo={box(0.34, 0.15, 0.28)} mat={m.super} p={[-L * 0.02, y + 0.075, 0]} />
      <M geo={box(0.18, 0.1, 0.22)} mat={m.super} p={[0.02, y + 0.2, 0]} />
      <mesh geometry={box(0.185, 0.02, 0.225)} material={m.accent} position={[0.02, y + 0.22, 0]} />
      <Funnel m={m} x={-L * 0.2} y={y} h={0.17} />
      {/* on-call beacon: always awake */}
      <Mast m={m} x={0.0} y={y + 0.25} h={0.24} beacon />
      <M geo={box(0.1, 0.04, 0.16)} mat={m.gun} p={[-L * 0.36, y + 0.02, 0]} />
    </>
  );
}

const CLASSES: Record<string, (p: { m: Mats; L: number }) => ReactNode> = {
  carrier: Carrier,
  battleship: Battleship,
  cruiser: Cruiser,
  submarine: Submarine,
  destroyer: Destroyer,
};

const DECK_Y: Record<string, number> = { carrier: 0.445, battleship: 0.255, cruiser: 0.245, submarine: 0.27, destroyer: 0.225 };

let softTex: THREE.Texture | null = null;
/** Shared soft round puff used by smoke and fire sprites. */
function puffTexture() {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

const SCORCH_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float n = vnoise(vUv * 6.0) * 0.6 + vnoise(vUv * 13.0) * 0.4;
    float r = length(c) + (n - 0.5) * 0.5;
    float soot = 1.0 - smoothstep(0.35, 0.95, r);
    // embers glow in the cracks near the impact centre
    float ember = (1.0 - smoothstep(0.0, 0.45, r)) * smoothstep(0.55, 0.8, n) * (0.6 + 0.4 * sin(uTime * 5.0 + n * 20.0));
    vec3 col = mix(vec3(0.03, 0.025, 0.02), vec3(1.4, 0.45, 0.08), ember);
    gl_FragColor = vec4(col, clamp(soot * 0.92 + ember, 0.0, 1.0));
  }
`;
const PLAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function Scorch({ x, y, seed }: { x: number; y: number; seed: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSeed: { value: seed } }), [seed]);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  return (
    <mesh position={[x, y, 0]} rotation={[-Math.PI / 2, 0, seed]} renderOrder={3}>
      <planeGeometry args={[0.78, 0.6]} />
      <shaderMaterial
        ref={mat}
        vertexShader={PLAIN_VERT}
        fragmentShader={SCORCH_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
        toneMapped={false}
      />
    </mesh>
  );
}

const PUFFS = 7;
const SMOKE_LIFE = 3.4;

/**
 * Smoke columns rising from hit segments, plus a flickering fire core. Lives in
 * board-aligned space so every column leans with the same wind.
 */
function DamageSmoke({ points, y, fading }: { points: [number, number][]; y: number; fading: boolean }) {
  const smoke = useRef<(THREE.Sprite | null)[]>([]);
  const fire = useRef<(THREE.Sprite | null)[]>([]);
  const age = useRef(0);
  const smokeMats = useMemo(
    () =>
      points.flatMap(() =>
        Array.from({ length: PUFFS }, () => new THREE.SpriteMaterial({ map: puffTexture(), color: '#3a4048', transparent: true, depthWrite: false, opacity: 0 })),
      ),
    [points],
  );
  const fireMat = useMemo(
    () => new THREE.SpriteMaterial({ map: puffTexture(), color: '#ff8a2a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  );
  useFrame((_, dt) => {
    age.current += dt;
    const t = performance.now() / 1000;
    const strength = fading ? Math.max(0, 1 - age.current / 7) : 1;
    points.forEach(([px, pz], i) => {
      for (let k = 0; k < PUFFS; k++) {
        const sp = smoke.current[i * PUFFS + k];
        if (!sp) continue;
        const life = ((t + (k / PUFFS) * SMOKE_LIFE + i * 0.37) % SMOKE_LIFE) / SMOKE_LIFE;
        const rise = life * 1.7;
        sp.position.set(px + rise * rise * 0.32 + Math.sin(t * 1.3 + k) * 0.04, y + 0.12 + rise, pz - rise * 0.16);
        sp.scale.setScalar(0.22 + life * 0.75);
        const m = sp.material as THREE.SpriteMaterial;
        m.opacity = Math.sin(Math.PI * Math.min(life * 1.25, 1)) * 0.55 * strength;
        m.color.setScalar(0.16 + life * 0.22);
      }
      const f = fire.current[i];
      if (f) {
        const flick = 0.8 + 0.2 * Math.sin(t * 17 + i * 3) * Math.sin(t * 11.3 + i);
        f.scale.set(0.3 * flick, 0.42 * flick, 1);
        f.position.set(px, y + 0.14, pz);
        (f.material as THREE.SpriteMaterial).opacity = 0.85 * strength * (fading ? 0.6 : 1);
      }
    });
  });
  return (
    <group>
      {points.map((_, i) => (
        <group key={i}>
          {Array.from({ length: PUFFS }, (_, k) => (
            <sprite key={k} ref={(el) => { smoke.current[i * PUFFS + k] = el; }} material={smokeMats[i * PUFFS + k]} renderOrder={6} />
          ))}
          <sprite ref={(el) => { fire.current[i] = el; }} material={fireMat} renderOrder={7} />
        </group>
      ))}
    </group>
  );
}

const FOAM_RING_FRAG = /* glsl */ `
  uniform float uAge;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    float k = clamp(uAge / 4.5, 0.0, 1.0);
    float front = 0.25 + k * 0.7;
    float n = vnoise(c * 7.0 + uAge * 0.6) * 0.7 + vnoise(c * 17.0) * 0.3;
    float ring = smoothstep(front - 0.2 - k * 0.1, front - 0.02, r) * (1.0 - smoothstep(front, front + 0.04, r));
    float churn = (1.0 - smoothstep(0.0, front * 0.8, r)) * (1.0 - k) * 0.6;
    float lace = smoothstep(0.35, 0.7, n);
    float residue = (1.0 - smoothstep(0.55, 0.95, r)) * smoothstep(0.5, 0.8, n) * 0.16;
    float a = (ring * (1.0 - k * 0.75) + churn) * lace + residue * smoothstep(0.2, 1.0, k);
    gl_FragColor = vec4(vec3(0.82, 0.92, 0.98), clamp(a, 0.0, 1.0) * 0.85);
  }
`;

/** Expanding foam ring and churned water where a ship goes down, leaving a faint slick. */
function SinkFoam({ L }: { L: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uAge: { value: 0 } }), []);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uAge.value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} scale={[L * 0.72 + 0.4, 0.95, 1]} renderOrder={4}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={PLAIN_VERT} fragmentShader={FOAM_RING_FRAG} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}

const KELVIN_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    // u: 0 at the stern -> 1 far astern; v: -1..1 across
    float u = vUv.x;
    float v = vUv.y * 2.0 - 1.0;
    // streaky turbulence stretched along the flow, never clumped into blobs
    float n = vnoise(vec2(u * 70.0 - uTime * 2.4, v * 46.0)) * 0.55 + vnoise(vec2(u * 140.0 - uTime * 3.1, v * 90.0)) * 0.45;
    // Kelvin arms (~19.5 degrees) that widen and soften with distance + a narrow prop wash
    float arm = 1.0 - smoothstep(0.0, 0.025 + u * 0.06, abs(abs(v) - u * 0.7 - 0.05));
    float wash = (1.0 - smoothstep(0.0, 0.05 + u * 0.12, abs(v))) * (1.0 - smoothstep(0.0, 0.55, u));
    float fade = (1.0 - smoothstep(0.2, 1.0, u)) * smoothstep(0.0, 0.03, u);
    float a = (arm * 0.5 + wash * 0.65) * (0.45 + 0.55 * n) * fade;
    gl_FragColor = vec4(vec3(0.8, 0.9, 0.97), a * 0.4);
  }
`;

/** V-shaped wake trailing astern of a ship that is underway (hero shots). */
function KelvinWake({ L }: { L: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: Math.random() * 10 } }), []);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  const len = L * 3.4 + 3;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-L / 2 - len / 2 + 0.25, 0.02, 0]} renderOrder={2}>
      <planeGeometry args={[len, len * 0.72]} />
      <shaderMaterial
        ref={mat}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() { vUv = vec2(1.0 - uv.x, uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `}
        fragmentShader={KELVIN_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Per-class warship built from extruded hulls and primitives: carrier flight
 * deck + island, battleship triple turrets, cruiser VLS + radar dome, a
 * low-slung submarine and a nimble destroyer. Hit segments scorch and smoke,
 * damaged ships list toward the damage, sunk ships char, roll and settle
 * into a foam ring.
 */
export function ShipMesh({
  ship,
  ghost = false,
  valid = true,
  side = 'player',
  hitCells,
  underway = false,
}: {
  ship: PlacedShip;
  ghost?: boolean;
  valid?: boolean;
  side?: 'player' | 'enemy';
  /** Cells of this ship that have been hit (drives scorch, smoke and listing). */
  hitCells?: Coord[];
  /** Sailing in open water (menu hero shots): draws a V wake astern. */
  underway?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const sinkT = useRef(0);

  const { center, angle, len } = useMemo(() => {
    const first = ship.cells[0];
    const last = ship.cells[ship.cells.length - 1];
    const horizontal = last.x !== first.x;
    const xs = ship.cells.map((c) => cellToWorld(c)[0]);
    const zs = ship.cells.map((c) => cellToWorld(c)[1]);
    return {
      center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] as const,
      angle: horizontal ? 0 : Math.PI / 2,
      len: ship.spec.length,
    };
  }, [ship]);

  const hitKey = hitCells?.map((c) => `${c.x},${c.y}`).join('|') ?? '';
  const damage = useMemo(() => {
    if (!hitKey) return { local: [] as number[], world: [] as [number, number][] };
    const cells = hitKey.split('|').map((k) => k.split(',').map(Number) as [number, number]);
    const world = cells.map(([x, y]) => {
      const [wx, wz] = cellToWorld({ x, y });
      return [wx - center[0], wz - center[1]] as [number, number];
    });
    // ship-local x along the hull (rotation y by +90deg maps local +x to world -z)
    const local = world.map(([dx, dz]) => (angle === 0 ? dx : -dz) * 0.9);
    return { local, world };
  }, [hitKey, center, angle]);

  const frac = Math.min(damage.local.length / len, 1);
  const lean = damage.local.length ? damage.local.reduce((a, b) => a + b, 0) / damage.local.length : 0;

  useFrame((_, dt) => {
    if (!group.current) return;
    const t = performance.now() / 1000;
    const ph = center[0] * 0.7 + center[1] * 0.5;
    if (ship.sunk && !ghost) {
      sinkT.current = Math.min(sinkT.current + dt, 10);
      const k = sinkT.current;
      // brief lurch, then roll over and settle as a half-submerged wreck
      const settle = 1 - Math.exp(-k * 0.55);
      group.current.position.y = -0.5 * settle + Math.sin(k * 6) * 0.03 * Math.exp(-k);
      group.current.rotation.x = 0.5 * settle + Math.sin(t * 0.5 + ph) * 0.01;
      group.current.rotation.z = (lean >= 0 ? -1 : 1) * 0.16 * settle;
    } else {
      // gentle bobbing on the swell; damage drags the hull down and over
      group.current.position.y = Math.sin(t * 0.9 + ph) * 0.03 - frac * 0.05;
      group.current.rotation.x = Math.sin(t * 0.7 + center[1]) * 0.018 + frac * 0.085;
      group.current.rotation.z = Math.sin(t * 0.55 + center[0]) * 0.01 - Math.sign(lean) * frac * 0.04;
    }
  });

  const mats = useMemo(() => (ghost ? ghostMats(valid) : MATS[ship.sunk ? 'sunk' : side]), [ghost, valid, ship.sunk, side]);
  const Body = CLASSES[ship.spec.id] ?? Destroyer;
  const L = len * 0.9;
  const deckY = DECK_Y[ship.spec.id] ?? 0.24;
  const damaged = !ghost && damage.local.length > 0;

  return (
    <group position={[center[0], 0.06, center[1]]}>
      <group rotation={[0, angle, 0]}>
        <group ref={group}>
          <Body m={mats} L={L} />
          {damaged && !ship.sunk && damage.local.map((x, i) => <Scorch key={i} x={x} y={deckY + 0.012} seed={i * 1.7 + len} />)}
        </group>
        {!ship.sunk && !ghost && <Wake L={L} />}
        {!ship.sunk && !ghost && underway && <KelvinWake L={L} />}
        {ship.sunk && !ghost && <SinkFoam L={L} />}
      </group>
      {damaged && <DamageSmoke points={damage.world} y={ship.sunk ? -0.1 : deckY} fading={ship.sunk} />}
    </group>
  );
}
const WAKE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c * vec2(1.0, 1.0));
    float ring = smoothstep(1.0, 0.72, r) * smoothstep(0.5, 0.82, r);
    float flicker = 0.75 + 0.25 * sin(uTime * 2.2 + c.x * 9.0 + c.y * 5.0);
    gl_FragColor = vec4(0.78, 0.92, 1.0, ring * 0.2 * flicker);
  }
`;
const WAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Soft foam collar where the hull meets the water. */
function Wake({ L }: { L: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: Math.random() * 10 } }), []);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} scale={[L * 0.62, 0.42, 1]} renderOrder={2}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={WAKE_VERT} fragmentShader={WAKE_FRAG} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}
