import { bandsOf, memberArt, memberLabel, memberRole, ROLES, SHEET, sheetRows, type Formation } from "./formation";
import { roleIconDataUrl } from "./roleIcons";

/*
 * 부대표를 그림으로 그린다. 화면과 같은 모양이어야 하므로 색과 크기는 SHEET
 * 하나에서 가져온다.
 *
 * 그림은 디스코드에 그대로 올라간다. 어두운 판으로 두면 거기 붙었을 때 혼자
 * 튀지 않고, 직업 아이콘이 흰 선화라 색을 뒤집지 않고 그대로 얹을 수 있다.
 */

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** 같은 아이콘이 여러 칸에 나오므로 한 번만 받아 둔다. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  let pending = cache.get(src);
  if (!pending) {
    pending = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      // 아이콘 하나가 없다고 표 전체를 못 그리면 안 된다.
      image.onerror = () => resolve(null);
      image.src = src;
    });
    cache.set(src, pending);
  }
  return pending;
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) =>
    blob ? resolve(blob) : reject(new Error("이미지를 만들 수 없습니다.")), "image/png"));
}

export async function formationImage(formation: Formation): Promise<Blob> {
  await document.fonts.ready;
  const rows = sheetRows(formation);
  // 부대 수는 인원이 정한다. 100 인이면 여섯 부대다.
  const count = formation.parties.length;
  /*
   * 화면과 같이 두 단으로 접는다. 한 줄로 늘어놓던 때는 여섯 부대가 2136x332 —
   * 디스코드가 550px 상자에 맞춰 줄이면 글자 줄 높이가 8px 이라 눌러 열지
   * 않고는 읽을 수 없었다. 3x2 는 1068x664 로 같은 상자를 꽉 채운다.
   */
  const bands = bandsOf(count);
  const bandHeight = SHEET.headerHeight + SHEET.rowHeight * rows;
  const width = SHEET.columnWidth * bands[0].length * 2;
  const height = bandHeight * bands.length;
  /* 부대가 그려질 왼쪽 위. 단을 접었으므로 가로로도 세로로도 밀린다. */
  const origin = new Map<number, { x: number; y: number }>();
  bands.forEach((band, b) => band.forEach((party, slot) => {
    origin.set(party, { x: slot * SHEET.columnWidth * 2, y: b * bandHeight });
  }));

  // 그릴 그림을 미리 다 받아 둔다. 그리는 도중에는 기다릴 수 없다.
  const art = formation.parties.flat().map((member) => memberArt(member));
  const roleSources = new Map<string, string>();
  for (const member of formation.parties.flat()) {
    const role = memberRole(member);
    if (role && !roleSources.has(role)) roleSources.set(role, roleIconDataUrl(role, SHEET.text));
  }
  await Promise.all([
    ...art.flatMap((a) => (a ? [loadImage(a.icon), ...(a.mark ? [loadImage(a.mark.src)] : [])] : [])),
    ...[...roleSources.values()].map(loadImage),
  ]);
  const images = new Map<string, HTMLImageElement | null>();
  for (const a of art) {
    if (!a) continue;
    images.set(a.icon, await loadImage(a.icon));
    if (a.mark) images.set(a.mark.src, await loadImage(a.mark.src));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들 수 없습니다.");
  ctx.scale(2, 2);

  ctx.fillStyle = SHEET.panel;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  // 부대 머리글 — 위아래로 옅게 깎인 금속 판처럼.
  for (let party = 0; party < count; party++) {
    const { x, y } = origin.get(party) as { x: number; y: number };
    const gradient = ctx.createLinearGradient(0, y, 0, y + SHEET.headerHeight);
    gradient.addColorStop(0, SHEET.headerTop);
    gradient.addColorStop(1, SHEET.headerBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, SHEET.columnWidth * 2, SHEET.headerHeight);
    ctx.fillStyle = SHEET.headerText;
    ctx.textAlign = "center";
    ctx.font = `bold 14px ${SHEET.font}`;
    ctx.fillText(formation.names[party] ?? "", x + SHEET.columnWidth, y + 17);
    ctx.font = `12px ${SHEET.font}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(`(${formation.parties[party].filter(Boolean).length}명)`, x + SHEET.columnWidth, y + 32);
    ctx.globalAlpha = 1;
  }

  // 줄마다 옅은 명암. 눈이 가로줄을 따라가기 쉬워진다.
  ctx.fillStyle = SHEET.stripe;
  for (let band = 0; band < bands.length; band++) {
    for (let row = 1; row < rows; row += 2) {
      ctx.fillRect(0, band * bandHeight + SHEET.headerHeight + row * SHEET.rowHeight,
        width, SHEET.rowHeight);
    }
  }

  ctx.textAlign = "left";
  // 픽셀로 그린 계열 마크는 늘리면 뭉개진다.
  ctx.imageSmoothingEnabled = false;

  for (let party = 0; party < count; party++) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < 2; column++) {
        const member = formation.parties[party][row * 2 + column];
        if (!member) continue;
        const spot = origin.get(party) as { x: number; y: number };
        const left = spot.x + column * SHEET.columnWidth;
        const middle = spot.y + SHEET.headerHeight + (row + 0.5) * SHEET.rowHeight;
        const a = memberArt(member);
        let textLeft = left + 5;

        if (a) {
          const icon = images.get(a.icon);
          if (icon) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(icon, left + 5, middle - SHEET.iconSize / 2, SHEET.iconSize, SHEET.iconSize);
            ctx.imageSmoothingEnabled = false;
          }
          if (a.mark) {
            const mark = images.get(a.mark.src);
            const cx = left + 5 + SHEET.iconSize - 1;
            const cy = middle + SHEET.iconSize / 2 - 2;
            const radius = SHEET.markSize / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = SHEET.panel;
            ctx.fill();
            ctx.strokeStyle = a.mark.color;
            ctx.lineWidth = 1;
            ctx.stroke();
            if (mark) {
              ctx.save();
              ctx.clip();
              ctx.drawImage(mark, cx - 3.5, cy - 4, 7, 8);
              ctx.restore();
            }
          }
          textLeft = left + 5 + SHEET.iconSize + 6;
        }

        // 역할 그림은 오른쪽 끝에 고정한다. 이름이 길어 줄어들어도 이것은 남는다.
        const role = memberRole(member);
        const roleRoom = role ? SHEET.roleSize + 4 : 0;

        const label = memberLabel(member);
        const room = SHEET.columnWidth - (textLeft - left) - 5 - roleRoom;
        ctx.fillStyle = SHEET.text;
        ctx.font = `${SHEET.fontSize}px ${SHEET.font}`;
        const textWidth = ctx.measureText(label).width;
        if (textWidth > room) ctx.font = `${Math.max(8, SHEET.fontSize * room / textWidth)}px ${SHEET.font}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(textLeft, spot.y + SHEET.headerHeight + row * SHEET.rowHeight, room, SHEET.rowHeight);
        ctx.clip();
        ctx.fillText(label, textLeft, middle);
        ctx.restore();

        if (role) {
          const drawn = await loadImage(roleSources.get(role) as string);
          if (drawn) {
            ctx.drawImage(drawn, left + SHEET.columnWidth - 5 - SHEET.roleSize,
              middle - SHEET.roleSize / 2, SHEET.roleSize, SHEET.roleSize);
          }
        }
      }
    }
  }

  // 격자와 테두리.
  ctx.strokeStyle = SHEET.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let band = 0; band < bands.length; band++) {
    const top = band * bandHeight;
    for (let column = 1; column < bands[band].length * 2; column++) {
      const x = column * SHEET.columnWidth + 0.5;
      ctx.moveTo(x, top + SHEET.headerHeight);
      ctx.lineTo(x, top + bandHeight);
    }
    for (let row = 1; row <= rows; row++) {
      const y = top + SHEET.headerHeight + row * SHEET.rowHeight + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = SHEET.border;
  ctx.lineWidth = 2;
  // 단과 단 사이. 윗단이 끝났다는 것이 보여야 아랫단을 다른 부대로 읽는다.
  ctx.beginPath();
  for (let band = 1; band < bands.length; band++) {
    ctx.moveTo(0, band * bandHeight);
    ctx.lineTo(width, band * bandHeight);
  }
  ctx.stroke();
  ctx.strokeRect(1, 1, width - 2, height - 2);
  ctx.beginPath();
  for (let column = 1; column < count; column++) {
    const x = column * SHEET.columnWidth * 2 + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SHEET.headerHeight);
  }
  ctx.moveTo(0, SHEET.headerHeight + 0.5);
  ctx.lineTo(width, SHEET.headerHeight + 0.5);
  ctx.stroke();

  return toPng(canvas);
}

