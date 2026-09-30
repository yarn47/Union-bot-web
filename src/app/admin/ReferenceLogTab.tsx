"use client";

import { useEffect, useState, useTransition } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { formatKstDateTime } from "@/lib/format";
import type { ReferenceLog } from "@/lib/referenceLog";
import styles from "./admin.module.css";
import { fetchReferenceLog } from "./pastActions";

/** 화면에는 코드가 아니라 사람들이 보는 제목을 적는다. */
const CARDS: { key: string; label: string }[] = [
  { key: "gb", label: "공방합 구간" },
  { key: "ec", label: "에크레타 강화" },
  { key: "hunt", label: "에다니아 사냥터" },
];

const shortTime = (date: Date) => formatKstDateTime(date).slice(5);

/*
 * 홈의 참고 자료를 누가 열었는지 본다.
 *
 * 표마다 얼마나 열렸는지는 위에 세 칸으로 두고, 아래는 사람별 한 표로 접는다.
 * 새로 올린 자료가 읽히고 있는지, 아직 안 본 사람이 누구인지 보라고 만든
 * 화면이라 사람이 중심이다. 하나하나의 기록은 접어 두었다가 필요할 때 편다.
 */
export function ReferenceLogTab() {
  const [log, setLog] = useState<ReferenceLog | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [isLoading, startLoad] = useTransition();

  const load = () => {
    startLoad(async () => {
      try {
        setLog(await fetchReferenceLog());
      } catch {
        // 다시 열면 회복된다
      }
    });
  };
  useEffect(load, []);

  const people = log?.people ?? [];
  const recent = log?.recent ?? [];

  return (
    <section className={styles.opStack}>
      <div className={styles.rosterBar}>
        <h2 className={styles.rosterTitle}>참고 자료 열람</h2>
        <span className={styles.spacer} />
        <button type="button" className={styles.btnSm} onClick={load} disabled={isLoading}>
          {isLoading ? "불러오는 중…" : "새로 고침"}
        </button>
      </div>

      <div className={styles.refCards}>
        {CARDS.map(({ key, label }) => {
          const card = log?.cards.find((row) => row.cardKey === key);
          return (
            <div key={key} className={styles.refCard}>
              <span className={styles.refCardName}>{label}</span>
              <span className={styles.refCardNumbers}>
                <span className={styles.refBig}>{card?.people ?? 0}</span>
                <span className={styles.refUnit}>명이 {card?.opens ?? 0}번</span>
              </span>
              <span className={styles.refCardLast}>
                {card?.lastAt ? `마지막 ${shortTime(card.lastAt)}` : "아직 없음"}
              </span>
            </div>
          );
        })}
      </div>

      {people.length === 0 ? (
        <p className={styles.hint}>아직 연 사람이 없습니다.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.diffTable}>
            <thead>
              <tr>
                <th>연 사람 {people.length}명</th>
                {CARDS.map(({ key, label }) => (
                  <th key={key}>{label}</th>
                ))}
                <th>합계</th>
                <th>마지막</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.userId ?? person.nickname}>
                  <td>
                    <span className={styles.refWho}>
                      <ProfileAvatar image={person.avatarUrl} name={person.nickname} size={26} />
                      <span className={styles.refNick}>{person.nickname}</span>
                    </span>
                  </td>
                  {CARDS.map(({ key }) => (
                    <td key={key} className={styles.mono}>
                      {person.byCard[key] ? (
                        `${person.byCard[key]}번`
                      ) : (
                        <span className={styles.refNone}>·</span>
                      )}
                    </td>
                  ))}
                  <td className={styles.mono}>{person.total}번</td>
                  <td className={styles.mono}>{shortTime(person.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        className={`${styles.btnSm} ${styles.refToggle}`}
        onClick={() => setShowRecent((on) => !on)}
      >
        {showRecent ? "기록 하나하나 접기" : `기록 하나하나 보기 (${recent.length}건)`}
      </button>

      {showRecent &&
        (recent.length === 0 ? (
          <p className={styles.hint}>아직 기록이 없습니다.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.diffTable}>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>닉네임</th>
                  <th>표</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className={styles.mono}>{shortTime(row.openedAt)}</td>
                    <td>
                      <span className={styles.refWho}>
                        <ProfileAvatar
                          image={row.avatarUrl}
                          name={row.nickname ?? "?"}
                          size={22}
                        />
                        {row.nickname ?? "이름 없음"}
                      </span>
                    </td>
                    <td>{CARDS.find((card) => card.key === row.cardKey)?.label ?? row.cardKey}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
