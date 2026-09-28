/*
 * 투표가 열리기 직전에 내는 소리.
 *
 * 소리 파일을 두지 않고 브라우저가 직접 음을 만든다. 짧은 틱 하나 때문에
 * 파일을 받아 오게 할 이유가 없고, 받아 오다 늦으면 정작 필요한 순간에 못
 * 울린다. 시계 초침처럼 마른 소리를 내려고 짧게 때리고 바로 끊는다.
 *
 * 브라우저는 사람이 한 번 누르기 전에는 소리를 내주지 않는다. 그래서 소리
 * 스위치를 누르는 그 순간에 이 장치를 만든다 — 그 누름이 허락이 된다.
 */

type Kind = "tick" | "beep" | "open";

/**
 * 소리마다 주파수(Hz)·길이(초)·세기. 길이가 짧아야 "틱" 으로 들린다.
 *
 * 여기 적힌 세기는 크기 막대를 끝까지 올렸을 때의 값이다. 1.0 이 최대이므로
 * 셋 다 한참 아래에 둔다 — 알림음이 기기를 울릴 만큼 클 이유가 없다.
 */
const TONES: Record<Kind, { hz: number; seconds: number; gain: number }> = {
  // 마지막 5 초 초읽기. 초침 소리에 가깝게 짧고 건조하게.
  tick: { hz: 1180, seconds: 0.035, gain: 0.32 },
  // 15 초마다 알리는 소리. 틱보다 조금 낮고 길어 구분된다.
  beep: { hz: 880, seconds: 0.11, gain: 0.36 },
  // 열리는 순간. 위로 한 번 튀어 "됐다" 로 들리게 한다.
  open: { hz: 1568, seconds: 0.22, gain: 0.42 },
};

/** 막대를 처음 놓는 자리(%). 이 값에서 예전 고정 크기와 같게 들린다. */
export const DEFAULT_VOLUME = 70;

export class CountdownSound {
  private context: AudioContext | null = null;
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
  }

  /** delay 는 초. 미리 듣기처럼 여러 소리를 이어 붙일 때 쓴다. */
  play(kind: Kind, delay = 0): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const tone = TONES[kind];
    // 0 까지 내리면 아예 내지 않는다. 지수로 줄이는 포락선은 0 을 다루지 못한다.
    const peak = tone.gain * this.volume;
    if (peak < 0.001) return;
    const now = context.currentTime + delay;

    const osc = context.createOscillator();
    // 사각파는 같은 크기에서도 또렷하게 들린다. 알림음이라 음색보다 분별이다.
    osc.type = kind === "open" ? "triangle" : "square";
    osc.frequency.value = tone.hz;

    /* 소리를 그냥 끊으면 "딱" 하고 잡음이 남는다. 아주 짧게 올렸다가 지수로
       내려 끝을 부드럽게 만든다. */
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.seconds);

    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + tone.seconds + 0.02);
  }
}

/*
 * 미리 듣기. 실제로 어떻게 울리는지 그때 가서 처음 듣지 않게 한다.
 *
 * 15 초마다 나는 삑, 마지막 초읽기, 열리는 소리를 순서대로 한 번씩 들려준다.
 * 시간은 브라우저의 소리 시계로 재서 화면이 버벅여도 간격이 흔들리지 않는다.
 */
export const PREVIEW_SECONDS = 2.4;

export function previewSequence(sound: CountdownSound): void {
  sound.play("beep", 0);
  sound.play("tick", 0.9);
  sound.play("tick", 1.2);
  sound.play("tick", 1.5);
  sound.play("open", 2.0);
}

/** 이 초에 소리를 낼지. 15 초마다, 그리고 마지막 5 초는 초읽기. */
export function toneForSecond(secondsLeft: number): Kind | null {
  if (secondsLeft <= 0 || secondsLeft > 60) return null;
  if (secondsLeft <= 5) return "tick";
  if (secondsLeft % 15 === 0) return "beep";
  return null;
}
