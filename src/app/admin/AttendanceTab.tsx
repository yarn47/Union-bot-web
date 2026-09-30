"use client";

import { useEffect, useState, useTransition } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { formatSurveyDate } from "@/lib/format";
import type { AttendanceReport } from "@/lib/attendanceQueries";
import styles from "./admin.module.css";
import { fetchAttendanceReport } from "./pastActions";

const RANGES = [
  { days: 7, label: "1주" },
  { days: 14, label: "2주" },
  { days: 28, label: "4주" },
];

const DOW = "일월화수목금토";

function dayLabel(date: Date): string {
  return `${formatSurveyDate(date).slice(5)} ${DOW[date.getDay()]}`;
}

const one = (n: number) => n.toFixed(1);

/*
 * 참여가 줄고 있는지 보는 화면.
 *
 * 회차별 인원을 막대로 세워 흐름을 먼저 보이고, 그 아래에 안 나온 사람을 둔다.
 * 미참과 무응답을 나눠 세는 것은 운영에서 다루는 방법이 다르기 때문이다 —
 * 미참은 못 온다고 밝힌 것이고, 무응답은 화면에 들어오지도 않은 것이다.
 */
export function AttendanceTab() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [isLoading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      try {
        setReport(await fetchAttendanceReport(days));
      } catch {
        // 다시 열면 회복된다
      }
    });
  }, [days]);

  const rounds = report?.rounds ?? [];
  const misses = report?.misses ?? [];
  const peak = Math.max(1, ...rounds.map((r) => r.attend + r.boarding + r.lateAttend));
  const diff =
    report?.previous && rounds.length > 0
      ? report.averageAttend - report.previous.averageAttend
      : null;

  return (
    <section className={styles.opStack}>
      <div className={styles.rosterBar}>
        <h2 className={styles.rosterTitle}>참여 점검</h2>
        <span className={styles.spacer} />
        {RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            className={days === range.days ? styles.btnPrimary : styles.btnSm}
            onClick={() => setDays(range.days)}
            disabled={isLoading}
          >
            {range.label}
          </button>
        ))}
      </div>

      {rounds.length === 0 ? (
        <p className={styles.hint}>
          {isLoading ? "불러오는 중…" : "이 기간에 치른 거점전이 없습니다."}
        </p>
      ) : (
        <>
          <p className={styles.hint}>
            {rounds.length}회차 · 회차당 평균 <b>{one(report?.averageAttend ?? 0)}명</b> 나왔습니다
            (연맹원 {report?.memberCount}명).
            {diff !== null && (
              <>
                {" "}
                앞선 {RANGES.find((r) => r.days === days)?.label}보다{" "}
                <b className={diff < 0 ? styles.refDown : styles.refUp}>
                  {diff < 0 ? "" : "+"}
                  {one(diff)}명
                </b>
                입니다.
              </>
            )}
          </p>

          <div className={styles.tableWrap}>
            <table className={styles.diffTable}>
              <thead>
                <tr>
                  <th>거점전</th>
                  <th>나온 인원</th>
                  <th>참여</th>
                  <th>부속</th>
                  <th>늦참</th>
                  <th>미참</th>
                  <th>무응답</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => {
                  const came = round.attend + round.boarding + round.lateAttend;
                  return (
                    <tr key={round.surveyId}>
                      <td className={styles.mono}>{dayLabel(new Date(round.executedAt))}</td>
                      <td>
                        <span className={styles.refBar}>
                          <span
                            className={styles.refBarFill}
                            style={{ width: `${(came / peak) * 100}%` }}
                          />
                          <span className={styles.refBarValue}>{came}</span>
                        </span>
                      </td>
                      <td className={styles.mono}>{round.attend}</td>
                      <td className={styles.mono}>{round.boarding}</td>
                      <td className={styles.mono}>{round.lateAttend}</td>
                      <td className={styles.mono}>{round.nonAttend}</td>
                      <td className={styles.mono}>{round.noReply}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3 className={styles.rosterTitle}>
            빠진 사람 {misses.length > 0 ? `${misses.length}명` : ""}
          </h3>
          {misses.length === 0 ? (
            <p className={styles.hint}>이 기간에는 모두 한 번씩은 나왔습니다.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.diffTable}>
                <thead>
                  <tr>
                    <th>닉네임</th>
                    <th>길드</th>
                    <th>나옴</th>
                    <th>미참</th>
                    <th>무응답</th>
                  </tr>
                </thead>
                <tbody>
                  {misses.map((person) => (
                    <tr key={person.userId}>
                      <td>
                        <span className={styles.refWho}>
                          <ProfileAvatar
                            image={person.avatarUrl}
                            name={person.nickname}
                            size={26}
                          />
                          <span className={styles.refNick}>{person.nickname}</span>
                        </span>
                      </td>
                      <td>{person.guildName ?? "—"}</td>
                      <td className={styles.mono}>
                        {person.attended > 0 ? `${person.attended}회` : <span className={styles.refNone}>·</span>}
                      </td>
                      <td className={styles.mono}>
                        {person.nonAttend > 0 ? `${person.nonAttend}회` : <span className={styles.refNone}>·</span>}
                      </td>
                      <td className={styles.mono}>
                        {person.noReply > 0 ? `${person.noReply}회` : <span className={styles.refNone}>·</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.hint}>
            무응답은 투표 화면에서 아무것도 누르지 않은 것입니다. 미참은 못 온다고 밝힌 것이라
            따로 셉니다.
          </p>
        </>
      )}
    </section>
  );
}
