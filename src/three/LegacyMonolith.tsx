import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ENEMY_FLEET_NAMES } from '../game/types';
import { fx } from '../state/fx';
import type { FxEvent } from '../state/fx';
import { useGame } from '../state/store';
import { Burst } from './Effects';
import { addTrauma, fxNow, SMOKE, SPARKS, FIREBALL, shipAt } from './fxKit';
import type { BurstSpec } from './fxKit';

// ------------------------------------------------------------------ personality

export type Mood = 'smug' | 'laugh' | 'hurt' | 'rage' | 'gloat' | 'charge' | 'dead' | 'victory';

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export const TAUNTS = {
  intro: ['MWAHAHA! 2 MILLION LINES OF SPAGHETTI!', 'NO DOCS. NO TESTS. NO MERCY.', 'I WAS HERE BEFORE GIT, KID.'],
  idle: [
    'PERFORM UNTIL YOU-QUIT.',
    'MY LAST MAINTAINER RETIRED IN 1998!',
    'GOTO VICTORY.',
    'WHO NEEDS UNIT TESTS? NOT ME!',
    'YOUR AI CANNOT READ MY GOTOs!',
    'HEH. 47 NESTED IFs AND COUNTING.',
  ],
  playerMiss: [
    'MISSED! LIKE YOUR SPRINT GOAL!',
    'HAHA! WORKS ON MY MAINFRAME!',
    '404: HIT NOT FOUND!',
    'SWING AND A MERGE CONFLICT!',
    'TRY TURNING IT OFF AND ON AGAIN!',
  ],
  playerHit: [
    'OW! MY GLOBAL VARIABLES!',
    'HEY! THAT WAS LOAD-BEARING!',
    'NOT THE PAYROLL MODULE!',
    'OOF! WHO APPROVED THIS PR?!',
    'A STACK TRACE?! ON ME?!',
  ],
  rage: [
    'MY {SHIP}!! YOU DEPRECATED IT!!',
    'RAAAH! {SHIP} TOOK 40 YEARS!',
    'ROLLBACK! ROLLBACK! NOT {SHIP}!',
  ],
  aiHit: ['BOOM! BREAKING CHANGE!', 'HEH. CHECK YOUR PAGER!', 'REGRESSION DELIVERED!', 'SEV-1 FOR YOU!'],
  aiSink: ['BYE BYE, {SHIP}! MWAHAHA!', '{SHIP}? MORE LIKE {SHIP}-NOT!', 'ANOTHER ONE FOR THE BACKLOG!'],
  aiMiss: ['BAH! FLAKY TARGETING...', 'IT WORKED IN PROD!', 'THAT WAS A WARNING SHOT.'],
  launch: ['INCOMING! COMPILE THIS!', 'FIRE ZE JCL!', 'SUBMIT JOB... DESTROY!'],
  defeat: ['ABEND S0C7... I\'LL BE BACK... IN Q3...', 'NOOO! MIGRATED... TO... THE CLOUD...'],
  victory: ['MAINFRAME 1, MODERNIZATION 0!', 'SEE YOU IN 1987! MWAHAHA!'],
} as const;

const fill = (s: string, ship?: string) => s.split('{SHIP}').join((ship ?? 'MY FLEET').toUpperCase());

// ------------------------------------------------------------------ canvas art

interface FacePal {
  bg: string;
  panel: string;
  fg: string;
  glow: string;
  hi: string;
}
const GREEN: FacePal = { bg: '#06150d', panel: '#0b2718', fg: '#75ff94', glow: '#55ff7b', hi: '#d8ffe0' };
const RED: FacePal = { bg: '#1a0404', panel: '#330808', fg: '#ff5b4d', glow: '#ff2a1a', hi: '#ffd2c8' };
const AMBER: FacePal = { bg: '#1a1104', panel: '#2b1d07', fg: '#ffc14d', glow: '#ff9d1a', hi: '#fff0c8' };
const BLUE: FacePal = { bg: '#0a1a6e', panel: '#0c2190', fg: '#e8eeff', glow: '#9fb4ff', hi: '#ffffff' };

const poly = (c: CanvasRenderingContext2D, pts: number[]) => {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
};

