import { Component, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FLEET, GRID_SIZE } from '../game/types';
import type { CellMark, PlacedShip } from '../game/types';
import { Burst, Ring } from './Effects';
import { DEBRIS, FIREBALL, MIST, SMOKE, SPARKS, WATER_COLUMN, WATER_CROWN } from './fxKit';
import { HeroFleet } from './HeroFleet';
import { LegacyMonolith } from './LegacyMonolith';
import { MarkerField } from './Markers';
import { LEGACY_MONOLITH_POSITION, LEGACY_MONOLITH_SCALE } from './config';
import { ShipMesh } from './ShipMesh';
import { WarmupContext } from './warmupContext';

/**
 * Shader precompile while the boot splash is still up.
 *
 * Battle-only pieces (the Legacy Monolith, particle bursts, rings) are mounted
 * once, hidden, so `compileAsync` builds their programs *and* the battle light
 * rig (the boss brings its own point lights, which changes every lit material's
 * program key). Clones of the warm materials are kept alive after the warm group
 * unmounts so three.js never releases those programs, and the first battle frame
 * and first explosion hit a warm cache instead of a synchronous compile.
 */

const KEEP_ALIVE: THREE.Object3D[] = [];
const MAX_WAIT_MS = 5000;
const FAR_PAST = -1e4;

class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function keepAlive(
  root: THREE.Object3D,
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scene: THREE.Scene,
  linearTarget: THREE.WebGLRenderTarget | null,
) {
  const holder = new THREE.Group();
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material;
    if (!material) return;
    const copy = o.clone(false);
    (copy as THREE.Mesh).material = Array.isArray(material) ? material.map((m) => m.clone()) : material.clone();
    holder.add(copy);
  });
  // cache hits only: this just bumps each program's reference count
  gl.compile(holder, camera, scene);
  if (linearTarget) {
    const linear = holder.clone(false);
    holder.children.forEach((c) => {
      const copy = c.clone(false);
      const mat = (c as THREE.Mesh).material;
      (copy as THREE.Mesh).material = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
      linear.add(copy);
    });
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(linearTarget);
    gl.compile(linear, camera, scene);
    gl.setRenderTarget(prev);
    KEEP_ALIVE.push(linear);
  }
  KEEP_ALIVE.push(holder);
}

const SPECS = [FIREBALL, SPARKS, DEBRIS, SMOKE, WATER_COLUMN, WATER_CROWN, MIST];
const WARM_SPEC = FLEET.find((spec) => spec.id === 'carrier')!;
const WARM_SHIP: PlacedShip = {
  spec: WARM_SPEC,
  cells: Array.from({ length: WARM_SPEC.length }, (_, x) => ({ x, y: 0 })),
  hits: 1,
  sunk: false,
};
const WARM_WRECK: PlacedShip = { ...WARM_SHIP, hits: WARM_SPEC.length, sunk: true };
const WARM_MARKS = Array.from({ length: GRID_SIZE }, () => Array<CellMark>(GRID_SIZE).fill('unknown'));
WARM_MARKS[0][0] = 'miss';
WARM_MARKS[1][1] = 'hit';

export function ShaderWarmup({ onReady, postfx }: { onReady: (ms: number) => void; postfx: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const [done, setDone] = useState(false);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      setDone(true);
      ready.current(performance.now() - t0);
    };
    const timer = window.setTimeout(finish, MAX_WAIT_MS);
    // Two frames later: sibling layout effects (environment, materials) are in and
    // the menu has painted its first fade-in frame (it is the LCP element), so the
    // compile burst doesn't sit in front of first meaningful paint.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        start = window.setTimeout(run, 0);
      });
    });
    let start = 0;
    const run = async () => {
      const g = group.current;
      try {
        // Children hide themselves outside battle (the boss rig and its lights);
        // three.js only counts visible lights, so reveal everything or every lit
        // material compiles for the wrong light count.
        g?.traverse((o) => (o.visible = true));
        const pending = gl.compileAsync(scene, camera);
        // With post-processing on, battle frames render into a linear render
        // target, which is a separate program variant (outputColorSpace).
        const prev = gl.getRenderTarget();
        const rt = postfx ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) : null;
        if (rt) {
          gl.setRenderTarget(rt);
          gl.compile(scene, camera);
        }
        if (g) keepAlive(g, gl, camera, scene, rt);
        gl.setRenderTarget(prev);
        rt?.dispose();
        if (g) g.visible = false;
        await pending;
      } catch {
        if (g) g.visible = false;
      }
      window.clearTimeout(timer);
      finish();
    };
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(start);
    };
  }, [gl, scene, camera, postfx]);

  if (done) return null;
  return (
    <WarmupContext.Provider value>
      <group ref={group} visible={false}>
        <Guard>
          <LegacyMonolith position={LEGACY_MONOLITH_POSITION} scale={LEGACY_MONOLITH_SCALE} />
          <HeroFleet />
          <ShipMesh ship={WARM_SHIP} hitCells={[WARM_SHIP.cells[0]]} />
          <ShipMesh ship={WARM_WRECK} hitCells={WARM_WRECK.cells} />
          <MarkerField marks={WARM_MARKS} version={0} />
        </Guard>
        <Guard>
          {SPECS.map((spec, i) => (
            <Burst key={i} spec={spec} birth={FAR_PAST} />
          ))}
          <Ring birth={FAR_PAST} life={1} from={0} to={1} color="#ffffff" />
          <Ring birth={FAR_PAST} life={1} from={0} to={1} color="#ffffff" additive={false} />
        </Guard>
      </group>
    </WarmupContext.Provider>
  );
}

/** Dev/QA probe: `?perf` (or any dev build) exposes the renderer for frame/program stats. */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('perf')) return;
    Object.assign(window, { __aetherGl: gl, __aetherScene: scene });
  }, [gl, scene]);
  return null;
}
