import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { signIn } from "@/auth";
import styles from "./login.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  unregistered:
    "등록되지 않은 계정이거나 비활성화 상태입니다. 운영진에게 문의해주세요.",
  AccessDenied:
    "등록되지 않은 계정이거나 비활성화 상태입니다. 운영진에게 문의해주세요.",
  left: "디스코드 서버에 없는 계정입니다. 다시 들어온 뒤 운영진에게 등록을 요청해주세요.",
};

// Only accept an internal relative path as the post-login destination —
// callbackUrl comes from a query param an attacker can set, so a bare
// "starts with /" (and not "//", which browsers treat as protocol-relative)
// check keeps this from becoming an open redirect.
function sanitizeCallbackUrl(callbackUrl: string | undefined): string {
  if (callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
    return callbackUrl;
  }
  return "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] ?? "로그인 중 오류가 발생했습니다." : null;
  const redirectTo = sanitizeCallbackUrl(callbackUrl);

  return (
    <main className={styles.main}>
      <ThemeToggle floating />
      {/* 홈 배너와 같은 그림이다. 바꿀 때는 번호를 올린다 — 같은 이름에 덮어쓰면
          이미 본 사람의 브라우저가 네 시간 동안 옛 그림을 들고 있다. */}
      <Image
        src="/Wallpaper-v2.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.backgroundImage}
      />
      <div className={styles.overlay} />

      <div className={styles.content}>
        <div className={styles.brandBlock}>
          <h1 className={styles.brand}>아시바당</h1>
          <p className={styles.subtitle}>거점전 투표와 연맹 정보를 한 곳에서.</p>
        </div>

        {errorMessage && <p className={styles.error}>{errorMessage}</p>}

        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo });
          }}
        >
          <button type="submit" className={styles.discordButton}>
            Discord로 로그인
          </button>
        </form>
      </div>
    </main>
  );
}
