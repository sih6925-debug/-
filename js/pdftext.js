// PDF 텍스트 조각을 화면상의 줄 단위로 다시 모은다.
// pdf.js가 주는 조각(item)은 좌표만 있고 줄 구분이 없어서, y 좌표가 같은 조각을 한 줄로 묶는다.
(function (root) {
  function itemsToLines(items) {
    const parts = items
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: Math.abs(it.transform[3]) || 10,
      }));
    parts.sort((a, b) => b.y - a.y || a.x - b.x);

    const rows = [];
    for (const p of parts) {
      const row = rows.find((r) => Math.abs(r.y - p.y) < Math.max(2, p.h * 0.35));
      // 굵게 보이려고 같은 글자를 겹쳐 찍은 PDF가 있어서, 거의 같은 자리의 같은 글자는 한 번만 쓴다.
      if (row && row.parts.some((q) => q.str === p.str && Math.abs(q.x - p.x) < p.h * 0.5)) continue;
      if (row) row.parts.push(p);
      else rows.push({ y: p.y, parts: [p] });
    }
    rows.sort((a, b) => b.y - a.y);

    return rows.map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const p of r.parts) {
        if (end !== null) {
          const gap = p.x - end;
          if (gap > p.h * 1.5) line += '    '; // 표의 칸 사이
          else if (gap > p.h * 0.15) line += ' ';
        }
        line += p.str;
        end = p.x + p.w;
      }
      return line.replace(/\s+$/, '');
    });
  }

  // pdfjsLib 문서 객체 → [[줄, 줄, ...], ...] (쪽마다)
  async function pdfToPages(pdf) {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items));
    }
    return pages;
  }

  const api = { itemsToLines, pdfToPages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
