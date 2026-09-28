/*
 * 투표가 열리기 직전에 내는 소리.
 *
 * 소리 파일을 두지 않고 브라우저가 직접 만든다. 파일을 받아 오다 늦으면 정작
 * 필요한 순간에 못 울린다.
 *
 * 초읽기는 벽시계 태엽 소리를 따라간다. 태엽 소리는 한 겹이 아니다 — 톱니가
 * 풀리며 나는 파열음, 그 위에 짧게 남는 금속 울림, 아래에 깔리는 몸통 울림이
 * 겹쳐 있다. 게다가 톱니가 걸렸다 놓이며 아주 짧은 간격으로 두 번 친다. 한
 * 겹으로 만들면 북을 얇게 친 소리가 되고, 겹쳐야 시계처럼 들린다.
 *
 * 열리는 순간은 옛날 쌍종 자명종이다. 망치가 두 종을 빠르게 번갈아 때리는
 * 소리라, 종 울림에 빠른 떨림을 걸어 만든다.
 *
 * 브라우저는 사람이 한 번 누르기 전에는 소리를 내주지 않는다. 그래서 소리
 * 스위치를 누르는 그 순간에 이 장치를 만든다 — 그 누름이 허락이 된다.
 */

type Kind = "tick" | "tock" | "open";

interface Voice {
  /** 톱니가 풀리는 파열음. 아주 짧고 넓다. */
  snap: { seconds: number; gain: number };
  /** 그 위에 남는 금속 울림. q 가 클수록 쇳소리에 가깝다. */
  ring: { hz: number; q: number; seconds: number; gain: number };
  /** 아래에 깔리는 몸통. 이것이 없으면 소리가 얇아진다. */
  body: { hz: number; seconds: number; gain: number };
  /** 두 번째 타격까지의 간격(초). 톱니가 걸렸다 놓이며 겹쳐 친다. */
  echo: number;
}

/*
 * 째는 높고 짧게, 깍은 낮고 길게. 번갈아 내야 주고받는 것처럼 들린다.
 *
 * 세 겹이 한꺼번에 더해지므로 겹마다의 값은 작게 잡는다. 크기 막대를 끝까지
 * 올렸을 때 합이 1 을 넘으면 소리가 찌그러진다 — 재어 보니 0.8 언저리다.
 */
const VOICES: Record<"tick" | "tock", Voice> = {
  tick: {
    snap: { seconds: 0.006, gain: 0.62 },
    ring: { hz: 4200, q: 12, seconds: 0.035, gain: 0.42 },
    body: { hz: 300, seconds: 0.045, gain: 0.28 },
    echo: 0.01,
  },
  tock: {
    snap: { seconds: 0.007, gain: 1.05 },
    ring: { hz: 3000, q: 11, seconds: 0.048, gain: 0.7 },
    body: { hz: 210, seconds: 0.065, gain: 0.5 },
    echo: 0.012,
  },
};

/*
 * 자명종. 두 종의 높이와 망치가 오가는 빠르기다.
 *
 * 종소리는 배음이 정수배가 아니어서 맑은 음과 다르게 들린다 — 그래서 기본음에
 * 1.49 배와 2.23 배를 얹는다. hits 는 1 초에 망치가 오가는 횟수다.
 */
const ALARM = {
  bells: [2150, 2680],
  partials: [1, 1.49, 2.23],
  hits: 27,
  seconds: 1.15,
  gain: 0.36,
};

/** 막대를 처음 놓는 자리(%). */
export const DEFAULT_VOLUME = 70;

/** 초읽기가 시작되는 남은 초. 여기서부터 매초 째깍거린다. */
export const COUNTDOWN_FROM = 10;

