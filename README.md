# MONEY RADAR — 덕원여고 투자 동아리 [인사이트]

날짜별 시황 아카이브 사이트입니다. 배포 주소: https://moneyradar-lemon.vercel.app

이 저장소에 커밋하면 Vercel이 자동으로 배포합니다. 빌드 단계는 없는 정적 사이트입니다.

## 구조

```
index.html                     화면(날짜를 고르면 그날 시황을 보여줌)
data/months.json               달 목록 (최신 달이 앞) — 자동 생성
data/YYYY-MM/index.json        그달 날짜 목록 (최신 날짜가 앞) — 자동 생성
data/YYYY-MM/YYYY-MM-DD.json   하루치 시황
scripts/add-day.mjs            새 날짜 추가·검사 스크립트 (배포되지 않음)
```

## 새 날짜 추가

```
node scripts/add-day.mjs /경로/오늘.json
```

- 형식을 검사한 뒤 `data/YYYY-MM/YYYY-MM-DD.json`을 만들고 목록 파일을 다시 생성합니다.
- 같은 날짜가 이미 있으면 아무것도 하지 않고 종료 코드 2로 끝납니다.
- 기존 날짜 파일은 절대 수정하지 않습니다. 목록 파일이 꼬였으면 `node scripts/add-day.mjs --rebuild`로 다시 만들 수 있습니다.

## 하루치 시황 형식

```json
{
  "date": "2026-10-27",
  "weekday": "화",
  "mood": "up",
  "closedNote": "휴장일 때만 (예: 주말 휴장)",
  "headline": "한 줄 요약",
  "us_market": "글로벌 증시 동향",
  "kr_market": "국내 증시 및 주요 이슈",
  "macro": "핵심 거시경제 지표",
  "top_news": [{ "title": "뉴스 제목", "impact": "영향 분석" }],
  "concepts": [{ "term": "용어", "desc": "고등학생용 설명" }],
  "checkpoints": [{ "time": "21:30", "item": "미국 9월 PCE 발표" }],
  "sources": [{ "t": "기사 제목", "u": "https://..." }]
}
```

- `mood`: `up` / `down` / `flat` / `closed`
- `weekday`: 한 글자(월~일), 날짜와 맞아야 함
- `checkpoints[].time`은 선택, 나머지 필드는 필수
