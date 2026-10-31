// 만든 파일을 사용자의 PC로 내려받게 한다.
// Claude 미리보기 안에서는 downloads 기능을, 일반 브라우저에서는 <a download>를 쓴다.
(function (root) {
  let downloadsPromise = null;
  function claudeDownloads() {
    if (!root.claude || typeof root.claude.use !== 'function') return Promise.resolve(null);
    if (!downloadsPromise) downloadsPromise = root.claude.use('downloads').catch(() => null);
    return downloadsPromise;
  }

  async function saveFile(filename, blob) {
    const downloads = await claudeDownloads();
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return 'saved';
      } catch (e) {
        if (e && e.code === 'declined') return 'declined';
        if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) throw e;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved';
  }

  root.SaveFile = { saveFile };
})(window);
