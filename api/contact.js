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

  const webhookUrl = process.env.VERCEL_ENV === 'production'
    ? process.env.N8N_WEBHOOK_PRODUCTION_URL
    : process.env.N8N_WEBHOOK_TEST_URL;

  if (!webhookUrl) {
    console.error('Missing n8n webhook environment variable.');
    return res.status(503).json({ error: 'The contact service is not configured yet.' });
  }

  let target;
  try {
    target = new URL(webhookUrl);
  } catch {
    console.error('Invalid n8n webhook URL.');
    return res.status(503).json({ error: 'The contact service configuration is invalid.' });
  }

  if (target.protocol !== 'https:') {
    return res.status(503).json({ error: 'The contact service configuration is invalid.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        server_received_at: new Date().toISOString()
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      console.error('n8n webhook returned status', upstream.status);
      return res.status(502).json({ error: 'Your request could not be delivered. Please try again.' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('n8n webhook request failed', error);
    return res.status(502).json({
      error: error?.name === 'AbortError'
        ? 'The contact service timed out. Please try again.'
        : 'Your request could not be delivered. Please try again.'
    });
  } finally {
    clearTimeout(timer);
  }
}
