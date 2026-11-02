import { DEFAULT_CLASS_ICON, getClassIconPath } from "@/lib/classIconMap";
import { getClassMark } from "@/lib/classMarkMap";
import type { ClassType } from "@/lib/types";
import { hasRoleIcon } from "./roleIcons";

export interface SquadMember {
  id: string;
  name: string;
  job: string;
  awakening: string;
}

export interface Formation {
  parties: (SquadMember | null)[][];
  waiting: SquadMember[];
  rows: number;
  /** 머리글에 적히는 부대 이름. 부대 수만큼 있고, 표에서 눌러 고칠 수 있다. */
  names: string[];
}

export interface CellAddress { party: number; index: number }

/*
 * 칸에 붙는 직업 아이콘과 계열 마크.
 *
 * 명단에는 직업이 글자로만 들어오므로 그림은 여기서 찾는다. 직업 이름이 우리가
 * 아는 32 개에 없으면 아무것도 붙이지 않는다 — 엉뚱한 그림을 붙이느니 글자만
 * 두는 편이 낫다.
 */
export interface MemberArt {
  icon: string;
  mark: { src: string; color: string } | null;
}

const MARK_COLOR = { 전승: "#5b7fb5", 각성: "#b0555f", 기타: "#8d867c" };

export function memberArt(member: SquadMember | null | undefined): MemberArt | null {
  if (!member?.job) return null;
  const icon = getClassIconPath(member.job);
  if (icon === DEFAULT_CLASS_ICON) return null;
  const type: ClassType =
    member.awakening === "전승" ? "Succession" : member.awakening === "각성" ? "Awaken" : "Else";
  const mark = getClassMark(member.job, type);
  return {
    icon,
    mark: mark ? { src: mark.src, color: MARK_COLOR[member.awakening as keyof typeof MARK_COLOR] ?? MARK_COLOR.기타 } : null,
  };
}

/*
 * 부대 이름의 기본값.
 *
 * 네 부대일 때는 쓰던 이름 그대로 두고, 여섯 부대로 나뉘면 뒤에 둘을 더한다.
 * 어차피 표에서 눌러 고칠 수 있으므로 여기 값은 출발점일 뿐이다.
 */
const BASE_NAMES = ["1부대(본대)", "2부대(본대)", "3부대(수비)", "4부대(본대/기둥)"];

export function defaultNames(parties: number): string[] {
  return Array.from({ length: parties }, (_, i) => BASE_NAMES[i] ?? `${i + 1}부대`);
}

/*
 * 부대표의 생김새.
 *
 * 어두운 판으로 둔 이유가 둘이다. 하나, 이 그림은 디스코드에 붙인다 — 거기가
 * 어두우므로 밝은 표는 혼자 튄다. 둘, 직업 아이콘이 흰 선화라 어두운 바탕에서는
 * 원본 그대로 얹힌다. 밝은 바탕이면 색을 뒤집는 처리가 한 겹 더 붙는다.
 */
export const SHEET = {
  columnWidth: 178,
  iconSize: 20,
  markSize: 12,
  roleSize: 20,
  // 직업 아이콘·계열 배지·역할 그림이 한 줄에 들어가야 한다.
  rowHeight: 32,
  headerHeight: 44,
  font: '"Malgun Gothic", Arial, sans-serif',
  panel: "#17130e",
  stripe: "#1d1811",
  grid: "#2b2318",
  border: "#6b5327",
  headerTop: "#3a2d18",
  headerBottom: "#241c11",
  headerText: "#e6c884",
  text: "#ded5c4",
  fontSize: 13,
};

export function emptyFormation(): Formation {
  return { parties: [[], [], [], []], waiting: [], rows: 10, names: defaultNames(4) };
}

/*
 * 이름 뒤에 붙이는 역할. 직업이 아니라 그 사람이 맡은 일이라 아이콘으로는
 * 드러나지 않는다. 손으로 글자를 치는 대신 눌러서 붙인다.
 *
 * 여기에 적힌 것만 붙일 수 있다. 늘리려면 이 줄에 더하면 된다.
 */
