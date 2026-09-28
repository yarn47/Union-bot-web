"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ReferenceModal } from "./ReferenceModal";
import {
  ACCESSORY_TABLES,
  ENHANCE_RATE_ROWS,
  buildAttackRows,
  buildDefenseRows,
  formatThousands,
} from "@/lib/referenceTables";
import styles from "./reference.module.css";

type OpenModal = "gb" | "ec" | "hunt" | null;
type EcTab = "acc" | "rate";

/*
 * 에다니아 내부 사냥터. 그림은 public/hunting 에 있는 고정 자료다 — 운영진이
 * 화면에서 올리는 것이 아니라 게시할 때 파일로 넣는다. 크기를 적어 두는 것은
 * 탭을 옮길 때 칸이 덜컥이지 않게 하려는 것이다.
 */
const HUNT_ZONES = [
  { key: "aphrodon", label: "아프로돈", width: 692, height: 584 },
  { key: "emesia", label: "에메시아", width: 620, height: 635 },
  { key: "magaia", label: "마가이아", width: 919, height: 922 },
  { key: "arethion", label: "아레시온", width: 612, height: 583 },
  { key: "voidekea", label: "보이데케아", width: 726, height: 522 },
] as const;

type HuntZone = (typeof HUNT_ZONES)[number]["key"];

const CARDS = [
  {
    key: "gb" as const,
    kicker: "REFERENCE 01",
    title: "공방합 구간 정보",
    description:
      "표기 공격력 395–450 구간의 보너스 공격력·몬스터 추가 공격력, 표기 방어력 481–531 구간의 보너스 피해 감소.",
  },
  {
    key: "ec" as const,
    kicker: "REFERENCE 02",
    title: "에크레타 악세사리 강화 정보",
    description: "반지·귀걸이·목걸이·허리띠의 단계별 수치와 강화 확률·기준 스택·필요 크론석.",
  },
  {
    key: "hunt" as const,
    kicker: "REFERENCE 03",
    title: "에다니아 내부 사냥터 정보",
    description:
      "아프로돈·에메시아·마가이아·아레시온·보이데케아의 의뢰 위치와 권장 공격력·방어력.",
  },
];

