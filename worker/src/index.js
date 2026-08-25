/**
 * SeguidoresCripto — Cloudflare Worker
 * Endpoints:
 *   POST /api/order          → cria pedido + gera invoice de pagamento
 *   GET  /api/status/:id     → consulta status do pedido
 *   POST /webhooks/nowpayments   → confirma pagamento cripto
 *   POST /webhooks/mercadopago   → confirma pagamento PIX
 *
 * Env vars (wrangler secret put):
 *   NOWPAYMENTS_API_KEY     → chave NOWPayments
 *   NOWPAYMENTS_IPN_SECRET  → segredo IPN NOWPayments
 *   MP_ACCESS_TOKEN         → Mercado Pago access token
 *   SMM_API_KEY             → chave do painel SMM (SMMHub ou similar)
 *   SMM_API_URL             → URL do painel SMM (ex: https://smmhub.com.br/api/v2)
 *   WORKER_BASE_URL         → URL pública deste worker (ex: https://smm.seudominio.workers.dev)
 *
 * KV binding (wrangler.toml):
 *   ORDERS                  → KV namespace para pedidos
 */

// ─── Catálogo de serviços ─────────────────────────────────────────────
// Substitua os smmId pelos IDs reais do seu painel SMM
// Para listar: POST { key: "SUA_KEY", action: "services" } na URL do painel
// priceBRL = preço cobrado do cliente (margem 40% sobre custo SMM)
// smmCost  = referência do custo base no painel (apenas documentação)
const CATALOG = {
  // Seguidores
  'ig_seg_1k':   { name: 'Seguidores Instagram 1K',    qty: 1000,  priceBRL: 6.99,  smmCost: 4.99,  smmId: '0' },
  'tt_seg_1k':   { name: 'Seguidores TikTok 1K',       qty: 1000,  priceBRL: 5.59,  smmCost: 3.99,  smmId: '0' },
  'yt_sub_1k':   { name: 'Inscritos YouTube 1K',       qty: 1000,  priceBRL: 9.79,  smmCost: 6.99,  smmId: '0' },
  'fb_seg_1k':   { name: 'Seguidores Facebook 1K',     qty: 1000,  priceBRL: 8.39,  smmCost: 5.99,  smmId: '0' },
  'ig_seg_5k':   { name: 'Seguidores Instagram 5K',    qty: 5000,  priceBRL: 27.90, smmCost: 19.90, smmId: '0' },
  'tt_seg_10k':  { name: 'Seguidores TikTok 10K',      qty: 10000, priceBRL: 41.90, smmCost: 29.90, smmId: '0' },
  // Visualizações
  'yt_view_5k':  { name: 'Visualizações YouTube 5K',   qty: 5000,  priceBRL: 13.99, smmCost: 9.99,  smmId: '0' },
  'tt_view_5k':  { name: 'Visualizações TikTok 5K',    qty: 5000,  priceBRL: 11.19, smmCost: 7.99,  smmId: '0' },
  'ig_view_5k':  { name: 'Views Instagram Reels 5K',   qty: 5000,  priceBRL: 8.39,  smmCost: 5.99,  smmId: '0' },
  'yt_view_15k': { name: 'Views YouTube 15K',          qty: 15000, priceBRL: 20.99, smmCost: 14.99, smmId: '0' },
  // Curtidas
  'ig_like_1k':  { name: 'Curtidas Instagram 1K',      qty: 1000,  priceBRL: 4.19,  smmCost: 2.99,  smmId: '0' },
  'tt_like_1k':  { name: 'Curtidas TikTok 1K',         qty: 1000,  priceBRL: 2.79,  smmCost: 1.99,  smmId: '0' },
  'fb_like_1k':  { name: 'Curtidas Facebook 1K',       qty: 1000,  priceBRL: 4.89,  smmCost: 3.49,  smmId: '0' },
  'yt_like_1k':  { name: 'Curtidas YouTube 1K',        qty: 1000,  priceBRL: 34.90, smmCost: 24.90, smmId: '0' },
  // Comentários
  'ig_cmt_10':   { name: 'Comentários Instagram 10',   qty: 10,    priceBRL: 6.99,  smmCost: 4.99,  smmId: '0' },
  'tt_cmt_10':   { name: 'Comentários TikTok 10',      qty: 10,    priceBRL: 9.79,  smmCost: 6.99,  smmId: '0' },
  'yt_cmt_10':   { name: 'Comentários YouTube 10',     qty: 10,    priceBRL: 7.69,  smmCost: 5.49,  smmId: '0' },
};

// ─── Entrada principal ────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return corsOk();

    try {
      if (path === '/api/order' && request.method === 'POST')
        return addCors(await handleCreateOrder(request, env));

      if (path.startsWith('/api/status/') && request.method === 'GET') {
        const id = path.split('/').pop();
        return addCors(await handleGetStatus(id, env));
      }

      if (path === '/api/ticket' && request.method === 'POST')
        return addCors(await handleCreateTicket(request, env));

      if (path.startsWith('/api/ticket/') && request.method === 'GET') {
        const tid = path.split('/').pop();
        return addCors(await handleGetTicket(tid, env));
      }

      if (path === '/webhooks/nowpayments' && request.method === 'POST')
        return handleNowPaymentsWebhook(request, env);

      if (path === '/webhooks/mercadopago' && request.method === 'POST')
        return handleMercadoPagoWebhook(request, env);

      return addCors(json({ error: 'Not found' }, 404));
    } catch (e) {
      console.error(e);
      return addCors(json({ error: 'Internal error', detail: e.message }, 500));
    }
  }
};

