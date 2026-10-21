import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import { useQuality } from './quality';

export default function PostFX() {
  const bloom = useQuality((s) => s.bloom);
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {bloom && <Bloom intensity={0.7} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur radius={0.7} />}
      <Vignette offset={0.28} darkness={0.62} />
      <SMAA />
    </EffectComposer>
  );
}
