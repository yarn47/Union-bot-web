import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { getUserByDiscordId } from "@/lib/queries";
import { rememberDiscordAvatar } from "@/lib/memberQueries";
import { fetchGuildMembership } from "@/lib/discordRoles";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // guilds.members.read 는 관리자 메뉴 노출 여부를 디스코드 역할로 판단하기
      // 위해 필요하다. 추가 시점부터 기존 사용자도 동의 화면을 한 번 더 본다.
      authorization: {
        params: { scope: "identify email guilds.members.read" },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ profile, account }) {
      if (!profile?.id) return false;
      // Only members already registered via the bot's #회원등록 command
      // (user.status = 1) may sign in — same gate as get_user_data().
      const dbUser = await getUserByDiscordId(profile.id as string);
      if (!dbUser) return "/login?error=unregistered";

      /*
       * 봇의 !탈퇴 를 거친 사람은 위에서 걸린다. 디스코드를 그냥 나가 버린
       * 사람은 DB 에 손이 닿지 않아 계속 회원으로 남으므로, 아직 서버에 있는지
       * 디스코드에 직접 물어본다.
       *
       * 조회가 안 될 때(null)는 막지 않는다. 디스코드가 잠깐 느리다고 멀쩡한
       * 회원이 투표 시간에 못 들어오는 편이 더 나쁘다.
       */
      if (account?.access_token) {
        const { inGuild } = await fetchGuildMembership(account.access_token);
        if (inGuild === false) return "/login?error=left";
      }
      return true;
    },
    async jwt({ token, profile, account }) {
      /*
       * 프로필 사진은 로그인할 때만 받을 수 있는데, 세션이 들어올 때마다 연장돼
       * 사진 기능 전부터 로그인해 둔 사람은 로그아웃될 일이 없다. 로그인하며 사진을
       * 적은 세션에만 표시를 남기고, 표시가 없는 세션은 null 을 돌려 한 번 풀어낸다.
       * 한 사람에게 한 번뿐이다 — 다시 로그인하면 표시가 생긴다.
       */
      if (profile?.id) token.profileSaved = true;
      else if (token.profileSaved !== true) return null;

      // account 는 최초 로그인 때만 온다. 역할은 그때 한 번 확인해 토큰에 담고,
      // 이후 요청에서는 DB 조회 없이 그 값을 쓴다.
      if (account?.access_token) {
        token.isAdmin = (await fetchGuildMembership(account.access_token)).isAdmin;
      }

      /*
       * 프로필 사진은 로그인할 때만 디스코드가 알려 준다. 추첨 화면에서 이름
       * 옆에 얼굴을 보여주려면 어딘가 적어 두어야 하므로 이때 한 번 적는다.
       * 웹 앱에는 봇 토큰이 없어 나중에 따로 물어볼 방법이 없다.
       */
      if (profile?.id) {
        const avatar = (profile as { avatar?: string | null }).avatar ?? null;
        await rememberDiscordAvatar(profile.id as string, avatar);
      }

      const discordId = (profile?.id as string | undefined) ?? (token.discordId as string | undefined);
      if (discordId) {
        const dbUser = await getUserByDiscordId(discordId);
        /*
         * 탈퇴 처리된 사람의 세션을 여기서 끊는다. 예전에는 찾지 못하면 토큰의
         * 옛 값을 그대로 두어서, !탈퇴 를 해도 이미 열려 있던 세션은 한 달 가까이
         * 그대로 살아 있었다. 세션은 요청마다 연장되므로 스스로 끝나지도 않는다.
         */
        if (!dbUser) return null;
        token.dbUserId = dbUser.id;
        token.discordId = dbUser.user_discord_id;
        token.nickname = dbUser.user_nickname;
        token.guildId = dbUser.guild_id;
        token.permission = dbUser.permission;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.dbUserId) {
        session.user.dbUserId = token.dbUserId as string;
        session.user.discordId = token.discordId as string;
        session.user.nickname = token.nickname as string;
        session.user.guildId = token.guildId as string;
        session.user.permission = token.permission as string;
        session.user.isAdmin = token.isAdmin === true;
      }
      return session;
    },
  },
});
