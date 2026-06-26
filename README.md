# 휩(HWIP) - LaTeX → 한글(HWP) 수식 변환기

AI(ChatGPT, Claude 등)가 출력하는 **Markdown LaTeX 수식**을 **한컴오피스 한글(HWP) 수식 편집기 문법**으로 변환합니다. 변환 결과를 복사해 한글 수식 편집기에 붙여넣으면 그대로 렌더링됩니다.

LaTeX와 한글 수식 편집기는 문법이 서로 호환되지 않아, AI가 만든 수식을 한글에 붙여넣으면 깨집니다. 이 도구가 그 간극을 메웁니다.

## 사용법

### 웹 (권장)

정적 파일이므로 `index.html`을 브라우저로 직접 열거나, GitHub Pages 등 정적 호스팅에 그대로 올릴 수 있습니다.  
단, 이미지 OCR은 모듈 Web Worker를 사용하므로 정적 서버를 통해 여세요.

```bash
open index.html        # macOS  
```

### REST API

별도 설치 없이 HTTP로 바로 쓸 수 있습니다.

**엔드포인트**: `POST https://hwip.vercel.app/api/convert`

```bash
curl -X POST https://hwip.vercel.app/api/convert \
  -H "Content-Type: application/json" \
  -d '{"latex": "$$\\frac{2\\pi}{24}$$"}'
# → {"result":"{2 pi} over {24}"}
```

```js
const res = await fetch('https://hwip.vercel.app/api/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ latex: '$$\\frac{2\\pi}{24}$$' }),
});
const { result } = await res.json();
// result → "{2 pi} over {24}"
```

간단한 테스트는 GET도 됩니다:

```
GET https://hwip.vercel.app/api/convert?latex=\frac{a}{b}
```

| 항목 | 내용 |
|------|------|
| 메서드 | `POST` (권장) · `GET` |
| 요청 본문 | `{ "latex": "<LaTeX 문자열>" }` |
| 응답 (성공) | `{ "result": "<한글 수식>" }` |
| 응답 (오류) | `{ "error": "<메시지>" }` |
| CORS | 전체 허용 (`*`) |

### 코드에서 직접

```js
const { convert } = require('./src/converter.js');
convert('$$\\frac{2\\pi}{24}(t - \\phi_1)$$');
// → "{2 pi} over {24} ( t `-` phi _{1} )"
```

브라우저에서는 `<script src="src/converter.js">` 후 `window.LatexToHwp.convert(...)`.

---

## 주요 기능

### ✏️ 텍스트 변환 탭

- **LaTeX → 한글 수식 자동 변환**: 입력창에 수식을 붙여넣으면 즉시 변환, 클립보드에 자동 복사됩니다.
- **미리보기**: 수식이 있을 때 출력 패널 하단에 KaTeX로 자동 렌더링됩니다. 입력이 없으면 숨겨집니다.
- **이미지 OCR (브라우저 로컬 실행)**: 입력창 우측 **🖼️ 이미지 인식** 버튼으로 파일 선택, 이미지를 입력창에 끌어다 놓거나 붙여넣기(⌘/Ctrl+V)하면 LaTeX로 자동 인식 후 변환합니다. OCR은 서버 없이 **접속자의 브라우저에서만** 실행되며 이미지는 외부로 전송되지 않습니다.
- **렌더링된 수식 감지 및 해결 안내**: AI 챗봇 화면에서 수식을 평문으로 그냥 복사하면(위/아래 첨자 정보 손실) 이를 자동 감지해 경고 모달을 띄웁니다. **"해결 방안 보기"**를 누르면 3가지 방법(① LaTeX 재요청 프롬프트, ② 이미지 OCR, ③ 크롬 확장 프로그램)을 안내합니다.
- **Fallback 복구**: ChatGPT·Google AI Studio·Claude의 렌더링 평문 복사 패턴을 분석해 가능한 수준에서 HWP 코드로 복구합니다.
- **다크 모드**: 우측 상단 토글로 전환합니다(선택은 브라우저에 기억됩니다).

### 📄 파일 변환 탭 (HWP / HWPX)

HWP 또는 HWPX 파일을 업로드하면, 문서 안의 텍스트 LaTeX 수식을 자동으로 찾아 **한컴 수식 개체**(`hp:equation`)로 교체한 뒤 새 HWPX 파일로 내보냅니다. 모든 처리는 브라우저에서 실행되며 파일은 서버로 전송되지 않습니다.

