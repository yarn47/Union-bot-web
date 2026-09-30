"use server";

import { auth } from "@/auth";
import { logReferenceOpen } from "@/lib/referenceLog";

/** 홈의 참고 자료에 있는 표. 화면에서 온 값을 그대로 적지 않으려고 여기서 막는다. */
const CARDS = ["gb", "ec", "hunt"];

/*
 * 참고 자료 팝업을 연 것을 남긴다.
 *
 * 화면은 이 결과를 기다리지 않는다 — 기록 때문에 표가 늦게 열리면 안 된다.
 * 실패해도 조용히 넘긴다. 못 남긴 기록 하나보다 안 열리는 표가 나쁘다.
 */
export async function logReferenceOpenAction(cardKey: string): Promise<void> {
  if (!CARDS.includes(cardKey)) return;
  try {
    const session = await auth();
    if (!session?.user?.dbUserId) return;
    await logReferenceOpen(cardKey, {
      userId: session.user.dbUserId,
      nickname: session.user.nickname ?? null,
    });
  } catch {
    // 기록이 빠지는 것은 화면을 막을 일이 아니다.
  }
}
