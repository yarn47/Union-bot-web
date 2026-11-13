"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ClassIcon } from "@/components/ClassIcon";
import { formatKstDateTime } from "@/lib/format";
import { SpecViewer } from "@/app/equipment/SpecViewer";
import type { SpecSubmissionListRow } from "@/lib/specQueries";
import styles from "./admin.module.css";
import { fetchSpecSubmissions, type SpecSurveyView } from "./specActions";

/*
 * 무엇을 기준으로 줄을 세울지는 보려는 것에 따라 다르다 — 전체 스펙은 공방합,
 * 탱커는 DP, 특정 사람을 찾을 때는 닉네임, 늦게 낸 사람은 제출 시각.
 *
 * desc 는 처음 눌렀을 때의 방향이다. 수치는 높은 쪽이, 이름은 가나다순이,
 * 시각은 최근이 먼저 궁금하다.
 */
const SORTS = [
  { key: "score", label: "공방합", desc: true },
  { key: "ap", label: "주무기", desc: true },
  { key: "aap", label: "각성무기", desc: true },
  { key: "dp", label: "방어력", desc: true },
  { key: "nickname", label: "닉네임", desc: false },
  { key: "guildName", label: "길드", desc: false },
  { key: "submittedAt", label: "제출 시각", desc: true },
] as const;
type SortKey = (typeof SORTS)[number]["key"];
/** 공방합·주무기·각성무기·방어력 은 수치라 미확인 제출을 함께 줄 세울 수 없다. */
const NUMERIC: SortKey[] = ["score", "ap", "aap", "dp"];

/*
 * 등수에 낄 수 없는 줄을 뒤로 민다. 탈퇴한 사람은 지금 인원이 아니라 등수를
 * 밀어낼 자리가 아니고, 수치 미확인은 합계 자체를 믿을 수 없다. 둘 다면 탈퇴가
 * 더 아래다 — 미확인은 언젠가 채워지지만 나간 사람은 그 명단으로 돌아오지 않는다.
 */
function byRankable(a: SpecSubmissionListRow, b: SpecSubmissionListRow): number {
  if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
  if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
  return 0;
}

function at(row: SpecSubmissionListRow, key: SortKey): number | string {
  if (key === "nickname") return row.nickname;
  if (key === "guildName") return row.guildName;
  if (key === "submittedAt") return new Date(row.submittedAt).getTime();
  return row[key];
}

/*
 * 낸 스펙을 줄 세워 본다. 행을 누르면 그 사람이 낸 세팅이 펼쳐지는데,
 * 연맹원이 쓰는 화면과 같은 판이고 고르는 기능만 없다. 낸 값은 굳어 있으므로
 * 여기서 고칠 것도 없다.
 */
