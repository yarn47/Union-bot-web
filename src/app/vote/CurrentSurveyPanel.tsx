"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VoteButtons } from "./VoteButtons";
import { maybeAnnounce } from "./announceAction";
import { useServerClock } from "@/lib/serverClock";
import {
  CountdownSound,
  DEFAULT_VOLUME,
  PREVIEW_SECONDS,
  previewSequence,
  toneForSecond,
} from "./countdownSound";
import { formatSurveyDate, formatSurveyTime } from "@/lib/format";
import type { ClassType, VotingType } from "@/lib/types";
import styles from "./vote.module.css";

function splitDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 소리와 화면이 급해지기 시작하는 시점. 열리기 1 분 전부터다. */
const URGENT_MS = 60_000;
/** 소리를 켜 두었는지 기억하는 자리. 회차마다 다시 묻지 않는다. */
const SOUND_KEY = "voteCountdownSound";
/** 소리 크기를 기억하는 자리(%). */
const VOLUME_KEY = "voteCountdownVolume";

/* 남은 시간에 따라 화면이 달라진다. 숫자만 줄어드는 것보다 색이 바뀌는 편이
   곁눈으로도 읽힌다. */
function urgencyOf(remaining: number): "none" | "near" | "close" | "final" {
  if (remaining > URGENT_MS) return "none";
  if (remaining > 30_000) return "near";
  if (remaining > 10_000) return "close";
  return "final";
}

/**
 * 카운트다운과 투표 화면을 한 컴포넌트에서 처리한다.
 *
 * 예전에는 봇이 status 를 바꿔주기를 5초 폴링으로 기다렸다. 그래서 열리는 순간이
 * 사람마다 최대 35초까지 어긋났고, 순번이 뒤틀렸다. 이제 설문 데이터를 미리 다
 * 받아두고 서버 시각이 opensAt 에 닿는 순간 이 자리에서 바로 투표 화면으로
 * 바꾼다. 서버 왕복도, 봇도 개입하지 않으므로 모두 같은 순간에 열린다.
 */