function drawFace(c: CanvasRenderingContext2D, mood: Mood, frame: number, blink: boolean) {
  const pal = mood === 'rage' ? RED : mood === 'dead' ? BLUE : mood === 'hurt' ? AMBER : GREEN;
  const W = 320;
  const H = 160;
  c.save();
  c.imageSmoothingEnabled = false;
  c.fillStyle = pal.bg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = pal.panel;
  c.fillRect(6, 6, W - 12, H - 12);
  c.fillStyle = pal.fg;
  c.strokeStyle = pal.fg;
  c.shadowColor = pal.glow;
  c.shadowBlur = 14;
  c.lineCap = 'square';
  c.lineWidth = 11;

  const brows = (lIn: number, lOut: number, rIn: number, rOut: number) => {
    c.beginPath();
    c.moveTo(38, lOut);
    c.lineTo(104, lIn);
    c.moveTo(282, rOut);
    c.lineTo(216, rIn);
    c.stroke();
  };
  const boxEyes = (h = 21, pupil = true) => {
    c.fillRect(50, 81 - h, 48, h);
    c.fillRect(222, 81 - h, 48, h);
    if (pupil && h > 10) {
      c.fillStyle = pal.hi;
      const look = mood === 'charge' ? (frame % 2) * 6 : 0;
      c.fillRect(63 + look, 81 - Math.min(14, h), 16, Math.min(14, h));
      c.fillRect(239 + look, 81 - Math.min(14, h), 16, Math.min(14, h));
      c.fillStyle = pal.fg;
    }
  };
  const teeth = (top: number, bottom: number, jag = 12) => {
    // grin with zigzag teeth (the signature look)
    const pts: number[] = [79, top + 5];
    for (let x = 79, k = 0; x <= 239; x += 21.5, k++) pts.push(x, top + (k % 2 ? -jag / 2 : jag / 2));
    pts.push(239, top + 5, 229, bottom - 4);
    for (let x = 229, k = 0; x >= 87; x -= 21, k++) pts.push(x, bottom + (k % 2 ? -6 : 4));
    poly(c, pts);
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = pal.hi;
    c.stroke();
    c.fillStyle = pal.hi;
    const inner: number[] = [96, top + 10];
    for (let x = 96, k = 0; x <= 222; x += 14, k++) inner.push(x, top + 10 + (k % 2 ? -4 : 4));
    inner.push(222, top + 10, 216, (top + bottom) / 2);
    for (let x = 216, k = 0; x >= 101; x -= 15, k++) inner.push(x, (top + bottom) / 2 + (k % 2 ? 4 : -4));
    poly(c, inner);
    c.fill();
    c.fillStyle = pal.fg;
    c.strokeStyle = pal.fg;
    c.lineWidth = 11;
  };

  switch (mood) {
    case 'smug':
    case 'charge': {
      brows(56, 39, 56, 39);
      if (blink) {
        c.fillRect(50, 72, 48, 6);
        c.fillRect(222, 72, 48, 6);
      } else boxEyes(mood === 'charge' ? 26 : 21);
      teeth(101, 140);
      if (mood === 'charge') {
        c.font = 'bold 18px monospace';
        c.shadowBlur = 6;
        c.fillText(frame % 2 ? '>> SUBMIT JOB' : '>> SUBMIT JOB_', 92, 30);
      }
      break;
    }
    case 'laugh':
    case 'gloat':
    case 'victory': {
      // ^  ^ squint eyes
      c.lineWidth = 10;
      c.beginPath();
      c.moveTo(50, 80);
      c.lineTo(74, 60);
      c.lineTo(98, 80);
      c.moveTo(222, 80);
      c.lineTo(246, 60);
      c.lineTo(270, 80);
      c.stroke();
      brows(48, 36, 48, 36);
      // wide open cackle that flaps between two frames
      const open = frame % 2 ? 44 : 34;
      poly(c, [70, 96, 250, 96, 236, 96 + open, 200, 104 + open, 120, 104 + open, 84, 96 + open]);
      c.fill();
      c.fillStyle = pal.bg;
      poly(c, [92, 108, 228, 108, 218, 92 + open, 188, 98 + open, 132, 98 + open, 102, 92 + open]);
      c.fill();
      c.fillStyle = pal.hi;
      for (let x = 96; x < 224; x += 16) {
        poly(c, [x, 107, x + 14, 107, x + 7, 118]);
        c.fill();
      }
      c.fillStyle = '#ff6b8a';
      c.shadowBlur = 0;
      c.fillRect(140, 88 + open, 40, 10);
      if (mood !== 'laugh') {
        c.fillStyle = pal.fg;
        c.font = 'bold 18px monospace';
        c.fillText(frame % 2 ? 'HA HA HA' : 'HAHAHAHA', 112, 30);
      }
      break;
    }
    case 'hurt': {
      // > < wince
      c.lineWidth = 10;
      c.beginPath();
      c.moveTo(52, 52);
      c.lineTo(94, 68);
      c.lineTo(52, 84);
      c.moveTo(268, 52);
      c.lineTo(226, 68);
      c.lineTo(268, 84);
      c.stroke();
      // wobbly gritted mouth
      c.lineWidth = 8;
      c.beginPath();
      c.moveTo(92, 122);
      for (let x = 92, k = 0; x <= 228; x += 17, k++) c.lineTo(x, 122 + (k % 2 ? -10 : 10) + (frame % 2) * 2);
      c.stroke();
      c.font = 'bold 16px monospace';
      c.shadowBlur = 4;
      c.fillText('WARN: INTEGRITY', 90, 28);
      // sweat drop
      c.fillStyle = '#9be7ff';
      poly(c, [292, 40, 300, 58, 292, 64, 284, 58]);
      c.fill();
      break;
    }
    case 'rage': {
      brows(70, 30, 70, 30);
      c.fillRect(54, 72, 42, 12);
      c.fillRect(224, 72, 42, 12);
      c.fillStyle = pal.hi;
      c.fillRect(70, 74, 10, 8);
      c.fillRect(240, 74, 10, 8);
      c.fillStyle = pal.fg;
      teeth(100, 134, 18);
      // steam/anger vein
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(276, 18);
      c.lineTo(290, 30);
      c.moveTo(304, 18);
      c.lineTo(290, 30);
      c.moveTo(276, 42);
      c.lineTo(290, 30);
      c.moveTo(304, 42);
      c.lineTo(290, 30);
      c.stroke();
      c.font = 'bold 16px monospace';
      c.fillText(frame % 2 ? '!! SEV-1 !!' : '   SEV-1   ', 110, 26);
      break;
    }
    case 'dead': {
      c.lineWidth = 10;
      c.beginPath();
      c.moveTo(54, 50);
      c.lineTo(94, 86);
      c.moveTo(94, 50);
      c.lineTo(54, 86);
      c.moveTo(226, 50);
      c.lineTo(266, 86);
      c.moveTo(266, 50);
      c.lineTo(226, 86);
      c.stroke();
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(110, 124);
      c.lineTo(210, 124);
      c.stroke();
      c.font = 'bold 15px monospace';
      c.shadowBlur = 0;
      c.fillText('*** ABEND S0C7 *** CORE DUMPED', 24, 28);
      c.fillText(frame % 2 ? 'PRESS ANY KEY TO MODERNIZE_' : 'PRESS ANY KEY TO MODERNIZE', 44, 148);
      break;
    }
  }
  c.shadowBlur = 0;
  c.fillStyle = mood === 'dead' ? 'rgba(255,255,255,0.08)' : 'rgba(255, 255, 255, 0.07)';
  for (let y = 10; y < 152; y += 7) c.fillRect(7, y, 306, 1);
  // CRT glitch tear while hurt / raging / dying
  if ((mood === 'hurt' || mood === 'rage' || mood === 'dead') && frame % 3 === 0) {
    const y = 20 + ((frame * 37) % 110);
    const strip = c.getImageData(0, y, W, 14);
    c.putImageData(strip, (frame % 2 ? 1 : -1) * 14, y);
  }
  c.restore();
}

