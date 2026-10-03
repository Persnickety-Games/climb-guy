// In-game feedback: a free-text box that sends to a Google Form, so responses
// land in the form (and its Google Sheet). No server of our own. Each message
// also carries a few details to help with bugs: mode, best, dailies played,
// screen size and browser. The feedback button stays hidden until the form is set.
window.Feedback = (() => {
  'use strict';

  // From the form's pre-filled link: the form id and each question's entry id.
  const FORM = { id: '', text: '', contact: '', details: '' };
  const ready = !!(FORM.id && FORM.text);

  const $ = (id) => document.getElementById(id);
  const root = $('feedback');
  let details = () => '';

  function open() {
    root.hidden = false;
    $('fb-status').textContent = '';
    $('fb-send').disabled = false;
    setTimeout(() => $('fb-text').focus(), 50);
  }

  function close() {
    root.hidden = true;
  }

  async function send() {
    const text = $('fb-text').value.trim();
    if (!text) { $('fb-status').textContent = 'Type something first.'; return; }
    $('fb-send').disabled = true;
    $('fb-status').textContent = 'Sending…';
    const body = new URLSearchParams({ [FORM.text]: text });
    const contact = $('fb-contact').value.trim();
    if (FORM.contact && contact) body.set(FORM.contact, contact);
    if (FORM.details) body.set(FORM.details, details());
    try {
      // Google Forms doesn't allow reading the reply from another site, so this
      // can't confirm delivery; a network failure still throws.
      await fetch(`https://docs.google.com/forms/d/e/${FORM.id}/formResponse`, { method: 'POST', mode: 'no-cors', body });
      $('fb-text').value = '';
      $('fb-status').textContent = 'Thanks! Got it. 🙌';
      if (window.Analytics) Analytics.event('feedback-sent');
      setTimeout(close, 1400);
    } catch {
      $('fb-status').textContent = "Couldn't send. Check your connection and try again.";
      $('fb-send').disabled = false;
    }
  }

  $('fb-send').addEventListener('click', send);
  $('fb-text').addEventListener('input', () => { if ($('fb-status').textContent === 'Type something first.') $('fb-status').textContent = ''; });
  $('fb-cancel').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  for (const b of document.querySelectorAll('.feedback-btn')) {
    b.hidden = !ready;
    b.addEventListener('click', open);
  }

  return { open, close, isOpen: () => !root.hidden, set details(fn) { details = fn; }, ready };
})();