export function CurrentSurveyPanel({
  renderedAt,
  build,
  surveyId,
  opensAt,
  executedAt,
  closesAt,
  initialVote,
  initialVotedAt,
  initialClassInfo,
  announceAt,
}: {
  /** 서버가 이 화면을 그린 시각(ms). 시계를 맞추기 전까지 이 값을 기준으로 삼는다. */
  renderedAt: number;
  /** 이 화면을 내려보낸 배포의 번호. 서버가 다른 번호를 말하면 새로 고쳐야 한다. */
  build: string;
  surveyId: string;
  opensAt: number;
  executedAt: number;
  closesAt: number;
  initialVote: VotingType | null;
  initialVotedAt: Date | null;
  initialClassInfo: { name: string; type: ClassType } | null;
  /** 공지를 쏠 시각(ms). 이미 보냈거나 공지가 없으면 null. */
  announceAt: number | null;
}) {
  // 투표가 열리는 순간이 가장 정확해야 하므로, 그 직전에 시계를 다시 맞춘다.
  const { offset, synced, build: serverBuild } = useServerClock(renderedAt, opensAt);
  const [serverNow, setServerNow] = useState(() => renderedAt);
  /* 시계를 못 맞춰도 영영 못 누르게 둘 수는 없다. 열릴 시각이 조금 지나도록 맞추지
     못하면 이 브라우저 시계라도 믿는다. */
  const [trustLocalClock, setTrustLocalClock] = useState(false);

  useEffect(() => {
    const tick = () => setServerNow(Date.now() + offset);
    tick();
    // 카운트다운이 도는 동안은 촘촘하게 확인해 0 을 넘기는 순간을 놓치지 않는다.
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [offset]);

  // 보이지 않는 두 번째 카운트다운. 공지 시각에 닿으면 서버에 한 번만 알린다.
  // 이 탭이 두 번 부르지 않게만 막으면 되고 화면과는 무관하므로 ref 를 쓴다.
  // 여러 사람의 탭이 동시에 불러도 실제 발송은 DB 선점으로 하나만 나간다.
  const announceFired = useRef(false);
  useEffect(() => {
    if (announceAt === null || announceFired.current) return;
    if (serverNow < announceAt) return;
    announceFired.current = true;
    void maybeAnnounce();
  }, [serverNow, announceAt]);

  /*
   * 서버가 이 화면을 그릴 때 이미 열려 있었다면 기다릴 것이 없다. 아직이었다면 서버
   * 시각을 한 번 받은 뒤에만 연다. 받기 전에는 이 브라우저 시계를 쓰는데, 그 시계가
   * 몇 초 빠르면 버튼이 그만큼 일찍 떠서 눌러도 서버에 거절당한다.
   */
  const openedWhenRendered = renderedAt >= opensAt;
  const clockReady = synced || openedWhenRendered || trustLocalClock;
  const remaining = Math.max(0, opensAt - serverNow);
  const isOpen = serverNow >= opensAt && clockReady;
  const isClosed = serverNow >= closesAt;

  /*
   * 열리기 1 분 전부터 나는 소리.
   *
   * 브라우저는 사람이 한 번 누르기 전에는 소리를 내주지 않는다. 그래서 켜는
   * 것은 반드시 스위치를 눌러야 하고, 한 번 켜 두면 다음 회차에도 기억한다.
   * 다만 기억하고 있어도 화면을 새로 열면 다시 한 번 눌러 줘야 한다 — 그 허락은
   * 브라우저가 페이지마다 새로 받는다.
   */
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(() => {
    /* 처음 그릴 때 읽는다. 서버에는 저장소가 없으므로 기본값으로 그려지고,
       브라우저가 이어받을 때 저장해 둔 값으로 다시 그려진다. */
    if (typeof window === "undefined") return DEFAULT_VOLUME;
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY));
      return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : DEFAULT_VOLUME;
    } catch {
      return DEFAULT_VOLUME;
    }
  });
  const [previewing, setPreviewing] = useState(false);
  const soundRef = useRef<CountdownSound | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToneSecond = useRef<number | null>(null);
  const openedTone = useRef(false);

  /* 저장소는 서버에서 읽을 수 없다. 서버는 늘 "안 켜 둠"으로 그리고, 브라우저에
     붙은 뒤 실제 값을 읽는다 — 효과 안에서 상태를 바꾸면 화면이 두 번 그려진다. */
  const soundRemembered = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(SOUND_KEY) === "on";
      } catch {
        return false;
      }
    },
    () => false,
  );

  // 화면을 떠날 때 소리 장치를 닫는다.
  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      soundRef.current?.close();
    };
  }, []);

  async function toggleSound() {
    if (soundOn) {
      soundRef.current?.close();
      soundRef.current = null;
      setSoundOn(false);
      try { localStorage.setItem(SOUND_KEY, "off"); } catch {}
      return;
    }
    soundRef.current ??= new CountdownSound();
    soundRef.current.setVolume(volume);
    const ok = await soundRef.current.enable();
    setSoundOn(ok);
    // 켰다는 것을 귀로 확인시켜 준다. 정작 그때 가서 안 들리면 늦다.
    if (ok) soundRef.current.play("tick");
    try { localStorage.setItem(SOUND_KEY, ok ? "on" : "off"); } catch {}
  }

  /*
   * 미리 듣기. 15 초마다 나는 삑, 마지막 초읽기, 열리는 소리를 차례로 한 번씩
   * 들려준다. 투표가 열리는 순간에 처음 듣게 되면 그게 무슨 소리인지 알아채는
   * 데만 몇 초가 간다.
   */
  function playPreview() {
    if (!soundRef.current || previewing) return;
    setPreviewing(true);
    previewSequence(soundRef.current);
    previewTimer.current = setTimeout(() => setPreviewing(false), PREVIEW_SECONDS * 1000);
  }

  /* 막대를 움직이면 그 자리에서 한 번 울려 크기를 귀로 확인시킨다. 소리 크기는
     눈으로 고를 수 있는 것이 아니다. */
  function changeVolume(next: number) {
    setVolume(next);
    try { localStorage.setItem(VOLUME_KEY, String(next)); } catch {}
    if (!soundRef.current) return;
    soundRef.current.setVolume(next);
    if (soundOn) soundRef.current.play("tick");
  }

  /* 남은 초가 바뀌는 순간에만 울린다. 화면은 0.2 초마다 도므로 같은 초에 네 번
     울리지 않게 마지막으로 울린 초를 적어 둔다. */
  useEffect(() => {
    if (!soundOn || !soundRef.current) return;
    if (remaining <= 0 || remaining > URGENT_MS) return;
    const secondsLeft = Math.ceil(remaining / 1000);
    if (lastToneSecond.current === secondsLeft) return;
    lastToneSecond.current = secondsLeft;
    const tone = toneForSecond(secondsLeft);
    if (tone) soundRef.current.play(tone);
  }, [soundOn, remaining]);

  // 열리는 순간은 한 번만 울린다.
  useEffect(() => {
    if (!soundOn || !isOpen || openedTone.current) return;
    openedTone.current = true;
    soundRef.current?.play("open");
  }, [soundOn, isOpen]);

  // 시계를 못 맞춘 채로 열릴 시각이 지나면, 세 번 더 재 보고 그래도 안 되면 그냥 연다.
  useEffect(() => {
    if (clockReady) return;
    const timer = setTimeout(() => setTrustLocalClock(true), Math.max(0, opensAt + 3000 - serverNow));
    return () => clearTimeout(timer);
  }, [clockReady, opensAt, serverNow]);

  /*
   * 배포가 바뀌면 이 화면의 투표 버튼은 서버가 알아보지 못한다. 열리기 전이라면
   * 잃을 것이 없으므로 조용히 새로 고친다. 이미 열린 뒤라면 고르던 것을 지울 수
   * 있으니 알리기만 하고 누를지는 사람이 정한다.
   */
  const staleBuild = serverBuild !== null && serverBuild !== build;
  const reloaded = useRef(false);
  useEffect(() => {
    if (!staleBuild || isOpen || reloaded.current) return;
    reloaded.current = true;
    /*
     * 한 배포당 한 번만 새로 고친다. 새로 고쳐도 낡은 화면이 다시 오는 상황
     * (앞단 캐시 같은)에서 끝없이 새로 고치는 것을 막는다. 그때는 알림만 남는다.
     */
    try {
      if (sessionStorage.getItem("voteBuildReload") === build) return;
      sessionStorage.setItem("voteBuildReload", build);
    } catch {
      // 저장소를 못 쓰는 브라우저면 그냥 한 번 새로 고친다.
    }
    window.location.reload();
  }, [staleBuild, isOpen, build]);

  const refreshNotice = staleBuild ? (
    <p className={styles.refreshNotice}>
      새 버전이 배포됐어요. 새로 고침해야 투표할 수 있어요.{" "}
      <button type="button" className={styles.refreshButton} onClick={() => window.location.reload()}>
        새로 고침
      </button>
    </p>
  ) : null;

  if (isOpen) {
    return (
      <>
        {refreshNotice}
        <h1 className={styles.title}>거점전 설문조사</h1>
        <p className={styles.dateLine}>
          거점 일시 {formatSurveyDate(new Date(executedAt))} {formatSurveyTime(new Date(executedAt))}
        </p>
        <p className={styles.instruction}>
          선택지는 하나만 선택해주세요. (부속인 경우 부속만 선택)
        </p>
        <VoteButtons
          surveyId={surveyId}
          initialVote={initialVote}
          initialVotedAt={initialVotedAt}
          closed={isClosed}
          initialClassInfo={initialClassInfo}
        />
      </>
    );
  }

  const { days, hours, minutes, seconds } = splitDuration(remaining);

  return (
    <>
      {refreshNotice}
      <h1 className={styles.title}>거점전 설문조사</h1>
      <p className={styles.dateLine}>
        거점 일시 {formatSurveyDate(new Date(executedAt))} {formatSurveyTime(new Date(executedAt))}
      </p>
      <p className={styles.instruction}>
        투표는 {formatSurveyTime(new Date(opensAt))}에 열립니다. 모두 같은 시각에 열리며, 이 화면이
        그대로 투표 화면으로 바뀝니다.
      </p>
      <div className={styles.countdown} data-urgency={urgencyOf(remaining)}>
        {days > 0 && <span className={styles.countdownSegment}>{days}일</span>}
        <span className={styles.countdownSegment} key={seconds}>
          {pad(hours)}:{pad(minutes)}:{pad(seconds)}
        </span>
      </div>

      <div className={styles.soundRow}>
        <button
          type="button"
          className={soundOn ? styles.soundButtonOn : styles.soundButton}
          aria-pressed={soundOn}
          onClick={toggleSound}
        >
          {soundOn ? "🔔 알림 소리 끄기" : "🔕 알림 소리 켜기"}
        </button>
        {soundOn && (
          <button
            type="button"
            className={styles.soundButton}
            disabled={previewing}
            onClick={playPreview}
          >
            {previewing ? "▶ 재생 중…" : "▶ 미리 듣기"}
          </button>
        )}

        {soundOn && (
          <label className={styles.volume}>
            <span className={styles.volumeLabel}>크기</span>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={volume}
              aria-label="알림 소리 크기"
              onChange={(event) => changeVolume(Number(event.target.value))}
            />
            <span className={styles.volumeValue}>{volume}%</span>
          </label>
        )}

        <span className={styles.soundNote}>
          {soundOn
            ? "열리기 1분 전부터 째깍거리고, 마지막 10초는 매초, 열리는 순간 자명종이 울립니다. 미리 들어 보세요."
            : soundRemembered
              ? "소리를 켜 두셨지만 이 화면에서 한 번 더 눌러야 울립니다."
              : "브라우저가 막아 두어 눌러야 소리가 납니다."}
        </span>
      </div>
    </>
  );
}