/*
 * 역할 그림이 무엇을 뜻하는지 알려 주는 쪽지.
 *
 * 그림만 붙은 표를 처음 받아 보면 깃발이 불퇴인지 점령인지 알 수 없다. 표와
 * 같은 색과 결로 그려서 디스코드에 나란히 올릴 수 있게 한다.
 */
const LEGEND = { columns: 5, cellWidth: 152, cellHeight: 56, headerHeight: 36, iconSize: 28, pad: 13 };

export async function roleLegendImage(): Promise<Blob> {
  await document.fonts.ready;
  const rows = Math.ceil(ROLES.length / LEGEND.columns);
  const width = LEGEND.cellWidth * LEGEND.columns;
  const height = LEGEND.headerHeight + LEGEND.cellHeight * rows;

  const sources = ROLES.map((role) => roleIconDataUrl(role, SHEET.text));
  const drawn = await Promise.all(sources.map(loadImage));

  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들 수 없습니다.");
  ctx.scale(2, 2);
  ctx.fillStyle = SHEET.panel;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  const gradient = ctx.createLinearGradient(0, 0, 0, LEGEND.headerHeight);
  gradient.addColorStop(0, SHEET.headerTop);
  gradient.addColorStop(1, SHEET.headerBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, LEGEND.headerHeight);
  ctx.fillStyle = SHEET.headerText;
  ctx.textAlign = "center";
  ctx.font = `bold 15px ${SHEET.font}`;
  ctx.fillText("역할 그림", width / 2, LEGEND.headerHeight / 2 + 1);

  ctx.fillStyle = SHEET.stripe;
  for (let row = 1; row < rows; row += 2) {
    ctx.fillRect(0, LEGEND.headerHeight + row * LEGEND.cellHeight, width, LEGEND.cellHeight);
  }

  ctx.textAlign = "left";
  for (const [index, role] of ROLES.entries()) {
    const left = (index % LEGEND.columns) * LEGEND.cellWidth;
    const middle = LEGEND.headerHeight
      + (Math.floor(index / LEGEND.columns) + 0.5) * LEGEND.cellHeight;
    const image = drawn[index];
    if (image) {
      ctx.drawImage(image, left + LEGEND.pad, middle - LEGEND.iconSize / 2,
        LEGEND.iconSize, LEGEND.iconSize);
    }
    ctx.fillStyle = SHEET.text;
    ctx.font = `15px ${SHEET.font}`;
    ctx.fillText(role, left + LEGEND.pad + LEGEND.iconSize + 11, middle + 1);
  }

  ctx.strokeStyle = SHEET.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let column = 1; column < LEGEND.columns; column++) {
    const x = column * LEGEND.cellWidth + 0.5;
    ctx.moveTo(x, LEGEND.headerHeight);
    ctx.lineTo(x, height);
  }
  for (let row = 1; row < rows; row++) {
    const y = LEGEND.headerHeight + row * LEGEND.cellHeight + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = SHEET.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);
  ctx.beginPath();
  ctx.moveTo(0, LEGEND.headerHeight + 0.5);
  ctx.lineTo(width, LEGEND.headerHeight + 0.5);
  ctx.stroke();

  return toPng(canvas);
}