export const ROLES = ["오더", "빌더", "대포", "대포컷", "코끼리", "불퇴", "신기전", "화염탑", "수비", "중범선"];

/*
 * 역할을 글자 대신 그림으로 보여 준다. 칸이 좁아 "(대포컷)" 네 글자가 이름을
 * 밀어내기 때문이다. 그림은 roleIcons.ts 에 직접 그려 두었다 — 이모지에는
 * 대포도 화차도 돛단배도 없다.
 */

/** 이름 뒤에 붙어 있는 역할. 그림이 있는 것만 역할로 본다. */
export function memberRole(member: SquadMember | null | undefined): string | null {
  if (!member) return null;
  const tag = member.name.match(TRAILING_TAG)?.[1];
  return hasRoleIcon(tag) ? (tag as string) : null;
}

/** 역할만 갈아 끼운다. 같은 역할을 다시 누르면 뗀다. */
/**
 * 역할을 붙이거나(role) 뗀다(null).
 *
 * 같은 역할을 다시 눌러 떼는 것은 부르는 쪽이 정한다. 여럿을 한꺼번에 고쳐야
 * 하는데 여기서 각자 토글해 버리면, 이미 붙은 사람은 떨어지고 안 붙은 사람만
 * 붙어 반반으로 갈린다.
 */
export function setRole(formation: Formation, id: string, role: string | null): Formation {
  const swap = (member: SquadMember) => {
    const bare = baseName(member.name);
    return { ...member, name: role ? `${bare}(${role})` : bare };
  };
  return {
    ...formation,
    parties: formation.parties.map((party) =>
      party.map((member) => (member?.id === id ? swap(member) : member))),
    waiting: formation.waiting.map((member) => (member.id === id ? swap(member) : member)),
  };
}

export function memberLabel(member: SquadMember | null | undefined): string {
  if (!member) return "";
  // 직업도 역할도 그림으로 붙으므로 글자로 또 적지 않는다. 칸은 이름 몫이다.
  return memberRole(member) ? baseName(member.name) : member.name;
}

