# 밥투게더 (boptogether)

캘린더에서 날짜를 골라 주문을 등록하고, 함께 먹을 사람들이 이름과 메뉴를 남긴 뒤,
주문자가 참여자별 정산금액과 입금 계좌를 관리할 수 있는 웹앱입니다.
최대 10명까지 한 주문에 참여할 수 있습니다.

순수 정적 사이트(HTML/CSS/JS) + [Supabase](https://supabase.com)(무료 Postgres DB)로
만들어져서, 별도 서버를 계속 켜둘 필요 없이 GitHub Pages에서 바로 돌아갑니다.

## 기능

- 캘린더에서 날짜 선택 후 주문 등록 (주문자이름 / 매장명 / 주문날짜 / 주문시간)
- 주문 상세 페이지에서 누구나 이름 / 메뉴를 입력해 참여 (최대 10명)
- 참여자별 정산금액 입력, 정산 계좌(은행명 / 예금주 / 계좌번호) 등록
- 참여자 삭제, 실시간 합계 표시

## 배포하기 (링크로 공유용, 최초 1회만 설정)

### 1. Supabase 프로젝트 만들기 (무료, 카드 등록 불필요)

1. [supabase.com](https://supabase.com) 접속 → GitHub 계정으로 로그인 → **New project** 생성
2. 왼쪽 메뉴 **SQL Editor** 클릭 → 이 저장소의 [`supabase/schema.sql`](./supabase/schema.sql)
   파일 내용을 전체 복사해서 붙여넣고 **Run** 실행 (테이블/보안 규칙이 한 번에 만들어져요)
3. 왼쪽 메뉴 **Settings → API** 에서 **Project URL** 과 **anon public key** 두 값을 복사

### 2. 코드에 Supabase 값 넣기

[`docs/js/supabase-config.js`](./docs/js/supabase-config.js) 파일을 열어서
`SUPABASE_URL` 과 `SUPABASE_ANON_KEY` 값을 방금 복사한 값으로 바꾸고 커밋/푸시합니다.

### 3. GitHub Pages 켜기

저장소 **Settings → Pages** 에서 Source를 `Deploy from a branch`, Branch를
`main` / `/docs` 폴더로 선택 후 저장. 잠시 후
`https://sujeong-yooon.github.io/boptogether/` 같은 링크가 생깁니다.
이 링크를 공유하면 친구들은 설치 없이 바로 웹사이트로 쓸 수 있어요.

## 로컬에서 미리보기 (선택)

Node/설치 없이 `docs/index.html` 파일을 브라우저로 그냥 열어도 되고,
간단히 정적 서버로 띄우고 싶다면:

```bash
npx serve docs
```
