// Background service worker: does the POST so page CSP/CORS is irrelevant.
// Falls back to downloading the payload as JSON for the inbox watcher.
importScripts('config.js');

async function postCapture(payload) {
  const res = await fetch(`${SNIPER_BASE}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text}`.trim());
  }
  return res.json();
}

function downloadFallback(payload) {
  // Service workers can't use URL.createObjectURL on a Blob in MV3; use a data URL.
  const json = JSON.stringify(payload);
  const dataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(json)));
  const slug = (payload.url.match(/\/in\/([^/?#]+)/) || [])[1] || 'profile';
  return new Promise((resolve) => {
    chrome.downloads.download(
      { url: dataUrl, filename: `sniper-${slug}-${Date.now()}.json`, saveAs: false },
      () => resolve()
    );
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind !== 'capture') return;
  (async () => {
    try {
      await postCapture(msg.payload);
      sendResponse({ ok: true });
    } catch (err) {
      console.warn('[sniper] POST failed, downloading fallback', err);
      try {
        await downloadFallback(msg.payload);
        sendResponse({ ok: false, downloaded: true });
      } catch (dlErr) {
        sendResponse({ ok: false, error: `${err.message}; fallback failed: ${dlErr.message}` });
      }
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
