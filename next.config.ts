import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      /*
       * 서버 액션 본문은 기본이 1MB 다. 거점전 스크린샷은 보통 2~3MB 라
       * 서버에 닿기도 전에 잘려 500 이 난다.
       *
       * 업로드에서 받아 주는 원본이 12MB 이므로 그보다 조금 크게 잡는다 —
       * multipart 로 보낼 때 경계선과 머리말이 몇십 KB 더 붙는다. 사진은
       * 서버에서 곧바로 줄여 저장하므로 이 크기로 쌓이지는 않는다.
       */
      bodySizeLimit: "13mb",
    },
  },
};

export default nextConfig;
