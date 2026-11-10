# 휩 브라우저 확장

Chrome과 Chromium 기반 Microsoft Edge에서 동작하는 Manifest V3 확장입니다.

- 렌더링된 수식 위에 `HWP 복사` 버튼을 표시합니다.
- 텍스트와 수식이 섞인 선택 영역을 `Ctrl+C`로 복사하면 각 수식을 변환합니다.
- Windows 보조 프로그램이 선택 영역을 일반 텍스트와 편집 가능한 한글 수식 개체로 재구성합니다.

## 로컬 확인

1. `chrome://extensions` 또는 `edge://extensions`를 엽니다.
2. 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 폴더를 선택합니다.
4. `HwipCompanion.exe`를 실행합니다.
5. 지원되는 AI 사이트에서 텍스트와 수식이 섞인 영역을 선택해 `Ctrl+C`한 뒤 한글에서 `Ctrl+V`합니다.

Chrome 웹 스토어 배포본은 이 폴더를 ZIP으로 압축해 새 버전으로 업로드합니다. `manifest.json`의 버전은 기존 게시 버전보다 높아야 합니다.
