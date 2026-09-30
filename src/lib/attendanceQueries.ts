import type { RowDataPacket } from "mysql2/promise";
import { pool } from "@/lib/db";
import { avatarUrl } from "@/lib/memberQueries";

/*
 * 참여 점검.
 *
 * "요즘 참여가 준 것 같다" 를 눈으로 확인하려고 만든다. 회차별 인원과, 안 나온
 * 사람을 한 화면에서 본다.
 *
 * 안 나온 것은 두 가지다 — 미참을 누른 것과 아예 누르지 않은 것. 앞은 의사를
 * 밝힌 것이고 뒤는 화면에 들어오지도 않은 것이라, 운영에서 다루는 방법이
 * 다르다. 그래서 합치지 않고 따로 센다.
 */

export interface AttendanceRound {
  surveyId: string;
  executedAt: Date;
  attend: number;
  boarding: number;
  lateAttend: number;
  nonAttend: number;
  /** 연맹원 중 이 회차에 아무것도 누르지 않은 사람 수. */
  noReply: number;
}

export interface AttendanceMiss {
  userId: string;
  nickname: string;
  guildName: string | null;
  avatarUrl: string | null;
  /** 참여·부속·늦참을 합친 수. */
  attended: number;
  nonAttend: number;
  noReply: number;
}

export interface AttendanceReport {
  days: number;
  memberCount: number;
  rounds: AttendanceRound[];
  misses: AttendanceMiss[];
  /** 회차당 평균 참여 인원(참여+부속+늦참). */
  averageAttend: number;
  /** 바로 앞 같은 길이의 기간. 늘었는지 줄었는지 견주려고 같이 가져온다. */
  previous: { rounds: number; averageAttend: number } | null;
}

interface RoundRow extends RowDataPacket {
  id: string;
  executed_at: Date;
  a: number;
  b: number;
  l: number;
  n: number;
  voted: number;
}

const ROUND_SQL =
  "SELECT s.id, s.executed_at, " +
  "  SUM(h.voting_type = 'attend') AS a, SUM(h.voting_type = 'boarding') AS b, " +
  "  SUM(h.voting_type = 'late_attend') AS l, SUM(h.voting_type = 'non_attend') AS n, " +
  "  COUNT(h.id) AS voted " +
  "FROM survey s " +
  // 탈퇴한 사람의 옛 표는 세지 않는다. 지금 연맹의 참여를 보는 것이다.
  "LEFT JOIN survey_history h ON h.survey_id = s.id " +
  "  AND h.user_id IN (SELECT id FROM user WHERE status = 1) " +
  "WHERE s.executed_at >= ? AND s.executed_at <= ? " +
  "GROUP BY s.id, s.executed_at ORDER BY s.executed_at";

async function roundsBetween(from: Date, to: Date): Promise<RoundRow[]> {
  const [rows] = await pool.query<RoundRow[]>(ROUND_SQL, [from, to]);
  return rows;
}

const attendedIn = (row: RoundRow) => Number(row.a) + Number(row.b) + Number(row.l);

const average = (rows: RoundRow[]) =>
  rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + attendedIn(row), 0) / rows.length;

export async function getAttendanceReport(days: number): Promise<AttendanceReport> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const previousFrom = new Date(from.getTime() - days * 86_400_000);

  const [[memberRow]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM user WHERE status = 1",
  );
  const memberCount = Number(memberRow.total);

  const [rows, previousRows] = await Promise.all([
    roundsBetween(from, to),
    roundsBetween(previousFrom, from),
  ]);

  const [missRows] = await pool.query<RowDataPacket[]>(
    "SELECT u.id, u.user_nickname, u.user_discord_id, u.discord_avatar, g.name AS guild_name, " +
      "  SUM(h.voting_type IN ('attend', 'boarding', 'late_attend')) AS attended, " +
      "  SUM(h.voting_type = 'non_attend') AS non_attend, COUNT(h.id) AS voted " +
      "FROM user u " +
      "LEFT JOIN guild g ON g.id = u.guild_id " +
      "LEFT JOIN survey_history h ON h.user_id = u.id AND h.survey_id IN " +
      "  (SELECT id FROM survey WHERE executed_at >= ? AND executed_at <= ?) " +
      "WHERE u.status = 1 GROUP BY u.id, u.user_nickname, u.user_discord_id, u.discord_avatar, g.name",
    [from, to],
  );

  const misses = missRows
    .map((row) => ({
      userId: String(row.id),
      nickname: row.user_nickname as string,
      guildName: (row.guild_name as string | null) ?? null,
      avatarUrl: avatarUrl(
        row.user_discord_id as string,
        (row.discord_avatar as string | null) ?? null,
      ),
      attended: Number(row.attended),
      nonAttend: Number(row.non_attend),
      noReply: rows.length - Number(row.voted),
    }))
    // 한 번도 빠지지 않은 사람은 볼 일이 없다.
    .filter((row) => row.nonAttend + row.noReply > 0)
    .sort((x, y) => y.noReply - x.noReply || y.nonAttend - x.nonAttend);

  return {
    days,
    memberCount,
    rounds: rows.map((row) => ({
      surveyId: String(row.id),
      executedAt: row.executed_at,
      attend: Number(row.a),
      boarding: Number(row.b),
      lateAttend: Number(row.l),
      nonAttend: Number(row.n),
      noReply: memberCount - Number(row.voted),
    })),
    misses,
    averageAttend: average(rows),
    previous:
      previousRows.length === 0
        ? null
        : { rounds: previousRows.length, averageAttend: average(previousRows) },
  };
}
