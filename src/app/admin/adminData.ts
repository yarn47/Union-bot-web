/* 관리자 콘솔의 타입과 순수 계산 */

import { formatKstTimeWithMillis } from "@/lib/format";
import type { VoterRow } from "@/lib/queries";
import { CLASS_TYPE_LABEL, VOTING_TYPE_LABEL } from "@/lib/types";
import type { ClassType } from "@/lib/types";
import { formatDayDate } from "@/lib/week";

export type Vote = "참여" | "부속" | "늦참" | "미참";
export type TabKey =
  | "운영"
  | "지난 투표"
  | "명단 비교"
  | "스펙조사"
  | "추첨"
  | "거절 기록"
  | "참고 자료"
  | "참여 점검";
export type Dow = "월" | "화" | "수" | "목" | "금" | "토" | "일";

export interface Member {
  id: string;
  nick: string;
  guild: string;
  job: string;
  /** 계열 이름표(전승·각성·기타). 표에 그대로 찍는다. */
  line: string;
  /** 계열 원본값. 직업 마크를 그리려면 이름표가 아니라 이것이 필요하다. */
  classType: ClassType | null;
  vote: Vote;
  ord: number;
  origSeq: number;
  time: string;
}

export interface SurveyDef {
  key: string;
  iso: string;
  dow: Dow;
  battle: string;
  open: string;
  counts: Record<Vote, number>;
}

export interface ManualRound {
  id: string;
  iso: string;
  battle: string;
  openIso: string;
  open: string;
  announceMin: number;
}

export interface QueueRow {
  key: string;
  iso: string;
  dow: Dow;
  battle: string;
  openIso: string;
  openDow: Dow;
  open: string;
  announceMin: number;
  src: "자동" | "수동";
}

/* 정원 프리셋 상태는 탭을 오가도 유지되도록 콘솔이 들고, 탭에는 이 묶음으로 내려준다. */
export interface PresetControls {
  cap: number;
  setCap: (n: number) => void;
  presets: number[];
  add: (raw: string) => void;
  remove: (index: number) => void;
}

export const VOTES: Vote[] = ["참여", "부속", "늦참", "미참"];
export const DAYS: Dow[] = ["월", "화", "수", "목", "금", "토", "일"];