// ─── POST /api/order ──────────────────────────────────────────────────
async function handleCreateOrder(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const { serviceId, link, paymentMethod } = body;

  if (!serviceId || !link || !paymentMethod)
    return json({ error: 'Missing: serviceId, link, paymentMethod' }, 400);

  const service = CATALOG[serviceId];
  if (!service) return json({ error: 'Service not found' }, 404);

  const validPayments = ['pix', 'btc', 'lightning', 'usdt', 'eth'];
  if (!validPayments.includes(paymentMethod))
    return json({ error: 'Invalid paymentMethod. Use: ' + validPayments.join(', ') }, 400);

  const orderId = 'SC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();

  const order = {
    id: orderId,
    serviceId,
    serviceName: service.name,
    smmId: service.smmId,
    qty: service.qty,
    link,
    priceBRL: service.priceBRL,
    paymentMethod,
    paymentStatus: 'pending',
    smmOrderId: null,
    smmStatus: 'pending',
    invoiceId: null,
    payAddress: null,
    payAmount: null,
    payCurrency: null,
    qrCode: null,
    qrBase64: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    if (paymentMethod === 'pix') {
      const inv = await createMercadoPagoPixInvoice(service.priceBRL, orderId, service.name, env);
      order.invoiceId = String(inv.id);
      order.qrCode    = inv.point_of_interaction?.transaction_data?.qr_code;
      order.qrBase64  = inv.point_of_interaction?.transaction_data?.qr_code_base64;
    } else {
      const payCurrency = paymentMethod === 'btc'       ? 'btc'
                        : paymentMethod === 'lightning'  ? 'btcln'
                        : paymentMethod === 'usdt'       ? 'usdttrc20'
                        : 'eth';
      const inv = await createNowPaymentsInvoice(service.priceBRL, payCurrency, orderId, service.name, env);
      order.invoiceId   = String(inv.payment_id);
      order.payAddress  = inv.pay_address;
      order.payAmount   = inv.pay_amount;
      order.payCurrency = inv.pay_currency;
      order.qrCode      = inv.qr_code || null;
    }
  } catch (e) {
    console.error('Payment provider error:', e.message);
    return json({ error: 'Payment provider error', detail: e.message }, 502);
  }

  await env.ORDERS.put(orderId, JSON.stringify(order), { expirationTtl: 604800 });

  return json({
    orderId,
    serviceName:   order.serviceName,
    qty:           order.qty,
    priceBRL:      order.priceBRL,
    paymentMethod: order.paymentMethod,
    payAddress:    order.payAddress,
    payAmount:     order.payAmount,
    payCurrency:   order.payCurrency,
    qrCode:        order.qrCode,
    qrBase64:      order.qrBase64,
    status:        order.paymentStatus,
  }, 201);
}

// ─── GET /api/status/:id ──────────────────────────────────────────────
async function handleGetStatus(orderId, env) {
  const raw = await env.ORDERS.get(orderId);
  if (!raw) return json({ error: 'Order not found' }, 404);
  const order = JSON.parse(raw);
  return json({
    orderId:       order.id,
    serviceName:   order.serviceName,
    qty:           order.qty,
    link:          order.link,
    paymentStatus: order.paymentStatus,
    smmStatus:     order.smmStatus,
    smmOrderId:    order.smmOrderId,
    createdAt:     order.createdAt,
    updatedAt:     order.updatedAt,
  });
}

// ─── POST /webhooks/nowpayments ───────────────────────────────────────
async function handleNowPaymentsWebhook(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return new Response('Bad Request', { status: 400 });

  const sig = request.headers.get('x-nowpayments-sig');
  if (env.NOWPAYMENTS_IPN_SECRET && sig) {
    const sorted = JSON.stringify(sortObject(body));
    const valid  = await verifyHmac(env.NOWPAYMENTS_IPN_SECRET, sorted, sig);
    if (!valid) return new Response('Invalid signature', { status: 403 });
  }

  const { order_id, payment_status } = body;
  if (!order_id) return new Response('Missing order_id', { status: 400 });

  const raw = await env.ORDERS.get(order_id);
  if (!raw) return new Response('Order not found', { status: 404 });
  const order = JSON.parse(raw);

  const confirmed = ['confirmed', 'sending', 'finished'].includes(payment_status);
  if (confirmed && order.paymentStatus !== 'confirmed') {
    order.paymentStatus = 'confirmed';
    order.updatedAt = new Date().toISOString();
    await dispatchSmmOrder(order, env);
    await env.ORDERS.put(order.id, JSON.stringify(order), { expirationTtl: 604800 });
  } else if (['failed', 'expired'].includes(payment_status)) {
    order.paymentStatus = 'failed';
    order.updatedAt = new Date().toISOString();
    await env.ORDERS.put(order.id, JSON.stringify(order), { expirationTtl: 604800 });
  }

  return new Response('OK');
}

