# OCR 모델 파인튜닝·평가 도구

FormulaNet(alephpi/FormulaNet, AGPL-3.0)을 사이트 용도(AI 챗봇 화면 캡처, 행렬·cases, 다크모드)에 맞게 파인튜닝하고 브라우저에서 평가하는 스크립트 모음. 학습 코드는 [Texo](https://github.com/alephpi/Texo)를 clone해 그 venv에서 실행한다.

| 파일 | 역할 |
|---|---|
| `select.py` | UniMER-Train 라벨에서 합성용 수식 선택 (벤치 수식 제외, 약한 유형 가중) |
| `gen_struct.py` | 행렬·cases 합성 — pmatrix/cases로 렌더, 라벨은 UniMER 규약(`\left ( \begin{array}`) |
| `render.js` | KaTeX/MathJax 헤드리스 Chrome 렌더 + 사이트와 같은 회색조·반전 |
| `finetune.py` | 합성 + UniMER 재생 데이터로 파인튜닝 (한 줄 array 감싸기 라벨 제거) |
| `eval_unimer.py` | UniMER-Test 공정 평가 |
| `w8.py`, `quant.py` | 가중치 전용 int8 압축 (80MB → 20MB) |
| `bench/` | 브라우저 벤치(`harness.html`, `rescore.html`) — 실행 시 `src/converter.js`를 `bench/converter.js`로 복사해 둘 것 |
| `autopilot.sh`, `bench_run.js`, `summarize.py` | 학습 서버에서 내보내기→압축→벤치→요약 자동 실행 |
