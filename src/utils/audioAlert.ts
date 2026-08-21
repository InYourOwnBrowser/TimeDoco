let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedAudioCtx || !(sharedAudioCtx instanceof Ctx)) sharedAudioCtx = new Ctx();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Call this from a real user click (e.g. the "Start Timer" button) so the
// browser's autoplay policy treats audio as unlocked for the rest of the
// session — otherwise the first automatic playback later (which has no
// user gesture behind it) may be silently blocked by the browser.
export function unlockAudioAlert() {
  getAudioContext()?.resume();
}

export function playOverrunChime() {
  const ctx = getAudioContext();
  if (!ctx) return; // Web Audio unsupported — modal/notification/title-flash still apply
  const now = ctx.currentTime;

  [0, 0.18].forEach((offset) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5 — short, clearly audible, not jarring
    gain.gain.setValueAtTime(0, now + offset);
    gain.gain.linearRampToValueAtTime(0.25, now + offset + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + offset + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.16);
  });
}
