# Lunch Roulette

점심 음식 후보와 벤 담당자를 룰렛으로 정하는 정적 웹앱입니다.

## 기능

- 벤 담당 멤버 룰렛
- 음식 후보 룰렛
- 룰렛에서 후보를 바깥으로 드래그해 제외
- 제외된 후보를 다시 룰렛으로 복귀
- Firebase Firestore 기반 공용 상태 저장

## 실행

`index.html` 파일을 브라우저에서 열면 됩니다.

## 배포

정적 파일만 사용하므로 GitHub Pages, Firebase Hosting, Netlify, Vercel 등에 바로 배포할 수 있습니다.

```text
index.html
styles.css
app.js
```

## Firebase

현재 앱은 Firebase Firestore의 `lunchRoulette/sharedState` 문서에 멤버, 음식, 제외 상태, 최근 결과를 저장합니다.

Spark 요금제에서 사용할 수 있으며, 운영 전에 Firestore 보안 규칙을 팀 사용 방식에 맞게 제한해야 합니다.