export function ReferenceSection() {
  const [open, setOpen] = useState<OpenModal>(null);
  const [ecTab, setEcTab] = useState<EcTab>("acc");
  const [huntZone, setHuntZone] = useState<HuntZone>("aphrodon");

  // 107 rows total; build once rather than on every render.
  const attackRows = useMemo(() => buildAttackRows(), []);
  const defenseRows = useMemo(() => buildDefenseRows(), []);

  return (
    <>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>참고 자료</h3>
      </div>

      <div className={styles.cardGrid}>
        {CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            className={styles.card}
            onClick={() => setOpen(card.key)}
          >
            <span className={styles.cardKicker}>{card.kicker}</span>
            <span className={styles.cardTitle}>{card.title}</span>
            <span className={styles.cardCta}>표 열기 →</span>
          </button>
        ))}
      </div>

      {open === "gb" && (
        <ReferenceModal
          kicker="REFERENCE 01"
          title="공방합 구간 정보"
          width={860}
          onClose={() => setOpen(null)}
        >
          <div className={styles.gbGrid}>
            <div className={styles.tableWrap}>
              <h3 className={styles.tableTitle}>보너스 공격력 및 몬스터 추가 공격력</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thLeft}>표기 공격력</th>
                    <th className={styles.th}>보너스 공격력</th>
                    <th className={styles.th}>몬스터 추가 공격력</th>
                  </tr>
                </thead>
                <tbody>
                  {attackRows.map((r) => (
                    <tr key={r.ap} className={styles.row}>
                      <td className={styles.tdLeft}>{r.ap}</td>
                      <td className={styles.td}>{r.bonus}</td>
                      <td className={styles.td}>{formatThousands(r.monster)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.tableWrap}>
              <h3 className={styles.tableTitle}>보너스 피해 감소</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thLeft}>표기 방어력</th>
                    <th className={styles.th}>보너스 피해 감소</th>
                  </tr>
                </thead>
                <tbody>
                  {defenseRows.map((r) => (
                    <tr key={r.dp} className={styles.row}>
                      <td className={styles.tdLeft}>{r.dp}</td>
                      <td className={styles.td}>{r.reduction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ReferenceModal>
      )}

      {open === "ec" && (
        <ReferenceModal
          kicker="REFERENCE 02"
          title="에크레타 악세사리 강화 정보"
          width={900}
          onClose={() => setOpen(null)}
          headerExtra={
            <>
              <button
                type="button"
                className={`${styles.tab} ${ecTab === "acc" ? styles.tabActive : ""}`}
                onClick={() => setEcTab("acc")}
              >
                단계별 수치
              </button>
              <button
                type="button"
                className={`${styles.tab} ${ecTab === "rate" ? styles.tabActive : ""}`}
                onClick={() => setEcTab("rate")}
              >
                강화 확률
              </button>
            </>
          }
        >
          {ecTab === "acc" ? (
            <>
              <div className={styles.accGrid}>
                {ACCESSORY_TABLES.map((t) => (
                  <div key={t.title} className={styles.tableWrap}>
                    <h3 className={styles.tableTitle}>{t.title}</h3>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.thLeft}>강화 단계</th>
                          <th className={styles.th}>공격력</th>
                          <th className={styles.th}>적중력</th>
                          <th className={styles.th}>피해감소</th>
                          <th className={styles.th}>회피력</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r) => (
                          <tr key={r.stage} className={styles.row}>
                            <td className={styles.tdStage}>{r.stage}</td>
                            <td className={styles.td}>{r.attack}</td>
                            <td className={styles.td}>{r.accuracy}</td>
                            <td className={styles.td}>{r.damageReduction}</td>
                            <td className={styles.td}>{r.evasion}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              <p className={styles.tableNote}>괄호 안은 히튼 적용 수치입니다.</p>
            </>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <h3 className={styles.tableTitle}>강화 확률</h3>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.thLeft}>강화 시도 단계</th>
                      <th className={styles.th}>기본 확률</th>
                      <th className={styles.th}>기준 스택</th>
                      <th className={styles.th}>적용 확률</th>
                      <th className={styles.th}>아그리스의 정수</th>
                      <th className={styles.th}>필요 크론석</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ENHANCE_RATE_ROWS.map((r) => (
                      <tr key={r.stage} className={styles.row}>
                        <td className={styles.tdStage}>{r.stage}</td>
                        <td className={styles.td}>{r.baseRate}</td>
                        <td className={styles.td}>{r.stack}</td>
                        <td className={styles.td}>{r.appliedRate}</td>
                        <td className={styles.td}>{r.agris}</td>
                        <td className={styles.td}>{formatThousands(r.cron)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.tableNote}>적용 확률은 기준 스택을 채웠을 때의 값입니다.</p>
            </>
          )}
        </ReferenceModal>
      )}

      {open === "hunt" && (
        <ReferenceModal
          kicker="REFERENCE 03"
          title="에다니아 내부 사냥터 정보"
          width={960}
          onClose={() => setOpen(null)}
          headerExtra={
            <>
              {HUNT_ZONES.map((zone) => (
                <button
                  key={zone.key}
                  type="button"
                  className={`${styles.tab} ${huntZone === zone.key ? styles.tabActive : ""}`}
                  onClick={() => setHuntZone(zone.key)}
                >
                  {zone.label}
                </button>
              ))}
            </>
          }
        >
          {HUNT_ZONES.filter((zone) => zone.key === huntZone).map((zone) => (
            <figure key={zone.key} className={styles.mapFigure}>
              {/* 게임 화면이라 글씨가 작다. 폰에서는 줄어들어 읽히지 않으므로
                  눌러서 원본 크기로 열 수 있게 한다. */}
              <a
                href={`/hunting/${zone.key}.webp`}
                target="_blank"
                rel="noreferrer"
                className={styles.mapLink}
              >
                <Image
                  src={`/hunting/${zone.key}.webp`}
                  alt={`${zone.label} 사냥터 지도`}
                  width={zone.width}
                  height={zone.height}
                  className={styles.mapImage}
                  sizes="(max-width: 960px) 100vw, 900px"
                />
              </a>
            </figure>
          ))}
          <p className={styles.tableNote}>
            그림을 누르면 원본 크기로 열립니다. 의뢰 창에 적힌 권장 공격력·방어력은 원활하게
            진행할 수 있는 기준입니다.
          </p>
        </ReferenceModal>
      )}
    </>
  );
}
