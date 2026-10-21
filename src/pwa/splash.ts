/** Fired on window once shaders are compiled and the first frame is on screen. */
export const SCENE_READY_EVENT = 'aether:scene-ready';

/**
 * Fades out the inline boot screen from index.html once the 3D scene has
 * compiled its shaders and painted (Scene dispatches SCENE_READY_EVENT). If the
 * 3D chunk fails or WebGL is missing, the UI still appears after `maxWaitMs`.
 */
export function dismissSplashWhenReady(maxWaitMs = 12000) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener(SCENE_READY_EVENT, finish);
    boot.classList.add('boot-done');
    performance.mark?.('aether:splash-done');
    window.setTimeout(() => boot.remove(), 700);
  };
  window.addEventListener(SCENE_READY_EVENT, finish);
  window.setTimeout(finish, maxWaitMs);
}
