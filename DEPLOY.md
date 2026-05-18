# 🚀 StockAI Pro 배포 가이드 (Step-by-Step)

## 📋 총 소요 시간: 1~2시간 (도메인 DNS 전파 제외)

---

## 1️⃣ Cloudflare Worker 배포 (30분)

### 1.1 Cloudflare 계정 가입
1. https://dash.cloudflare.com/sign-up — 이메일·비밀번호로 가입 (무료)
2. 이메일 인증

### 1.2 Worker 생성
1. 대시보드 → 좌측 메뉴 **Workers & Pages**
2. **Create application** 클릭 → **Create Worker**
3. 이름: `stockai-proxy` (또는 원하는 이름)
4. **Deploy** 클릭 (기본 코드로 일단 배포)

### 1.3 Worker 코드 교체
1. 방금 만든 워커 클릭 → **Edit code**
2. 기본 코드 모두 삭제
3. `cloudflare-worker.js` 파일 내용 전체 복사 → 붙여넣기
4. 우측 상단 **Deploy** 클릭

### 1.4 환경 변수 등록
1. Worker 페이지 → **Settings** → **Variables**
2. **Add variable** 클릭:
   - 이름: `ANTHROPIC_API_KEY`
   - 값: Anthropic 콘솔(https://console.anthropic.com)에서 발급한 키
   - **Encrypt** 체크 ✓
3. **Add variable** 다시:
   - 이름: `ADMIN_SECRET`
   - 값: 랜덤 32자 이상 문자열 (예: `K9j2P3mX...`)
   - **Encrypt** 체크 ✓
4. **Save**

### 1.5 KV Namespace 생성
1. 좌측 메뉴 **Workers & Pages** → **KV**
2. **Create namespace** 클릭
3. 이름: `LICENSE_KV`
4. **Add**
5. 다시 Worker 페이지 → **Settings** → **Variables** → **KV Namespace Bindings**
6. **Add binding**:
   - Variable name: `LICENSE_KV`
   - KV namespace: 방금 만든 LICENSE_KV 선택
7. **Save and deploy**

### 1.6 Worker URL 확인
- 배포된 URL: `https://stockai-proxy.{your-account}.workers.dev`
- 또는 Custom Domain 설정 가능 (1.7 참고)
- 헬스체크: 브라우저에서 `URL/health` 접속 → `{"ok":true,...}` 응답 확인

### 1.7 (선택) 커스텀 도메인 연결
1. Worker → **Settings** → **Triggers** → **Custom Domains**
2. **Add Custom Domain** 클릭
3. `api.stockai.maeulhang.kr` 입력
4. (사전 조건: 도메인이 Cloudflare DNS 사용 중이어야 함)

---

## 2️⃣ 앱 코드에 Worker URL 등록 (5분)

### 옵션 A: 모든 사용자 자동 적용 (권장)
`주식AI비서.html` 파일에서 다음 위치 찾기:

```javascript
window.WorkerProxy = (function(){
  const KEY_URL = 'sai_worker_url';
  function getWorkerUrl(){ return localStorage.getItem(KEY_URL) || ''; }
```

→ 다음으로 변경:
```javascript
window.WorkerProxy = (function(){
  const KEY_URL = 'sai_worker_url';
  const DEFAULT_URL = 'https://stockai-proxy.your-account.workers.dev';  // ← 본인 URL
  function getWorkerUrl(){ return localStorage.getItem(KEY_URL) || DEFAULT_URL; }
```

### 옵션 B: 개별 PC에서 콘솔로 설정
브라우저 F12 → Console:
```javascript
localStorage.setItem('sai_worker_url', 'https://stockai-proxy.your-account.workers.dev');
```

---

## 3️⃣ 입금 계좌 정보 코드 업데이트 (5분)

`주식AI비서.html`에서 다음 위치 찾기:
```javascript
const BANK = { bank:'국민은행', account:'123-456-789012', holder:'(주)마을항해' };
```

→ 실제 정보로 변경:
```javascript
const BANK = { bank:'국민은행', account:'실제계좌번호', holder:'실제예금주' };
```

---

## 4️⃣ 사업자 등록 (1일, 무료)

### 4.1 홈택스 사업자등록 (개인사업자 기준)
1. https://www.hometax.go.kr 접속
2. **신청·제출** → **사업자등록 신청·정정·휴폐업** → **사업자등록 신청 (개인)**
3. 입력:
   - 업종: 정보통신업 (소프트웨어 개발 및 공급업)
   - 종목: 응용 소프트웨어 개발 및 공급업 (KSIC 58221)
   - 사업장 주소: 자택 또는 사무실 주소
4. 제출 → 영업일 1일 내 발급

### 4.2 통신판매업 신고 (관할 지자체)
1. 사업자등록 완료 후
2. 정부24 (https://www.gov.kr) → **통신판매업 신고**
3. 사업자등록증·도메인 정보·결제계좌 입력
4. 발급 비용: 면허세 ~30,000원

### 4.3 코드에 사업자 정보 업데이트
이용약관 모달 마지막 부분 찾기:
```html
운영자: (주)마을항해 · 사업자등록번호 [추후 등록]
```

→ 실제 번호 입력:
```html
운영자: (주)마을항해 · 사업자등록번호 123-45-67890
```

---

## 5️⃣ GitHub Pages 배포 (30분)

### 5.1 GitHub 저장소 생성
1. https://github.com/new
2. 이름: `stockai-app`
3. **Public** 선택 (Pages 사용 위해)
4. **Create repository**

### 5.2 파일 업로드
저장소에 다음 파일 업로드 (`upload files` 또는 git push):
- `주식AI비서.html` → `index.html`로 이름 변경
- `og-image.svg`
- `cloudflare-worker.js` (Worker 코드 보관용)
- `관리자_대시보드.html` (관리자만 접근, 별도 폴더로 권장)
- `테스트.html` (선택)

### 5.3 GitHub Pages 활성화
1. 저장소 → **Settings** → **Pages**
2. Source: `main` branch / `(root)` 폴더
3. **Save**
4. 약 1분 후 `https://{username}.github.io/stockai-app/` 접속 확인

### 5.4 (선택) 커스텀 도메인
1. 저장소 → **Settings** → **Pages**
2. Custom domain: `stockai.maeulhang.kr`
3. **Save** + **Enforce HTTPS** 체크
4. Cloudflare DNS에서 CNAME 추가:
   - Name: `stockai`
   - Target: `{username}.github.io`
   - Proxy: ON (오렌지 구름)

---

## 6️⃣ 도메인 연결 (10분 + DNS 전파 1~24시간)

### 6.1 Cloudflare DNS 설정
도메인을 Cloudflare DNS로 사용 중이면:
1. Cloudflare 대시보드 → 도메인 선택 → **DNS**
2. CNAME 추가:
   - 메인 사이트: `stockai` → `{username}.github.io`
   - API: `api.stockai` → `stockai-proxy.{your}.workers.dev`

### 6.2 SSL 자동 설정
- Cloudflare가 자동으로 무료 SSL 발급 (Let's Encrypt)
- 일반적으로 10분 내 활성화

---

## 7️⃣ 최종 점검 체크리스트

### 운영 시작 전 확인
- [ ] Worker `/health` 접속 → `ok:true` 응답
- [ ] 앱에서 AI 분석 실행 → Worker 경유 정상 동작
- [ ] 결제 모달에서 실제 BANK 정보 표시
- [ ] 이용약관 모달에 실제 사업자등록번호 표시
- [ ] 모바일에서 직접 접속 → 가로 스크롤 0
- [ ] 다크모드 토글 정상 작동
- [ ] og-image.svg 카카오톡 공유 미리보기 확인

### 운영 시작 후 (관리자 대시보드)
- [ ] `관리자_대시보드.html` 접속 → Worker URL + ADMIN_SECRET 입력
- [ ] 자기 자신 키 1개 발급 테스트 → PRO 활성화 확인
- [ ] 발급 → 운영자 PC 백업 자동 저장 확인 ([3-B] 카드)

---

## 💰 예상 비용 (월간)

| 항목 | 비용 | 비고 |
|---|---|---|
| Cloudflare Worker | $0 | 10만 요청/일 무료 |
| Cloudflare KV | $0 | 10만 read/일 무료 |
| Anthropic API | $300~1000 | 사용자 수 × 분석 횟수 |
| GitHub Pages | $0 | 100GB/월 무료 |
| 도메인 | $1.67 | 연 $20 / 12개월 |
| **합계** | **~$300~1000** | 사용자 100명 PRO 가정 |

### 수익 모델 (예시)
- PRO 100명 × 19,900원 = 1,990,000원/월
- VIP 10명 × 29,900원 = 299,000원/월
- **합계 수익**: 약 2,290,000원/월
- **운영 비용**: 약 300,000원/월
- **순이익**: 약 2,000,000원/월 (BEP 30명 PRO)

---

## 📞 운영자 지원

문의: dev@maeulhang.kr / sadad1052@naver.com
