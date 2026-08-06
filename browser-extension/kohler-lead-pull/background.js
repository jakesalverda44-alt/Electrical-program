importScripts('config.js');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'CREATE_LEAD') return false;

  (async () => {
    try {
      const res = await fetch(`${CRM_BASE_URL}/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CRM_API_KEY,
        },
        body: JSON.stringify(msg.payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        sendResponse({ ok: false, error: data.error || `CRM returned ${res.status}` });
        return;
      }
      sendResponse({ ok: true, lead: data });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