// ─── POST /webhooks/mercadopago ───────────────────────────────────────
async function handleMercadoPagoWebhook(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return new Response('Bad Request', { status: 400 });

  if (body.type !== 'payment') return new Response('OK');

  const paymentId = body.data?.id;
  if (!paymentId) return new Response('OK');

  const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!mpResp.ok) return new Response('MP fetch error', { status: 502 });
  const payment = await mpResp.json();

  const orderId = payment.external_reference;
  if (!orderId) return new Response('No external_reference', { status: 400 });

  const raw = await env.ORDERS.get(orderId);
  if (!raw) return new Response('Order not found', { status: 404 });
  const order = JSON.parse(raw);

  if (payment.status === 'approved' && order.paymentStatus !== 'confirmed') {
    order.paymentStatus = 'confirmed';
    order.updatedAt = new Date().toISOString();
    await dispatchSmmOrder(order, env);
    await env.ORDERS.put(order.id, JSON.stringify(order), { expirationTtl: 604800 });
  }

  return new Response('OK');
}

// ─── SMM Panel: disparar pedido ───────────────────────────────────────
async function dispatchSmmOrder(order, env) {
  if (!env.SMM_API_KEY || !env.SMM_API_URL) {
    console.warn('SMM API not configured');
    order.smmStatus = 'pending';
    return;
  }
  if (order.smmId === '0') {
    console.warn(`smmId='0' para ${order.serviceId} — configure o CATALOG no worker`);
    order.smmStatus = 'needs_config';
    return;
  }
  try {
    const form = new URLSearchParams({
      key:      env.SMM_API_KEY,
      action:   'add',
      service:  order.smmId,
      link:     order.link,
      quantity: String(order.qty),
    });
    const resp = await fetch(env.SMM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await resp.json();
    if (data.order) {
      order.smmOrderId = String(data.order);
      order.smmStatus  = 'processing';
    } else {
      order.smmStatus = 'failed';
      console.error('SMM error:', JSON.stringify(data));
    }
  } catch (e) {
    order.smmStatus = 'failed';
    console.error('SMM dispatch error:', e.message);
  }
}

// ─── NOWPayments: criar invoice ───────────────────────────────────────
async function createNowPaymentsInvoice(amountBRL, payCurrency, orderId, description, env) {
  const baseUrl = env.WORKER_BASE_URL || 'https://smm-worker.your-subdomain.workers.dev';
  const resp = await fetch('https://api.nowpayments.io/v1/payment', {
    method: 'POST',
    headers: { 'x-api-key': env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_amount:       amountBRL,
      price_currency:     'brl',
      pay_currency:       payCurrency,
      order_id:           orderId,
      order_description:  description,
      ipn_callback_url:   `${baseUrl}/webhooks/nowpayments`,
    }),
  });
  if (!resp.ok) throw new Error(`NOWPayments ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ─── Mercado Pago PIX: criar invoice ──────────────────────────────────
async function createMercadoPagoPixInvoice(amountBRL, orderId, description, env) {
  const resp = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization:        `Bearer ${env.MP_ACCESS_TOKEN}`,
      'Content-Type':       'application/json',
      'X-Idempotency-Key':  orderId,
    },
    body: JSON.stringify({
      transaction_amount:  amountBRL,
      payment_method_id:   'pix',
      external_reference:  orderId,
      description,
      payer: { email: 'cliente@seguidorescripto.com' },
    }),
  });
  if (!resp.ok) throw new Error(`MercadoPago ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function addCors(response) {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers: h });
}

function corsOk() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function sortObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  return Object.fromEntries(Object.keys(obj).sort().map(k => [k, sortObject(obj[k])]));
}

async function verifyHmac(secret, message, signature) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify']);
  const sig = hexToBytes(signature);
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(message));
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  return arr;
}

// ─── Tickets de Suporte ───────────────────────────────────────────────
async function handleCreateTicket(request, env) {
  const body = await request.json().catch(() => ({}));
  const { orderId = '', message = '' } = body;
  if (!message.trim()) return jsonResponse({ error: 'Mensagem obrigatoria' }, 400);

  const ticketId = 'TK-' + Date.now().toString(36).toUpperCase().slice(-6) +
                   Math.random().toString(36).toUpperCase().slice(2, 5);
  const ticket = {
    ticketId,
    orderId:   orderId.trim(),
    message:   message.trim().slice(0, 2000),
    status:    'open',
    createdAt: new Date().toISOString(),
  };
  await env.ORDERS.put('ticket:' + ticketId, JSON.stringify(ticket), { expirationTtl: 60 * 60 * 24 * 90 }); // 90 dias
  return jsonResponse({ ticketId, status: 'open' });
}

async function handleGetTicket(ticketId, env) {
  const raw = await env.ORDERS.get('ticket:' + ticketId);
  if (!raw) return jsonResponse({ error: 'Ticket nao encontrado' }, 404);
  return jsonResponse(JSON.parse(raw));
}
