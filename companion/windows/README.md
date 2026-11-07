# 휩 Windows 보조 프로그램

웹 브라우저가 한글의 네이티브 수식 개체 클립보드 형식을 직접 만들 수 없기 때문에, 설치형 한글 Automation을 이용해 수식 개체를 만들고 클립보드에 복사하는 작은 로컬 프로그램이다.

## 사용자 흐름

1. `HwipCompanion.exe`를 내려받아 실행한다.
2. 웹에서 **수식 개체 복사**를 누른다.
3. 한글 본문에서 `Ctrl+V`를 누른다.

프로그램은 작업 표시줄 알림 영역에서 실행된다. 종료하려면 알림 영역 아이콘을 우클릭해 **종료**를 선택한다.

## 보안 경계

- `127.0.0.1:38473`에만 바인딩하며 외부 네트워크에서는 접근할 수 없다.
- `https://hwip.dshs.dev`와 로컬 개발 Origin만 허용한다.
- 임의 한글 Automation 명령을 받지 않고 수식 개체 생성·복사만 제공한다.
- HTTP 본문 1MB, 수식 50,000자, 처리 15초, 동시 처리 1건으로 제한한다.
- 프로그램 종료 시 숨겨진 한글 Automation 인스턴스도 종료한다.

## 빌드

Windows PowerShell에서 다음을 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File companion/windows/build.ps1
```

Windows에 포함된 .NET Framework C# 컴파일러를 사용하며 별도 패키지를 내려받지 않는다. 결과물은 `public/downloads/HwipCompanion.exe`와 SHA-256 파일이다.

## API

- `GET /health`
- `POST /v1/equation/copy` — `{ "equation": "{a} over {b}" }`

브라우저의 Private Network Access preflight를 위해 `OPTIONS`와 `Access-Control-Allow-Private-Network: true`를 지원한다.