function drawStatus(c: CanvasRenderingContext2D, mood: Mood, alive: number, total: number, frame: number) {
  c.fillStyle = mood === 'rage' ? '#3a1414' : mood === 'dead' ? '#0c1a5a' : '#2b3333';
  c.fillRect(0, 0, 256, 64);
  c.font = 'bold 18px monospace';
  c.fillStyle = mood === 'rage' ? '#ff8a7a' : '#d8c49c';
  const title =
    mood === 'dead' ? 'JOB TERMINATED' : mood === 'rage' ? 'SEV-1: ROLLBACK!!' : mood === 'victory' ? 'BATCH COMPLETE :)' : 'COBOL · BATCH 01';
  c.fillText(title, 12, 25);
  c.font = '13px monospace';
  c.fillStyle = '#a9ff73';
  c.fillText('INTEGRITY', 12, 50);
  const pct = total ? alive / total : 1;
  for (let i = 0; i < total; i++) {
    const on = i < alive;
    c.fillStyle = on ? (pct > 0.5 ? '#a9ff73' : pct > 0.25 ? '#ffc14d' : '#ff5b4d') : '#41494a';
    if (on && pct <= 0.25 && frame % 2) c.fillStyle = '#7a2222';
    c.fillRect(96 + i * 22, 39, 18, 13);
  }
  c.fillStyle = '#a9ff73';
  c.fillText(`${Math.round(pct * 100)}%`, 210, 50);
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Dark CRT speech balloon with a pointer toward the boss (bubble sits to the boss's left). */
function drawBubble(c: CanvasRenderingContext2D, text: string, mood: Mood) {
  const W = 512;
  const H = 200;
  c.clearRect(0, 0, W, H);
  const accent = mood === 'rage' ? '#ff5b4d' : mood === 'hurt' ? '#ffc14d' : mood === 'dead' ? '#9fb4ff' : '#75ff94';
  const r = 26;
  const x0 = 8;
  const y0 = 8;
  const x1 = W - 52;
  const y1 = H - 40;
  c.beginPath();
  c.moveTo(x0 + r, y0);
  c.lineTo(x1 - r, y0);
  c.quadraticCurveTo(x1, y0, x1, y0 + r);
  c.lineTo(x1, y1 - 70);
  c.lineTo(W - 6, y1 - 30); // pointer
  c.lineTo(x1, y1 - 34);
  c.lineTo(x1, y1 - r);
  c.quadraticCurveTo(x1, y1, x1 - r, y1);
  c.lineTo(x0 + r, y1);
  c.quadraticCurveTo(x0, y1, x0, y1 - r);
  c.lineTo(x0, y0 + r);
  c.quadraticCurveTo(x0, y0, x0 + r, y0);
  c.closePath();
  c.fillStyle = 'rgba(5, 14, 10, 0.92)';
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = accent;
  c.stroke();
  let size = 38;
  let lines: string[] = [];
  for (; size >= 24; size -= 2) {
    c.font = `900 ${size}px ui-monospace, Menlo, monospace`;
    lines = wrap(c, text, x1 - x0 - 44);
    if (lines.length <= 3 && lines.length * size * 1.15 <= y1 - y0 - 24) break;
  }
  c.fillStyle = accent;
  c.textBaseline = 'middle';
  const lh = size * 1.15;
  const top = (y0 + y1) / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => c.fillText(l, x0 + 24, top + i * lh));
}

const makeCanvasTexture = (w: number, h: number, pixel = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: pixel });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
  }
  return { ctx, tex };
};

