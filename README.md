# StockAI Pro

한국 주식 AI 분석 비서 — 내 룰로 분석하는 AI 주식 비서

## 구조

- `index.html` — 메인 앱 (단일 파일)
- `admin.html` — 운영자 대시보드 (라이선스 키 발급/관리)
- `cloudflare-worker.js` — Cloudflare Worker 프록시 코드 (별도 배포)
- `og-image.svg` — 카카오/페이스북 공유 이미지
- `DEPLOY.md` — 배포 가이드 (Worker → GitHub Pages → 도메인)

## 빠른 시작

### 사용자
1. GitHub Pages URL 접속
2. 첫 화면 디스클레이머 동의
3. 노란 배너의 "🔑 개인 API 키" 클릭 → Anthropic Console에서 발급한 키 입력
4. 즉시 모든 AI 기능 사용 가능

### 운영자 (정식 출시)
`DEPLOY.md` 7단계 참고 — Cloudflare Worker 배포 후 사용자 키 등록 불필요

## 라이선스
사내 사용

## 문의
dev@maeulhang.kr
