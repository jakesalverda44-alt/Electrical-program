(function () {
  const BUTTON_ID = 'kohler-crm-pull-btn';

  // Salesforce Lightning components live inside (mostly open) shadow roots, so a
  // plain document.querySelector can't see them. Walk every shadow root too.
  function deepQuerySelector(selector, root) {
    root = root || document;
    const found = root.querySelector(selector);
    if (found) return found;
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const r = deepQuerySelector(selector, el.shadowRoot);
        if (r) return r;
      }
    }
    return null;
  }

  function getOpportunityId() {
    const m = location.pathname.match(/\/opportunity\/([a-zA-Z0-9]{15,18})\b/);
    return m ? m[1] : null;
  }

  function extractLead() {
    const nameEl = deepQuerySelector('lightning-formatted-text[slot="primaryField"]');
    const phoneEl = deepQuerySelector('a[href^="tel:"]');
    const emailEl = deepQuerySelector('a[href^="mailto:"]');
    const addrLinkEl = deepQuerySelector('lightning-formatted-address a[aria-label]');

    return {
      name: nameEl ? nameEl.textContent.trim() : '',
      phone: phoneEl ? phoneEl.textContent.trim() : '',
      email: emailEl ? emailEl.textContent.trim() : '',
      address: addrLinkEl ? addrLinkEl.getAttribute('aria-label').replace(/\n+/g, ', ').trim() : '',
    };
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 999999,
      padding: '12px 20px',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '700',
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      boxShadow: '0 4px 14px rgba(0,0,0,.25)',
      cursor: 'pointer',
    });
    document.body.appendChild(btn);
    return btn;
  }

  function setButtonState(btn, state, message) {
    btn.disabled = state === 'loading';
    if (state === 'idle') {
      btn.textContent = 'Pull into CRM';
      btn.style.background = '#1b5fd4';
    } else if (state === 'loading') {
      btn.textContent = 'Pulling…';
      btn.style.background = '#6b7280';
    } else if (state === 'success') {
      btn.textContent = message || 'Pulled into CRM ✓';
      btn.style.background = '#16a34a';
    } else if (state === 'error') {
      btn.textContent = message || 'Failed — click to retry';
      btn.style.background = '#dc2626';
    }
  }

  function handleClick(btn) {
    const oppId = getOpportunityId();
    const { name, phone, email, address } = extractLead();

    if (!name) {
      setButtonState(btn, 'error', 'No name found — retry');
      setTimeout(() => setButtonState(btn, 'idle'), 3000);
      return;
    }

    setButtonState(btn, 'loading');

    const payload = {
      name,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      source: 'kohler',
      external_lead_id: oppId || undefined,
      notes: `Kohler opportunity: ${location.href}`,
    };

    chrome.runtime.sendMessage({ type: 'CREATE_LEAD', payload }, (res) => {
      if (chrome.runtime.lastError) {
        setButtonState(btn, 'error', 'Extension error — retry');
        setTimeout(() => setButtonState(btn, 'idle'), 3000);
        return;
      }
      if (res && res.ok) {
        setButtonState(btn, 'success', 'Pulled into CRM ✓');
      } else {
        setButtonState(btn, 'error', (res && res.error) || 'Failed — retry');
        setTimeout(() => setButtonState(btn, 'idle'), 4000);
      }
    });
  }

  // Salesforce is a single-page app: URL changes without a full page reload, so
  // poll for navigation instead of relying on a fresh content-script injection.
  let lastHref = '';
  function tick() {
    const isOppPage = /\/partnerhq\/s\/opportunity\//.test(location.pathname);
    let btn = document.getElementById(BUTTON_ID);

    if (!isOppPage) {
      if (btn) btn.remove();
      lastHref = location.href;
      return;
    }

    if (location.href !== lastHref) {
      lastHref = location.href;
      if (btn) { btn.remove(); btn = null; }
    }

    if (!btn) {
      btn = makeButton();
      btn.addEventListener('click', () => handleClick(btn));
      setButtonState(btn, 'idle');
    }
  }

  setInterval(tick, 1000);
  tick();
})();
