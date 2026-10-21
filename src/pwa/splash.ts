/** Fades out the inline boot screen from index.html once the 3D canvas has painted. */
export function dismissSplashWhenReady(maxWaitMs = 12000) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    boot.classList.add('boot-done');
    window.setTimeout(() => boot.remove(), 700);
  };
  const afterFrames = (n: number) => (n <= 0 ? finish() : requestAnimationFrame(() => afterFrames(n - 1)));
  const check = () => {
    if (document.querySelector('#root canvas')) afterFrames(3);
  };
  const observer = new MutationObserver(check);
  observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
  check();
  window.setTimeout(finish, maxWaitMs);
}
