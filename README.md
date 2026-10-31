# 안전보건 자료 분석

MSDS(물질안전보건자료) PDF를 올리면 제품별로 정리하고, 회사 양식(MSDS 취급현황표)과 엑셀·PDF 보고서를 만들어 주는 웹 도구입니다.

- 올린 파일은 각자의 PC 브라우저 안에서만 처리되며, 서버로 전송되거나 저장되지 않습니다.
- 결과 파일은 사용자의 PC로만 내려받아집니다.

## 구성

- `index.html`, `css/`, `js/`: 화면과 분석 코드
- `vendor/`: pdf.js, SheetJS, pdfmake, JSZip
- `fonts/`: PDF 보고서용 나눔고딕
- `templates/msds-template.js`: 기본 양식(분석_물질안전보건자료.ver002.xlsx)
