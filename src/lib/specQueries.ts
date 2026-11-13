import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/lib/db";
import { ensureColumn } from "@/lib/schema";
import { MAX_BUILDS, apBasisFor, buildEquipmentText, calculateEquipmentStats, parseBuild } from "@/lib/equipment";
import type { ApBasis, EquipmentBuild } from "@/lib/equipment";
import type { ClassType, UserCharacterClass } from "@/lib/types";

/*
 * 스펙조사 저장 구조.
 *
 * 세팅과 제출을 나눈다. spec_build 는 연맹원이 평소에 만지는 세팅이라 언제든
 * 고치고 지운다. spec_submission 은 조사에 낸 스펙이라 낸 순간의 값을 통째로
 * 복사해 굳힌다. 제출이 세팅을 참조만 하면, 나중에 그 세팅을 고쳤을 때 이미
 * 낸 스펙까지 조용히 따라 바뀐다. 투표에서 survey_history 와
 * survey_history_final 을 나눈 것과 같은 이유다.
 *
 * 장비·수정·광명석은 한 세트다. 장비만 바꾸고 수정이 그대로 남으면 그건 세팅이
 * 아니다. 셋을 같은 행에 둔다.
 *
 * 기존 테이블이 Django 가 만든 것이라 외래키가 걸려 있지만, 우리가 새로 만드는
 * 테이블은 survey_history_final · vote_failure_log 와 같이 외래키 없이 둔다.
 * 봇과 웹이 같은 DB 를 쓰는 상황에서 제약이 늘면 한쪽의 실수가 다른 쪽을
 * 멈추게 한다.
 */
