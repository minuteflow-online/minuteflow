/**
 * MinuteFlow Chrome Extension — Content Script
 *
 * Injects toast notification UI into web pages.
 * Listens for messages from the background service worker.
 */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__minuteflow_content_loaded) return;
  window.__minuteflow_content_loaded = true;

  // ---------------------------------------------------------------------------
  // Toast Container
  // ---------------------------------------------------------------------------

  let toastContainer = null;

  function ensureContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return toastContainer;

    toastContainer = document.createElement('div');
    toastContainer.id = 'minuteflow-toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  // ---------------------------------------------------------------------------
  // Show Toast
  // ---------------------------------------------------------------------------

  function showToast(message, options = {}) {
    const container = ensureContainer();

    const toast = document.createElement('div');
    toast.className = 'minuteflow-toast';

    // Icon
    const icon = document.createElement('div');
    icon.className = 'minuteflow-toast-icon';
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>`;

    // Content
    const content = document.createElement('div');
    content.className = 'minuteflow-toast-content';

    const title = document.createElement('div');
    title.className = 'minuteflow-toast-title';
    title.textContent = options.title || 'MinuteFlow';

    const body = document.createElement('div');
    body.className = 'minuteflow-toast-body';
    body.textContent = message;

    content.appendChild(title);
    content.appendChild(body);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'minuteflow-toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
      toast.classList.add('minuteflow-toast-exit');
      setTimeout(() => toast.remove(), 300);
    });

    toast.appendChild(icon);
    toast.appendChild(content);
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('minuteflow-toast-visible');
    });

    // Auto-dismiss after 8 seconds
    const duration = options.duration || 8000;
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('minuteflow-toast-exit');
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);

    return toast;
  }

  // ---------------------------------------------------------------------------
  // Capture Indicator
  // ---------------------------------------------------------------------------

  function showCaptureIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'minuteflow-capture-indicator';
    indicator.innerHTML = `
      <div class="minuteflow-capture-dot"></div>
      <span>Screenshot captured</span>
    `;
    document.body.appendChild(indicator);

    requestAnimationFrame(() => {
      indicator.classList.add('minuteflow-capture-visible');
    });

    setTimeout(() => {
      indicator.classList.add('minuteflow-capture-exit');
      setTimeout(() => indicator.remove(), 500);
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Message Listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MINUTEFLOW_TOAST') {
      showToast(msg.message, {
        title: msg.title || 'Message from Admin',
        duration: msg.duration || 8000,
      });
      sendResponse({ received: true });
    }

    if (msg.type === 'MINUTEFLOW_CAPTURE_INDICATOR') {
      showCaptureIndicator();
      sendResponse({ received: true });
    }
  });
})();
