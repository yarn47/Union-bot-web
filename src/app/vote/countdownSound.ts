/*
 * 투표가 열리기 직전에 내는 소리.
 *
 * 초읽기는 실제 벽시계 녹음이다. 만들어 낸 소리로는 흉내가 나지 않아 1 시간
 * 짜리 녹음에서 똑 하나, 딱 하나를 잘라 왔다(public/sounds). 둘의 크기 차이는
 * 녹음 그대로 두었다 — 그 차이가 "똑딱" 으로 들리게 하는 것이다.
 *
 * 열리는 순간은 옛날 쌍종 자명종이고, 이것만 브라우저가 만들어 낸다. 종소리는
 * 배음이 정수배가 아니어서 맑은 음과 다르게 들린다.
 *
 * 브라우저는 사람이 한 번 누르기 전에는 소리를 내주지 않는다. 그래서 소리
 * 스위치를 누르는 그 순간에 이 장치를 만들고, 녹음도 그때 받아 둔다 — 울려야
 * 할 때 받기 시작하면 늦는다.
 */

type Kind = "tick" | "tock" | "open";

const CLIPS: Record<"tick" | "tock", string> = {
  tick: "/sounds/tick.wav",
  tock: "/sounds/tock.wav",
};

/*
 * 자명종. 두 종의 높이와 망치가 오가는 빠르기다.
 *
 * 종소리는 배음이 정수배가 아니어서 기본음에 1.49 배, 2.23 배를 얹는다.
 * hits 는 1 초에 망치가 오가는 횟수다.
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

/** 초읽기가 시작되는 남은 초. 여기서부터 매초 똑딱거린다. */
export const COUNTDOWN_FROM = 10;

export class CountdownSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private limiter: AudioNode | null = null;
  private clips = new Map<string, AudioBuffer>();
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
      if (this.context.state !== "running") return false;
      await this.loadClips(this.context);
      return true;
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
    this.clips.clear();
  }

  /*
   * 녹음을 미리 받아 둔다. 둘 다 15KB 가 안 되고, 한 번 받으면 다시 받지
   * 않는다. 하나가 실패해도 나머지는 살린다 — 초읽기가 반만 울리는 편이
   * 아무 소리도 안 나는 것보다 낫다.
   */
  private async loadClips(context: AudioContext): Promise<void> {
    await Promise.all(
      Object.values(CLIPS).map(async (url) => {
        if (this.clips.has(url)) return;
        try {
          const response = await fetch(url, { cache: "force-cache" });
          if (!response.ok) return;
          this.clips.set(url, await context.decodeAudioData(await response.arrayBuffer()));
        } catch {
          // 못 받으면 그 소리만 빠진다.
        }
      }),
    );
  }

  /** 잡음 조각. 자명종의 망치 소리에 쓴다. */
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
   * 모든 소리가 지나는 마지막 자리. 큰 쪽만 부드럽게 눌러 앉혀, 크기 막대를
   * 끝까지 올려도 찌그러지지 않게 한다.
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

  /** delay 는 초. 미리 듣기처럼 여러 소리를 이어 붙일 때 쓴다. */
  play(kind: Kind, delay = 0): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const at = context.currentTime + delay;

    if (kind === "open") {
      this.playAlarm(context, at);
      return;
    }

    // 벽시계는 1 초에 한 번만 친다. 똑과 딱은 초마다 번갈아 나는 것이다.
    const clip = this.clips.get(CLIPS[kind]);
    if (!clip || this.volume < 0.001) return;
    const source = context.createBufferSource();
    source.buffer = clip;
    const gain = context.createGain();
    gain.gain.value = this.volume;
    source.connect(gain).connect(this.output(context));
    source.start(at);
  }

  /*
   * 쌍종 자명종. 망치가 두 종을 빠르게 오가며 때린다.
   *
   * 종마다 배음을 세 겹 쌓고 전체를 빠른 떨림으로 끊는다. 떨림이 망치가 오가는
   * 소리다 — 이것이 없으면 그냥 길게 늘어진 종소리가 된다.
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
 * 똑딱 초읽기 네 번과 자명종을 들려준다. 시간은 브라우저의 소리 시계로 재서
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
 * 똑과 딱은 초의 홀짝으로 번갈아 난다. 같은 소리를 열 번 반복하면 시계가
 * 아니라 경보음으로 들린다.
 */
export function toneForSecond(secondsLeft: number): Kind | null {
  if (secondsLeft <= 0 || secondsLeft > 60) return null;
  if (secondsLeft > COUNTDOWN_FROM && secondsLeft % 15 !== 0) return null;
  return secondsLeft % 2 === 0 ? "tick" : "tock";
}