export async function ensureSpecTables(): Promise<void> {
  // 연맹원이 만드는 세팅. 개수 상한(8)은 parseWorkspace 가 이미 들고 있어
  // 앱에서 막는다. MySQL 로는 "사용자당 몇 개" 를 제약으로 쓸 수 없다.
  await pool.execute(
    "CREATE TABLE IF NOT EXISTS spec_build (" +
      "id bigint NOT NULL AUTO_INCREMENT, " +
      "user_id bigint NOT NULL, " +
      "name varchar(40) NOT NULL, " +
      "gear json NOT NULL, " +
      "crystals json NOT NULL, " +
      "lightstones json NOT NULL, " +
      "ap smallint NOT NULL, " +
      "aap smallint NOT NULL, " +
      "dp smallint NOT NULL, " +
      "score smallint NOT NULL, " +
      "is_complete tinyint(1) NOT NULL, " +
      "created_at datetime(6) NOT NULL, " +
      "updated_at datetime(6) NOT NULL, " +
      "PRIMARY KEY (id), " +
      // 같은 이름의 세팅이 둘 있으면 고르는 화면에서 구별할 수가 없다.
      "UNIQUE KEY uq_build_user_name (user_id, name), " +
      "KEY idx_build_user (user_id))",
  );

  // 조사 회차. closed_at 이 NULL 이면 상시 접수다.
  await pool.execute(
    "CREATE TABLE IF NOT EXISTS spec_survey (" +
      "id bigint NOT NULL AUTO_INCREMENT, " +
      "title varchar(60) NOT NULL, " +
      "opened_at datetime(6) NOT NULL, " +
      "closed_at datetime(6) NULL, " +
      "created_at datetime(6) NOT NULL, " +
      "updated_at datetime(6) NOT NULL, " +
      "PRIMARY KEY (id), " +
      "KEY idx_spec_survey_opened (opened_at))",
  );

  /*
   * 제출. gear·crystals·lightstones 는 spec_build 에서 복사해온 값이고,
   * summary_text 는 그때 사람이 읽던 형태다.
   *
   * 텍스트까지 굳히는 이유는 아이템 id 가 가모스 원본 id 를 그대로 쓰기
   * 때문이다(garmoth-930601). 카탈로그를 다시 뽑아 id 가 바뀌거나 빠지면
   * 저장된 JSON 이 어떤 장비였는지 알 수 없게 된다. 텍스트는 그때 무엇을
   * 냈는지를 카탈로그와 무관하게 남긴다.
   */
  await pool.execute(
    "CREATE TABLE IF NOT EXISTS spec_submission (" +
      "id bigint NOT NULL AUTO_INCREMENT, " +
      "spec_survey_id bigint NOT NULL, " +
      "user_id bigint NOT NULL, " +
      // 어느 세팅에서 냈는지. 그 세팅이 지워지면 NULL 로 남는다.
      "source_build_id bigint NULL, " +
      "build_name varchar(40) NOT NULL, " +
      "gear json NOT NULL, " +
      "crystals json NOT NULL, " +
      "lightstones json NOT NULL, " +
      "ap smallint NOT NULL, " +
      "aap smallint NOT NULL, " +
      "dp smallint NOT NULL, " +
      "score smallint NOT NULL, " +
      "is_complete tinyint(1) NOT NULL, " +
      "summary_text text NOT NULL, " +
      "created_at datetime(6) NOT NULL, " +
      "updated_at datetime(6) NOT NULL, " +
      "PRIMARY KEY (id), " +
      // 한 회차에 한 사람 한 번. 다시 내면 갱신한다. survey_history 는 이
      // 제약이 없어서 나중에 중복을 지우고 붙여야 했다.
      "UNIQUE KEY uq_submission_survey_user (spec_survey_id, user_id), " +
      // 관리자 명단은 공방합 내림차순이 기본이다.
      "KEY idx_submission_rank (spec_survey_id, score DESC), " +
      "KEY idx_submission_user (user_id))",
  );

  /*
   * 공방합 기준은 나중에 붙였다. 처음에는 AP·AAP 중 큰 쪽을 썼는데, 직업이
   * 정하는 값이라 그 판단 근거를 함께 남겨야 나중에도 같은 수를 설명할 수 있다.
   */
  await ensureColumn("spec_build", "ap_basis", "varchar(12) NOT NULL DEFAULT ''");
  await ensureColumn("spec_submission", "ap_basis", "varchar(12) NOT NULL DEFAULT ''");
  /*
   * 낼 때의 직업과 기준을 기록으로 남긴다. 화면은 지금 등록된 직업을 보여
   * 주므로(getSpecSubmissions 참고) 이 두 칸은 나중에 "그때는 무슨 직업으로
   * 냈나" 를 되짚을 때만 쓴다.
   */
  await ensureColumn("spec_submission", "class_name", "varchar(50) NOT NULL DEFAULT ''");
  await ensureColumn("spec_submission", "class_type", "varchar(20) NOT NULL DEFAULT ''");
  await backfillApBasis();

  // 회차를 나누기 전까지는 상시 접수 한 줄로 받는다. 나중에 회차제로 갈 때
  // 행만 추가하면 되므로 스키마를 다시 바꿀 일이 없다.
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT EXISTS(SELECT 1 FROM spec_survey) AS filled",
  );
  if (Number(rows[0].filled) === 1) return;
  await pool.execute(
    "INSERT INTO spec_survey (title, opened_at, closed_at, created_at, updated_at) " +
      "VALUES ('상시 스펙조사', NOW(6), NULL, NOW(6), NOW(6))",
  );
}

/*
 * 기준을 붙이기 전에 저장된 줄을 채운다. 규칙은 apBasisFor 한 군데에 있으므로
 * SQL 에 다시 쓰지 않고 읽어서 계산한 뒤 되돌려 준다. 그때의 직업을 알 길이
 * 없어 지금 등록된 직업으로 채우는데, 한 번만 도는 일이라 그 뒤로는 낼 때의
 * 직업이 그대로 굳는다.
 */
