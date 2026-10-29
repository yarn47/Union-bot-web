"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { autoAssign, baseName, editCell, emptyFormation, memberArt, memberLabel, memberRole, FORMATS, mergeFormations, moveMembers, parseMembers, renameParty, ROLES, setRole, SHEET, sheetRows, type CellAddress, type Formation, type FormatKey, type SquadMember } from "./formation";
import { formationImage, roleLegendImage } from "./image";
import { ROLE_ICON_PATH } from "./roleIcons";
import { boardPulseAction, loadBoardAction, saveBoardAction, type Viewer } from "./boardActions";
import { TabGuide } from "../TabGuide";
import styles from "./squad.module.css";

/** 역할 그림. 직접 그린 것이라 글자색을 그대로 따라간다. */
function RoleIcon({ role, size }: { role: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: ROLE_ICON_PATH[role] ?? "" }} />
  );
}

function NameInput({ value, onCommit, onCancel }: {
  value: string; onCommit: (value: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const finished = useRef(false);
  const focusInput = useCallback((element: HTMLInputElement | null) => {
    if (element) { element.focus(); element.select(); }
  }, []);
  function finish(cancel = false) {
    if (finished.current) return;
    finished.current = true;
    if (cancel) onCancel();
    else onCommit(text);
  }
  return <input className={styles.nameInput} aria-label="이름 수정" value={text}
    ref={focusInput}
    onChange={(event) => setText(event.target.value)} onBlur={() => finish()}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finish(event.key === "Escape");
      }
    }} />;
}

type Editing = { key: string; value: string; cell?: CellAddress; waitingId?: string; headerParty?: number };

/*
 * 남이 고쳤는지 묻는 주기. 판 전체가 아니라 번호 한 줄만 물어보므로(기본키
 * 조회 하나) 짧게 두어도 DB 가 힘들어하지 않는다. 받아 오는 양은 이 주기가
 * 혼자 정한다 — 한 번 돌 때 판을 많아야 한 번 가져오니, 남이 자주 저장해도
 * 읽기가 배로 늘지는 않는다.
 */
const POLL_MS = 1500;
/*
 * 손을 멈춘 뒤 저장하기까지. 옮길 때마다 다시 센다.
 *
 * 반쯤 된 판이 새어 나갈 걱정은 없다 — 고르는 것은 판을 건드리지 않고, 끄는
 * 중과 이름을 고치는 중에는 저장이 막혀 있다. 그래서 이 값은 "쓰기를 몇 번
 * 묶을까" 일 뿐이고, 짧게 두면 그만큼 빨리 남에게 닿는다.
 */
const SAVE_DELAY_MS = 300;
/*
 * 사람마다 다른 색.
 *
 * 이름을 숫자로 접어 색상환의 한 자리를 고른다. 같은 사람은 어느 창에서든
 * 같은 색이 나오고, 서버가 색을 들고 다닐 필요가 없다. 밝기와 진하기는
 * 고정이라 어두운 표 위에서 다 비슷하게 읽힌다.
 */
function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

/* 남의 판 위에 내 변경만 다시 얹는다. 둘을 견줄 바탕(base)이 없으면 포기한다. */
function mergeOnto(base: string | null, mine: Formation, theirs: string): Formation | undefined {
  if (base === null) return undefined;
  try {
    return mergeFormations(JSON.parse(base) as Formation, mine, JSON.parse(theirs) as Formation);
  } catch { return undefined; }
}

/* 회차에 묶이지 않는 임시판. 거점전이 끝나고 다음 회차가 아직 안 올라온 동안에도
   짜 둘 데가 있어야 한다. 회차 번호는 1 부터라 0 과 부딪치지 않는다. */
const SCRATCH_ID = "0";