interface Motion {
  ag: number;
  droop: number;
}

function CableTentacle({
  side,
  phase,
  anchorY,
  reach,
  depth,
  motion,
}: {
  side: -1 | 1;
  phase: number;
  anchorY: number;
  reach: number;
  depth: number;
  motion: { current: Motion };
}) {
  const cable = useRef<THREE.Group>(null);
  const clock = useRef(0);
  const curve = useMemo(() => {
    const points = [
      new THREE.Vector3(side * 1.72, anchorY, -0.25),
      new THREE.Vector3(side * 2.35, anchorY + 0.22, depth),
      new THREE.Vector3(side * (reach - 0.65), anchorY - 0.38, depth + 0.6),
      new THREE.Vector3(side * reach, anchorY - 1.12, depth + 1.35),
      new THREE.Vector3(side * (reach - 0.35), anchorY - 1.62, depth + 2.0),
      new THREE.Vector3(side * (reach - 1.0), anchorY - 1.0, depth + 2.25),
    ];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.22, 10, false);
  }, [anchorY, depth, reach, side]);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2c4a57', metalness: 0.4, roughness: 0.38 }),
    [],
  );

  useFrame((_, dt) => {
    if (!cable.current) return;
    const { ag, droop } = motion.current;
    clock.current += dt * (1 + ag * 3.2);
    const t = clock.current;
    const amp = 1 + ag * 2.2;
    cable.current.rotation.y = Math.sin(t * 1.15 + phase) * 0.14 * amp;
    cable.current.rotation.z = Math.sin(t * 0.8 + phase) * 0.085 * side * amp - droop * 0.5 * side;
    cable.current.rotation.x = droop * 0.35;
    cable.current.position.y = Math.sin(t * 1.4 + phase) * 0.09 * amp - droop * 0.6;
  });

  useEffect(
    () => () => {
      curve.dispose();
      material.dispose();
    },
    [curve, material],
  );

  return (
    <group ref={cable}>
      <mesh geometry={curve} material={material} />
      <mesh position={[side * (reach - 1.0), anchorY - 1.0, depth + 2.25]}>
        <sphereGeometry args={[0.28, 14, 10]} />
        <meshStandardMaterial color="#b6c4b5" metalness={0.4} roughness={0.3} emissive="#30443a" />
      </mesh>
      <mesh position={[side * 1.82, anchorY, -0.2]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.28, 0.075, 8, 16]} />
        <meshStandardMaterial color="#c4b99c" metalness={0.4} roughness={0.3} />
      </mesh>
    </group>
  );
}

const STEAM: BurstSpec = {
  ...SMOKE,
  count: 22,
  life: [1.0, 1.7],
  up: [2.2, 3.6],
  speed: [0.3, 0.9],
  size: [0.45, 0.8],
  delay: [0, 0.5],
  colors: ['#ffffff', '#e2e8ee', '#9aa4ae'],
  opacity: 0.6,
};
const HIT_SPARKS: BurstSpec = { ...SPARKS, count: 34, speed: [2, 4.5], floor: -100 };
const BOOM: BurstSpec = { ...FIREBALL, count: 34, size: [1.0, 1.8], speed: [1.0, 2.6] };
const WRECK_SMOKE: BurstSpec = {
  ...SMOKE,
  count: 40,
  life: [2.6, 4.0],
  up: [1.4, 2.4],
  size: [1.1, 1.9],
  spread: 1.6,
  delay: [0, 2.2],
  colors: ['#2b2420', '#1f2227', '#4a5059'],
};

