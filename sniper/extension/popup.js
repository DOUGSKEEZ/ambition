// Popup: load companies, then on Capture inject the collector and hand the
// payload to the background worker for POSTing.
const statusEl = document.getElementById('status');
const captureBtn = document.getElementById('capture');
const supportBtn = document.getElementById('capture-support');

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || '';
}

async function loadCompanies() {
  const sel = document.getElementById('company');
  try {
    const res = await fetch(`${SNIPER_BASE}/companies`);
    const list = await res.json();
    sel.innerHTML = '';
    if (!list.length) {
      sel.innerHTML = '<option value="">(none — add in review UI)</option>';
      return;
    }
    for (const c of list) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    }
  } catch (err) {
    sel.innerHTML = '<option value="">(could not reach Sniper)</option>';
    setStatus(`Companies load failed: ${err.message}`, 'err');
  }
}

// Runs in the page context (already-authenticated tab). ASYNC so we can scroll the
// page first — LinkedIn lazy-loads Experience/Education only when they enter view, so
// without scrolling those sections never exist in the captured HTML.
async function collectFromPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Scroll down in steps to trigger lazy-loading of every section, then back to top.
  const total = document.body.scrollHeight;
  for (let y = 0; y <= total; y += Math.max(400, window.innerHeight * 0.8)) {
    window.scrollTo(0, y);
    await sleep(350);
  }
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(500);
  window.scrollTo(0, 0);
  await sleep(300);

  const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => s.textContent);

  // Read the profile photo as a data URL. The profile owner's picture has alt == the
  // person's name; the top-nav "Me" avatar (the viewer) must be skipped, else we'd grab
  // Doug's own face. We pick the largest displayphoto whose alt matches the <h1> name.
  function photoDataUrl() {
    const ownerName = (document.querySelector('h1')?.textContent || '').trim();
    const imgs = [...document.images].filter((i) => /displayphoto/i.test(i.currentSrc || i.src || ''));
    const inNav = (i) => !!i.closest('header, nav, .global-nav, [class*="global-nav"]');
    const score = (i) => {
      const alt = (i.alt || '').trim();
      let s = 0;
      if (ownerName && alt === ownerName) s += 100;
      else if (ownerName && alt.includes(ownerName)) s += 50;
      if (inNav(i)) s -= 1000;            // strongly avoid the viewer's nav avatar
      s += (i.naturalWidth || 0);          // prefer the bigger, fully-loaded image
      return s;
    };
    const img = imgs.filter((i) => i.complete && i.naturalWidth > 60).sort((a, b) => score(b) - score(a))[0];
    if (!img) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return null; // cross-origin taint — server falls back to downloading photo_url
    }
  }

  return {
    url: location.href,
    html: document.documentElement.outerHTML,
    jsonld,
    photo: photoDataUrl(),
  };
}

// destination null = normal Sniper staging; 'support' = personal network (Support app :7707,
// hidden import_status, no AI enrichment) — same endpoint, the server routes on the flag.
async function doCapture(destination) {
  captureBtn.disabled = supportBtn.disabled = true;
  setStatus('Capturing…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/linkedin\.com\/in\//.test(tab.url || '')) {
      throw new Error('Open a LinkedIn profile (/in/...) first');
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectFromPage,
    });

    const payload = {
      ...result,
      company_id: document.getElementById('company').value
        ? Number(document.getElementById('company').value) : null,
      type: document.getElementById('type').value,
      priority: document.getElementById('priority').value
        ? Number(document.getElementById('priority').value) : null,
      my_notes: document.getElementById('notes').value.trim() || null,
      captured_at: new Date().toISOString(),
    };
    if (destination) payload.destination = destination;

    // Fire-and-forget: hand the payload to the background worker and report success
    // immediately. The background does the POST (and download fallback) on its own;
    // the server stages the row at once and synthesizes AI notes in the background.
    chrome.runtime.sendMessage({ kind: 'capture', payload }).then((resp) => {
      if (resp?.downloaded) setStatus('Saved to Downloads (inbox fallback)', 'ok');
      else if (resp && !resp.ok) setStatus(`✗ ${resp.error || 'send failed'}`, 'err');
    }).catch(() => { /* popup may already be closed; background still completes */ });

    setStatus(destination === 'support'
      ? '✓ Captured — sent to Support' : '✓ Captured — staging in Sniper', 'ok');
  } catch (err) {
    setStatus(`✗ ${err.message}`, 'err');
  }
  captureBtn.disabled = supportBtn.disabled = false;
}

captureBtn.onclick = () => doCapture(null);
supportBtn.onclick = () => doCapture('support');

loadCompanies();