export function SquadTab({ surveyId }: { surveyId: string | null }) {
  const [input, setInput] = useState("");
  const [formation, setFormation] = useState(emptyFormation);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  /* 판 크기. 자동은 온 인원으로 고르고, 직접 고르면 인원이 모자라도 그 판으로
     짠다 — 100 인 거점전인데 여든 명만 와도 여섯 부대로 세워 두는 일이 있다. */
  const [format, setFormat] = useState<FormatKey>("auto");
  /* 고른 사람들. 눌러서 고르고 눌러서 보내는 길과 끌어다 놓는 길이 함께 산다.
     가로로 멀리 끌고 가는 것이 폰에서도 트랙패드에서도 어려워 누르는 길을
     남겼고, 마우스로는 끄는 편이 빠르다. */
  const [selected, setSelected] = useState<string[]>([]);
  /* 폰에는 Ctrl 이 없다. 켜 두면 누르는 것이 곧 고르기가 된다. */
  const [multi, setMulti] = useState(false);
  /* 사용법. 탭 위쪽 ? 와 같은 글을 띄운다 — 손이 가 있는 자리에서 바로 열린다. */
  const [helpOpen, setHelpOpen] = useState(false);
  // 묶인 회차가 없으면 임시판에 저장한다.
  const boardId = surveyId ?? SCRATCH_ID;
  /* 저장된 판의 번호. 0 은 아직 이 회차에 저장된 것이 없다는 뜻이다. */
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState("");
  /* 지금 같은 판을 보고 있는 사람들. 혼자인지 아닌지가 보여야 표가 혼자
     움직이는 것처럼 느껴지지 않는다. */
  const [viewers, setViewers] = useState<Viewer[]>([]);
  /* 남이 방금 건드린 칸. 잠깐 반짝였다 사라진다 — 무엇이 바뀌었는지 눈으로
     따라갈 수 있어야 한다. */
  const [flash, setFlash] = useState<Set<string>>(new Set());
  /* 그 칸을 건드린 사람의 색. 한 번에 한 사람이 보내 온 것이라 하나면 된다. */
  const [flashHue, setFlashHue] = useState(40);
  /* 서버가 들고 있는 것으로 아는 판. 이것과 다를 때에만 저장한다 — 남이 고친
     것을 받아 그린 뒤에 그대로 되돌려 보내는 일이 없어야 한다. */
  const stored = useRef<string | null>(null);
  /* 끄는 동안 따라오는 사람들. 끌기가 아닌 평소에는 비어 있어야, 바깥에서
     끌어온 파일 따위를 놓았을 때 엉뚱하게 사람이 움직이지 않는다. */
  const [dragging, setDragging] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /* 저장은 한 번에 하나만 나간다. 겹쳐 보내면 두 번째가 첫 번째가 받아 올
     새 번호를 모른 채 옛 번호로 나가 제 저장과 부딪친다. */
  const saving = useRef(false);
  /* 저장이 끝날 때마다 하나 오른다. 보내는 중이라 미뤘던 저장을 다시 깨운다. */
  const [savePass, setSavePass] = useState(0);
  /*
   * 지금 화면이 들고 있는 것. 3 초마다 도는 시계가 state 가 아니라 이것을 본다.
   *
   * state 를 보면 사람을 하나 옮길 때마다 시계를 새로 걸어야 하고, 그러면 3 초가
   * 처음부터 다시 시작된다. 한창 짜는 사람은 그 3 초를 한 번도 넘기지 못해 남이
   * 저장한 것을 영원히 받지 못했고, 제 판 번호가 옛것에 멈춘 채로 저장해 매번
   * 부딪쳤다 — 가만히 보고 있는 쪽만 늘 이기는 판이었다.
   */
  const live = useRef({ formation, version, editing, dragging });
  const root = useRef<HTMLDivElement>(null);
  const sheetScroll = useRef<HTMLDivElement>(null);
  const rows = sheetRows(formation);
  const columns = formation.parties.length * 2;
  const assignedCount = formation.parties.reduce((sum, party) => sum + party.filter(Boolean).length, 0);

  useEffect(() => { live.current = { formation, version, editing, dragging }; });

  useLayoutEffect(() => {
    const sheet = sheetScroll.current;
    if (!sheet) return;
    function fitNames() {
      sheet?.querySelectorAll<HTMLElement>("[data-member-label]").forEach((label) => {
        label.style.fontSize = "";
        const available = (label.parentElement?.clientWidth ?? 0) - 6;
        if (available > 0 && label.scrollWidth > available) {
          label.style.fontSize = `${(10 * 4 / 3) * available / label.scrollWidth}px`;
        }
      });
    }
    fitNames();
    const observer = new ResizeObserver(fitNames);
    observer.observe(sheet);
    let active = true;
    void document.fonts.ready.then(() => { if (active) fitNames(); });
    return () => { active = false; observer.disconnect(); };
  }, [formation, editing]);

  /* 저장된 판을 받아 그린다. 골라 둔 사람은 그 판에도 있으면 그대로 둔다.
     받기 직전의 판은 stored 가 들고 있으므로, 둘을 견줘 바뀐 칸을 찾아낸다.

     show 를 주면 받은 판 대신 그것을 그린다 — 남의 것과 내 것을 합친 판이다.
     서버가 들고 있는 것으로 아는 판(stored)은 어느 쪽이든 받은 그대로 둔다. */
  const applyBoard = useCallback((data: string, nextVersion: number, by?: string | null,
    show?: Formation) => {
    let next: Formation;
    try { next = JSON.parse(data) as Formation; } catch { return; }
    if (!Array.isArray(next?.parties)) return;

    const changed = new Set<string>();
    if (stored.current && stored.current !== data) {
      try {
        const before = JSON.parse(stored.current) as Formation;
        next.parties.forEach((party, p) => {
          const old = before.parties[p] ?? [];
          const count = Math.max(party.length, old.length);
          for (let i = 0; i < count; i += 1) {
            if ((party[i]?.id ?? null) !== (old[i]?.id ?? null)) changed.add(`${p}:${i}`);
          }
        });
      } catch {
        // 옛 판이 깨져 있으면 반짝임만 포기한다. 새 판은 그대로 그린다.
      }
    }

    stored.current = data;
    setVersion(nextVersion);
    const board = show ?? next;
    setFormation(board);
    setFlash(changed);
    if (by) setFlashHue(hueOf(by));
    const alive = new Set([...board.parties.flat(), ...board.waiting]
      .filter((m): m is SquadMember => Boolean(m)).map((m) => m.id));
    setSelected((previous) => previous.filter((id) => alive.has(id)));
  }, []);

  // 반짝임은 잠깐이다. 계속 남아 있으면 무엇이 방금 바뀐 것인지 알 수 없다.
  useEffect(() => {
    if (!flash.size) return;
    const timer = setTimeout(() => setFlash(new Set()), 2400);
    return () => clearTimeout(timer);
  }, [flash]);

  /* 탭을 열 때 한 번. 회차가 바뀌면 AdminConsole 이 key 로 새로 마운트하므로
     여기서 되돌릴 것이 없다. */
  useEffect(() => {
    let alive = true;
    void loadBoardAction(boardId).then((board) => {
      if (!alive || !board) return;
      applyBoard(board.data, board.version);
      setMessage(`저장해 둔 편성을 불러왔습니다. 마지막 수정: ${board.updatedBy ?? "알 수 없음"}.`);
    }).catch(() => {});
    return () => { alive = false; };
  }, [boardId, applyBoard]);

  /* 손을 멈추면 저장한다. 끄는 중이거나 이름을 고치는 중에는 기다린다 — 반쯤
     옮긴 판을 남에게 보내 봐야 소용이 없다. */
  useEffect(() => {
    if (editing || dragging.length || saving.current) return;
    const data = JSON.stringify(formation);
    if (data === stored.current) return;
    /* 받아 오기 전의 빈 판은 보내지 않는다. 느린 날 저장된 판보다 먼저 닿으면
       남이 짜 둔 것과 쓸데없이 부딪친다. */
    if (stored.current === null && !assignedCount && !formation.waiting.length) return;
    const timer = setTimeout(() => {
      saving.current = true;
      setSaveState("저장 중…");
      void saveBoardAction(boardId, data, version).then((result) => {
        if (result.ok) {
          stored.current = data;
          setVersion(result.version);
          setSaveState("저장됨");
          return;
        }
        if (!result.board) { setSaveState("저장 실패"); return; }
        /* 사이에 남이 저장했다. 그쪽 판에 내가 옮긴 사람만 다시 얹는다.
           그냥 덮으면 남이 방금 옮긴 사람이, 그쪽으로 맞추기만 하면 내가 방금
           옮긴 사람이 소리 없이 제자리로 돌아간다. 합친 판은 아래 저장이 한 번
           더 돌며 그대로 올라간다. */
        const merged = mergeOnto(stored.current, live.current.formation, result.board.data);
        applyBoard(result.board.data, result.board.version, result.board.updatedBy, merged);
        setSaveState("");
        setMessage(merged
          ? `${result.board.updatedBy ?? "다른 사람"}님이 같은 때에 고쳐 둘을 합쳤습니다.`
          : `${result.board.updatedBy ?? "다른 사람"}님이 먼저 저장해 그 편성으로 맞췄습니다.`);
      }).catch(() => setSaveState("저장 실패"))
        .finally(() => { saving.current = false; setSavePass((pass) => pass + 1); });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [boardId, formation, assignedCount, version, editing, dragging.length, savePass, applyBoard]);

  /* 남이 고쳤는지 번호만 물어본다. 내가 손대는 중이거나 아직 못 보낸 변경이
     있으면 받아 가지 않는다 — 곧 나갈 저장이 그 자리에서 합쳐 준다.
     시계는 판이 바뀌어도 그대로 돈다. 바뀔 때마다 새로 걸면 손이 바쁜 동안
     3 초가 영원히 다시 시작된다. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      /* 손대는 중에도 "나 여기 있다" 는 보낸다. 안 보내면 내가 한참 끌고 있는
         동안 남의 화면에서 내가 사라진다. 판을 받아 가는 것만 미룬다. */
      void boardPulseAction(boardId).then(async ({ version: serverVersion, viewers: here }) => {
        setViewers(here);
        const now = live.current;
        if (now.editing || now.dragging.length || saving.current) return;
        if (serverVersion <= now.version) return;
        /* 아직 아무것도 저장되지 않았던 판이면 stored 가 비어 있다. 그때는
           내가 짜 둔 것이 있는지로 가린다 — 비어 있다고 영원히 안 받으면,
           먼저 열어 둔 사람은 남이 첫 저장을 해도 끝까지 못 본다. */
        const unsent = stored.current === null
          ? now.formation.parties.some((party) => party.some(Boolean)) || now.formation.waiting.length > 0
          : JSON.stringify(now.formation) !== stored.current;
        if (unsent) return;
        const board = await loadBoardAction(boardId);
        if (!board) return;
        applyBoard(board.data, board.version, board.updatedBy);
        setMessage(`${board.updatedBy ?? "다른 사람"}님이 편성을 바꿨습니다.`);
      }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [boardId, applyBoard]);


  function assign(useFormat: FormatKey = format) {
    const members = parseMembers(input);
    if (!members.length) { setMessage("닉네임 / 직업 형식으로 명단을 입력해 주세요."); return; }
    const next = autoAssign(members, useFormat);
    // 고쳐 둔 부대 이름은 다시 돌려도 남긴다. 부대 수가 달라지면 되돌린다.
    setFormation((previous) => next.names.length === previous.names.length
      ? { ...next, names: previous.names } : next);
    setEditing(null);
    // 다시 짜면 자리가 통째로 바뀐다. 고른 채로 두면 엉뚱한 사람이 고른 것이 된다.
    setSelected([]);
    endDrag();
    /* 자리가 모자라 빠진 사람은 말해 준다. 미배치 칸에 조용히 쌓여 있으면
       그대로 넘어가 부대 없이 들어가는 사람이 생긴다. */
    setMessage(next.waiting.length
      ? `${members.length}명 중 ${next.waiting.length}명이 자리가 없어 미배치로 갔습니다. 아래에서 옮겨 주세요.`
      : `${members.length}명을 ${next.parties.length}개 부대에 모두 배치했습니다.`);
  }

  /* 판을 고르면 그 자리에서 다시 짠다. 고르기만 하고 가만히 있으면 왜 안 바뀌나
     하게 된다. 명단이 비어 있으면 고르기만 해 둔다. */
  function pickFormat(next: FormatKey) {
    setFormat(next);
    if (parseMembers(input).length) assign(next);
  }

  function commit(value: string) {
    if (!editing) return;
    const { cell, waitingId, headerParty } = editing;
    const id = `manual-${crypto.randomUUID()}`;
    setFormation((previous) => {
      if (headerParty !== undefined) return renameParty(previous, headerParty, value);
      if (cell) return editCell(previous, cell, value, id);
      return {
        ...previous,
        waiting: previous.waiting.map((member) => member.id === waitingId && value.trim()
          ? { ...member, name: value.trim() } : member),
      };
    });
    setEditing(null);
  }

  const picked = new Set(selected);

  function toggle(id: string) {
    setSelected((previous) => previous.includes(id)
      ? previous.filter((other) => other !== id) : [...previous, id]);
  }

  /** 고른 사람들을 그 자리로 보낸다. 한 명이면 자리 맞바꿈, 여럿이면 빈칸 채우기. */
  function place(target: CellAddress | null) {
    if (!selected.length) return;
    setFormation((previous) => moveMembers(previous, selected, target));
    setSelected([]);
  }

  /** 칸을 눌렀을 때. 고른 것이 없으면 고르고, 있으면 그 자리로 보낸다. */
  function tapCell(member: { id: string } | null | undefined, cell: CellAddress,
    event?: MouseEvent) {
    if (editing) return;
    const adding = multi || event?.ctrlKey || event?.metaKey || event?.shiftKey;
    if (member && adding) { toggle(member.id); return; }
    if (selected.length) {
      if (selected.length === 1 && selected[0] === member?.id) { setSelected([]); return; }
      place(cell);
      return;
    }
    if (member) setSelected([member.id]);
  }

  /* 끌기. 고른 무리 안의 사람을 끌면 무리째 따라오고, 밖의 사람을 끌면 그
     사람만 따라온다. 손에 뭘 들었는지 보이도록 고르기도 같이 맞춘다. */
  function startDrag(event: DragEvent, id: string) {
    const ids = picked.has(id) && selected.length > 1 ? selected : [id];
    setDragging(ids);
    setSelected(ids);
    event.dataTransfer.effectAllowed = "move";
    // 파이어폭스는 담은 것이 없으면 끌기를 시작조차 하지 않는다.
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function overDrop(event: DragEvent, key: string | null) {
    if (!dragging.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver((previous) => (previous === key ? previous : key));
  }

  function drop(event: DragEvent, target: CellAddress | null) {
    if (!dragging.length) return;
    event.preventDefault();
    const ids = dragging;
    endDrag();
    setFormation((previous) => moveMembers(previous, ids, target));
    setSelected([]);
  }

  function endDrag() {
    setDragging([]);
    setDragOver(null);
  }

  const everyone = [...formation.parties.flat(), ...formation.waiting];
  const selectedMembers = selected
    .map((id) => everyone.find((m) => m?.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  /** 고른 사람들에게 모두 붙어 있는 역할. 섞여 있으면 빈 값이다. */
  const selectedRole = selectedMembers.length && selectedMembers.every((m) =>
    memberRole(m) === memberRole(selectedMembers[0])) ? memberRole(selectedMembers[0]) ?? "" : "";

  /* 이미 모두 달고 있는 역할을 다시 누르면 뗀다. 섞여 있으면 모두에게 붙인다. */
  function applyRole(role: string) {
    if (!selected.length) return;
    const next = selectedRole === role ? null : role;
    setFormation((previous) => selected.reduce((f, id) => setRole(f, id, next), previous));
  }

  /* png 는 이미 시작된 약속이어야 한다. Safari 는 누름이 끝난 뒤에 시작한
     쓰기를 막으므로, 부르는 쪽에서 미리 만들어 넘긴다. */
  async function copyPng(png: Promise<Blob>, filename: string, done: string) {
    setCopying(true);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("clipboard");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setMessage(done);
    } catch {
      try {
        const url = URL.createObjectURL(await png);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("이미지 복사를 사용할 수 없어 PNG 파일로 내려받았습니다.");
      } catch { setMessage("이미지를 만들지 못했습니다. 다시 시도해 주세요."); }
    } finally { setCopying(false); }
  }

  return <div ref={root} className={styles.root}>
    <div className={styles.inputHeader}>
      <label htmlFor="squad-members">명단 입력</label>
      <div className={styles.actions}>
        <span className={styles.formatLabel}>판 크기</span>
        {FORMATS.map((option) => (
          <button key={option.key} type="button" className={styles.button}
            aria-pressed={format === option.key} onClick={() => pickFormat(option.key)}>
            {option.label}
          </button>
        ))}
        <button type="button" className={styles.primary} onClick={() => assign()}>부대 자동 배치</button>
      </div>
    </div>
    <textarea id="squad-members" className={styles.rosterInput} value={input}
      onChange={(event) => setInput(event.target.value)} spellCheck={false}
      placeholder={"투표 명단을 붙여 넣으세요.\n1. 예니체리 / 노바 (각성)\n2. 홍줭 / 위자드 (각성)"} />

    <div className={styles.toolbar}>
      <h2>부대 편성 <span>{assignedCount}명</span></h2>
      <button type="button" className={styles.helpBtn} onClick={() => setHelpOpen(true)}
        title="부대편성 사용법 보기" aria-label="부대편성 사용법 보기">?</button>
      <span className={styles.saveState} role="status">
        {surveyId ? saveState : `임시판${saveState ? ` · ${saveState}` : ""}`}
      </span>

      {helpOpen && <TabGuide tab="부대편성" onClose={() => setHelpOpen(false)} />}
      <div className={styles.actions}>
        <button type="button" className={styles.button} aria-pressed={multi}
          onClick={() => setMulti((previous) => !previous)}>여러 명 고르기</button>
        <button type="button" className={styles.button} onClick={() => {
          setFormation(emptyFormation());
          setSelected([]); setEditing(null); endDrag();
          setMessage("편성을 비웠습니다.");
        }}>새로 짜기</button>
        <button type="button" className={styles.button} disabled={copying}
          onClick={() => copyPng(roleLegendImage(), "역할그림.png", "역할 그림을 복사했습니다.")}>
          역할 그림 복사
        </button>
        <button type="button" className={styles.button} disabled={copying}
          onClick={() => copyPng(formationImage(formation), "부대편성.png", "부대표 이미지를 복사했습니다.")}>
          {copying ? "복사 중…" : "이미지로 복사"}
        </button>
      </div>
    </div>
    <div ref={sheetScroll} className={styles.sheetScroll}>
      <table className={styles.sheet} aria-label="부대 편성표" style={{
        "--sheet-column": `${SHEET.columnWidth}px`, "--sheet-row": `${SHEET.rowHeight}px`,
        "--sheet-header": `${SHEET.headerHeight}px`, "--sheet-min": `${columns * 138}px`,
        "--flash": `hsl(${flashHue} 62% 36%)`, "--flash-soft": `hsla(${flashHue}, 62%, 36%, 0.42)`,
        fontFamily: SHEET.font,
      } as CSSProperties}>
        <colgroup>{Array.from({ length: columns }, (_, i) =>
          <col key={i} style={{ width: `${100 / columns}%` }} />)}</colgroup>
        <thead><tr>{formation.names.map((name, party) =>
          <th key={party} scope="colgroup" colSpan={2}>
            {editing?.key === `head:${party}`
              ? <NameInput key={`head:${party}`} value={editing.value} onCommit={commit}
                onCancel={() => setEditing(null)} />
              : <button type="button" className={styles.headerName} title="눌러서 이름 고치기"
                onClick={() => setEditing({ key: `head:${party}`, value: name, headerParty: party })}>
                {name}<br /><span>({formation.parties[party].filter(Boolean).length}명)</span>
              </button>}
          </th>)}</tr></thead>
        <tbody>{Array.from({ length: rows + 1 }, (_, row) => <tr key={row} className={row === rows ? styles.extraRow : undefined}>
          {formation.parties.flatMap((party, partyIndex) => [0, 1].map((column) => {
            const index = row * 2 + column;
            const member = party[index];
            const label = memberLabel(member);
            const key = `${partyIndex}:${index}`;
            const startEdit = (value = member?.name ?? "") => setEditing({ key, value, cell: { party: partyIndex, index } });
            return <td key={key}>
              {editing?.key === key ? <NameInput key={key} value={editing.value} onCommit={commit} onCancel={() => setEditing(null)} />
                : <button type="button" className={styles.cell}
                  draggable={Boolean(member)}
                  onDragStart={(event) => member && startDrag(event, member.id)}
                  onDragEnd={endDrag}
                  onDragOver={(event) => overDrop(event, key)}
                  onDragLeave={() => setDragOver((previous) => previous === key ? null : previous)}
                  onDrop={(event) => drop(event, { party: partyIndex, index })}
                  data-picked={member && picked.has(member.id) ? "" : undefined}
                  data-target={selected.length && !(member && picked.has(member.id)) ? "" : undefined}
                  data-over={dragOver === key ? "" : undefined}
                  data-flash={flash.has(key) ? "" : undefined}
                  aria-label={`${partyIndex + 1}부대 ${row + 1}행 ${column + 1}열: ${label || "빈칸"}`}
                  aria-pressed={member ? picked.has(member.id) : undefined}
                  title={selected.length ? "눌러서 이 자리로" : label ? "눌러서 고르기 · 끌어서 옮기기" : ""}
                  onClick={(event) => tapCell(member, { party: partyIndex, index }, event)}
                  onKeyDown={(event) => {
                    if (event.key === "F2") { event.preventDefault(); startEdit(); }
                    else if ((event.key === "Delete" || event.key === "Backspace") && member) {
                      // 고른 무리 안의 사람을 지우면 무리째 미배치로 내려간다.
                      event.preventDefault();
                      const ids = picked.has(member.id) && selected.length > 1 ? selected : [member.id];
                      setFormation((previous) => moveMembers(previous, ids, null));
                      setSelected([]);
                    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                      event.preventDefault(); startEdit(event.key);
                    }
                  }}>
                  {(() => {
                    const art = memberArt(member);
                    return art ? (
                      <span className={styles.art}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- 칸마다 들어가는 작은 정적 그림이라 최적화가 필요 없다. */}
                        <img src={art.icon} alt="" className={styles.icon} />
                        {art.mark && (
                          <span className={styles.badge} style={{ borderColor: art.mark.color }}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- 픽셀 그림이라 늘리면 뭉개진다. */}
                            <img src={art.mark.src} alt="" />
                          </span>
                        )}
                      </span>
                    ) : null;
                  })()}
                  <span className={styles.memberLabel} data-member-label>{label}</span>
                  {memberRole(member) && (
                    <span className={styles.role} title={memberRole(member) ?? ""}>
                      <RoleIcon role={memberRole(member) as string} size={SHEET.roleSize} />
                    </span>
                  )}</button>}
            </td>;
          }))}
        </tr>)}</tbody>
      </table>
    </div>
    {viewers.length > 0 && (
      <div className={styles.viewerBar}>
        <span className={styles.dot} aria-hidden="true" />
        {viewers.map((viewer) => (
          <span key={viewer.name} className={styles.face} title={`${viewer.name} 같이 보는 중`}
            style={{ borderColor: `hsl(${hueOf(viewer.name)} 72% 58%)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 디스코드 CDN 의 작은 사진이라 최적화할 것이 없다. */}
            {viewer.avatar ? <img src={viewer.avatar} alt="" /> : viewer.name.slice(0, 1)}
          </span>
        ))}
        <span className={styles.viewerNames}>{viewers.map((v) => v.name).join(", ")} 같이 보는 중</span>
      </div>
    )}
    {selectedMembers.length ? (
      <div className={styles.roleBar}>
        <strong>{selectedMembers.length === 1
          ? baseName(selectedMembers[0].name) : `${selectedMembers.length}명`}</strong>
        <span className={styles.roleHint}>역할</span>
        {ROLES.map((role) => (
          <button key={role} type="button"
            className={selectedRole === role ? styles.roleOn : styles.roleButton}
            onClick={() => applyRole(role)}><RoleIcon role={role} size={17} /> {role}</button>
        ))}
        <button type="button" className={styles.button} onClick={() => setSelected([])}>고르기 취소</button>
      </div>
    ) : (
      <p className={styles.hint}>
        사람을 누르고 갈 자리를 누르면 옮겨집니다. 끌어다 놓아도 됩니다.
        여러 명은 Ctrl(⌘)이나 Shift 를 누른 채, 폰에서는 「여러 명 고르기」로 고릅니다.
        {" "}자세한 사용법은 <button type="button" className={styles.hintLink}
          onClick={() => setHelpOpen(true)}>?</button> 를 누르세요.
      </p>
    )}
    <section className={styles.waiting} aria-label="미배치 인원"
      data-target={selected.length ? "" : undefined} data-over={dragOver === "waiting" ? "" : undefined}
      onDragOver={(event) => overDrop(event, "waiting")}
      onDragLeave={() => setDragOver((previous) => previous === "waiting" ? null : previous)}
      onDrop={(event) => drop(event, null)}
      onClick={(event) => { if (selected.length && event.target === event.currentTarget) place(null); }}>
      <h3>미배치 <span>{formation.waiting.length}명</span>
        {selected.length > 0 && <button type="button" className={styles.button} onClick={() => place(null)}>여기로 보내기</button>}
      </h3>
      <div className={styles.waitingMembers}>
        {formation.waiting.map((member) => editing?.waitingId === member.id
          ? <NameInput key={member.id} value={editing.value} onCommit={commit} onCancel={() => setEditing(null)} />
          : <button key={member.id} type="button" className={styles.waitingMember}
            draggable onDragStart={(event) => startDrag(event, member.id)} onDragEnd={endDrag}
            data-picked={picked.has(member.id) ? "" : undefined}
            aria-pressed={picked.has(member.id)}
            onClick={(event) => (multi || event.ctrlKey || event.metaKey || event.shiftKey)
              ? toggle(member.id)
              : setSelected((previous) =>
                previous.length === 1 && previous[0] === member.id ? [] : [member.id])}
            onKeyDown={(event) => { if (event.key === "F2") {
              event.preventDefault(); setEditing({ key: `waiting-${member.id}`, waitingId: member.id, value: member.name });
            } }}>{member.name}</button>)}
        {!formation.waiting.length && <p>배치에서 뺄 인원을 여기로 옮기세요.</p>}
      </div>
    </section>
    <p className={styles.message} role="status">{message}</p>
  </div>;
}