interface BossBurst {
  id: number;
  spec: BurstSpec;
  birth: number;
  pos: [number, number, number];
}
let burstId = 1;

const popIn = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) * 0.9);
const env = (age: number, dur: number) => (age < 0 || age > dur ? 0 : Math.pow(1 - age / dur, 2));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function LegacyMonolith({
  position,
  scale,
}: {
  position: [number, number, number];
  scale: [number, number, number];
}) {
  const group = useRef<THREE.Group>(null);
  const indicators = useRef<(THREE.Mesh | null)[]>([]);
  const bubble = useRef<THREE.Group>(null);
  const rageLight = useRef<THREE.PointLight>(null);
  const warmLight = useRef<THREE.PointLight>(null);
  const phase = useGame((s) => s.phase);
  const motion = useRef<Motion>({ ag: 0, droop: 0 });
  const [bursts, setBursts] = useState<BossBurst[]>([]);

  const face = useMemo(() => makeCanvasTexture(320, 160, true), []);
  const status = useMemo(() => makeCanvasTexture(256, 64), []);
  const speech = useMemo(() => makeCanvasTexture(512, 200), []);
  const cabinet = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#a59e8d', metalness: 0.32, roughness: 0.5 }),
    [],
  );
  const trim = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#5f6a67', metalness: 0.4, roughness: 0.36 }),
    [],
  );
  const screenFrame = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#202d2a', metalness: 0.4, roughness: 0.3 }),
    [],
  );

  const st = useRef({
    mood: 'smug' as Mood,
    moodUntil: 0,
    flinch: -99,
    laugh: -99,
    rage: -99,
    recoil: -99,
    taunt: '',
    tauntAt: -99,
    tauntDur: 0,
    nextIdle: 0,
    faceKey: '',
    statusKey: '',
    bubbleKey: '',
    defeatAt: -1,
    victoryAt: -1,
    match: undefined as unknown,
  });

  useEffect(
    () => () => {
      face.tex.dispose();
      status.tex.dispose();
      speech.tex.dispose();
      cabinet.dispose();
      trim.dispose();
      screenFrame.dispose();
    },
    [cabinet, face, screenFrame, speech, status, trim],
  );

  // world-space offsets (relative to the boss origin) for particles & bubble
  const W = useMemo(
    () => ({
      face: [0, 4.05 * scale[1], 1.25 * scale[2]] as [number, number, number],
      hatch: [0, 5.95 * scale[1], 0.2 * scale[2]] as [number, number, number],
      inv: [1 / scale[0], 1 / scale[1], 1 / scale[2]] as [number, number, number],
    }),
    [scale],
  );

  useEffect(() => {
    const s = st.current;
    const say = (text: string, important = false) => {
      const now = fxNow();
      if (!important && now - s.tauntAt < s.tauntDur * 0.7) return;
      if (s.defeatAt > 0 && text && !important) return;
      s.taunt = text;
      s.tauntAt = now;
      s.tauntDur = 1.6 + text.length * 0.05;
      s.nextIdle = now + rnd(11, 16);
    };
    const mood = (m: Mood, dur: number) => {
      if (s.mood === 'dead' || s.mood === 'victory') return;
      if (s.mood === 'rage' && fxNow() < s.moodUntil && m !== 'rage') return;
      s.mood = m;
      s.moodUntil = fxNow() + dur;
    };
    const spawn = (spec: BurstSpec, pos: [number, number, number], delay = 0) => {
      const birth = fxNow() + delay;
      setBursts((cur) => [...cur.filter((b) => fxNow() - b.birth < 6), { id: burstId++, spec, birth, pos }]);
    };
    const onFx = (e: FxEvent) => {
      const now = fxNow();
      if (e.type === 'bossMood' || useGame.getState().phase !== 'battle' || s.defeatAt > 0 || s.victoryAt > 0) return;
      if (e.side === 'enemy') {
        if (e.type === 'explosion') {
          s.flinch = now;
          mood('hurt', 1.2);
          if (Math.random() < 0.75) say(pick(TAUNTS.playerHit));
          spawn(HIT_SPARKS, [W.face[0] + rnd(-2.6, 2.6), W.face[1] + rnd(-1.6, 0.8), W.face[2]]);
        } else if (e.type === 'splash') {
          s.laugh = now;
          mood('laugh', 1.4);
          if (Math.random() < 0.7) say(pick(TAUNTS.playerMiss));
        } else if (e.type === 'sink') {
          s.rage = now;
          mood('rage', 2.6);
          const ship = shipAt('enemy', e.coord);
          const name = ship ? ENEMY_FLEET_NAMES[ship.spec.id] ?? ship.spec.name : undefined;
          say(fill(pick(TAUNTS.rage), name), true);
          addTrauma(0.25);
          spawn(STEAM, [-2.4 * scale[0] * 0.6, W.hatch[1], W.hatch[2]]);
          spawn(STEAM, [2.4 * scale[0] * 0.6, W.hatch[1], W.hatch[2]], 0.15);
        }
      } else {
        if (e.type === 'missile') {
          s.recoil = now;
          mood('charge', 0.85);
          if (Math.random() < 0.3) say(pick(TAUNTS.launch));
        } else if (e.type === 'explosion') {
          s.laugh = now;
          mood('gloat', 1.5);
          if (Math.random() < 0.6) say(pick(TAUNTS.aiHit));
        } else if (e.type === 'sink') {
          s.laugh = now;
          mood('gloat', 2.4);
          const ship = shipAt('player', e.coord);
          say(fill(pick(TAUNTS.aiSink), ship?.spec.name), true);
        } else if (e.type === 'splash') {
          mood('smug', 1);
          if (Math.random() < 0.4) say(pick(TAUNTS.aiMiss));
        }
      }
    };
    const unsub = fx.subscribe(onFx);
    (st.current as unknown as { say: typeof say; spawn: typeof spawn }).say = say;
    (st.current as unknown as { say: typeof say; spawn: typeof spawn }).spawn = spawn;
    return unsub;
  }, [W, scale]);

  useFrame((_, dt) => {
    if (!group.current) return;
    const s = st.current as typeof st.current & {
      say?: (t: string, i?: boolean) => void;
      spawn?: (spec: BurstSpec, pos: [number, number, number], delay?: number) => void;
    };
    const now = fxNow();
    const game = useGame.getState();
    const reduced = game.settings.reducedMotion ? 0.3 : 1;
    const m = game.match;

    // new match → reset personality
    if (m !== s.match) {
      s.match = m;
      s.mood = 'smug';
      s.defeatAt = -1;
      s.victoryAt = -1;
      s.flinch = s.laugh = s.rage = s.recoil = -99;
      s.taunt = '';
      s.tauntAt = -99;
      s.nextIdle = now + 1.4;
      motion.current.droop = 0;
      group.current.position.set(0, 0, 0);
      group.current.rotation.set(0, 0, 0);
      group.current.visible = true;
    }
    if (m?.winner === 'player' && s.defeatAt < 0) {
      s.defeatAt = now + 0.25;
      s.taunt = '';
      s.tauntAt = -99;
      for (let i = 0; i < 6; i++) {
        const p: [number, number, number] = [rnd(-3.2, 3.2), rnd(1.5, 7.2), 1.8];
        s.spawn?.(i % 2 ? BOOM : HIT_SPARKS, p, 0.25 + i * 0.22);
      }
      s.spawn?.(WRECK_SMOKE, [0, 4.5, 1.4], 0.5);
      s.spawn?.(STEAM, [0, 1.2, 2.4], 1.0);
    }
    if (s.defeatAt > 0 && now >= s.defeatAt && s.mood !== 'dead') {
      s.mood = 'dead';
      addTrauma(0.55 * reduced);
      s.say?.(pick(TAUNTS.defeat), true);
    }
    if (m?.winner === 'ai' && s.victoryAt < 0) {
      s.victoryAt = now + 0.35;
    }
    if (s.victoryAt > 0 && now >= s.victoryAt && s.mood !== 'victory') {
      s.mood = 'victory';
      s.say?.(pick(TAUNTS.victory), true);
    }
    if (s.mood !== 'dead' && s.mood !== 'victory' && now > s.moodUntil) s.mood = 'smug';

    // idle trash talk
    if (game.phase === 'battle' && now > s.nextIdle && s.mood === 'smug') {
      s.say?.(pick(s.tauntAt < 0 ? TAUNTS.intro : TAUNTS.idle));
    }

    // ---- body animation
    const g = group.current;
    const t = now;
    let px = 0;
    let py = Math.sin(t * 1.1) * 0.12;
    let pz = 0;
    let rx = 0;
    const ry = Math.sin(t * 0.45) * 0.05;
    let rz = Math.sin(t * 0.75) * 0.018;
    let sx = 1;
    let sy = 1;

    const fa = now - s.flinch;
    const fe = env(fa, 0.75);
    if (fe > 0) {
      px += Math.sin(fa * 72) * 0.16 * fe * reduced;
      rx -= 0.22 * Math.sin(Math.min(fa / 0.08, 1) * Math.PI * 0.5) * fe * reduced;
      pz -= 0.35 * fe * reduced;
      sy -= 0.08 * fe;
      sx += 0.05 * fe;
    }
    const la = now - (s.mood === 'victory' ? s.victoryAt : s.laugh);
    const le = s.mood === 'victory' ? 1 : env(la, 1.5);
    if (le > 0 && la >= 0) {
      const hop = Math.abs(Math.sin(la * 15));
      py += hop * 0.24 * le * reduced;
      rz += Math.sin(la * 15) * 0.05 * le * reduced;
      sy += (hop - 0.5) * 0.05 * le;
    }
    const ra = now - s.rage;
    const re = ra < 0 || ra > 2.6 ? 0 : ra < 2.1 ? 1 : (2.6 - ra) / 0.5;
    if (re > 0) {
      px += Math.sin(ra * 91) * 0.11 * re * reduced;
      py += Math.abs(Math.sin(ra * 9)) * 0.14 * re * reduced;
      rz += Math.sin(ra * 57) * 0.03 * re * reduced;
      const pulse = 1 + Math.max(0, Math.sin(ra * 18)) * 0.06 * re;
      sx *= pulse;
      sy *= 2 - pulse * 0.97;
    }
    const ca = now - s.recoil;
    const ce = env(ca, 0.6);
    if (ce > 0) {
      rx += -0.1 * Math.sin(Math.min(ca / 0.12, 1) * Math.PI * 0.5) * ce * reduced;
      sy -= 0.06 * ce;
    }
    let droop = 0;
    if (s.defeatAt > 0 && now >= s.defeatAt) {
      const da = now - s.defeatAt;
      const shake = Math.max(0, 1 - da / 1.3);
      px += Math.sin(da * 83) * 0.2 * shake * reduced;
      rz += Math.sin(da * 47) * 0.05 * shake * reduced;
      const k = THREE.MathUtils.smoothstep(da, 0.5, 3.6);
      g.visible = k < 1;
      py -= k * 7.8;
      rx += k * 0.42;
      rz += k * 0.24;
      droop = Math.min(1, da / 1.0);
    }
    motion.current.droop = droop;
    const agTarget = re > 0 ? 1 : s.mood === 'victory' || le > 0.2 ? 0.55 : s.mood === 'hurt' ? 0.4 : 0;
    motion.current.ag += (agTarget - motion.current.ag) * Math.min(1, dt * 5);

    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);
    g.scale.set(sx, sy, 2 - sx);

    if (rageLight.current) rageLight.current.intensity = re * (26 + Math.sin(ra * 30) * 12);
    if (warmLight.current) warmLight.current.intensity = s.mood === 'dead' ? Math.random() < 0.15 ? 12 : 2 : 12;

    const dead = s.mood === 'dead';
    indicators.current.forEach((light, index) => {
      const material = light?.material as THREE.MeshStandardMaterial | undefined;
      if (!material) return;
      if (dead) material.emissiveIntensity = Math.random() < 0.04 ? 2 : 0;
      else if (re > 0) {
        material.emissive.set(Math.sin(t * 20 + index * 1.3) > 0 ? '#ff2a1a' : '#550000');
        material.emissiveIntensity = 2.6;
      } else {
        material.emissive.set(index % 2 ? '#78ff54' : '#ff8d3c');
        material.emissiveIntensity = 0.6 + (0.4 + 0.4 * Math.sin(t * 2.4 + index)) * 1.8;
      }
    });

    // ---- face + status screens (redrawn only when their content changes)
    const blink = s.mood === 'smug' && t % 4.3 < 0.13;
    const fps = s.mood === 'laugh' || s.mood === 'gloat' || s.mood === 'victory' ? 9 : 4;
    const frame = Math.floor(t * fps);
    const faceKey = `${s.mood}|${s.mood === 'smug' ? 0 : frame}|${blink}`;
    if (faceKey !== s.faceKey && face.ctx) {
      s.faceKey = faceKey;
      drawFace(face.ctx, s.mood, frame, blink);
      face.tex.needsUpdate = true;
    }
    const ships = m?.enemy.ships ?? [];
    const alive = ships.filter((x) => !x.sunk).length;
    const sframe = Math.floor(t * 3) % 2;
    const statusKey = `${s.mood}|${alive}|${ships.length}|${alive / Math.max(1, ships.length) <= 0.25 ? sframe : 0}`;
    if (statusKey !== s.statusKey && status.ctx) {
      s.statusKey = statusKey;
      drawStatus(status.ctx, s.mood, alive, ships.length || 5, sframe);
      status.tex.needsUpdate = true;
    }

    // ---- speech bubble (typewriter + elastic pop)
    const b = bubble.current;
    if (b) {
      const age = now - s.tauntAt;
      const show = !!s.taunt && age >= 0 && age < s.tauntDur && (game.phase === 'battle' || game.phase === 'over');
      b.visible = show;
      if (show) {
        const chars = Math.min(s.taunt.length, Math.floor(age * 42) + 1);
        const key = `${s.taunt}|${chars}|${s.mood}`;
        if (key !== s.bubbleKey && speech.ctx) {
          s.bubbleKey = key;
          drawBubble(speech.ctx, s.taunt.slice(0, chars), s.mood);
          speech.tex.needsUpdate = true;
        }
        const out = Math.max(0, (age - (s.tauntDur - 0.2)) / 0.2);
        const k = popIn(age / 0.4) * (1 - out);
        b.scale.setScalar(Math.max(0.001, k));
        b.position.y = 8.2 + Math.sin(t * 2.2) * 0.08;
      }
    }
  });

  const visible = phase === 'battle' || phase === 'over';

  return (
    <group position={position} scale={scale} visible={visible}>
      <group ref={group}>
        <pointLight ref={warmLight} position={[0, 4.7, 3.8]} intensity={12} color="#ffd69a" distance={16} />
        <pointLight position={[0, 4.4, -1.8]} intensity={10} color="#70eaff" distance={13} />
        <pointLight ref={rageLight} position={[0, 4.2, 3.2]} intensity={0} color="#ff2a1a" distance={20} />

        <mesh position={[0, 2.95, 0]} material={cabinet}>
          <boxGeometry args={[4.8, 5.55, 1.9]} />
        </mesh>
        <mesh position={[0, 0.22, 0.05]} material={trim}>
          <boxGeometry args={[5.1, 0.45, 2.15]} />
        </mesh>
        <mesh position={[0, 5.78, 0.02]} material={trim}>
          <boxGeometry args={[4.95, 0.28, 2.05]} />
        </mesh>
        <mesh position={[0, 4.05, 1.01]} material={screenFrame}>
          <boxGeometry args={[3.82, 2.2, 0.22]} />
        </mesh>
        <mesh position={[0, 4.05, 1.135]}>
          <planeGeometry args={[3.48, 1.84]} />
          <meshBasicMaterial map={face.tex} toneMapped={false} />
        </mesh>

        <mesh position={[0, 2.45, 1.01]} material={trim}>
          <boxGeometry args={[3.7, 0.78, 0.18]} />
        </mesh>
        <mesh position={[0, 2.45, 1.115]}>
          <planeGeometry args={[3.46, 0.62]} />
          <meshBasicMaterial map={status.tex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.22, 1.01]} material={trim}>
          <boxGeometry args={[3.72, 0.1, 0.15]} />
        </mesh>

        {Array.from({ length: 6 }).map((_, row) => (
          <mesh key={`vent-${row}`} position={[-1.66, 1.85 - row * 0.18, 0.99]} material={screenFrame}>
            <boxGeometry args={[0.58, 0.055, 0.08]} />
          </mesh>
        ))}
        {Array.from({ length: 6 }).map((_, row) => (
          <mesh key={`vent-right-${row}`} position={[1.66, 1.85 - row * 0.18, 0.99]} material={screenFrame}>
            <boxGeometry args={[0.58, 0.055, 0.08]} />
          </mesh>
        ))}

        {Array.from({ length: 5 }).map((_, index) => (
          <mesh
            key={`indicator-${index}`}
            ref={(mesh) => {
              indicators.current[index] = mesh;
            }}
            position={[-1.52 + index * 0.76, 0.82, 1.02]}
          >
            <sphereGeometry args={[0.085, 10, 8]} />
            <meshStandardMaterial
              color={index % 2 ? '#b9ff64' : '#ffb957'}
              emissive={index % 2 ? '#78ff54' : '#ff8d3c'}
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
        ))}

        <CableTentacle side={-1} phase={0.2} anchorY={1.65} reach={4.2} depth={-0.1} motion={motion} />
        <CableTentacle side={-1} phase={2.3} anchorY={0.45} reach={3.7} depth={0.55} motion={motion} />
        <CableTentacle side={1} phase={1.1} anchorY={1.5} reach={4.4} depth={0.25} motion={motion} />
        <CableTentacle side={1} phase={3.4} anchorY={0.55} reach={3.8} depth={-0.35} motion={motion} />
      </group>

      {/* un-scaled space: particles + speech balloon keep true proportions */}
      <group scale={W.inv}>
        {bursts.map((b) => (
          <Burst key={b.id} spec={b.spec} birth={b.birth} position={b.pos} />
        ))}
        <group ref={bubble} position={[-6.9, 8.2, 1.6]} visible={false}>
          <mesh renderOrder={20}>
            <planeGeometry args={[5.8, 2.266]} />
            <meshBasicMaterial map={speech.tex} transparent depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
