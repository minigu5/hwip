# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code(및 기여자)를 위한 안내서다.

## 컨텍스트 최적화

`.claudeignore`가 Claude Code의 불필요한 파일 읽기를 차단해 토큰을 절약한다.

**무시 대상**: `vendor/jszip.min.js`(minified 95KB), `package-lock.json`, `LICENSE`, `README.md`, `*.pdf`, `*.zip`, `*.png` 등 바이너리/이미지, `.DS_Store`

작업에 필요한 정보는 모두 `CLAUDE.md`·`CONVERSION_RULES.md`·`src/`·`app.js`·`test/`에 있다.

---

## ⚠️ 저장소 관리 절대 원칙

본 프로젝트는 다중 저장소 구조다. 다음 규칙을 어기면 데이터 손실·저장소 오염이 발생한다.

| 구성 요소 | 로컬 경로 | GitHub 저장소 |
|----------|----------|---------------|
| **메인 프로젝트** | `/` | [minigu5/hwip](https://github.com/minigu5/hwip) (옛 이름 `latex-to-hwp` — 자동 리다이렉트) |
| **크롬 확장 프로그램** | `/chrome-extension` | [minigu5/latex-to-hwp-extension](https://github.com/minigu5/latex-to-hwp-extension) |

1. **`/chrome-extension`은 메인 저장소(`hwip`)에 절대 커밋·푸시하지 말 것.** `.gitignore`의 `/chrome-extension/` 규칙은 의도적이다. 로컬 파일은 보존하되, 변경은 별도 저장소(`latex-to-hwp-extension`)로만 푸시한다. 그 폴더엔 독립 `.git`이 없으므로 임시 위치에 `gh repo clone minigu5/latex-to-hwp-extension` → `rsync -a --exclude='.git' --exclude='.DS_Store' chrome-extension/ <clone>/` → clone에서 commit·push.
2. **로직 동기화**: `src/converter.js`를 수정하면 반드시 `chrome-extension/lib/converter.js`로 복사해 동기화. 동기화 후 각 저장소에 별도 커밋·푸시.
3. **커밋 정책**: 한컴 공식 명세 PDF(`*.pdf`)는 저작권 보유(한글과컴퓨터)로 커밋 금지 — `.gitignore`로 이미 제외. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 추가. 커밋·푸시는 사용자가 요청할 때만 수행한다.

### 실수 복구
- `git checkout <commit_id> -- <path>` — 특정 파일 복구
- `git rm -r --cached chrome-extension/` — 원격에서만 삭제, 로컬 유지

---

## 프로젝트 목적

인공지능(ChatGPT, Claude 등)이 출력하는 **Markdown LaTeX 수식**을 **한컴오피스 한글(HWP)의 수식 편집기 문법**으로 변환한다. LaTeX 문법과 한글 수식 편집기 문법이 서로 호환되지 않아 AI가 만든 수식을 한글 문서에 그대로 붙여넣으면 깨진다. 변환 결과를 한글 수식 편집기에 붙여넣으면 **즉시 올바른 수식으로 렌더링**된다.

### 변환 예시 (골든 테스트)

이 입출력은 동작의 기준점이다. 변환 로직을 수정할 때 반드시 이 케이스를 통과해야 한다.

**입력 (LaTeX):**
```
$$\lambda(t) = \lambda_0 + A_1 \sin\left(\frac{2\pi}{24}(t - \phi_1)\right) + A_2 \sin\left(\frac{2\pi}{12}(t - \phi_2)\right)$$
```

**출력 (한글 수식):**
```
lambda  (t)= lambda  ` _{`0} +A _{1} sin( {2 pi } over {24} (t`-` phi  _{1} ))+A _{2} sin( {2 pi } over {12} (t`-` phi  _{2} ))
```

## 사용 형태 / 기술 스택

- **형태**: 브라우저에서 동작하는 단일 웹 페이지, **두 가지 탭**으로 구성.
  - **텍스트 변환 탭**: 입력창의 LaTeX 수식을 변환해 표시·자동 복사. 이미지를 업로드/붙여넣기하면 브라우저에서 OCR로 LaTeX를 인식해 같은 변환 흐름에 태운다.
  - **파일 변환 탭**: HWP/HWPX 파일을 업로드하면 문서 안의 텍스트 LaTeX 수식을 찾아 한컴 수식 개체(`hp:equation`)로 교체한 뒤 새 HWPX 파일로 내보낸다.
- **언어**: JavaScript (프레임워크/빌드 도구 없이 순수 HTML+CSS+JS. 의존성 최소화).
- **배포**: 정적 파일이라 파일을 브라우저로 직접 열거나 GitHub Pages 등 정적 호스팅으로 제공 가능.
- **구조 원칙**: 변환 로직(파서/변환기)은 UI와 분리된 순수 함수 모듈로 둔다. 테스트와 재사용(CLI 등)이 쉬워진다.

## 파일 구조

```
index.html              메인 UI (탭 2개: 텍스트 변환 / 파일 변환)
privacy.html            개인정보 처리방침 페이지
app.js                  UI 이벤트, OCR 흐름, 파일 변환 흐름
sw.js                   Service Worker — 앱 쉘 캐시·오프라인 지원
api/
  convert.js            Vercel 서버리스 함수 — REST API 엔드포인트 (POST /api/convert)
src/
  converter.js          LaTeX → 한글 수식 변환 엔진 (순수 함수, window.LatexToHwp)
  hwpx-convert.js       HWPX(ZIP+XML) 파싱·수식 개체 삽입·재압축 (window.HwpxConvert)
  ocr-worker.js         Web Worker — FormulaNet 모델 추론
vendor/
  jszip.min.js          JSZip v3.10.1 (hwpx-convert.js 의존성, MIT)
public/
  favicon.png
test/
  converter.test.js     변환 엔진 골든 테스트
CONVERSION_RULES.md     LaTeX → 한글 수식 전체 매핑 규칙 (스펙 기반)
```

## 한글(HWP) 수식 편집기 문법 핵심

자체 마크업 언어다. 변환 시 기본 규칙:

- **공백/띄어쓰기**
  - 백틱 `` ` `` = 좁은 공백(1/4 크기). 연산자 주위 미세 간격에 쓴다.
  - 물결 `~` = 일반 공백.
  - 키워드(`over`, `sqrt`, `sin` 등)는 앞뒤를 공백으로 구분해야 한다 (항 구분).
- **그리스 문자**: 영문 이름 그대로 (`\alpha`→`alpha`, `\lambda`→`lambda` …). 뒤에 식별 공백.
- **분수**: `A over B`. 우선순위를 위해 `{A} over {B}`로 묶는다.
- **첨자**: 아래 `_`, 위 `^`. 여러 글자는 `{}`로 묶음.
- **루트**: `sqrt {x}`, n제곱근은 명세상 `^{n} sqrt {x}`.
- **함수**: `sin`, `cos`, `log`, `lim` 등 이름 그대로.
- **합/곱/적분**: `sum`, `prod`, `int`. 범위는 첨자 → `sum _{i=1} ^{n}`.
- **괄호**: 일반 `( )` 그대로. LaTeX `\left(`/`\right)`는 자동 크기 괄호이므로 `LEFT(`/`RIGHT)`로 변환.

## 변환 규칙 (LaTeX → 한글)

> **전체 매핑은 [`CONVERSION_RULES.md`](./CONVERSION_RULES.md)에 있다.** 한컴 공식 명세(`한글문서파일형식_수식_revision1.2.pdf`)를 정독해 만든 문서로 구조 명령·그리스 문자·연산/집합/화살표/기타 기호의 전체 표, 한글 수식 고유 규칙, 골든 예시 재해석을 담는다. 변환 로직을 만들거나 고칠 때 먼저 참고할 것.

자주 쓰는 핵심 매핑 요약:

| LaTeX | 한글 수식 | 비고 |
|-------|-----------|------|
| `\frac{a}{b}` | `{a} over {b}` | 핵심 변환 |
| `\sqrt{x}` | `sqrt {x}` | |
| `\sqrt[n]{x}` | `^{n} sqrt {x}` | 명세 권장 형태 |
| `x_{i}` / `x_i` | `x_{i}` | 단일 문자도 `{}`로 통일 |
| `x^{n}` / `x^n` | `x^{n}` | |
| `\sum_{i=1}^{n}` | `sum _{i=1} ^{n}` | |
| `\int_a^b` | `int _{a} ^{b}` | |
| `\left(` `\right)` | `LEFT(` `RIGHT)` | 자동 크기 괄호 (명세 권장) |
| `\alpha`, `\lambda`, `\pi`, `\phi` … | `alpha`, `lambda`, `pi`, `phi` … | 그리스 문자 |
| `\sin`, `\cos`, `\log`, `\lim` … | `sin`, `cos`, `log`, `lim` … | 함수 이름 |
| `\cdot`, `\times` | `cdot`, `times` | |
| `$$ … $$`, `$ … $`, `\[ … \]` | (구분자 제거) | 수식 본문만 변환 |

## 주의사항 및 예외 처리

- **공백 처리는 까다롭다.** 골든 예시의 공백/백틱 배치는 미묘하다. 모든 공백을 하드코딩하기보다 **골든 테스트를 통과시키는 방향으로 점진적으로 다듬는다**. 새 케이스를 발견하면 골든 테스트 모음에 추가.
- **한글 수식 문법은 공식 레퍼런스가 빈약**하다. 확신이 없는 변환 규칙은 추측하지 말고 사용자에게 실제 한글 동작 결과를 물어본다.
- 미지원·미확인 LaTeX 명령은 임의로 버리지 말고 원문을 보존해 사용자가 알아챌 수 있게 한다.
- **렌더링된 수식 붙여넣기 감지 → 해결 방안 모달** (`#warningModal`): 사용자가 AI 챗봇의 렌더링된 수식을 그대로 복사하면 위/아래 첨자 정보가 손실된다. `app.js`가 휴리스틱으로 감지해 2단계 모달을 띄운다 — (1) 경고 → "해결 방안 보기" → (2) 번호 탭으로 3가지 해결법 (① LaTeX 재요청 프롬프트, ② 이미지 OCR, ③ 크롬 확장). ChatGPT·Google AI Studio·Claude(분모-분자 역전 등)의 평문 복사 포맷을 구분하는 Fallback 로직도 함께 제공.
- **`$$` 없는 LaTeX 감지 → 강제 변환 경고** (`#noDelimiterModal`): 일부 AI가 `\frac{dp}{dx}` 같은 LaTeX를 `$$` 구분자 없이 출력하는 경우가 있다. 텍스트 탭에서는 `app.js`의 `isLikelyUndelimitedLatex()`가 붙여넣기 시 `\\[a-zA-Z]{2,}` 패턴으로 감지하고, 파일 탭에서는 변환 후 `stats.forcedEquations > 0`이면 동일 모달을 띄운다. 두 경우 모두 변환은 강제로 진행되며, 모달은 화면 중앙에 **2초간 닫을 수 없는** 형태로 표시된다(`noDelimCanClose` 플래그로 버튼·오버레이 클릭 모두 차단). 모달에는 AI에게 `$$` 기호로 감싸서 다시 작성해 달라는 프롬프트 복사 버튼이 포함된다.

## 이미지 OCR (브라우저 로컬)

수식 이미지 → LaTeX 인식까지 **접속자 브라우저에서** 처리하고, 그 LaTeX를 `window.LatexToHwp.convert`에 그대로 넘긴다. OCR 자체는 서버리스 함수를 쓰지 않는다(모델 추론이 브라우저 WASM에서 실행됨). 변환 로직은 `api/convert.js` REST API로도 별도 제공한다.

- **모델**: `alephpi/FormulaNet` (PP-FormulaNet-S 파인튜닝, 20M, `image-to-text` ONNX). 라이선스 **AGPL-3.0** — 호스팅 시 소스 공개 의무 유의.
- **런타임**: `@huggingface/transformers`(transformers.js v3)를 CDN ESM으로 로드. 추론은 Web Worker `src/ocr-worker.js`에서 별도 스레드로 수행.
- **모델 사용법/전처리는 추측 금지**: 동일 모델 저자의 검증된 구현(Texo-web)을 그대로 따랐다. `VisionEncoderDecoderModel.from_pretrained(..., {dtype:'fp32'})` + 1채널 384×384 텐서를 3채널로 복제해 `model.generate`. 전처리(`app.js`의 `preprocessImage`)는 UniMERNet 규약(그레이스케일·색반전·여백크롭·중앙패딩·mean 0.7931/std 0.1738)을 따른다. **이 값/순서를 바꾸면 정확도가 떨어지므로 함부로 수정하지 말 것.**
- **검증**: 헤드리스 Chrome + matplotlib로 렌더한 수식 PNG로 E2E 인식·변환을 확인. (KaTeX는 헤드리스에서 웹폰트 글리프가 비어 부적합 — 실제 렌더 이미지를 쓸 것.)

## 파일 변환 (HWP / HWPX → 수식 개체 삽입)

HWP/HWPX 파일을 업로드하면 브라우저 안에서 LaTeX 수식을 한컴 수식 개체로 바꾼 새 HWPX 파일을 생성한다.

**HWPX 파일** (ZIP+XML 구조):
1. `JSZip`으로 ZIP 해제
2. `Contents/section*.xml`을 `DOMParser`로 파싱
3. 텍스트 런(`hp:t`)에서 LaTeX 구간 탐지 — `$100$`처럼 숫자뿐인 달러 표기는 금액으로 보고 제외
   - 구분자(`$$`, `$`, `\[`, `\(`)로 감싸진 구간 외에, `\frac` 등 LaTeX 명령이 포함된 구분자 없는 텍스트 런도 감지해 강제 변환한다. 강제 변환 개수는 `stats.forcedEquations`로 추적되며 결과 UI에 별도 경고로 표시된다.
4. 각 구간을 `converter.js`로 변환해 `<hp:equation>` 개체로 치환
5. `XMLSerializer`로 직렬화 후 **중복 xmlns 선언 제거** → ZIP 재압축(mimetype은 첫 항목·비압축으로 보존)

**HWP 파일** (이진 포맷): 직접 수정 불가. 오픈소스 엔진 [rhwp](https://github.com/edwardkim/rhwp)의 editor iframe(외부 URL, 인터넷 필요)을 배경에서 불러와 `loadFile` → `exportHwpx`로 HWPX 변환 후 위 흐름에 태운다. 출력은 항상 HWPX. HWP가 필요하면 한컴 오피스에서 "다른 이름으로 저장".

### 한글 경고 방지 — xmlns 중복 제거

브라우저의 `XMLSerializer`는 `createElementNS()` 요소마다 `xmlns:hp="..."` 선언을 인라인으로 중복 삽입한다. 한글 파서가 이를 손상된 구조로 인식해 "복구하였습니다" 경고를 띄울 수 있어, `src/hwpx-convert.js`의 `removeRedundantNsDecls()`가 직렬화 후 첫 번째 선언만 남기고 모두 제거한다 (`processSectionXml`의 직렬화 직후 적용).

### 참고한 오픈소스 프로젝트
- [hwpx-latex-to-equation](https://github.com/fakeminjun7321/hwpx-latex-to-equation) — HWPX ZIP+XML 파싱·수식 개체 삽입 구조. `src/hwpx-convert.js`는 이 프로젝트를 기반으로 통합한 것.
- [rhwp](https://github.com/edwardkim/rhwp) — Rust+WASM 기반 HWP/HWPX 파서·에디터. HWP 이진 → HWPX 변환에 활용.

## 오프라인 지원 (Service Worker)

`sw.js`가 첫 방문에서 앱 쉘(HTML·JS·CSS·`vendor/jszip.min.js`·KaTeX CDN)을 캐시에 담아 두고, 이후 새로고침이나 오프라인에서도 변환 페이지가 그대로 동작하게 한다.

- **전략**: 내비게이션은 network-first → 실패 시 캐시된 `index.html` 폴백. 같은 오리진 정적 자원·KaTeX CDN은 cache-first. HuggingFace(OCR 모델)·rhwp·Vercel insights 등은 캐시하지 않고 통과.
- **캐시 무효화**: `CACHE_VERSION` 상수를 올리면 사용자 브라우저가 새 셸을 받는다. 앱 쉘 목록(`APP_SHELL`)이나 변환 로직을 고칠 때 함께 올린다.
- **오프라인 배너**: `index.html`이 `navigator.onLine`/`online`/`offline` 이벤트로 상단에 "⚠️ 오프라인" 배너를 슬라이드 표시.

## REST API

외부 개발자가 변환기를 HTTP로 사용할 수 있도록 Vercel 서버리스 함수(`api/convert.js`)로 노출한다.

- **엔드포인트**: `POST https://hwip.vercel.app/api/convert`
- **요청**: `{ "latex": "<LaTeX 문자열>" }` (Content-Type: application/json)
- **응답**: `{ "result": "<한글 수식>" }` 또는 `{ "error": "..." }`
- GET `?latex=...` 쿼리 파라미터도 지원 (브라우저 테스트용)
- CORS 전체 허용(`*`). `api/convert.js`가 직접 헤더를 설정하며 `vercel.json`은 수정하지 않는다.
- 내부적으로 `src/converter.js`의 `convert()` 함수를 그대로 `require`해 사용하므로 로직을 한 곳에서만 관리한다.

## 개발 방침

- 변환 로직은 순수 함수로 작성하고 골든 테스트 케이스 모음을 함께 유지한다.
- 외부 의존성은 최소로. 가능하면 추가하지 않는다.
- 커밋·푸시는 사용자가 요청할 때만 한다.
- `src/converter.js` 수정 시 `chrome-extension/lib/converter.js`도 함께 동기화한다.
- 앱 쉘 자원(HTML/JS/CSS/벤더) 추가·삭제 시 `sw.js`의 `APP_SHELL`과 `CACHE_VERSION`을 함께 갱신.
- `api/convert.js`는 변환 로직을 직접 구현하지 않고 `src/converter.js`에만 의존한다 — 중복 구현 금지.