export class CountdownSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private limiter: AudioNode | null = null;
  /** 0~1. 화면의 크기 막대가 정한다. */
  private volume = DEFAULT_VOLUME / 100;

  setVolume(percent: number): void {
    this.volume = Math.min(1, Math.max(0, percent / 100));
  }

  /** 사람이 스위치를 누른 그 자리에서 부른다. 여기 아니면 소리가 막힌다. */
  async enable(): Promise<boolean> {
    try {
      type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
      if (!Ctor) return false;
      this.context ??= new Ctor();
      // 탭이 뒤로 갔다 오면 멈춰 있을 수 있다.
      if (this.context.state === "suspended") await this.context.resume();
      return this.context.state === "running";
    } catch {
      // 소리가 안 나는 것은 투표를 막을 일이 아니다.
      return false;
    }
  }

  close(): void {
    void this.context?.close();
    this.context = null;
    this.noise = null;
    this.limiter = null;
  }

  /** 잡음 조각. 한 번 만들어 두고 칠 때마다 다시 쓴다. */
  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.noise) {
      const length = Math.ceil(context.sampleRate * 0.5);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  /*
   * 모든 소리가 지나는 마지막 자리.
   *
   * 잡음으로 만든 소리는 칠 때마다 봉우리가 크게 튄다 — 같은 값으로도 두 배
   * 넘게 차이가 났다. 그대로 두면 어떤 타격은 한계를 넘어 찌그러진다. 그래서
   * 끝에 곡선을 하나 두어 큰 쪽만 부드럽게 눌러 앉힌다. 작은 소리는 그대로
   * 지나가고, 큰 소리만 완만해진다.
   */
  private output(context: AudioContext): AudioNode {
    if (!this.limiter) {
      const shaper = context.createWaveShaper();
      const size = 2048;
      const curve = new Float32Array(size);
      const drive = 1.7;
      for (let i = 0; i < size; i += 1) {
        const x = (i / (size - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      shaper.curve = curve;
      shaper.oversample = "2x";
      shaper.connect(context.destination);
      this.limiter = shaper;
    }
    return this.limiter;
  }

  /** 0 에서 순간에 올렸다 지수로 내리는 포락선. */
  private envelope(context: AudioContext, at: number, peak: number, seconds: number): GainNode {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    // 지수는 0 을 다루지 못하므로 올라가는 쪽만 직선으로 긋는다.
    gain.gain.linearRampToValueAtTime(peak, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    return gain;
  }

  /** delay 는 초. 미리 듣기처럼 여러 소리를 이어 붙일 때 쓴다. */
  play(kind: Kind, delay = 0): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const at = context.currentTime + delay;

    if (kind === "open") {
      this.playAlarm(context, at);
      return;
    }
    const voice = VOICES[kind];
    this.strike(context, voice, at, 1);
    // 두 번째 타격은 작게. 이것이 있어야 "딱" 이 아니라 "째깍" 으로 들린다.
    this.strike(context, voice, at + voice.echo, 0.45);
  }

  private strike(context: AudioContext, voice: Voice, at: number, scale: number): void {
    const level = this.volume * scale;
    if (level < 0.001) return;

    // 1) 파열음 — 넓은 잡음에서 높은 쪽만 남겨 아주 짧게.
    const snap = context.createBufferSource();
    snap.buffer = this.noiseBuffer(context);
    const snapFilter = context.createBiquadFilter();
    snapFilter.type = "highpass";
    snapFilter.frequency.value = 1800;
    const snapGain = this.envelope(context, at, voice.snap.gain * level, voice.snap.seconds);
    snap.connect(snapFilter).connect(snapGain).connect(this.output(context));
    snap.start(at);
    snap.stop(at + voice.snap.seconds + 0.02);

    // 2) 금속 울림 — 같은 잡음을 좁은 띠로 걸러 조금 더 길게.
    const ring = context.createBufferSource();
    ring.buffer = this.noiseBuffer(context);
    const ringFilter = context.createBiquadFilter();
    ringFilter.type = "bandpass";
    ringFilter.frequency.value = voice.ring.hz;
    ringFilter.Q.value = voice.ring.q;
    const ringGain = this.envelope(context, at, voice.ring.gain * level, voice.ring.seconds);
    ring.connect(ringFilter).connect(ringGain).connect(this.output(context));
    ring.start(at);
    ring.stop(at + voice.ring.seconds + 0.02);

    // 3) 몸통 — 낮은 음 한 번. 이것이 소리에 무게를 준다.
    const body = context.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(voice.body.hz, at);
    // 때린 뒤 살짝 내려앉는다. 두드린 물체의 소리는 늘 그렇다.
    body.frequency.exponentialRampToValueAtTime(voice.body.hz * 0.82, at + voice.body.seconds);
    const bodyGain = this.envelope(context, at, voice.body.gain * level, voice.body.seconds);
    body.connect(bodyGain).connect(this.output(context));
    body.start(at);
    body.stop(at + voice.body.seconds + 0.02);
  }

  /*
   * 쌍종 자명종. 망치가 두 종을 빠르게 오가며 때린다.
   *
   * 종마다 배음을 세 겹 쌓고, 그 전체를 빠른 떨림으로 끊어 준다. 떨림이 망치가
   * 오가는 소리다 — 이것이 없으면 그냥 길게 늘어진 종소리가 된다.
   */
  private playAlarm(context: AudioContext, at: number): void {
    const level = this.volume;
    if (level < 0.001) return;
    const { bells, partials, hits, seconds, gain } = ALARM;

    // 전체 크기. 끝으로 갈수록 잦아든다.
    const master = context.createGain();
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(gain * level, at + 0.005);
    master.gain.setValueAtTime(gain * level, at + seconds * 0.55);
    master.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    master.connect(this.output(context));

    // 망치가 오가며 소리를 끊는 떨림. 0 과 1 사이를 오르내리게 만든다.
    const chopper = context.createGain();
    chopper.gain.setValueAtTime(0.5, at);
    const lfo = context.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = hits;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(chopper.gain);
    lfo.start(at);
    lfo.stop(at + seconds + 0.05);
    chopper.connect(master);

    for (const [index, bell] of bells.entries()) {
      for (const [order, ratio] of partials.entries()) {
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.value = bell * ratio;
        const partialGain = context.createGain();
        // 높은 배음일수록 작게. 두 번째 종은 반 박자 늦게 들어와 서로 엇갈린다.
        partialGain.gain.value = (1 / (order + 1.6)) * (index === 1 ? 0.85 : 1);
        osc.connect(partialGain).connect(chopper);
        osc.start(at + (index === 1 ? 0.5 / hits : 0));
        osc.stop(at + seconds + 0.05);
      }
    }

    // 망치가 종에 닿는 쇳소리. 잡음을 얇게 얹는다.
    const hammer = context.createBufferSource();
    hammer.buffer = this.noiseBuffer(context);
    hammer.loop = true;
    const hammerFilter = context.createBiquadFilter();
    hammerFilter.type = "bandpass";
    hammerFilter.frequency.value = 5200;
    hammerFilter.Q.value = 2;
    const hammerGain = context.createGain();
    hammerGain.gain.value = 0.35;
    hammer.connect(hammerFilter).connect(hammerGain).connect(chopper);
    hammer.start(at);
    hammer.stop(at + seconds + 0.05);
  }
}

/*
 * 미리 듣기. 실제로 어떻게 울리는지 그때 가서 처음 듣지 않게 한다.
 *
 * 째깍 초읽기 네 번과 자명종을 들려준다. 시간은 브라우저의 소리 시계로 재서
 * 화면이 버벅여도 간격이 흔들리지 않는다.
 */
export const PREVIEW_SECONDS = 3.4;

export function previewSequence(sound: CountdownSound): void {
  sound.play("tick", 0);
  sound.play("tock", 0.5);
  sound.play("tick", 1.0);
  sound.play("tock", 1.5);
  sound.play("open", 2.0);
}

/**
 * 이 초에 낼 소리. 15 초마다 한 번, 마지막 10 초는 매초.
 *
 * 째와 깍은 초의 홀짝으로 번갈아 난다. 같은 소리를 열 번 반복하면 시계가
 * 아니라 경보음으로 들린다. 15 초마다 나는 것도 같은 소리다 — 구분할 이유가
 * 없다.
 */
export function toneForSecond(secondsLeft: number): Kind | null {
  if (secondsLeft <= 0 || secondsLeft > 60) return null;
  if (secondsLeft > COUNTDOWN_FROM && secondsLeft % 15 !== 0) return null;
  return secondsLeft % 2 === 0 ? "tick" : "tock";
}
