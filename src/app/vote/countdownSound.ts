/*
 * 투표가 열리기 직전에 내는 소리.
 *
 * 소리 파일을 두지 않고 브라우저가 직접 만든다. 짧은 소리 몇 개 때문에 파일을
 * 받아 오게 할 이유가 없고, 받아 오다 늦으면 정작 필요한 순간에 못 울린다.
 *
 * 초읽기는 벽시계 소리를 따라간다. 시계의 "째깍" 은 음이 아니라 아주 짧은
 * 파열음이라, 사인파 같은 맑은 음으로는 흉내가 안 난다. 잡음을 좁은 띠로
 * 걸러 순간에 때리고 바로 끊는다. 째와 깍은 걸러 내는 높이가 달라서, 번갈아
 * 내면 시계처럼 들린다.
 *
 * 브라우저는 사람이 한 번 누르기 전에는 소리를 내주지 않는다. 그래서 소리
 * 스위치를 누르는 그 순간에 이 장치를 만든다 — 그 누름이 허락이 된다.
 */

type Kind = "tick" | "tock" | "beep" | "open";

/** 맑은 음으로 내는 소리. 주파수(Hz)·길이(초)·세기. */
const TONES: Record<"beep" | "open", { hz: number; seconds: number; gain: number }> = {
  // 15 초마다 알리는 소리. 초읽기와 확실히 구분되도록 음으로 낸다.
  beep: { hz: 880, seconds: 0.11, gain: 0.36 },
  // 열리는 순간. 위로 한 번 튀어 "됐다" 로 들리게 한다.
  open: { hz: 1568, seconds: 0.22, gain: 0.42 },
};

/*
 * 시계 소리. 좁은 띠로 거른 잡음을 때린다.
 *
 * hz 는 그 띠의 가운데다 — 높을수록 날카롭고 낮을수록 둔하다. q 가 클수록 띠가
 * 좁아 금속처럼 울리고, 작으면 "탁" 하는 둔한 소리가 된다. 깍이 째보다 낮고
 * 조금 길어야 두 소리가 주고받는 것처럼 들린다.
 *
 * gain 이 1 을 넘는 것은 띠로 거르며 힘이 빠지기 때문이다. 걸러 낸 뒤 실제로
 * 나가는 크기는 삑과 비슷한 0.2 언저리다.
 */
const CLICKS: Record<"tick" | "tock", { hz: number; q: number; seconds: number; gain: number }> = {
  tick: { hz: 2400, q: 2.4, seconds: 0.03, gain: 1.2 },
  tock: { hz: 1550, q: 2.2, seconds: 0.042, gain: 1.2 },
};

/** 막대를 처음 놓는 자리(%). 이 값에서 예전 고정 크기와 같게 들린다. */
export const DEFAULT_VOLUME = 70;

/** 초읽기가 시작되는 남은 초. 여기서부터 매초 째깍거린다. */
export const COUNTDOWN_FROM = 10;

export class CountdownSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
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
  }

  /** 잡음 조각. 한 번 만들어 두고 칠 때마다 다시 쓴다. */
  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.noise) {
      const length = Math.ceil(context.sampleRate * 0.12);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  /** delay 는 초. 미리 듣기처럼 여러 소리를 이어 붙일 때 쓴다. */
  play(kind: Kind, delay = 0): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const at = context.currentTime + delay;

    if (kind === "tick" || kind === "tock") {
      this.playClick(context, CLICKS[kind], at);
      return;
    }

    const tone = TONES[kind];
    // 0 까지 내리면 아예 내지 않는다. 지수로 줄이는 포락선은 0 을 다루지 못한다.
    const peak = tone.gain * this.volume;
    if (peak < 0.001) return;

    const osc = context.createOscillator();
    // 사각파는 같은 크기에서도 또렷하게 들린다. 알림음이라 음색보다 분별이다.
    osc.type = kind === "open" ? "triangle" : "square";
    osc.frequency.value = tone.hz;

    /* 소리를 그냥 끊으면 "딱" 하고 잡음이 남는다. 아주 짧게 올렸다가 지수로
       내려 끝을 부드럽게 만든다. */
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.seconds);

    osc.connect(gain).connect(context.destination);
    osc.start(at);
    osc.stop(at + tone.seconds + 0.02);
  }

  private playClick(
    context: AudioContext,
    click: { hz: number; q: number; seconds: number; gain: number },
    at: number,
  ): void {
    const peak = click.gain * this.volume;
    if (peak < 0.001) return;

    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);

    // 좁은 띠만 남긴다. 이 띠의 높이가 째와 깍을 가른다.
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = click.hz;
    band.Q.value = click.q;

    /* 때리는 소리라 올라가는 데 1 밀리초도 걸리지 않는다. 0 에서 시작하므로
       지수가 아니라 직선으로 올린다 — 지수는 0 을 다루지 못한다. */
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + click.seconds);

    source.connect(band).connect(gain).connect(context.destination);
    source.start(at);
    source.stop(at + click.seconds + 0.02);
  }
}

/*
 * 미리 듣기. 실제로 어떻게 울리는지 그때 가서 처음 듣지 않게 한다.
 *
 * 15 초마다 나는 삑, 째깍 초읽기, 열리는 소리를 순서대로 들려준다. 시간은
 * 브라우저의 소리 시계로 재서 화면이 버벅여도 간격이 흔들리지 않는다.
 */
export const PREVIEW_SECONDS = 3;

export function previewSequence(sound: CountdownSound): void {
  sound.play("beep", 0);
  sound.play("tick", 0.9);
  sound.play("tock", 1.4);
  sound.play("tick", 1.9);
  sound.play("open", 2.4);
}

/**
 * 이 초에 낼 소리. 15 초마다 삑, 마지막 10 초는 째깍 초읽기.
 *
 * 째와 깍은 초의 홀짝으로 번갈아 난다. 같은 소리를 열 번 반복하면 시계가
 * 아니라 경보음으로 들린다.
 */
export function toneForSecond(secondsLeft: number): Kind | null {
  if (secondsLeft <= 0 || secondsLeft > 60) return null;
  if (secondsLeft <= COUNTDOWN_FROM) return secondsLeft % 2 === 0 ? "tick" : "tock";
  if (secondsLeft % 15 === 0) return "beep";
  return null;
}
