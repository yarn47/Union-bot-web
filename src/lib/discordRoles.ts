const ROLE_API = "https://discord.com/api/v10/users/@me/guilds";

/*
 * 로그인한 사람이 우리 디스코드 서버에 남아 있는지, 그리고 관리자 역할
 * (부대장·대장)을 가졌는지.
 *
 * OAuth 의 guilds.members.read 권한으로 본인 길드 멤버 정보를 읽는다. 로그인
 * 시점에 한 번만 확인해 세션에 담으므로, 디스코드에서 역할을 바꾸면 다시
 * 로그인해야 반영된다.
 */
export interface GuildMembership {
  /** 아직 디스코드 서버에 남아 있는지. 조회 자체가 안 되면 판단하지 않는다. */
  inGuild: boolean | null;
  isAdmin: boolean;
}

/**
 * 로그인한 사람의 길드 멤버 정보를 한 번 읽어 두 가지를 판단한다.
 *
 * 남아 있는지 — 디스코드를 그냥 나가 버린 사람은 봇의 !탈퇴 를 거치지 않아
 * DB 에는 계속 회원으로 남는다. 그 상태로도 로그인이 되던 것을 여기서 막는다.
 * 나간 사람에게는 디스코드가 404 를 준다.
 *
 * 관리자인지 — 부대장·대장 역할을 가졌는지.
 *
 * 조회가 실패하면 inGuild 를 null 로 둔다. 디스코드가 잠깐 느리거나 설정이
 * 비어 있을 때 멀쩡한 회원을 내쫓지 않기 위해서다. 반대로 관리자 여부는
 * 실패하면 거짓으로 본다 — 모를 때 권한을 열어 주는 쪽으로 기울면 안 된다.
 */
export async function fetchGuildMembership(accessToken: string): Promise<GuildMembership> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return { inGuild: null, isAdmin: false };

  const adminRoleIds = (process.env.DISCORD_ADMIN_ROLE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  try {
    const res = await fetch(`${ROLE_API}/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    // 나갔거나 애초에 들어온 적 없는 사람.
    if (res.status === 404) return { inGuild: false, isAdmin: false };
    if (!res.ok) return { inGuild: null, isAdmin: false };
    const member = (await res.json()) as { roles?: string[] };
    return {
      inGuild: true,
      isAdmin: (member.roles ?? []).some((role) => adminRoleIds.includes(role)),
    };
  } catch {
    return { inGuild: null, isAdmin: false };
  }
}