**동작 방식:**
- **HWPX 파일**: ZIP+XML 구조를 JSZip으로 열어 `Contents/section*.xml`의 텍스트 런에서 `$…$`, `$$…$$`, `\(…\)`, `\[…\]` 형태의 LaTeX를 탐지하고, 각각을 `<hp:equation><hp:script>…</hp:script></hp:equation>` 개체로 치환한 뒤 다시 ZIP으로 묶어 내보냅니다.
- **HWP 파일(이진 포맷)**: 오픈소스 엔진 [rhwp](https://github.com/edwardkim/rhwp)(인터넷 연결 필요)으로 먼저 HWPX로 변환한 뒤, 위와 같은 방식으로 수식을 삽입합니다.

**참고한 오픈소스 프로젝트:**
- [hwpx-latex-to-equation](https://github.com/fakeminjun7321/hwpx-latex-to-equation) — HWPX ZIP+XML 파싱 및 수식 개체 삽입 구조
- [rhwp](https://github.com/edwardkim/rhwp) — HWP 이진 파일 파싱 및 HWPX 변환 엔진

### 🧩 크롬 확장 프로그램

AI 사이트의 수식에 마우스를 올리면 바로 변환·복사하는 [크롬 확장](https://github.com/minigu5/latex-to-hwp-extension)도 제공합니다(웹스토어 미등록 — 개발자 모드로 설치). 이 확장의 소스 코드는 별도 저장소로 관리됩니다.

---

## 변환 예시

| 입력 (LaTeX) | 출력 (한글 수식) |
|--------------|------------------|
| `\frac{a}{b}` | `{a} over {b}` |
| `x^2 + y_{ij}` | `x ^{2} \`+\` y _{i j}` |
| `\sqrt{2}` | `sqrt {2}` |
| `\sum_{i=1}^{n}` | `sum _{i \`=\` 1} ^{n}` |
| `\alpha \cup \beta` | `alpha union beta` |

> 한글 수식 편집기에서 **공백은 항(term) 구분 용도**이며 화면에는 나타나지 않습니다. **백틱(`` ` ``)은 1/4 크기의 좁은 간격**으로, 연산자 주위 간격을 보기 좋게 맞추는 데 쓰입니다.

---

## 이미지 OCR (브라우저 로컬 실행)

수식 사진·캡처를 LaTeX로 인식한 뒤 그대로 한글 수식으로 변환합니다.

- **동작 위치:** 인식(OCR)과 변환 모두 **접속자의 브라우저에서** 실행됩니다. 이미지는 서버로 업로드되지 않습니다.
- **사용 모델:** [`alephpi/FormulaNet`](https://huggingface.co/alephpi/FormulaNet) (PP-FormulaNet-S 기반 파인튜닝, 20M 파라미터). `image-to-text` 비전-인코더-디코더 ONNX 모델로, [transformers.js](https://github.com/huggingface/transformers.js)(`@huggingface/transformers`)가 ONNX Runtime Web(WASM)으로 실행합니다.
- **모델 로딩:** 첫 인식 때 HuggingFace Hub에서 모델(약 80MB)을 한 번 내려받아 브라우저 Cache Storage에 저장하며, 이후에는 즉시 동작합니다. 추론은 Web Worker(`src/ocr-worker.js`)에서 별도 스레드로 수행해 UI를 막지 않습니다.
- **전처리:** 흰 배경 합성 → 그레이스케일 → (어두운 이미지면) 색 반전 → 여백 크롭 → 384×384 비율 유지 축소 + 중앙 패딩 → 정규화. (UniMERNet 전처리 규약을 그대로 따름. `app.js`의 `preprocessImage`)
- **라이선스 주의:** 모델 가중치는 **AGPL-3.0**입니다(런타임 라이브러리 transformers.js는 Apache-2.0). 공개 호스팅 시 소스 공개 의무가 생길 수 있으므로 유의하세요. 이 저장소 코드 자체는 Non-Commercial & Attribution 라이선스입니다.
- **요구 사항:** 모듈 Web Worker를 지원하는 최신 브라우저(Chrome/Edge/Firefox/Safari 최신 버전). `file://` 직접 열기에서는 워커가 동작하지 않을 수 있으니 정적 서버로 여세요.

---

## 테스트

```bash
npm test     # 또는: node --test
```

---

## 변환 규칙

전체 매핑(구조 명령·그리스 문자·연산/집합/화살표/기타 기호)과 한글 수식 고유 규칙은 [`CONVERSION_RULES.md`](./CONVERSION_RULES.md)에 정리되어 있습니다.

---

## 한계 / 확인 필요 항목

- `\left` / `\right`는 한글 명세 권장 방식인 `LEFT(/RIGHT)`로 변환합니다 (내용 높이에 맞춰 괄호가 커집니다).
- 일부 기호(`\nabla` 등 명세에 이미지로만 있는 항목)는 실제 한글 동작 검증이 필요합니다.
- 미확인 LaTeX 명령은 임의로 버리지 않고 이름을 보존합니다.
- 파일 변환 결과는 항상 HWPX 형식으로 출력됩니다. HWP 파일이 필요하다면 한컴 오피스에서 "다른 이름으로 저장"하세요.

---

## 저작권 및 라이선스 (Copyright & License)

Copyright (c) 2026 **Shin Mingyu**. All rights reserved.

본 프로젝트는 다음 조건 하에 이용 가능합니다 (Non-Commercial & Attribution):
- **Attribution**: 이용 시 원저작자(Shin Mingyu)를 반드시 명시해야 합니다.
- **Non-Commercial**: 영리 목적의 판매나 서비스 이용을 금지합니다.
- 상세한 내용은 [LICENSE](./LICENSE) 파일을 확인해 주세요.

변환 규칙은 한글과컴퓨터의 공개 문서 **「한글 문서 파일 형식 - 수식」(revision 1.2)**를 참고하여 개발했습니다. 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

런타임 의존성 **JSZip v3.10.1**(© Stuart Knightley, MIT)은 `vendor/jszip.min.js`에 라이선스 배너를 보존한 채 동봉했습니다.
