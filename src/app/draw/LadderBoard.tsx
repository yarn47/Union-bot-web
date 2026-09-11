"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { DrawEntry, Ladder } from "@/lib/draw";
import { traceLadder } from "@/lib/draw";
import styles from "./draw.module.css";

/*
 * 사다리를 그리고 각 사람의 길을 따라 내려간다.
 *
 * 길은 실제로 결과에 닿는 길이다. 손가락으로 따라가면 발표한 자리에 도착한다.
 * 그림과 결과가 따로 놀면 그건 추첨이 아니라 연출이다.
 *
 * 크기는 칸으로만 그리고 실제 픽셀은 CSS 에 맡긴다 — 다 같이 보는 화면이라
 * 사다리가 자리를 남김없이 채워야 한다. 가로세로 비율을 맞추지 않으므로
 * (preserveAspectRatio="none") 선 굵기는 vector-effect 로 붙잡아 둔다.
 */
export function LadderBoard({
  ladder,
  entries,
  winningSlots,
  revealed,
  running,
  onFinish,
  durationMs = 6000,
}: {
  ladder: Ladder;
  /** 출발 순서대로 늘어놓은 참여자. */
  entries: DrawEntry[];
  /** 당첨이 걸린 도착 자리. 스타트 전에는 그리지 않는다. */
  winningSlots: number[];
  /** 길이 다 내려온 뒤에만 당첨을 드러낸다. */
  revealed: boolean;
  running: boolean;
  onFinish: () => void;
  durationMs?: number;
}) {
  /* 스타트 전에는 길을 그리지 않는다 — 미리 눈으로 좇을 거리를 주지 않는다. */
  const [progress, setProgress] = useState(0);
  /* useId 는 «r0» 처럼 url(#…) 에 그대로 못 쓰는 글자를 섞어 준다. */
  const clipId = `ladder${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /*
   * 진행값은 처음 값으로만 정한다(위 useState). 효과 안에서 곧바로 setState 하면
   * 그린 것을 지우고 다시 그리는 셈이라, 새 라운드마다 이 컴포넌트를 통째로 다시
   * 세운다 — 부르는 쪽이 key 를 바꾼다.
   */
  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    const span = durationMs;
    let raf = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setProgress(1);
      onFinish();
    };
    const step = (now: number) => {
      const value = Math.min(1, (now - started) / span);
      setProgress(value);
      if (value < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);
    /*
     * 화면이 뒤로 가면 브라우저가 프레임을 멈춘다. 그 사이 추첨이 끝나지 않은
     * 채로 남으면 결과를 영영 볼 수 없으므로, 시간이 지나면 프레임과 상관없이
     * 끝낸다. 돌아왔을 때 결과가 나와 있는 편이 멈춰 있는 것보다 낫다.
     */
    const timer = setTimeout(finish, span + 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [running, onFinish, durationMs]);

  /* 가로는 열 하나가 1칸, 세로는 가로줄 한 줄이 1칸. 위아래로 반 칸씩 남긴다. */
  const x = (column: number) => column + 0.5;
  const y = (row: number) => row + 0.5;
  const bottom = y(ladder.rows + 1);
  const at = (index: number) => `${((index + 0.5) / ladder.columns) * 100}%`;

  /* land[출발 열] = 도착 자리. */
  const land = useMemo(() => traceLadder(ladder), [ladder]);
  const won = useMemo(() => new Set(winningSlots), [winningSlots]);
  const didWin = (column: number) => revealed && won.has(land[column]);

  const paths = useMemo(() => {
    const rungsByRow = new Map<number, number[]>();
    for (const rung of ladder.rungs) {
      const list = rungsByRow.get(rung.row) ?? [];
      list.push(rung.left);
      rungsByRow.set(rung.row, list);
    }
    return Array.from({ length: ladder.columns }, (_, start) => {
      let column = start;
      const points = [`${column + 0.5},0.5`];
      for (let row = 0; row < ladder.rows; row += 1) {
        const lefts = rungsByRow.get(row) ?? [];
        points.push(`${column + 0.5},${row + 1.5}`);
        if (lefts.includes(column)) column += 1;
        else if (lefts.includes(column - 1)) column -= 1;
        points.push(`${column + 0.5},${row + 1.5}`);
      }
      points.push(`${column + 0.5},${ladder.rows + 1.5}`);
      return points.join(" ");
    });
  }, [ladder]);

  return (
    <div className={styles.ladderWrap}>
      {/* 사람이 적으면 열 간격이 터무니없이 벌어져 한 사다리로 안 보인다. 너비를 묶는다. */}
      <div className={styles.ladderInner} style={{ "--columns": ladder.columns } as React.CSSProperties}>
        <div className={styles.ladderLabels}>
          {entries.map((entry, i) => (
            <span key={entry.nickname} className={styles.ladderName} style={{ left: at(i) }}
              data-won={didWin(i) ? "true" : undefined}>
              {entry.nickname}
            </span>
          ))}
        </div>
        <svg className={styles.ladder} viewBox={`0 0 ${ladder.columns} ${ladder.rows + 2}`}
          preserveAspectRatio="none" role="img" aria-label={`참여자 ${ladder.columns}명의 사다리`}>
          {/* 세로줄 */}
          {Array.from({ length: ladder.columns }, (_, i) => (
            <line key={`v${i}`} x1={x(i)} y1={0.5} x2={x(i)} y2={bottom}
              className={styles.ladderLine} vectorEffect="non-scaling-stroke" />
          ))}
          {/* 가로줄 */}
          {ladder.rungs.map((rung) => (
            <line key={`r${rung.row}-${rung.left}`}
              x1={x(rung.left)} y1={y(rung.row + 1)} x2={x(rung.left + 1)} y2={y(rung.row + 1)}
              className={styles.ladderLine} vectorEffect="non-scaling-stroke" />
          ))}
          {/*
            * 길 — 당첨된 사람만 금색으로 남긴다.
            *
            * 위에서부터 잘라 보이며 내려온다. 점선 길이로 그리면 화면에 몇 픽셀로
            * 펴졌는지에 따라 속도가 달라지는데, 잘라 보이는 방식은 칸으로 재므로
            * 조가 몇 개든 같은 속도로 내려온다.
            */}
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <rect x={0} y={0} width={ladder.columns} height={progress * (ladder.rows + 2)} />
          </clipPath>
          <g clipPath={`url(#${clipId})`} className={styles.pathGroup}
            data-revealed={revealed ? "true" : undefined}>
            {paths.map((points, start) => (
              <polyline key={`p${start}`} points={points} vectorEffect="non-scaling-stroke"
                className={`${styles.ladderPath} ${didWin(start) ? styles.ladderPathWin : ""}`} />
            ))}
          </g>
        </svg>
        {/* 당첨이 걸린 자리. 길이 다 내려온 뒤에 드러난다. */}
        <div className={styles.slotRow}>
          {revealed && winningSlots.map((slot) => (
            <span key={`w${slot}`} className={styles.slotDot} style={{ left: at(slot) }} />
          ))}
        </div>
      </div>
    </div>
  );
}
