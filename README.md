# 휩(Hwip) - LaTeX → 한글(HWP) 수식 변환기

**🌐 [hwip.dshs.dev](https://hwip.dshs.dev)** · **🧩 [크롬 확장 프로그램](https://chromewebstore.google.com/detail/meahkfhlalnljlgllhmhmfdhpkknfncg)**

📖 [사용법](https://hwip.dshs.dev/guide) · [변환 예시](https://hwip.dshs.dev/examples) · [한글 수식 문법](https://hwip.dshs.dev/syntax) · [소개·문의](https://hwip.dshs.dev/about)

ChatGPT·Claude·Gemini 같은 AI가 쓴 수식을 한글 문서에 그대로 붙여넣으면 깨집니다. AI는 **LaTeX**로 수식을 쓰고, 한컴오피스 한글은 **자체 수식 편집기 문법**을 쓰기 때문입니다.

휩은 이 둘 사이를 이어 줍니다. LaTeX 수식을 한글 수식 문법으로 바꿔 주고, 결과를 한글 수식 편집기에 붙여넣으면 바로 올바른 수식으로 보입니다.

- **수식 변환** — LaTeX를 붙여넣으면 즉시 한글 수식으로 바꿔 클립보드에 복사합니다.
- **이미지 인식** — 수식 사진·캡처를 LaTeX로 인식해 같은 흐름으로 변환합니다.
- **문서 변환** — HWP/HWPX 문서 속 LaTeX를 한컴 수식 개체로 바꾸고, Markdown 문서는 수식까지 살린 HWPX로 만듭니다.
- **크롬 확장 · REST API** — AI 사이트에서 수식 위에 마우스만 올려 복사하거나, HTTP로 변환기를 호출할 수 있습니다.

변환·인식·문서 처리는 모두 **브라우저 안에서** 실행되며, 수식·이미지·파일은 서버로 전송되지 않습니다. (REST API는 예외)

## 사용법

### 웹 (권장)

[hwip.dshs.dev](https://hwip.dshs.dev)에서 바로 쓸 수 있습니다. 기능별 자세한 안내는 [사용법](https://hwip.dshs.dev/guide) 페이지에 있습니다.

빌드 과정이 없는 정적 파일이라 정적 호스팅에 그대로 올릴 수 있습니다. 로컬에서는 정적 서버로 여세요.
페이지 간 링크가 확장자 없는 경로(`/guide`)이고 이미지 OCR이 모듈 Web Worker를 쓰기 때문에, `file://`로 직접 열면 일부 기능이 동작하지 않습니다.

```bash
npx serve .            # http://localhost:3000 (확장자 없는 경로 지원)
```

### REST API

별도 설치 없이 HTTP로 바로 쓸 수 있습니다.

**엔드포인트**: `POST https://hwip.dshs.dev/api/convert`

```bash
curl -X POST https://hwip.dshs.dev/api/convert \
  -H "Content-Type: application/json" \
  -d '{"latex": "$$\\frac{2\\pi}{24}$$"}'
# → {"result":"{2 pi} over {24}"}
```

```js
const res = await fetch('https://hwip.dshs.dev/api/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ latex: '$$\\frac{2\\pi}{24}$$' }),
});
const { result } = await res.json();
// result → "{2 pi} over {24}"
```

간단한 테스트는 GET도 됩니다:

```
GET https://hwip.dshs.dev/api/convert?latex=\frac{a}{b}
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
- **수식 개체로 바로 복사(Windows)**: `HwipCompanion.exe`를 실행한 상태에서 **수식 개체 복사**를 누르면 한글 본문에서 `Ctrl+V`만으로 편집 가능한 수식 개체를 붙일 수 있습니다. 수식 편집기를 먼저 열 필요가 없습니다.
- **AI 사이트 복사 자동 승격**: 보조 프로그램 실행 중 Gemini 등의 **HWP 수식 복사** 버튼으로 한글 수식 문법을 복사하면 이를 자동 감지해 네이티브 수식 개체로 교체합니다.
- **문단 속 수식까지 한 번에 복사**: ChatGPT·Gemini 등에서 텍스트와 수식이 섞인 영역을 선택해 `Ctrl+C`하면, 보조 프로그램이 문단 순서를 유지한 채 텍스트와 편집 가능한 한글 수식 개체로 구성합니다. 한글에서는 `Ctrl+V`만 누르면 됩니다.
- **앱별 붙여넣기 형식 분리**: 같은 클립보드에 한글 수식 개체 형식과 원문 텍스트를 함께 보관합니다. 한글에서는 편집 가능한 수식 개체로 붙고, Codex·메모장·웹 입력창 등에서는 수식이 포함된 원문 텍스트로 붙습니다.
- **미리보기**: 수식이 있을 때 출력 패널 하단에 KaTeX로 자동 렌더링됩니다. 입력이 없으면 숨겨집니다.
- **이미지 OCR (브라우저 로컬 실행)**: 입력창 우측 **🖼️ 이미지 인식** 버튼으로 파일 선택, 이미지를 입력창에 끌어다 놓거나 붙여넣기(⌘/Ctrl+V)하면 LaTeX로 자동 인식 후 변환합니다. OCR은 서버 없이 **접속자의 브라우저에서만** 실행되며 이미지는 외부로 전송되지 않습니다.
- **렌더링된 수식 감지 및 해결 안내**: AI 챗봇 화면에서 수식을 평문으로 그냥 복사하면(위/아래 첨자 정보 손실) 이를 자동 감지해 경고 모달을 띄웁니다. **"해결 방안 보기"**를 누르면 3가지 방법(① LaTeX 재요청 프롬프트, ② 이미지 OCR, ③ 크롬 확장 프로그램)을 안내합니다.
- **Fallback 복구**: ChatGPT·Google AI Studio·Claude의 렌더링 평문 복사 패턴을 분석해 가능한 수준에서 HWP 코드로 복구합니다.
- **다크 모드**: 우측 상단 토글로 전환합니다(선택은 브라우저에 기억됩니다).
- **오프라인**: 한 번 접속하면 Service Worker가 앱을 저장해 두어 인터넷 없이도 수식 변환·HWPX 변환이 동작합니다.

### 📄 문서 변환 탭 (HWP / HWPX / Markdown)

HWP 또는 HWPX 파일을 업로드하면, 문서 안의 텍스트 LaTeX 수식을 자동으로 찾아 **한컴 수식 개체**(`hp:equation`)로 교체한 뒤 새 HWPX 파일로 내보냅니다. 모든 처리는 브라우저에서 실행되며 파일은 서버로 전송되지 않습니다.

**동작 방식:**
- **HWPX 파일**: ZIP+XML 구조를 JSZip으로 열어 `Contents/section*.xml`의 텍스트 런에서 `$…$`, `$$…$$`, `\(…\)`, `\[…\]` 형태의 LaTeX를 탐지하고, 각각을 `<hp:equation><hp:script>…</hp:script></hp:equation>` 개체로 치환한 뒤 다시 ZIP으로 묶어 내보냅니다.
- **HWP 파일(이진 포맷)**: 오픈소스 엔진 [rhwp](https://github.com/edwardkim/rhwp)(인터넷 연결 필요)으로 먼저 HWPX로 변환한 뒤, 위와 같은 방식으로 수식을 삽입합니다.

**Markdown → HWPX:** AI 답변을 통째로 붙여넣거나(⌘/Ctrl+V) `.md` 파일을 올리면 글꼴·크기를 고르고 A4 미리보기를 본 뒤 `.hwpx`로 내려받습니다. 제목·목록·표·코드 블록·인용·수식이 한글 서식과 수식 개체로 들어갑니다.

**참고한 오픈소스 프로젝트:**
- [hwpx-latex-to-equation](https://github.com/fakeminjun7321/hwpx-latex-to-equation) — HWPX ZIP+XML 파싱 및 수식 개체 삽입 구조
- [rhwp](https://github.com/edwardkim/rhwp) — HWP 이진 파일 파싱 및 HWPX 변환 엔진
- [markdown_to_hwp](https://github.com/minigu5/markdown_to_hwp) — Markdown → HWPX 변환

### 📖 안내 페이지

| 페이지 | 내용 |
|--------|------|
| [사용법](https://hwip.dshs.dev/guide) (`guide.html`) | AI에게 LaTeX 받기부터 한글 수식 편집기에 붙여넣기까지, 기능별 단계 안내와 FAQ |
| [변환 예시](https://hwip.dshs.dev/examples) (`examples.html`) | 보고서·논문에 자주 쓰는 수식 18개의 LaTeX ↔ 한글 수식 (바로 복사) |
| [한글 수식 문법](https://hwip.dshs.dev/syntax) (`syntax.html`) | 한글 수식 편집기 문법을 LaTeX와 나란히 정리한 표 |
| [소개](https://hwip.dshs.dev/about) (`about.html`) | 만든 이유, 만든 사람, 문의처 |
| [이용약관](https://hwip.dshs.dev/terms) · [개인정보처리방침](https://hwip.dshs.dev/privacy) | |

예시 페이지의 한글 수식은 변환기 출력을 그대로 넣은 것이며, `test/examples-page.test.js`가 변환 로직과 어긋나지 않는지 검사합니다.

### 🧩 Chrome·Edge 확장 프로그램

AI 사이트의 수식에 마우스를 올리면 바로 변환·복사하며, 수식이 포함된 문단 전체 복사도 지원합니다. [크롬 웹스토어](https://chromewebstore.google.com/detail/meahkfhlalnljlgllhmhmfdhpkknfncg)에서 설치할 수 있고 Chromium 기반 Microsoft Edge에서도 사용할 수 있습니다. 확장 소스는 [`browser-extension`](./browser-extension)에 함께 관리됩니다.

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
- **사용 모델:** [`minigu5/hwip-formulanet`](https://huggingface.co/minigu5/hwip-formulanet) — [`alephpi/FormulaNet`](https://huggingface.co/alephpi/FormulaNet)(PP-FormulaNet-S 기반, 20M 파라미터)을 AI 챗봇 화면 캡처·행렬·다크모드용으로 파인튜닝하고 가중치를 int8로 압축한 모델. `image-to-text` 비전-인코더-디코더 ONNX 모델로, [transformers.js](https://github.com/huggingface/transformers.js)(`@huggingface/transformers`)가 ONNX Runtime Web(WASM)으로 실행합니다.
- **모델 로딩:** 첫 인식 때 HuggingFace Hub에서 모델(약 20MB)을 한 번 내려받아 브라우저 Cache Storage에 저장하며, 이후에는 즉시 동작합니다. 추론은 Web Worker(`src/ocr-worker.js`)에서 별도 스레드로 수행해 UI를 막지 않습니다.
- **후처리:** 모델 출력을 `cleanOcr()`(`src/converter.js`)로 정리 — 간격 잡음 제거, 행렬·cases 환경 복원, 함수 이름·기호 별칭 정규화.
- **전처리:** 배경 합성(투명 PNG는 글자 밝기에 맞춰) → 그레이스케일 → (어두운 이미지면) 색 반전 → 여백 크롭 → 384×384 비율 유지 축소 + 중앙 패딩 → 정규화. (UniMERNet 전처리 규약을 그대로 따름. `app.js`의 `preprocessImage`)
- **라이선스 주의:** 모델 가중치는 **AGPL-3.0**입니다(런타임 라이브러리 transformers.js는 Apache-2.0). 공개 호스팅 시 소스 공개 의무가 생길 수 있으므로 유의하세요. 이 저장소 코드 자체는 Non-Commercial & Attribution 라이선스입니다.
- **요구 사항:** 모듈 Web Worker를 지원하는 최신 브라우저(Chrome/Edge/Firefox/Safari 최신 버전). `file://` 직접 열기에서는 워커가 동작하지 않을 수 있으니 정적 서버로 여세요.

---

## 테스트

```bash
npm test     # 또는: node --test
```

## Windows 수식 개체 복사

브라우저는 한글의 네이티브 수식 개체 클립보드 형식을 직접 만들 수 없으므로, [Windows 보조 프로그램](./companion/windows/README.md)이 설치형 한글 Automation을 통해 개체를 생성합니다.

1. 웹페이지에서 `HwipCompanion.exe`를 내려받아 실행하고 **예**를 눌러 설치합니다.
2. 목록에서 휩을 사용할 Chrome 프로필을 선택합니다.
3. 선택한 각 프로필에서 열린 웹스토어의 **Chrome에 추가**를 한 번씩 누릅니다.
4. 수식 하나는 **HWP 수식 복사**를 누릅니다. 문단 전체는 텍스트와 수식을 함께 선택하고 `Ctrl+C`를 누릅니다.
5. 한글 본문에서 `Ctrl+V`를 누릅니다.

Gemini 등에서 크롬 확장의 **HWP 수식 복사**를 사용하는 경우에는 휩 웹사이트를 거치지 않아도 됩니다. 보조 프로그램이 복사된 한글 수식 문법을 감지해 수식 개체로 바꿉니다. 자동 감지는 알림 영역의 휩 아이콘 우클릭 메뉴에서 끌 수 있으며, 클립보드 내용은 저장하거나 외부로 전송하지 않습니다.

보조 프로그램은 `127.0.0.1`에서만 요청을 받고 수식 생성·복사 이외의 Automation 명령은 제공하지 않습니다. Windows와 설치형 한글이 필요합니다.

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

## 문의

변환이 잘못되는 수식이나 필요한 기능은 [GitHub Issues](https://github.com/minigu5/hwip/issues) 또는 이메일 seong381400@gmail.com 으로 알려 주세요.

---

## 저작권 및 라이선스 (Copyright & License)

Copyright (c) 2026 **Shin Mingyu**. All rights reserved.

본 프로젝트는 다음 조건 하에 이용 가능합니다 (Non-Commercial & Attribution):
- **Attribution**: 이용 시 원저작자(Shin Mingyu)를 반드시 명시해야 합니다.
- **Non-Commercial**: 영리 목적의 판매나 서비스 이용을 금지합니다.
- 상세한 내용은 [LICENSE](./LICENSE) 파일을 확인해 주세요.

변환 규칙은 한글과컴퓨터의 공개 문서 **「한글 문서 파일 형식 - 수식」(revision 1.3)**를 참고하여 개발했습니다. 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

런타임 의존성 **JSZip v3.10.1**(© Stuart Knightley, MIT)은 `vendor/jszip.min.js`에 라이선스 배너를 보존한 채 동봉했습니다.
