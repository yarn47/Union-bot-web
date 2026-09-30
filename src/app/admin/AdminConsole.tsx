"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVotingClosesAt } from "@/lib/format";
import type { DbSurvey } from "@/lib/types";
import styles from "./admin.module.css";
import { OperationTab } from "./OperationTab";
import { ComparisonTab } from "./ComparisonTab";
import { FailureLogTab } from "./FailureLogTab";
import { ReferenceLogTab } from "./ReferenceLogTab";
import { SpecTab } from "./SpecTab";
import { DrawTab } from "./DrawTab";
import { TabGuide } from "./TabGuide";
import { PastVotesTab } from "./PastVotesTab";
import { SettingsTab } from "./SettingsTab";
import type { PresetControls, TabKey } from "./adminData";

const TABS: TabKey[] = [
  "운영",
  "지난 투표",
  "명단 비교",
  "스펙조사",
  "추첨",
  "거절 기록",
  "참고 자료",
];

export type Phase = "waiting" | "live" | "closed";

function phaseOf(current: DbSurvey | null, now: Date): Phase {
  if (!current) return "waiting";
  if (now < current.exposed_at) return "waiting";
  // 관리자가 즉시 마감을 누르면 complete 가 찍힌다
  if (current.status === "complete") return "closed";
  if (now < getVotingClosesAt(current.executed_at)) return "live";
  return "closed";
}

const DEFAULT_PRESETS = [55, 75, 100];
const SCHEDULE_POLL_MS = 5000;

interface AdminConsoleProps {
  current: DbSurvey | null;
  queue: DbSurvey[];
}

/* 탭 껍데기. 탭을 오가도 유지돼야 하는 상태(정원 프리셋, 마감 여부, 토스트)만 여기서 든다. */
export function AdminConsole({ current, queue }: AdminConsoleProps) {
  const [tab, setTab] = useState<TabKey>("운영");
  /* 탭마다 다른 안내를 보여준다. 지금 보고 있는 탭 기준이다. */
  const [guideOpen, setGuideOpen] = useState(false);

  const [cap, setCap] = useState(DEFAULT_PRESETS[0]);
  const [presetList, setPresetList] = useState<number[]>([...DEFAULT_PRESETS]);

  // 회차 전환과 지난 투표 갱신 주기를 맞춰 두 탭이 같은 회차를 보게 한다.
  // 현재 회차가 바뀌면 current.id key 로 OperationTab 도 새로 마운트된다.
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      router.refresh();
    }, SCHEDULE_POLL_MS);
    return () => clearInterval(timer);
  }, [router]);
  const phase: Phase = phaseOf(current, now);

  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const presets: PresetControls = {
    cap,
    setCap,
    presets: presetList,
    remove: (index) => {
      // 프리셋은 최소 1개 남긴다
      if (presetList.length <= 1) return;
      const gone = presetList[index];
      setPresetList((prev) => prev.filter((_, i) => i !== index));
      if (cap === gone) setCap(presetList.find((_, i) => i !== index) ?? gone);
    },
    add: (raw) => {
      const v = Number.parseInt(raw, 10);
      if (!Number.isFinite(v) || v <= 0) return;
      setPresetList((prev) => (prev.includes(v) ? prev : [...prev, v].sort((a, b) => a - b)));
    },
  };

  return (
    <div className={styles.console}>
      <div className={styles.tabs}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
            onClick={() => setTab(key)}
          >
            {key}
          </button>
        ))}
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.guideBtn}
          onClick={() => setGuideOpen(true)}
          title={`${tab} 탭 사용법 보기`}
          aria-label={`${tab} 탭 사용법 보기`}
        >
          ?
        </button>
      </div>

      {guideOpen && <TabGuide tab={tab} onClose={() => setGuideOpen(false)} />}

      {tab === "운영" && (
        <>
          <SettingsTab current={current} queue={queue} phase={phase} showToast={showToast} />
          <OperationTab
            key={current?.id ?? "no-current-survey"}
            presets={presets}
            showToast={showToast}
            closed={phase === "closed"}
            waiting={phase === "waiting"}
            current={current}
          />
        </>
      )}
      {tab === "지난 투표" && <PastVotesTab cap={cap} />}
      {tab === "명단 비교" && <ComparisonTab />}
      {tab === "스펙조사" && <SpecTab />}
      {tab === "추첨" && <DrawTab />}
      {tab === "거절 기록" && <FailureLogTab />}
      {tab === "참고 자료" && <ReferenceLogTab />}

      <div className={`${styles.toast} ${toast ? styles.toastShow : ""}`}>{toast}</div>
    </div>
  );
}