export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function isoOf(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseIso(iso: string) {
  const p = iso.split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

export function dowOf(d: Date): Dow {
  // getDay()는 일요일이 0이라 월요일 시작인 DAYS에 맞춰 옮긴다
  return DAYS[(d.getDay() + 6) % 7];
}

// 투표 마감은 거점전 1시간 전
export function closeOf(battle: string) {
  const [h, m] = battle.split(":").map(Number);
  return `${pad2((h + 23) % 24)}:${pad2(m)}`;
}

export function countsOf(list: Member[]): Record<Vote, number> {
  const c: Record<Vote, number> = { 참여: 0, 부속: 0, 늦참: 0, 미참: 0 };
  list.forEach((m) => {
    c[m.vote] += 1;
  });
  return c;
}

/* 순번 명단은 참여와 부속만 선다. 늦참과 미참은 순번이 없다. */
export function rosterOf(list: Member[]) {
  return list.filter((m) => m.vote === "참여" || m.vote === "부속").sort((a, b) => a.ord - b.ord);
}

export interface ClassCount {
  job: string;
  classType: ClassType | null;
  count: number;
}
export interface ClassStats {
  total: number;
  /** 계열별 인원. 직업을 등록하지 않은 사람은 unknown 으로 센다. */
  byLine: { type: ClassType; count: number }[];
  unknown: number;
  byJob: ClassCount[];
}

/*
 * 정원 안에 드는 사람들만 센다. 정원이 55 인지 100 인지에 따라 실제로 나가는
 * 사람이 달라지므로 분포도 달라진다.
 *
 * 같은 직업 이름이라도 전승과 각성은 다른 직업으로 센다. 계열이 다르면 자리와
 * 역할이 다르다.
 */
export function classStatsOf(roster: Member[]): ClassStats {
  const lines = new Map<ClassType, number>();
  const jobs = new Map<string, ClassCount>();
  let unknown = 0;
  for (const member of roster) {
    if (!member.classType || member.job === "-") {
      unknown += 1;
      continue;
    }
    lines.set(member.classType, (lines.get(member.classType) ?? 0) + 1);
    const key = `${member.classType}:${member.job}`;
    const found = jobs.get(key);
    if (found) found.count += 1;
    else jobs.set(key, { job: member.job, classType: member.classType, count: 1 });
  }
  const ORDER: ClassType[] = ["Succession", "Awaken", "Else"];
  return {
    total: roster.length,
    byLine: ORDER.map((type) => ({ type, count: lines.get(type) ?? 0 })),
    unknown,
    // 많은 직업부터. 같은 수면 이름순이라 순서가 흔들리지 않는다.
    byJob: [...jobs.values()].sort((a, b) => b.count - a.count || a.job.localeCompare(b.job, "ko")),
  };
}

export function ofVote(list: Member[], kind: Vote) {
  return list.filter((m) => m.vote === kind).sort((a, b) => a.ord - b.ord);
}

export function buildQueue(
  recurDays: Record<Dow, boolean>,
  battle: string,
  open: string,
  announceMin: number,
  manual: ManualRound[],
  from: Date,
  days: number,
): QueueRow[] {
  const rows: QueueRow[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from.getTime());
    d.setDate(d.getDate() + i);
    const dow = dowOf(d);
    if (!recurDays[dow]) continue;
    const iso = isoOf(d);
    // 자동 회차의 투표 오픈은 거점전 전날
    const prev = new Date(d.getTime());
    prev.setDate(prev.getDate() - 1);
    rows.push({
      key: `a:${iso}`,
      iso,
      dow,
      battle,
      openIso: isoOf(prev),
      openDow: dowOf(prev),
      open,
      announceMin,
      src: "자동",
    });
  }
  manual.forEach((m) => {
    rows.push({
      key: `m:${m.id}`,
      iso: m.iso,
      dow: dowOf(parseIso(m.iso)),
      battle: m.battle,
      openIso: m.openIso,
      openDow: dowOf(parseIso(m.openIso)),
      open: m.open,
      announceMin: m.announceMin,
      src: "수동",
    });
  });
  rows.sort((a, b) => (a.iso === b.iso ? a.battle.localeCompare(b.battle) : a.iso.localeCompare(b.iso)));
  return rows;
}

/* 디코로 나가는 발송본에는 예비 명단을 공개하지 않는다. 예비까지 붙는 건 관리자용 복사뿐. */
export function buildExportText(members: Member[], cap: number, heading: string) {
  const main = rosterOf(members).slice(0, cap);
  // 조정 표시는 컷 밖에서 안으로 끌어올린 사람에게만 붙인다
  const mark = (m: Member, pulledIn: boolean) =>
    `${m.nick} / ${m.job} (${m.line})${pulledIn ? " <<<<<<<<<" : ""}`;

  const lines: string[] = [];
  lines.push(`== ${heading} 거점전 투표 결과 ==`);
  lines.push("");
  lines.push(`[참여 ${main.length}명]`);
  main.forEach((m, i) => lines.push(`${i + 1}. ${mark(m, m.origSeq > cap)}`));
  return lines.join("\n");
}

/* 표 목록을 화면 명단으로 바꾼다. 순번은 참여와 부속끼리만 매긴다. */
export function votersToMembers(voters: VoterRow[]): Member[] {
  // 원래 순번은 표 시각 순서로 매긴다. 유저의 표 변경은 시각과 자리가 같이
  // 움직이므로, 이 순서와 자리가 어긋난 사람은 관리자가 조정한 사람뿐이다.
  const firstSeq = new Map<string, number>();
  voters
    .filter((v) => {
      const vote = VOTING_TYPE_LABEL[v.votingType] as Vote;
      return vote === "참여" || vote === "부속";
    })
    .sort(
      (a, b) =>
        new Date(a.votedAt).getTime() - new Date(b.votedAt).getTime() ||
        Number(a.historyId) - Number(b.historyId),
    )
    .forEach((v, i) => firstSeq.set(v.historyId, i + 1));

  let rosterSeq = 0;
  let restSeq = 0;
  return voters.map((v) => {
    const vote = VOTING_TYPE_LABEL[v.votingType] as Vote;
    const inRoster = vote === "참여" || vote === "부속";
    const ord = inRoster ? rosterSeq : restSeq;
    if (inRoster) rosterSeq += 1;
    else restSeq += 1;
    const votedAt = new Date(v.votedAt);
    return {
      id: v.historyId,
      nick: v.nickname,
      guild: v.guildName,
      job: v.className ?? "-",
      line: v.classType ? CLASS_TYPE_LABEL[v.classType] : "-",
      classType: v.classType,
      vote,
      ord,
      origSeq: inRoster ? firstSeq.get(v.historyId)! : ord + 1,
      time: `${formatDayDate(votedAt)} ${formatKstTimeWithMillis(votedAt)}`,
    };
  });
}
