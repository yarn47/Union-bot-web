"use server";

import { requireAdmin } from "@/lib/adminAuth";
import { type PastSurveyRow, getPastSurveys } from "@/lib/adminQueries";

const PAGE_SIZE = 15;

export async function fetchPastSurveys(
  page: number,
): Promise<{ rows: PastSurveyRow[]; total: number; pageSize: number }> {
  await requireAdmin();
  const { rows, total } = await getPastSurveys(page, PAGE_SIZE);
  return { rows, total, pageSize: PAGE_SIZE };
}

/* 회차 하나의 원본 ↔ 확정 명단 비교 */
export async function fetchRosterComparison(surveyId: string) {
  await requireAdmin();
  const { getRosterComparison } = await import("@/lib/adminQueries");
  return getRosterComparison(surveyId);
}

/* 비교 탭 회차 목록. 운영 중인 회차도 포함한다. */
export async function fetchComparableSurveys(page: number) {
  await requireAdmin();
  const { getComparableSurveys } = await import("@/lib/adminQueries");
  const { rows, total } = await getComparableSurveys(page, PAGE_SIZE);
  return { rows, total, pageSize: PAGE_SIZE };
}

/* 거절된 투표 기록. 성공한 표는 survey_history 에 있으므로 여기엔 실패만 쌓인다. */
export async function fetchVoteFailures() {
  await requireAdmin();
  const { getVoteFailures } = await import("@/lib/voteLog");
  return getVoteFailures(100);
}

/* 홈의 참고 자료를 누가 열었는지. 기록은 열 때마다 한 줄씩 쌓인다. */
export async function fetchReferenceLog() {
  await requireAdmin();
  const { getReferenceLog } = await import("@/lib/referenceLog");
  return getReferenceLog(100);
}
