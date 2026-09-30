/* 서버가 시작될 때 한 번 실행된다. DB 준비처럼 요청 전에 끝나야 하는 일을 여기서 한다. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureFinalTable } = await import("@/lib/adminQueries");
  const { ensureVoteFailureTable } = await import("@/lib/voteLog");
  const { ensureSpecTables } = await import("@/lib/specQueries");
  const { ensureMemberProfileColumn } = await import("@/lib/memberQueries");
  await ensureFinalTable();
  await ensureVoteFailureTable();
  await ensureSpecTables();
  await ensureMemberProfileColumn();
  const { ensureDrawTables } = await import("@/lib/drawQueries");
  await ensureDrawTables();
  const { ensureBattleTables } = await import("@/lib/battleQueries");
  await ensureBattleTables();
  const { ensureReferenceLogTable } = await import("@/lib/referenceLog");
  await ensureReferenceLogTable();
}
