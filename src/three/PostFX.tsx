import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import { useQuality } from './quality';

export default function PostFX() {
  const bloom = useQuality((s) => s.bloom);
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {bloom && <Bloom intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.12} mipmapBlur radius={0.55} />}
      <Vignette offset={0.3} darkness={0.55} />
      <SMAA />
    </EffectComposer>
  );
}
