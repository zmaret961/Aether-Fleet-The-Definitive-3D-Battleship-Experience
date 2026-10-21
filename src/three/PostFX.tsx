import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useQuality } from './quality';

/** Post-processing lives in its own lazily loaded chunk so the first frame never waits on it. */
export default function PostFX() {
  const bloom = useQuality((s) => s.bloom);
  if (!bloom) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.55} luminanceThreshold={0.32} mipmapBlur />
    </EffectComposer>
  );
}
