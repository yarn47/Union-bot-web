"use client";

import { useEffect, useState, useTransition } from "react";
import { formatKstDateTime } from "@/lib/format";
import type { ReferenceLog } from "@/lib/referenceLog";
import styles from "./admin.module.css";
import { fetchReferenceLog } from "./pastActions";

/** 화면에는 코드가 아니라 사람들이 보는 제목을 적는다. */
const CARD_LABEL: Record<string, string> = {
  gb: "공방합 구간",
  ec: "에크레타 강화",
  hunt: "에다니아 사냥터",
};

const CARDS = ["gb", "ec", "hunt"];

const label = (key: string) => CARD_LABEL[key] ?? key;

/*
 * 홈의 참고 자료를 누가 열었는지 본다.
 *
 * 새로 올린 자료가 읽히고 있는지, 누가 아직 안 봤는지 알 방법이 없었다.
 * 표별 합계, 사람별 횟수, 최근 기록 세 가지를 한 장에 둔다.
 */
export function ReferenceLogTab() {
  const [log, setLog] = useState<ReferenceLog | null>(null);
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
        <h2 className={styles.rosterTitle}>참고 자료를 연 기록</h2>
        <span className={styles.spacer} />
        <button type="button" className={styles.btnSm} onClick={load} disabled={isLoading}>
          {isLoading ? "불러오는 중…" : "새로 고침"}
        </button>
      </div>

      <p className={styles.hint}>
        홈 맨 아래 참고 자료에서 표를 열면 한 줄씩 남습니다. 같은 사람이 여러 번 열면 그만큼
        세어집니다.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.diffTable}>
          <thead>
            <tr>
              <th>표</th>
              <th>연 사람</th>
              <th>연 횟수</th>
              <th>마지막</th>
            </tr>
          </thead>
          <tbody>
            {CARDS.map((key) => {
              const row = log?.cards.find((card) => card.cardKey === key);
              return (
                <tr key={key}>
                  <td>{label(key)}</td>
                  <td className={styles.mono}>{row ? `${row.people}명` : "—"}</td>
                  <td className={styles.mono}>{row ? `${row.opens}번` : "—"}</td>
                  <td className={styles.mono}>
                    {row?.lastAt ? formatKstDateTime(row.lastAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className={styles.rosterTitle}>
        사람별{people.length > 0 ? ` (${people.length}명)` : ""}
      </h3>
      {people.length === 0 ? (
        <p className={styles.hint}>아직 연 사람이 없습니다.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.diffTable}>
            <thead>
              <tr>
                <th>닉네임</th>
                {CARDS.map((key) => (
                  <th key={key}>{label(key)}</th>
                ))}
                <th>합계</th>
                <th>마지막</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.userId ?? person.nickname}>
                  <td>{person.nickname}</td>
                  {CARDS.map((key) => (
                    <td key={key} className={styles.mono}>
                      {person.byCard[key] ? `${person.byCard[key]}번` : "—"}
                    </td>
                  ))}
                  <td className={styles.mono}>{person.total}번</td>
                  <td className={styles.mono}>{formatKstDateTime(person.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className={styles.rosterTitle}>최근 기록</h3>
      {recent.length === 0 ? (
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
                  <td className={styles.mono}>{formatKstDateTime(row.openedAt)}</td>
                  <td>{row.nickname ?? "이름 없음"}</td>
                  <td>{label(row.cardKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