export function parseMembers(input: string): SquadMember[] {
  let accepting = true;
  return input.split(/\r?\n/).flatMap((line, index) => {
    line = line.trim();
    if (!line || /^==|^```/.test(line)) return [];
    if (/^\[.*\]$/.test(line)) {
      accepting = !/불참|미참|미투표|취소/.test(line);
      return [];
    }
    if (!accepting) return [];
    const parts = line.replace(/<{3,}/g, "").split("/");
    if (parts.length < 2) return [];
    const name = parts[0].replace(/^\d+\s*[.)、:\-]\s*/, "").trim();
    const awakening = parts[1].match(/\((각성|전승|기타)\)/)?.[1] ?? "";
    const job = parts[1].replace(/\((각성|전승|기타)\)/, "").trim();
    return name ? [{ id: `input-${index}`, name, job, awakening }] : [];
  });
}

/** 이름 뒤에 붙은 역할 표시. "예니체리(대포)" 의 "(대포)" 부분이다. */
const TRAILING_TAG = /\(([^()]*)\)\s*$/;

/** 역할 표시를 뗀 이름. 명단에 "홍줭(흑정)" 으로 적혀 와도 "홍줭" 으로 찾는다. */
export function baseName(name: string): string {
  return name.replace(TRAILING_TAG, "").trim();
}

/*
 * 부대 정원.
 *
 * 부대 수는 이 배열의 길이가 정한다. 표도 복사 이미지도 여기를 따라오므로,
 * 다른 판이 생기면 숫자만 더하면 된다.
 */
const FORMAT_SIZES = {
  "55": [15, 15, 14, 11],
  "75": [20, 20, 15, 20],
  "100": [17, 17, 17, 17, 16, 16],
} as const;

export const FORMATS = [
  { key: "auto", label: "자동" },
  { key: "55", label: "55인" },
  { key: "75", label: "75인" },
  { key: "100", label: "100인" },
] as const;

export type FormatKey = (typeof FORMATS)[number]["key"];

/*
 * 자동은 온 인원으로 판을 고른다.
 *
 * 55 석과 75 석 두 벌뿐이던 때는 그 사이가 비어 있었다. 60 명이 나오면 55 석에
 * 넣느라 다섯 명이, 69 명이면 열네 명이 말없이 미배치로 빠졌다. 이제 다 들어가는
 * 쪽을 고른다. 판을 직접 고르면 인원과 상관없이 그 판으로 짠다.
 */
/*
 * 판보다 사람이 적게 왔을 때, 정원을 인원만큼 줄여 모든 부대에 고루 퍼뜨린다.
 *
 * 그냥 두면 앞 부대부터 정원까지 채우고 뒤는 통째로 빈다 — 100 인 판에 마흔
 * 명이면 17·17·6 뒤로 세 부대가 빈칸이다. 비율은 그대로 두므로 수비 부대가
 * 얇은 모양도 같이 따라 줄어든다.
 */
function fitSizes(sizes: number[], count: number): number[] {
  const capacity = sizes.reduce((sum, size) => sum + size, 0);
  if (count >= capacity) return sizes;
  const scaled = sizes.map((size) => Math.floor(size * count / capacity));
  let left = count - scaled.reduce((sum, size) => sum + size, 0);
  for (let i = 0; left > 0; i = (i + 1) % sizes.length) { scaled[i] += 1; left -= 1; }
  return scaled;
}

function partySizes(count: number, format: FormatKey): number[] {
  if (format !== "auto") return fitSizes([...FORMAT_SIZES[format]], count);
  if (count > 75) return [...FORMAT_SIZES["100"]];
  if (count > 55) return [...FORMAT_SIZES["75"]];
  if (count >= 50) return [...FORMAT_SIZES["55"]];
  return Array.from({ length: 4 }, (_, i) => Math.floor(count / 4) + (i < count % 4 ? 1 : 0));
}

// 직업별 인원과 위치를 정하고 나머지를 채운다.
export function autoAssign(members: SquadMember[], format: FormatKey = "auto"): Formation {
  const sizes = partySizes(members.length, format);
  const parties: (SquadMember | null)[][] = sizes.map(() => []);
  const assigned = new Set<string>();
  const filled = (party: number) => parties[party].filter(Boolean).length;
  function placeAt(member: SquadMember, party: number, index: number, suffix = "") {
    // 이미 역할이 적혀 온 이름에 또 붙이면 "예니체리(대포)(대포)" 가 된다.
    const name = suffix ? baseName(member.name) + suffix : member.name;
    const list = parties[party];
    while (list.length <= index) list.push(null);
    list[index] = { ...member, name };
    assigned.add(member.id);
  }
  /* 위에서부터 첫 빈칸. 아래에 박아 둔 사람을 덮지 않는다. */
  function place(member: SquadMember, party: number, suffix = "") {
    let index = 0;
    while (parties[party][index]) index += 1;
    placeAt(member, party, index, suffix);
  }

  // 위자치의 부대 분배를 먼저 정한다. 최종 자리는 인원이 정해진 뒤 빈칸 없이 맞춘다.
  const rows = Math.max(1, Math.ceil(Math.max(...sizes) / 2));
  function pinBottom(jobs: string[], column: 0 | 1) {
    const pool = members.filter((m) => jobs.includes(m.job) && !assigned.has(m.id));
    const slots: number[] = [];
    for (let row = rows - 1; row >= 0; row -= 1) slots.push(row * 2 + column);
    const used = sizes.map(() => 0);
    let party = 0;
    for (const member of pool) {
      let placed = false;
      for (let tries = 0; tries < sizes.length && !placed; tries += 1) {
        // 이미 누가 앉아 있으면 한 줄 위로 올라간다.
        while (used[party] < slots.length && parties[party][slots[used[party]]]) used[party] += 1;
        if (used[party] < slots.length) {
          placeAt(member, party, slots[used[party]]);
          used[party] += 1;
          placed = true;
        }
        party = (party + 1) % sizes.length;
      }
      // 어느 부대에도 자리가 없으면 나머지와 함께 순서대로 채워진다.
      if (!placed) break;
    }
  }

  function fixed(name: string, party: number, suffix = "") {
    // 명단에 역할이 붙어 오거나 영문 대소문자가 달라도 같은 사람으로 본다.
    const key = name.toLowerCase();
    const member = members.find((m) => baseName(m.name).toLowerCase() === key && !assigned.has(m.id));
    if (!member) return false;
    if (member.job === "샤이" || member.job === "자이언트") return false;
    place(member, party, suffix);
    return true;
  }

  fixed("예니체리", 0);
  fixed("홍줭", 1);
  fixed("사색가", 2, "(빌더)");
  fixed("Wheel", 3);
  fixed("마창", 0);
  let cannonCount = 0;
  for (const name of ["연필", "Nicode", "폭풍"]) {
    if (cannonCount < 2) {
      if (fixed(name, 2, "(대포)")) cannonCount++;
    } else fixed(name, 2);
  }
  for (const name of ["이랑", "RoyalJelly", "성별"]) fixed(name, 2, "(불퇴)");
  fixed("환호", 2, "(신기전)");
  for (const name of ["bingegrab", "멜루", "연등"]) fixed(name, 2, "(화염탑)");
  for (const name of ["이지선다", "Sha", "염궁문"]) fixed(name, 2, "(수비)");

  const wizardIds = new Set(members.filter((m) =>
    ["위자드", "위치"].includes(m.job) && !assigned.has(m.id)).map((m) => m.id));
  pinBottom(["위자드", "위치"], 0);

  const hasRoom = (party: number) => filled(party) < sizes[party];
  const shais = sizes.map(() => [] as SquadMember[]);
  const giants = sizes.map(() => [] as SquadMember[]);
  function placeClass(member: SquadMember, party: number, groups: SquadMember[][]) {
    place(member, party);
    groups[party].push(member);
  }
  function placeMain(member: SquadMember, groups: SquadMember[][]) {
    const candidates = [0, 1].filter(hasRoom);
    candidates.sort((a, b) => groups[a].length - groups[b].length || a - b);
    if (candidates.length) placeClass(member, candidates[0], groups);
  }

  // 두 본대에 한 명씩 먼저 두고, 수비·기동에 한 명씩 둔 뒤 나머지는 본대에 나눈다.
  const shaiPool = members.filter((m) => m.job === "샤이" && !assigned.has(m.id));
  for (const party of [0, 1, 2, 3]) {
    if (hasRoom(party) && shaiPool.length) placeClass(shaiPool.shift()!, party, shais);
  }
  // 자동배치를 실행할 때만 섞고, 부대 이력은 사용하지 않는다.
  const giantPool = members.filter((m) => m.job === "자이언트" && !assigned.has(m.id));
  for (let i = giantPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [giantPool[i], giantPool[j]] = [giantPool[j], giantPool[i]];
  }
  // 두 본대에 한 명씩 먼저 확보한 뒤 수비에 한 명만 배치한다.
  for (const party of [0, 1]) {
    if (hasRoom(party) && giantPool.length) placeClass(giantPool.shift()!, party, giants);
  }
  if (giants[0].length && giants[1].length && giantPool.length && hasRoom(2)) {
    placeClass(giantPool.shift()!, 2, giants);
  }
  for (const member of shaiPool) placeMain(member, shais);
  for (const member of giantPool) placeMain(member, giants);

  const classMembers = new Set([...shais.flat(), ...giants.flat()].map((m) => m.id));
  // 직업별 자리를 먼저 확보한 뒤 빈칸을 일반 인원으로 채운다.
  for (const list of parties) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] && classMembers.has(list[i]!.id)) list[i] = null;
    }
  }
  const columnMembers = (party: number, column: number) => parties[party]
    .filter((m, index): m is SquadMember => Boolean(m) && index % 2 === column);
  const columns: { party: number; column: number; top: SquadMember[]; bottom: SquadMember[] }[] = [];
  for (const party of [0, 1]) {
    if (giants[party].length || shais[party].length) columns.push({
      party, column: 1, top: [...giants[party], ...columnMembers(party, 1)], bottom: shais[party],
    });
  }
  if (shais[2].length || giants[2].length) {
    const left = columnMembers(2, 0).filter((m) => !wizardIds.has(m.id));
    const wizards = columnMembers(2, 0).filter((m) => wizardIds.has(m.id));
    columns.push({ party: 2, column: 0, top: left, bottom: [...wizards, ...shais[2], ...giants[2]] });
  }
  if (shais[3].length) columns.push({
    party: 3, column: 1, top: [...shais[3], ...columnMembers(3, 1)], bottom: [],
  });
  const finalRows = Math.max(rows, ...parties.map((p) => Math.ceil(p.length / 2)),
    ...columns.map((c) => c.top.length + c.bottom.length));
  // 한쪽 열에 인원이 많아 표가 길어져도 위자치의 아래쪽 정렬을 유지한다.
  if (classMembers.size && finalRows > rows) {
    for (let party = 0; party < parties.length; party++) {
      if (columns.some((c) => c.party === party && c.column === 0)) continue;
      const left = columnMembers(party, 0);
      if (left.some((m) => wizardIds.has(m.id))) columns.push({
        party, column: 0, top: left.filter((m) => !wizardIds.has(m.id)),
        bottom: left.filter((m) => wizardIds.has(m.id)),
      });
    }
  }
  for (const { party, column, top, bottom } of columns) {
    const list = parties[party];
    while (list.length < finalRows * 2) list.push(null);
    for (let row = 0; row < finalRows; row++) list[row * 2 + column] = null;
    top.forEach((member, row) => { list[row * 2 + column] = member; });
    bottom.forEach((member, row) => { list[(finalRows - bottom.length + row) * 2 + column] = member; });
  }

  // 원거리 직업은 2부대, 1부대 순서로 남은 자리를 먼저 채운다.
  const rangedJobs = ["아처", "레인저", "에이전트", "데드아이"];
  for (const party of [1, 0]) {
    for (const member of members) {
      if (!hasRoom(party)) break;
      if (!assigned.has(member.id) && rangedJobs.includes(member.job)) place(member, party);
    }
  }

  // 직업 분배에서 자리가 없던 인원을 일반 배치로 다른 부대에 넘기지 않는다.
  let party = 0;
  for (const member of members) {
    if (assigned.has(member.id) || member.job === "샤이" || member.job === "자이언트") continue;
    while (party < sizes.length && filled(party) >= sizes[party]) party++;
    if (party < sizes.length) place(member, party);
  }
  // 아래쪽 직업을 표의 마지막 줄에 고정하면 정원이 작은 부대에 빈칸이 남는다.
  // 두 열의 순서는 유지하면서 위로 붙여 자이·샤이·보영 앞의 빈칸을 없앤다.
  for (let party = 0; party < parties.length; party++) {
    const left = columnMembers(party, 0);
    const right = columnMembers(party, 1);
    parties[party] = Array.from({ length: Math.max(left.length, right.length) * 2 },
      (_, index) => (index % 2 ? right : left)[Math.floor(index / 2)] ?? null);
  }
  return {
    parties,
    waiting: members.filter((member) => !assigned.has(member.id)),
    rows: Math.max(1, ...parties.map((p) => Math.ceil(p.length / 2))),
    names: defaultNames(sizes.length),
  };
}

export function sheetRows(formation: Formation) {
  return Math.max(formation.rows, ...formation.parties.map((party) =>
    Math.ceil((party.findLastIndex((member) => member !== null) + 1) / 2)));
}

// 빈칸으로는 이동하고, 이미 사람이 있는 칸으로는 자리를 맞바꾼다.
export function moveMember(formation: Formation, id: string, target: CellAddress | null): Formation {
  const parties = formation.parties.map((party) => [...party]);
  const waiting = [...formation.waiting];
  const sourceParty = parties.findIndex((party) => party.some((m) => m?.id === id));
  const sourceIndex = sourceParty < 0 ? waiting.findIndex((m) => m.id === id)
    : parties[sourceParty].findIndex((m) => m?.id === id);
  if (sourceIndex < 0) return formation;
  const member = sourceParty < 0 ? waiting[sourceIndex] : parties[sourceParty][sourceIndex];
  if (!member) return formation;
  if (!target) {
    if (sourceParty < 0) return formation;
    parties[sourceParty][sourceIndex] = null;
    waiting.push(member);
  } else {
    const displaced = parties[target.party][target.index] ?? null;
    if (sourceParty < 0) {
      if (displaced) waiting[sourceIndex] = displaced;
      else waiting.splice(sourceIndex, 1);
    } else parties[sourceParty][sourceIndex] = displaced;
    while (parties[target.party].length <= target.index) parties[target.party].push(null);
    parties[target.party][target.index] = member;
  }
  return { ...formation, parties, waiting };
}

/** 머리글 이름 바꾸기. 비워 두면 머리글이 사라지므로 그때는 그대로 둔다. */
export function renameParty(formation: Formation, party: number, name: string): Formation {
  const value = name.trim();
  if (!value) return formation;
  return { ...formation, names: formation.names.map((n, i) => (i === party ? value : n)) };
}

/*
 * 여러 명을 한꺼번에 옮긴다.
 *
 * 한 명일 때는 자리를 맞바꾸지만, 여럿일 때는 바꾸지 않는다. 다섯 명을 끌어다
 * 놓았는데 그 자리에 있던 다섯 명이 튕겨 나오면 어디로 갔는지 알 수 없다.
 * 대신 놓은 자리부터 빈칸을 찾아 차례로 채운다.
 */
export function moveMembers(formation: Formation, ids: string[], target: CellAddress | null): Formation {
  if (ids.length === 1) return moveMember(formation, ids[0], target);
  const moving: SquadMember[] = [];
  const taken = new Set(ids);
  const parties = formation.parties.map((party) => party.map((member) => {
    if (!member || !taken.has(member.id)) return member;
    moving.push(member);
    return null;
  }));
  const waiting = formation.waiting.filter((member) => {
    if (!taken.has(member.id)) return true;
    moving.push(member);
    return false;
  });
  if (!moving.length) return formation;
  if (!target) return { ...formation, parties, waiting: [...waiting, ...moving] };

  /* 놓은 자리부터 인원수만큼 비어 있으면 거기 그대로 앉힌다. 누가 앉아 있으면
     그 자리에 끼워 넣고 아래를 민다 — 빈칸만 찾아 흩어 놓으면 같이 보낸 무리가
     부대 끝까지 뿔뿔이 흩어진다. */
  const party = parties[target.party];
  if (moving.every((_, offset) => !party[target.index + offset])) {
    while (party.length < target.index + moving.length) party.push(null);
    moving.forEach((member, offset) => { party[target.index + offset] = member; });
  } else {
    while (party.length < target.index) party.push(null);
    party.splice(target.index, 0, ...moving);
  }
  return { ...formation, parties, waiting };
}

export function editCell(formation: Formation, target: CellAddress, name: string, id: string): Formation {
  const previous = formation.parties[target.party][target.index];
  const value = name.trim();
  if (!value) return previous ? moveMember(formation, previous.id, null) : formation;
  const parties = formation.parties.map((party) => [...party]);
  while (parties[target.party].length <= target.index) parties[target.party].push(null);
  parties[target.party][target.index] = previous ? { ...previous, name: value }
    : { id, name: value, job: "", awakening: "" };
  return { ...formation, parties };
}

/** 사람이 앉아 있는 자리. 미배치는 칸 번호가 없어 따로 적는다. */
type Place = { party: number; index: number } | "waiting";

function places(formation: Formation): Map<string, Place> {
  const map = new Map<string, Place>();
  formation.parties.forEach((party, p) => party.forEach((member, index) => {
    if (member) map.set(member.id, { party: p, index });
  }));
  formation.waiting.forEach((member) => map.set(member.id, "waiting"));
  return map;
}

function roster(formation: Formation): Map<string, SquadMember> {
  const map = new Map<string, SquadMember>();
  for (const member of [...formation.parties.flat(), ...formation.waiting]) {
    if (member) map.set(member.id, member);
  }
  return map;
}

function samePlace(a: Place | null, b: Place | null): boolean {
  if (!a || !b || a === "waiting" || b === "waiting") return a === b;
  return a.party === b.party && a.index === b.index;
}

/*
 * 둘이 같은 때에 고친 판을 하나로 합친다.
 *
 * base 는 내가 보고 고치기 시작한 판, mine 은 지금 내 화면, theirs 는 그 사이
 * 남이 저장해 둔 판이다. 사람마다 "내가 옮겼는지" 만 본다 — base 에서 자리가
 * 달라진 사람은 내 자리로, 손대지 않은 사람은 남의 자리로 간다. 그래서 서로
 * 다른 사람을 옮겼으면 둘 다 살고, 같은 사람을 옮겼을 때에만 내 것이 남는다.
 *
 * 한쪽을 통째로 버리던 때는 늦게 저장한 쪽이 방금 한 일을 매번 잃었다. 둘이
 * 같이 짜면 한 사람은 계속 "다시 해 주세요" 만 보게 되어 있었다.
 *
 * 양쪽이 서로 자기 것을 남겨 판이 갈리지만, "내가 옮긴 사람" 은 저장이 통하는
 * 순간 비워진다. 그래서 손을 멈추면 한 판으로 모인다 — 늦어도 한 번 더 저장될
 * 때까지다.
 */
export function mergeFormations(base: Formation, mine: Formation, theirs: Formation): Formation {
  /* 부대 수가 달라졌으면 칸끼리 견줄 수가 없다. 판을 다시 짠 쪽을 그대로 쓴다. */
  if (mine.parties.length !== base.parties.length) return mine;
  if (theirs.parties.length !== base.parties.length) return theirs;

  const basePlace = places(base), minePlace = places(mine), theirPlace = places(theirs);
  const baseWho = roster(base), mineWho = roster(mine), theirWho = roster(theirs);

  const claims: { member: SquadMember; place: Place; mine: boolean }[] = [];
  for (const id of new Set([...mineWho.keys(), ...theirWho.keys()])) {
    const moved = !samePlace(minePlace.get(id) ?? null, basePlace.get(id) ?? null);
    const place = moved ? minePlace.get(id) : theirPlace.get(id);
    // 한쪽이 명단에서 아예 뺀 사람. 자리가 없으므로 앉힐 것도 없다.
    if (!place) continue;
    /* 이름에 붙은 역할도 같은 규칙으로 고른다 — 내가 바꿨으면 내 것. */
    const my = mineWho.get(id);
    const member = my && my.name !== baseWho.get(id)?.name ? my : (theirWho.get(id) ?? my);
    if (member) claims.push({ member, place, mine: moved });
  }

  const parties: (SquadMember | null)[][] = theirs.parties.map(() => []);
  const waiting: SquadMember[] = [];
  /* 표에 보이는 칸까지는 밀어 넣을 수 있다. 그보다 아래로는 안 보이므로 못 쓴다. */
  const cap = Math.max(base.rows, mine.rows, theirs.rows,
    ...[base, mine, theirs].flatMap((f) => f.parties.map((p) => Math.ceil(p.length / 2)))) * 2;

  /* 내가 옮긴 사람이 자리를 먼저 잡는다. 같은 칸을 둘이 노렸을 때, 눈앞에서
     움직인 쪽이 남아야 방금 한 일이 사라지지 않는다. */
  for (const claim of [...claims.filter((c) => c.mine), ...claims.filter((c) => !c.mine)]) {
    if (claim.place === "waiting") { waiting.push(claim.member); continue; }
    const { party, index } = claim.place;
    let seat = index;
    while (seat < cap && parties[party][seat]) seat += 1;
    // 밀려난 사람은 아래 빈칸으로. 그마저 없으면 미배치로 내려가 눈에 띈다.
    if (seat >= cap) { waiting.push(claim.member); continue; }
    while (parties[party].length <= seat) parties[party].push(null);
    parties[party][seat] = claim.member;
  }
  return {
    parties,
    waiting,
    rows: Math.max(mine.rows, theirs.rows),
    names: theirs.names.map((name, i) =>
      mine.names[i] !== undefined && mine.names[i] !== base.names[i] ? mine.names[i] : name),
  };
}
