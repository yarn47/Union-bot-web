"use client";

import { useRef, useState, useTransition } from "react";
import type { CommentActionResult } from "../actions";
import styles from "../battle.module.css";

/*
 * 사진 올리기. 자리 사진과 거점 지도가 같이 쓴다.
 *
 * 공개 여부는 올릴 때 함께 넘긴다. 기본은 꺼짐 — 로그인한 사람만 본다.
 * 켜면 주소를 아는 사람은 누구나 받을 수 있으므로 밖에 나가도 되는 사진만
 * 켠다. 이미 올린 사진의 공개 여부만 바꾸는 것은 파일을 건드리지 않는다.
 */
export function ImageUploader({
  label,
  hasImage,
  isPublic,
  upload,
  clear,
  setPublic,
  onError,
}: {
  /** 확인 창에 들어갈 이름. "1번 자리 사진", "3거점 지도" 같은 것. */
  label: string;
  hasImage: boolean;
  isPublic: boolean;
  upload: (form: FormData, isPublic: boolean) => Promise<CommentActionResult>;
  clear: () => Promise<void>;
  setPublic: (isPublic: boolean) => Promise<void>;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(isPublic);
  const [isPending, startTransition] = useTransition();

  function send() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    onError("");
    startTransition(async () => {
      /* 사진이 서버 액션 본문 한도를 넘으면 우리 코드가 돌기도 전에 요청이
         끊긴다. 그때는 반환값이 아니라 예외로 오므로 여기서 받아 준다 —
         받지 않으면 화면에 아무 말도 뜨지 않고 조용히 실패한다. */
      try {
        const result = await upload(form, open);
        if (result.ok) {
          setFile(null);
          if (input.current) input.current.value = "";
        } else {
          onError(result.message);
        }
      } catch {
        onError("사진을 보내지 못했습니다. 파일이 너무 크거나 연결이 끊겼습니다.");
      }
    });
  }

  return (
    <div className={styles.imageField}>
      <div className={styles.imageRow}>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={styles.file}
          aria-label={`${label} 고르기`}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className={styles.miniButton}
          disabled={!file || isPending}
          onClick={send}
        >
          {isPending ? "올리는 중…" : hasImage ? "바꾸기" : "올리기"}
        </button>
      </div>

      {/*
        사진이 몇 MB 라 줄이고 보관함에 넣기까지 몇 초가 걸린다. 그동안 아무
        표시가 없으면 눌린 건지 알 수 없어, 같은 사진을 또 올리게 된다.

        서버 액션은 올라간 양을 알려 주지 않으므로 몇 %인지는 보여 줄 수 없다.
        도는 막대로 "하는 중"만 알린다.
      */}
      {isPending && (
        <div className={styles.progress} role="status" aria-label="사진 올리는 중">
          <span className={styles.progressBar} />
        </div>
      )}
      <div className={styles.imageRow}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={open}
            disabled={isPending}
            onChange={(event) => {
              const next = event.target.checked;
              setOpen(next);
              // 이미 사진이 있으면 켜고 끄는 즉시 반영한다. 아직 없으면 다음에
              // 올릴 사진에 이 값이 함께 넘어간다.
              if (!hasImage) return;
              onError("");
              startTransition(async () => {
                try {
                  await setPublic(next);
                } catch {
                  setOpen(!next);
                  onError("바꾸지 못했습니다. 새로 고침 후 다시 시도해 주세요.");
                }
              });
            }}
          />
          로그인 없이도 보이기
        </label>
        {hasImage && (
          <button
            type="button"
            className={styles.dangerButton}
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(`${label}을 지웁니다. 되돌릴 수 없습니다.`)) return;
              onError("");
              startTransition(async () => {
                try {
                  await clear();
                } catch {
                  onError("지우지 못했습니다. 새로 고침 후 다시 시도해 주세요.");
                }
              });
            }}
          >
            사진 지우기
          </button>
        )}
      </div>
    </div>
  );
}
