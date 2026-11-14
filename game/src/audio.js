// Synthesised sound, no audio assets and no network: every effect is built
// from oscillators and filtered noise in a lazily created AudioContext, so the
// game stays a set of static files. The context resumes on the first user
// gesture (the play button); before that every call is a silent no-op.
export function createAudio() {
  let context = null;
  let master = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') void context.resume();
      return context;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
    } catch {
      context = null;
    }
    return context;
  }

  function noiseBuffer(seconds) {
    const ctx = ensure();
    if (!ctx) return null;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, frequency = 1200, type = 'lowpass', gain = 0.5, slideTo = null }) {
    const ctx = ensure();
    if (!ctx || !master) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    if (slideTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), ctx.currentTime + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start();
    source.stop(ctx.currentTime + duration + 0.02);
  }

  function tone({ frequency = 440, to = null, duration = 0.1, type = 'sine', gain = 0.25, delay = 0 }) {
    const ctx = ensure();
    if (!ctx || !master) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(amp).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    // weapon: kind picks the crack; distant shots are quieter and duller.
    shot(kind, distant = false) {
      if (kind === 'sniper') burst({ duration: 0.28, frequency: distant ? 500 : 2600, slideTo: 120, gain: distant ? 0.18 : 0.7 });
      else if (kind === 'shotgun') burst({ duration: 0.22, frequency: distant ? 420 : 1500, slideTo: 90, gain: distant ? 0.2 : 0.75 });
      else if (kind === 'smg') burst({ duration: 0.08, frequency: distant ? 700 : 2200, slideTo: 300, gain: distant ? 0.1 : 0.4 });
      else burst({ duration: 0.12, frequency: distant ? 600 : 1900, slideTo: 180, gain: distant ? 0.14 : 0.55 });
      tone({ frequency: 150, to: 55, duration: 0.1, type: 'triangle', gain: distant ? 0.08 : 0.3 });
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.14 });
      tone({ frequency: 620, duration: 0.05, type: 'square', gain: 0.14, delay: 0.28 });
      tone({ frequency: 1150, duration: 0.04, type: 'square', gain: 0.16, delay: 0.55 });
    },
    hit(kill) {
      tone({ frequency: kill ? 880 : 660, duration: 0.07, type: 'sine', gain: 0.22 });
      if (kill) tone({ frequency: 1320, duration: 0.12, type: 'sine', gain: 0.18, delay: 0.07 });
    },
    hurt() {
      tone({ frequency: 220, to: 110, duration: 0.16, type: 'sawtooth', gain: 0.2 });
    },
    grenade() {
      burst({ duration: 0.7, frequency: 900, slideTo: 60, gain: 0.9 });
      tone({ frequency: 90, to: 32, duration: 0.6, type: 'sine', gain: 0.5 });
    },
    beep(final = false) {
      tone({ frequency: final ? 1560 : 1040, duration: final ? 0.3 : 0.09, type: 'square', gain: 0.16 });
    },
    plant() {
      tone({ frequency: 1040, duration: 0.08, type: 'square', gain: 0.16 });
      tone({ frequency: 1040, duration: 0.08, type: 'square', gain: 0.16, delay: 0.22 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.22, type: 'triangle', gain: 0.2, delay: i * 0.12 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.24, type: 'triangle', gain: 0.18, delay: i * 0.13 }));
    },
    buy() {
      tone({ frequency: 980, duration: 0.06, type: 'sine', gain: 0.18 });
      tone({ frequency: 1470, duration: 0.09, type: 'sine', gain: 0.16, delay: 0.06 });
    },
    denied() {
      tone({ frequency: 180, duration: 0.12, type: 'square', gain: 0.16 });
    },
  };
}
