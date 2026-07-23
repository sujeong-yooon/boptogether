# 밥투게더 (boptogether)

캘린더에서 날짜를 골라 주문을 등록하고, 함께 먹을 사람들이 이름과 메뉴를 남긴 뒤,
주문자가 참여자별 정산금액과 입금 계좌를 관리할 수 있는 웹앱입니다.
최대 10명까지 한 주문에 참여할 수 있습니다.

순수 정적 사이트(HTML/CSS/JS) + [Supabase](https://supabase.com)(무료 Postgres DB)로
만들어져서, 별도 서버를 계속 켜둘 필요 없이 GitHub Pages에서 바로 돌아갑니다.

## 배포 상태

- Supabase 프로젝트 연결 완료 (`docs/js/supabase-config.js`에 URL/키 반영됨)
- 저장소 Public 전환 완료
- GitHub Pages: 저장소 **Settings → Pages** 에서 Source가 `Deploy from a branch`로
  켜져 있는지 확인하세요. 켜져 있다면 아래 링크로 접속됩니다.

  **https://sujeong-yooon.github.io/boptogether/**

  (아직 링크가 안 열린다면 Pages 설정에서 폴더가 `/docs`로 되어 있는지,
  Branch가 지금 코드가 올라간 브랜치로 되어 있는지 확인해주세요.)

## 기능

- 캘린더에서 날짜 선택 후 주문 등록 (주문자이름 / 매장명 / 주문날짜 / 주문시간)
- 주문 상세 페이지에서 누구나 이름 / 메뉴를 입력해 참여 (최대 10명)
- 참여자별 정산금액 입력, 정산 계좌(은행명 / 예금주 / 계좌번호) 등록
- 참여자 삭제, 실시간 합계 표시
- 정산 관련 권한을 둘로 분리해서 보호
  - **관리 비밀번호(PIN, 숫자 4자리)**: 주문자만 아는 값. 계좌 수정/삭제,
    참여자 금액 입력에만 씁니다.
  - **확인 퀴즈(질문+답)**: 참여자들도 알 수 있는 값. 마스킹된 계좌번호를
    보는 데만 씁니다 — 계좌를 보여주자고 참여자에게 PIN까지 알려줄 필요가
    없어요.
  - 둘 다 서버에 암호화해서 저장하고 브라우저로는 절대 내려주지 않습니다.

> **schema.sql이 바뀌었다면?** Supabase SQL Editor에서 `supabase/schema.sql`
> 내용을 다시 전체 복사해서 붙여넣고 Run 하면 됩니다. 스크립트가 재실행해도
> 안전하게 작성돼 있어서, 기존 데이터를 지우지 않고 새 컬럼/함수/보안 규칙만
> 추가/갱신됩니다.

## 처음부터 다시 배포하는 방법 (참고용 / 다른 사람이 포크할 경우)

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