async function backfillApBasis(): Promise<void> {
  for (const table of ["spec_build", "spec_submission"]) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.ap, t.aap, t.dp, c.type, c.name FROM ${table} t ` +
        "JOIN user_character_class_map m ON m.user_id = t.user_id " +
        "JOIN character_class c ON c.id = m.character_class_id " +
        "WHERE t.ap_basis = ''",
    );
    for (const row of rows) {
      const basis = apBasisFor({ type: row.type as ClassType, name: row.name as string });
      if (!basis) continue;
      const score = (basis === "main" ? row.ap : row.aap) + row.dp;
      await pool.execute(`UPDATE ${table} SET ap_basis = ?, score = ? WHERE id = ?`, [basis, score, row.id]);
    }
  }
}

/* ── 세팅 ── */

export interface SpecBuildStats { ap: number; aap: number; dp: number; score: number; isComplete: boolean }
export interface SpecBuildRow extends SpecBuildStats { build: EquipmentBuild; updatedAt: Date }
export type SaveBuildResult =
  | { ok: true; id: string; stats: SpecBuildStats }
  | { ok: false; reason: "duplicate-name" | "limit"; message: string };

function buildValues(build: EquipmentBuild, basis: ApBasis | null): [string, string, string, string, number, number, number, number, number, string] {
  const stats = calculateEquipmentStats(build, basis);
  return [
    build.name,
    JSON.stringify(build.equipment), JSON.stringify(build.crystals), JSON.stringify(build.lightstones),
    stats.ap, stats.aap, stats.dp, stats.score, stats.complete ? 1 : 0, basis ?? "",
  ];
}

/*
 * 카탈로그가 바뀌어 열 수 없게 된 세팅은 세지 않고 건너뛴다. 한 줄 때문에
 * 화면 전체가 뜨지 않는 것보다는, 몇 개를 못 열었다고 알리는 편이 낫다.
 */
export async function getSpecBuilds(userId: string): Promise<{ builds: EquipmentBuild[]; broken: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, gear, crystals, lightstones FROM spec_build WHERE user_id = ? ORDER BY id ASC",
    [userId],
  );
  const builds: EquipmentBuild[] = [];
  let broken = 0;
  for (const row of rows) {
    try {
      builds.push(parseBuild({
        id: String(row.id), name: row.name,
        equipment: row.gear, crystals: row.crystals, lightstones: row.lightstones,
      }));
    } catch {
      broken += 1;
    }
  }
  return { builds, broken };
}

/*
 * build.id 가 숫자면 이미 저장된 세팅이라 그 줄을 고친다. 화면이 새로 만든
 * 세팅은 숫자가 아닌 임시 id 를 달고 오므로 새 줄이 된다. 고칠 줄이 남의
 * 것이거나 이미 지워졌으면 affectedRows 가 0 이고, 그때도 새로 만든다.
 */
export async function saveSpecBuild(userId: string, build: EquipmentBuild, basis: ApBasis | null): Promise<SaveBuildResult> {
  const values = buildValues(build, basis);
  const stats = calculateEquipmentStats(build, basis);
  const asStats: SpecBuildStats = { ap: stats.ap, aap: stats.aap, dp: stats.dp, score: stats.score, isComplete: stats.complete };
  const now = new Date();
  const existingId = /^\d+$/.test(build.id) ? build.id : null;
  try {
    if (existingId) {
      const [updated] = await pool.execute<ResultSetHeader>(
        "UPDATE spec_build SET name = ?, gear = ?, crystals = ?, lightstones = ?, " +
          "ap = ?, aap = ?, dp = ?, score = ?, is_complete = ?, ap_basis = ?, updated_at = ? " +
          "WHERE id = ? AND user_id = ?",
        [...values, now, existingId, userId],
      );
      if (updated.affectedRows > 0) return { ok: true, id: existingId, stats: asStats };
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM spec_build WHERE user_id = ?",
      [userId],
    );
    if (Number(rows[0].total) >= MAX_BUILDS) {
      return { ok: false, reason: "limit", message: `세팅은 최대 ${MAX_BUILDS}개까지 저장할 수 있습니다. 쓰지 않는 세팅을 지워 주세요.` };
    }
    const [inserted] = await pool.execute<ResultSetHeader>(
      "INSERT INTO spec_build (user_id, name, gear, crystals, lightstones, ap, aap, dp, score, is_complete, ap_basis, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [userId, ...values, now, now],
    );
    return { ok: true, id: String(inserted.insertId), stats: asStats };
  } catch (error) {
    // uq_build_user_name. 같은 이름이 둘이면 고르는 화면에서 구별할 수 없다.
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    return { ok: false, reason: "duplicate-name", message: `"${build.name}" 이라는 이름의 세팅이 이미 있습니다. 다른 이름을 지어 주세요.` };
  }
}

export async function deleteSpecBuild(userId: string, buildId: string): Promise<boolean> {
  // 제출은 세팅을 지워도 남는다. 어디서 나온 것인지만 잃는다.
  await pool.execute(
    "UPDATE spec_submission SET source_build_id = NULL WHERE source_build_id = ? AND user_id = ?",
    [buildId, userId],
  );
  const [result] = await pool.execute<ResultSetHeader>(
    "DELETE FROM spec_build WHERE id = ? AND user_id = ?",
    [buildId, userId],
  );
  return result.affectedRows > 0;
}

/* ── 조사와 제출 ── */

export interface SpecSurveyRow { id: string; title: string; openedAt: Date; closedAt: Date | null }
export interface SpecSubmissionRow extends SpecBuildStats {
  buildName: string;
  sourceBuildId: string | null;
  updatedAt: Date;
}
export type SubmitSpecResult =
  | { ok: true; submission: SpecSubmissionRow }
  | { ok: false; reason: "closed" | "missing"; message: string };

/** 지금 받고 있는 조사. closed_at 이 비어 있으면 상시 접수다. */
export async function getOpenSpecSurvey(now: Date = new Date()): Promise<SpecSurveyRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, title, opened_at, closed_at FROM spec_survey " +
      "WHERE opened_at <= ? AND (closed_at IS NULL OR closed_at > ?) " +
      "ORDER BY opened_at DESC, id DESC LIMIT 1",
    [now, now],
  );
  if (!rows.length) return null;
  return { id: String(rows[0].id), title: rows[0].title, openedAt: rows[0].opened_at, closedAt: rows[0].closed_at };
}

export async function getSpecSubmission(surveyId: string, userId: string): Promise<SpecSubmissionRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT source_build_id, build_name, ap, aap, dp, score, is_complete, updated_at " +
      "FROM spec_submission WHERE spec_survey_id = ? AND user_id = ?",
    [surveyId, userId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    buildName: row.build_name,
    sourceBuildId: row.source_build_id === null ? null : String(row.source_build_id),
    ap: row.ap, aap: row.aap, dp: row.dp, score: row.score,
    isComplete: row.is_complete === 1,
    updatedAt: row.updated_at,
  };
}

/*
 * 화면이 보낸 세팅이 아니라 저장된 줄을 읽어서 낸다. "저장된 셋 중 하나를
 * 골라 낸다" 가 규칙이므로 제출한 것과 저장한 것이 어긋날 자리를 두지 않는다.
 *
 * 낸 값은 그 자리에서 굳는다. 나중에 그 세팅을 고쳐도 이 줄은 그대로다.
 */
export async function submitSpec(surveyId: string, userId: string, buildId: string, basis: ApBasis, characterClass: UserCharacterClass): Promise<SubmitSpecResult> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, gear, crystals, lightstones FROM spec_build WHERE id = ? AND user_id = ?",
    [buildId, userId],
  );
  if (!rows.length) {
    return { ok: false, reason: "missing", message: "저장된 세팅을 찾지 못했습니다. 먼저 저장한 뒤 제출해 주세요." };
  }
  const row = rows[0];
  const build = parseBuild({
    id: String(row.id), name: row.name,
    equipment: row.gear, crystals: row.crystals, lightstones: row.lightstones,
  });
  const values = buildValues(build, basis);
  const now = new Date();
  await pool.execute(
    "INSERT INTO spec_submission (spec_survey_id, user_id, source_build_id, build_name, gear, crystals, lightstones, " +
      "ap, aap, dp, score, is_complete, ap_basis, class_name, class_type, summary_text, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new " +
      "ON DUPLICATE KEY UPDATE source_build_id = new.source_build_id, build_name = new.build_name, " +
      "gear = new.gear, crystals = new.crystals, lightstones = new.lightstones, " +
      "ap = new.ap, aap = new.aap, dp = new.dp, score = new.score, is_complete = new.is_complete, " +
      "ap_basis = new.ap_basis, class_name = new.class_name, class_type = new.class_type, " +
      "summary_text = new.summary_text, updated_at = new.updated_at",
    [surveyId, userId, buildId, ...values, characterClass.name, characterClass.type, buildEquipmentText(build, basis), now, now],
  );
  const stats = calculateEquipmentStats(build, basis);
  return {
    ok: true,
    submission: {
      buildName: build.name, sourceBuildId: buildId,
      ap: stats.ap, aap: stats.aap, dp: stats.dp, score: stats.score,
      isComplete: stats.complete, updatedAt: now,
    },
  };
}

/* ── 관리자 ── */

export interface SpecSubmissionListRow extends SpecBuildStats {
  apBasis: ApBasis | null;
  /** 지금 등록된 직업. 낼 때의 직업이 아니라 마지막으로 고른 직업이다. */
  characterClass: UserCharacterClass | null;
  userId: string;
  nickname: string;
  guildName: string;
  /*
   * 지금도 연맹원인지. 봇의 !탈퇴 를 거치면 user.status 가 내려간다. 다른
   * 화면은 status = 1 로 걸러 버리는데, 여기서는 걸러 내지 않고 표시만 한다 —
   * 낸 스펙은 그 사람이 있던 때의 기록이라 지워 버릴 것이 아니고, 명단을
   * 읽는 사람은 그 줄을 지금 인원으로 세면 안 된다는 것만 알면 된다.
   */
  isMember: boolean;
  buildName: string;
  summaryText: string;
  submittedAt: Date;
  /** 카탈로그가 바뀌어 판으로 그릴 수 없으면 비어 있다. 그때는 summaryText 를 보여준다. */
  build: EquipmentBuild | null;
}

/** 거르기 상자를 만들 목록. 아무도 내지 않은 길드도 상자는 있어야 한다. */
export async function getGuildNames(): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT name FROM guild WHERE status = 1 ORDER BY id",
  );
  return rows.map((row) => row.name as string);
}

/** 열려 있는 조사가 없으면 마지막 조사를 본다. 관리자는 끝난 조사도 봐야 한다. */
export async function getLatestSpecSurvey(): Promise<SpecSurveyRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, title, opened_at, closed_at FROM spec_survey ORDER BY opened_at DESC, id DESC LIMIT 1",
  );
  if (!rows.length) return null;
  return { id: String(rows[0].id), title: rows[0].title, openedAt: rows[0].opened_at, closedAt: rows[0].closed_at };
}

/*
 * 공방합 내림차순. 같은 값이면 먼저 낸 사람이 앞이다.
 * 수치를 확인하지 못한 장비가 섞인 제출은 합계를 믿을 수 없으므로 맨 뒤로 보낸다.
 *
 * 어느 공격력을 보는지는 지금 등록된 직업이 정한다. 낼 때 오공이었더라도 지금
 * 매구면 매구로 본다. 그래서 굳혀 둔 ap_basis 와 score 대신 여기서 다시
 * 계산한다. 장비 수치(ap·aap·dp)는 낸 그대로이고 어느 쪽을 볼지만 달라진다.
 */
export async function getSpecSubmissions(surveyId: string): Promise<SpecSubmissionListRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT s.user_id, u.user_nickname, u.status AS user_status, g.name AS guild_name, s.build_name, " +
      "s.gear, s.crystals, s.lightstones, " +
      "s.ap, s.aap, s.dp, s.is_complete, c.name AS class_name, c.type AS class_type, s.summary_text, s.updated_at " +
      "FROM spec_submission s LEFT JOIN user u ON u.id = s.user_id " +
      "LEFT JOIN guild g ON g.id = u.guild_id " +
      "LEFT JOIN user_character_class_map m ON m.user_id = s.user_id " +
      "LEFT JOIN character_class c ON c.id = m.character_class_id " +
      "WHERE s.spec_survey_id = ? " +
      "ORDER BY s.is_complete DESC, s.updated_at ASC",
    [surveyId],
  );
  return rows.map((row) => {
    let build: EquipmentBuild | null = null;
    try {
      build = parseBuild({
        id: String(row.user_id), name: row.build_name,
        equipment: row.gear, crystals: row.crystals, lightstones: row.lightstones,
      });
    } catch {
      build = null;
    }
    const characterClass: UserCharacterClass | null = row.class_name
      ? { name: row.class_name as string, type: row.class_type as ClassType }
      : null;
    const apBasis = apBasisFor(characterClass);
    return {
      userId: String(row.user_id),
      nickname: row.user_nickname ?? "알 수 없음",
      guildName: row.guild_name ?? "소속 없음",
      // 행이 아예 없으면(NULL) 그 사람도 지금 연맹원이 아니다.
      isMember: row.user_status === 1,
      buildName: row.build_name,
      summaryText: row.summary_text,
      submittedAt: row.updated_at,
      ap: row.ap, aap: row.aap, dp: row.dp,
      score: apBasis === null ? 0 : (apBasis === "main" ? row.ap : row.aap) + row.dp,
      // 기준을 정할 직업이 없으면 합계도 뜻이 없다.
      isComplete: row.is_complete === 1 && apBasis !== null,
      apBasis,
      characterClass,
      build,
    };
  });
}
