"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { submitVote } from "./actions";
import {
  ATTEND_TYPES,
  CLASS_TYPE_LABEL,
  VOTING_TYPE_LABEL,
  type ClassType,
  type VotingType,
} from "@/lib/types";
import { formatSurveyDate, formatSurveyTime } from "@/lib/format";
import styles from "./vote.module.css";

// Order follows the design handoff's 2×2 grid: 참여 / 부속 / 늦참 / 미참.
const BUTTONS: VotingType[] = ["attend", "boarding", "late_attend", "non_attend"];
/** 참여만 자리를 옮긴다. 나머지 셋은 다투는 자리가 아니다. */
const OTHERS: VotingType[] = BUTTONS.filter((type) => type !== "attend");

/*
 * 참여 버튼을 놓을 자리. 가로·세로 각각 0 에서 1 사이이고, CSS 가 이 수를 받아
 * 틀 안쪽으로만 밀어 넣는다(vote.module.css 의 .scrambleSpot). 1 이어도 버튼이
 * 틀 밖으로 나가지 않는다.
 *
 * 이 수는 브라우저에서, 투표가 열리는 그 순간에 뽑는다. 서버가 정해 내려보내면
 * 모두에게 같은 자리가 되어 한 사람만 알아내면 끝이고, 미리 뽑아 두면 열리기
 * 전에 찾아낼 수 있다. 그리고 투표가 몰리는 순간에 서버가 할 일을 늘리지
 * 않는다 — 그 왕복 한 번이 그대로 대기열이 된다(actions.ts 참고).
 */
function randomSpot(): { x: number; y: number } {
  return { x: Math.random(), y: Math.random() };
}

export function VoteButtons({
  surveyId,
  initialVote,
  initialVotedAt,
  closed,
  initialClassInfo,
  scramble,
}: {
  surveyId: string;
  initialVote: VotingType | null;
  initialVotedAt: Date | null;
  closed: boolean;
  initialClassInfo: { name: string; type: ClassType } | null;
  /** 열린 직후 몇 분 동안만 참여 버튼을 흩어 놓는다. 지나면 원래 2x2 로 돌아온다. */
  scramble: boolean;
}) {
  /*
   * 자리는 브라우저에서, 이 화면이 붙은 뒤에 뽑는다. 서버가 그릴 때 뽑으면 두 가지가
   * 어긋난다 — 브라우저가 이어받으며 다른 수를 뽑아 React 가 "맞지 않는다" 고 하고
   * (그러면 서버 값이 그대로 남는다), 그 값은 내려보낸 HTML 에 적혀 있어 열리기
   * 전에도 읽을 수 있다. 뽑기 전 한 프레임은 틀이 비는데, 겨눌 것이 없는 편이 맞다.
   */
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { setSpot(randomSpot()); }, []);
  const [currentVote, setCurrentVote] = useState<VotingType | null>(initialVote);
  const [votedAt, setVotedAt] = useState<Date | null>(initialVotedAt);
  // Registration now lives on /classes, so this never changes here.
  const classInfo = initialClassInfo;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  /* 서버가 마감이라고 답하면 화면도 즉시 잠근다. 오래 열어둔 탭에서 눌렀을 때
     버튼이 계속 살아 있으면 같은 실패를 반복하게 된다. */
  const [serverClosed, setServerClosed] = useState(false);
  /* 열리기 몇 초 전에 눌렀을 때. 마감과 달리 곧 열리므로 그때까지만 잠근다. */
  const [tooEarly, setTooEarly] = useState(false);
  const earlyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (earlyTimer.current) clearTimeout(earlyTimer.current); }, []);

  const isAttend = currentVote ? ATTEND_TYPES.includes(currentVote) : false;
  const votingClosed = closed || serverClosed;

  function handleVote(votingType: VotingType) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitVote(surveyId, votingType);
        if (!result.ok) {
          const waiting = result.opensAt !== null ? result.opensAt - result.serverNow : 0;
          if (waiting > 0) {
            // 몇 초 일찍 눌렀다. 열릴 때까지만 잠그고, 열리면 버튼을 다시 살린다.
            setError(`아직 열리지 않았어요. ${Math.ceil(waiting / 1000)}초 뒤에 열립니다.`);
            setTooEarly(true);
            earlyTimer.current = setTimeout(() => { setTooEarly(false); setError(null); }, waiting);
            return;
          }
          setError(result.message);
          if (result.reason === "closed") setServerClosed(true);
          return;
        }
        const kor = VOTING_TYPE_LABEL[result.vote.votingType];
        setMessage(result.vote.isDuplicated ? `이미 ${kor}를 선택한 상태입니다.` : `${kor} 선택.`);
        setCurrentVote(result.vote.votingType);
        setVotedAt(result.vote.votedAt);
      } catch {
        // 여기까지 오는 것은 네트워크가 끊겼거나 서버가 죽은 경우뿐이다.
        /* 배포가 바뀌어 이 화면의 버튼을 서버가 알아보지 못할 때도 여기로 온다. */
        setError("투표를 보내지 못했습니다. 새로 고침 후 다시 시도해 주세요.");
      }
    });
  }

  const locked = votingClosed || tooEarly || isPending;
  const button = (type: VotingType, className: string, style?: CSSProperties) => (
    <button
      key={type}
      type="button"
      className={`${className} ${currentVote === type ? styles.selected : ""}`}
      disabled={locked}
      style={style}
      onClick={() => handleVote(type)}
    >
      {VOTING_TYPE_LABEL[type]}
    </button>
  );

  return (
    <div>
      {scramble ? (
        /*
         * 참여만 틀 안 아무 데나 놓는다. 자리를 외워 두고 찍는 매크로는 빈 곳을
         * 누르게 되고, 빈 곳은 아무 일도 하지 않는다 — 다른 보기를 잘못 찍는 일은
         * 없어야 하므로 버튼끼리 자리를 섞지는 않는다.
         */
        <>
          <div className={styles.scrambleField}>
            {spot && button("attend", `${styles.voteButton} ${styles.scrambleSpot}`,
              { "--spot-x": spot.x, "--spot-y": spot.y } as CSSProperties)}
          </div>
          <p className={styles.scrambleHint}>
            참여 버튼이 이 칸 중 랜덤으로 생성됩니다.
            투표가 열린 지 5분이 지나면 제자리로 돌아옵니다.
          </p>
          <div className={styles.buttonRowRest}>
            {OTHERS.map((type) => button(type, styles.voteButton))}
          </div>
        </>
      ) : (
        <div className={styles.buttonRow}>
          {BUTTONS.map((type) => button(type, styles.voteButton))}
        </div>
      )}

      {currentVote && votedAt && (
        <p className={styles.notice}>
          {formatSurveyDate(votedAt)} {formatSurveyTime(votedAt)}에 투표 완료
        </p>
      )}

      {votingClosed && <p className={styles.notice}>투표가 마감되었습니다.</p>}
      {message && <p className={styles.message}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!votingClosed && isAttend && (
        <div className={styles.classSection}>
          {classInfo ? (
            <p className={styles.notice}>
              현재 직업: {classInfo.name} ({CLASS_TYPE_LABEL[classInfo.type]})
            </p>
          ) : (
            <p className={styles.warning}>
              ⚠️ 직업 미등록! 직업을 등록해야 인원제한결과에 포함됩니다.
            </p>
          )}
          <Link href="/classes" className={styles.classLink}>
            직업 등록 화면 →
          </Link>
        </div>
      )}
    </div>
  );
}
