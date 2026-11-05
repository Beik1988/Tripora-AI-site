const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9() .\-]{7,30}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanString(value, maxLength) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength)
    : '';
}

function isValidDate(value) {
  if (!ISO_DATE_RE.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload.' });
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request payload.' });
  }

  const payload = {
    name: cleanString(body.name, 100),
    email: cleanString(body.email, 254).toLowerCase(),
    phone: cleanString(body.phone, 30),
    destination: cleanString(body.destination, 100),
    travel_dates: cleanString(body.travel_dates, 10),
    budget: Number(body.budget),
    message: cleanString(body.message, 2000),
    consent: body.consent === true,
    lead_source: 'contact',
    timezone: cleanString(body.timezone, 64) || 'Asia/Tehran',
    submitted_at: cleanString(body.submitted_at, 40) || new Date().toISOString(),
    event_id: cleanString(body.event_id, 128)
  };

  const errors = {};
  if (payload.name.length < 2) errors.name = 'Please enter your full name.';
  if (!EMAIL_RE.test(payload.email)) errors.email = 'Please enter a valid email address.';
  if (payload.phone && !PHONE_RE.test(payload.phone)) errors.phone = 'Please enter a valid phone number.';
  if (payload.destination.length < 2) errors.destination = 'Please enter a destination.';
  if (!isValidDate(payload.travel_dates)) errors.travel_dates = 'Please enter a valid travel date.';
  if (!Number.isFinite(payload.budget) || payload.budget < 1 || payload.budget > 1000000) errors.budget = 'Please enter a valid budget.';
  if (payload.message.length < 10) errors.message = 'Please enter a message of at least 10 characters.';
  if (!payload.consent) errors.consent = 'Consent is required.';

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please check the form fields.', fields: errors });
  }

  // Email delivery is opt-in; existing webhook deployments keep their behavior.
  const delivery = process.env.CONTACT_DELIVERY || 'webhook';
  if (!['email', 'webhook'].includes(delivery)) {
    return res.status(503).json({ error: 'The contact service configuration is invalid.' });
  }

  let target;
  let headers = { 'Content-Type': 'application/json' };
  let outgoing = { ...payload, server_received_at: new Date().toISOString() };
  if (delivery === 'email') {
    const apiKey = process.env.RESEND_API_KEY;
    const recipient = process.env.CONTACT_EMAIL_TO;
    const sender = process.env.CONTACT_EMAIL_FROM;
    if (!apiKey || !recipient || !EMAIL_RE.test(recipient) || !sender) {
      return res.status(503).json({ error: 'The contact service is not configured yet.' });
    }
    target = new URL('https://api.resend.com/emails');
    headers.Authorization = 'Bearer ' + apiKey;
    outgoing = {
      from: sender,
      to: [recipient],
      reply_to: payload.email,
      subject: 'New Tripora travel request',
      text: Object.entries(payload).map(([key, value]) => key + ': ' + value).join('\n')
    };
  } else {
    const webhookUrl = process.env.N8N_WEBHOOK_PRODUCTION_URL;
    if (!webhookUrl) {
      return res.status(503).json({ error: 'The contact service is not configured yet.' });
    }
    try { target = new URL(webhookUrl); } catch {
      return res.status(503).json({ error: 'The contact service configuration is invalid.' });
    }
    if (target.protocol !== 'https:') {
      return res.status(503).json({ error: 'The contact service configuration is invalid.' });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(outgoing),
      signal: controller.signal
    });

    if (!upstream.ok) {
      console.error('Contact delivery returned status', upstream.status);
      return res.status(502).json({ error: 'Your request could not be delivered. Please try again.' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Contact delivery failed:', error?.name || 'Error');
    return res.status(502).json({
      error: error?.name === 'AbortError'
        ? 'The contact service timed out. Please try again.'
        : 'Your request could not be delivered. Please try again.'
    });
  } finally {
    clearTimeout(timer);
  }
}