export function SpecTab() {
  const [survey, setSurvey] = useState<SpecSurveyView | null>(null);
  const [guilds, setGuilds] = useState<string[]>([]);
  const [rows, setRows] = useState<SpecSubmissionListRow[]>([]);
  /* 빈 집합이 "모두" 다. 상자를 다 풀면 자연히 전체로 돌아온다. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [desc, setDesc] = useState(true);
  const [copied, setCopied] = useState("");
  const [isLoading, startLoad] = useTransition();

  const load = () => {
    startLoad(async () => {
      try {
        const result = await fetchSpecSubmissions();
        setSurvey(result.survey);
        setGuilds(result.guilds);
        setRows(result.rows);
      } catch {
        // 다시 열면 회복된다
      }
    });
  };
  useEffect(load, []);

  function chooseSort(key: SortKey) {
    // 보고 있던 기준을 다시 누르면 방향만 뒤집는다.
    if (key === sortKey) { setDesc(v => !v); return; }
    setSortKey(key);
    setDesc(SORTS.find(s => s.key === key)!.desc);
  }

  function toggleGuild(name: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const countByGuild = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.guildName, (counts.get(row.guildName) ?? 0) + 1);
    return counts;
  }, [rows]);

  const sorted = useMemo(() => {
    const list = picked.size ? rows.filter(row => picked.has(row.guildName)) : [...rows];
    list.sort((a, b) => {
      /*
       * 등수가 뜻을 갖는 것은 수치로 줄 세울 때다. 이름·시각으로 볼 때는 내리지
       * 않는다 — 그때는 등수를 보는 것이 아니라 찾는 것이라, 찾는 사람이
       * 제자리에 있어야 한다.
       */
      if (NUMERIC.includes(sortKey)) {
        const rankable = byRankable(a, b);
        if (rankable !== 0) return rankable;
      }
      const left = at(a, sortKey), right = at(b, sortKey);
      const diff = typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right as string, "ko")
        : (left as number) - (right as number);
      if (diff !== 0) return desc ? -diff : diff;
      // 같은 길드끼리는 공방합이 높은 쪽이 위다. 길드별로 묶어 보는 이유가 그것이다.
      // 묶음 안쪽도 등수이므로 여기서도 같은 규칙이 선다.
      if (sortKey === "guildName") {
        const rankable = byRankable(a, b);
        if (rankable !== 0) return rankable;
        if (a.score !== b.score) return b.score - a.score;
      }
      // 그 밖에는 값이 같으면 어느 방향으로 보든 먼저 낸 사람이 앞이다.
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });
    return list;
  }, [rows, picked, sortKey, desc]);

  async function copyList() {
    const mixed = new Set(sorted.map(row => row.guildName)).size > 1;
    const text = sorted
      .map((row, index) => `${index + 1}. ${row.nickname}${row.isMember ? "" : "(탈퇴)"}${mixed ? `(${row.guildName})` : ""} · ${row.isComplete ? row.score : "?"} (주무기 ${row.ap} / 각성무기 ${row.aap} / 방어력 ${row.dp}) · ${row.buildName}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${rows.length}명 명단을 복사했습니다.`);
    } catch {
      setCopied("복사 권한을 확인해 주세요.");
    }
  }

  const unknown = sorted.filter((row) => !row.isComplete).length;
  const gone = sorted.filter((row) => !row.isMember).length;

  return (
    <section className={styles.opStack}>
      <h2 className={styles.rosterTitle}>스펙조사 제출 명단</h2>
      <p className={styles.hint}>
        기본은 공방합이 높은 순이고, 아래에서 길드를 거르거나 정렬 기준을 바꿀 수 있습니다.
        행을 누르면 그 사람이 낸 장비·수정·광명석을 볼 수 있습니다.
        낸 값은 제출한 순간에 굳으므로, 그 뒤에 세팅을 고쳐도 여기 보이는 것은 바뀌지 않습니다.
        그 뒤에 탈퇴한 사람은 줄을 그어 두고, 수치로 줄 세울 때는 맨 아래로 내립니다 —
        낸 기록은 남기되 지금 인원의 등수에는 넣지 않습니다.
      </p>

      <div className={styles.card}>
        <div className={styles.rosterBar}>
          <span className={styles.label}>
            {survey ? `${survey.title}${survey.open ? "" : " (마감)"} · 제출 ${rows.length}명` : "등록된 스펙조사가 없습니다"}
            {picked.size > 0 && ` · 표시 ${sorted.length}명`}
            {unknown > 0 && ` · 수치 미확인 ${unknown}명`}
            {gone > 0 && ` · 탈퇴 ${gone}명`}
          </span>
          <span className={styles.spacer} />
          <button type="button" className={styles.btnSm} onClick={copyList} disabled={!rows.length}>
            명단 복사
          </button>
          <button type="button" className={styles.btnSm} onClick={load} disabled={isLoading}>
            {isLoading ? "새로 고치는 중..." : "새로 고침"}
          </button>
        </div>

        <div className={styles.sortBar}>
          <span className={styles.label}>길드</span>
          <label className={styles.check}>
            <input type="checkbox" checked={picked.size === 0} onChange={() => setPicked(new Set())} />
            <span>모두 {rows.length}</span>
          </label>
          {guilds.map((name) => (
            <label key={name} className={styles.check}>
              <input type="checkbox" checked={picked.has(name)} onChange={() => toggleGuild(name)} />
              <span>{name} {countByGuild.get(name) ?? 0}</span>
            </label>
          ))}
        </div>

        <div className={styles.sortBar} role="group" aria-label="정렬 기준">
          <span className={styles.label}>정렬</span>
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`${styles.btnXs} ${option.key === sortKey ? styles.btnPrimary : ""}`}
              aria-pressed={option.key === sortKey}
              title={option.key === sortKey ? "다시 누르면 방향이 바뀝니다" : `${option.label} 기준으로 줄 세우기`}
              onClick={() => chooseSort(option.key)}
            >
              {option.label}
              {option.key === sortKey && <span aria-hidden="true"> {desc ? "▾" : "▴"}</span>}
            </button>
          ))}
        </div>

        {copied && <p className={styles.hint}>{copied}</p>}

        {!rows.length && !isLoading && (
          <p className={styles.hint}>아직 아무도 스펙을 내지 않았습니다.</p>
        )}

        <div className={styles.specTable}>
        {sorted.length > 0 && (
          <div className={styles.specHead}>
            <span>#</span>
            <span>직업 · 닉네임 · 길드</span>
            <span>세팅</span>
            <span>공방합</span>
            <span>주무기 / 각성무기 / 방어력</span>
            <span>제출</span>
            <span />
          </div>
        )}
        <ol className={styles.specList}>
          {sorted.map((row, index) => {
            const open = openId === row.userId;
            return (
              <li
                key={row.userId}
                className={[open ? styles.specOpen : "", row.isMember ? "" : styles.specGone]
                  .filter(Boolean).join(" ") || undefined}
              >
                <button
                  type="button"
                  className={styles.specRow}
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : row.userId)}
                >
                  <span className={`${styles.specRank} ${styles.mono}`}>{index + 1}</span>
                  {/* 낼 때의 직업이다. 마크가 계열(전승·각성·기타)을 함께 알려 준다. */}
                  <span className={styles.specName}>
                    {row.characterClass ? (
                      <ClassIcon
                        name={row.characterClass.name}
                        type={row.characterClass.type}
                        size={24}
                        markSize={12}
                      />
                    ) : <span className={styles.specNoClass} title="직업 정보 없음" aria-hidden="true" />}
                    <span className={styles.specNick}>{row.nickname}</span>
                    {/* 줄만 그어 두면 왜 그었는지 알 수 없다. 까닭을 글자로 적는다. */}
                    {!row.isMember && (
                      <span className={styles.specGoneTag} title="지금은 연맹원이 아닙니다">탈퇴</span>
                    )}
                    <span className={styles.specGuild}>{row.guildName}</span>
                  </span>
                  <span className={styles.specBuild}>{row.buildName}</span>
                  <span className={`${styles.specScore} ${styles.mono}`}>{row.isComplete ? row.score : "—"}</span>
                  {/* 공방합에 실제로 더한 쪽을 굵게 둔다. 직업마다 다르므로 숫자만으로는 알 수 없다. */}
                  <span className={`${styles.specParts} ${styles.mono}`}>
                    <b className={row.apBasis === "main" ? styles.specUsed : undefined}>주무기 {row.ap}</b>
                    {" / "}
                    <b className={row.apBasis === "awakening" ? styles.specUsed : undefined}>각성무기 {row.aap}</b>
                    {" / 방어력 "}{row.dp}
                  </span>
                  <span className={`${styles.specTime} ${styles.mono}`}>{formatKstDateTime(new Date(row.submittedAt))}</span>
                  <span className={styles.specChevron} aria-hidden="true">{open ? "▴" : "▾"}</span>
                </button>
                {open && (
                  <div className={styles.specPanel}>
                    {row.build
                      ? <SpecViewer build={row.build} basis={row.apBasis} />
                      : <pre className={styles.specText}>{row.summaryText}</pre>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        </div>
      </div>
    </section>
  );
}
