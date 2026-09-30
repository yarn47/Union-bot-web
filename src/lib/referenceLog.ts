import type { RowDataPacket } from "mysql2/promise";
import { pool } from "@/lib/db";
import { avatarUrl } from "@/lib/memberQueries";

/*
 * 홈의 참고 자료 팝업을 누가 열었는지 남기는 기록.
 *
 * 공방합 표나 사냥터 지도를 실제로 보는 사람이 있는지, 새로 올린 자료가 읽히고
 * 있는지 알 방법이 없었다. 열 때마다 한 줄씩 남긴다 — 사람이 백몇 명이고 자주
 * 여는 것도 아니라 부담이 없다.
 *
 * 닉네임은 열 때의 것을 찍어 둔다. 나중에 연맹을 나가도 누가 봤는지는 남는다.
 */
export async function ensureReferenceLogTable(): Promise<void> {
  await pool.execute(
    "CREATE TABLE IF NOT EXISTS reference_open_log (" +
      "id bigint NOT NULL AUTO_INCREMENT, " +
      "card_key varchar(20) NOT NULL, " +
      "user_id bigint NULL, " +
      "nickname varchar(64) NULL, " +
      "opened_at datetime(6) NOT NULL, " +
      "PRIMARY KEY (id), " +
      "KEY idx_reference_card (card_key, opened_at), " +
      "KEY idx_reference_user (user_id))",
  );
}

export async function logReferenceOpen(
  cardKey: string,
  who: { userId: string | null; nickname: string | null },
): Promise<void> {
  await pool.execute(
    "INSERT INTO reference_open_log (card_key, user_id, nickname, opened_at) VALUES (?, ?, ?, ?)",
    [cardKey, who.userId, who.nickname, new Date()],
  );
}

export interface ReferenceCardCount {
  cardKey: string;
  opens: number;
  people: number;
  lastAt: Date | null;
}

export interface ReferencePerson {
  userId: string | null;
  nickname: string;
  avatarUrl: string | null;
  /** 표별 횟수. 아직 안 연 표는 0 이 아니라 아예 없다. */
  byCard: Record<string, number>;
  total: number;
  lastAt: Date;
}

export interface ReferenceOpenRow {
  id: string;
  cardKey: string;
  nickname: string | null;
  avatarUrl: string | null;
  openedAt: Date;
}

export interface ReferenceLog {
  cards: ReferenceCardCount[];
  people: ReferencePerson[];
  recent: ReferenceOpenRow[];
}

/*
 * 세 가지를 한 번에 가져온다 — 표마다 몇 번 열렸나, 사람마다 무엇을 열었나,
 * 최근에 누가 열었나. 관리자 화면 한 장에서 같이 보는 것이라 나눌 이유가 없다.
 */
export async function getReferenceLog(recentLimit = 100): Promise<ReferenceLog> {
  const [cardRows] = await pool.query<RowDataPacket[]>(
    "SELECT card_key, COUNT(*) AS opens, COUNT(DISTINCT user_id) AS people, MAX(opened_at) AS last_at " +
      "FROM reference_open_log GROUP BY card_key ORDER BY opens DESC",
  );

  /*
   * 사람별로 접는다. 먼저 사람·표로 세고 그 위에서 다시 합치는데, 바깥에서
   * COUNT 를 쓰면 표 가짓수가 세어진다 — 연 횟수는 안쪽 값을 더해야 한다.
   *
   * 얼굴은 유저 표에서 지금 값을 읽는다. 연맹을 나가 사라진 사람은 얼굴 없이
   * 찍어 둔 이름만 남는다.
   */
  const [personRows] = await pool.query<RowDataPacket[]>(
    "SELECT t.user_id, MAX(t.nickname) AS nickname, SUM(t.cnt) AS total, MAX(t.opened_at) AS last_at, " +
      "  GROUP_CONCAT(CONCAT(t.card_key, ':', t.cnt) SEPARATOR ',') AS cards, " +
      "  u.user_discord_id, u.discord_avatar " +
      "FROM (SELECT user_id, nickname, card_key, COUNT(*) AS cnt, MAX(opened_at) AS opened_at " +
      "      FROM reference_open_log GROUP BY user_id, nickname, card_key) t " +
      "LEFT JOIN user u ON u.id = t.user_id " +
      "GROUP BY t.user_id, u.user_discord_id, u.discord_avatar ORDER BY last_at DESC",
  );

  const [recentRows] = await pool.query<RowDataPacket[]>(
    "SELECT l.id, l.card_key, l.nickname, l.opened_at, u.user_discord_id, u.discord_avatar " +
      "FROM reference_open_log l LEFT JOIN user u ON u.id = l.user_id " +
      "ORDER BY l.opened_at DESC LIMIT ?",
    [recentLimit],
  );

  return {
    cards: cardRows.map((row) => ({
      cardKey: row.card_key as string,
      opens: Number(row.opens),
      people: Number(row.people),
      lastAt: (row.last_at as Date | null) ?? null,
    })),
    people: personRows.map((row) => {
      const byCard: Record<string, number> = {};
      for (const pair of String(row.cards ?? "").split(",")) {
        const [key, count] = pair.split(":");
        if (key) byCard[key] = Number(count);
      }
      return {
        userId: row.user_id === null ? null : String(row.user_id),
        nickname: (row.nickname as string | null) ?? "이름 없음",
        avatarUrl: row.user_discord_id
          ? avatarUrl(row.user_discord_id as string, (row.discord_avatar as string | null) ?? null)
          : null,
        byCard,
        total: Number(row.total),
        lastAt: row.last_at as Date,
      };
    }),
    recent: recentRows.map((row) => ({
      id: String(row.id),
      cardKey: row.card_key as string,
      nickname: (row.nickname as string | null) ?? null,
      avatarUrl: row.user_discord_id
        ? avatarUrl(row.user_discord_id as string, (row.discord_avatar as string | null) ?? null)
        : null,
      openedAt: row.opened_at as Date,
    })),
  };
}
