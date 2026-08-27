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
// PREÇOS SMM: rate = R$/1000 unidades no painel SMMHub (https://smmhub.com.br)
// ⚠️ Serviços marcados com REVISAR_PRECO têm custo > preço cobrado — ajuste priceBRL antes de ir live
const CATALOG = {

  // ── INSTAGRAM — Seguidores Mundiais (smmId 192, R$3.90/1K) ───────────
  'ig_seg_100':   { name: 'Seguidores Instagram 100',    qty: 100,    priceBRL: 1.19,   smmCost: 0.39,   smmId: '192' },
  'ig_seg_250':   { name: 'Seguidores Instagram 250',    qty: 250,    priceBRL: 2.49,   smmCost: 0.98,   smmId: '192' },
  'ig_seg_500':   { name: 'Seguidores Instagram 500',    qty: 500,    priceBRL: 3.99,   smmCost: 1.95,   smmId: '192' },
  'ig_seg_1k':    { name: 'Seguidores Instagram 1K',     qty: 1000,   priceBRL: 6.99,   smmCost: 3.90,   smmId: '192' },
  'ig_seg_2k':    { name: 'Seguidores Instagram 2K',     qty: 2000,   priceBRL: 12.90,  smmCost: 7.80,   smmId: '192' },
  'ig_seg_5k':    { name: 'Seguidores Instagram 5K',     qty: 5000,   priceBRL: 27.90,  smmCost: 19.50,  smmId: '192' },
  'ig_seg_10k':   { name: 'Seguidores Instagram 10K',    qty: 10000,  priceBRL: 49.90,  smmCost: 39.00,  smmId: '192' },
  'ig_seg_20k':   { name: 'Seguidores Instagram 20K',    qty: 20000,  priceBRL: 89.90,  smmCost: 78.00,  smmId: '192' },
  'ig_seg_50k':   { name: 'Seguidores Instagram 50K',    qty: 50000,  priceBRL: 199.90, smmCost: 195.00, smmId: '192' },
  'ig_seg_100k':  { name: 'Seguidores Instagram 100K',   qty: 100000, priceBRL: 369.90, smmCost: 390.00, smmId: '192' },

  // ── INSTAGRAM — Seguidores BR 🇧🇷 (smmId 937, R$9.00/1K · R30 · MELHOR OPÇÃO) ──
  'ig_seg_br_100':  { name: 'Seguidores BR Instagram 100',  qty: 100,   priceBRL: 2.49,   smmCost: 0.90,  smmId: '937' },
  'ig_seg_br_500':  { name: 'Seguidores BR Instagram 500',  qty: 500,   priceBRL: 7.90,   smmCost: 4.50,  smmId: '937' },
  'ig_seg_br_1k':   { name: 'Seguidores BR Instagram 1K',   qty: 1000,  priceBRL: 12.90,  smmCost: 9.00,  smmId: '937' },
  'ig_seg_br_2k':   { name: 'Seguidores BR Instagram 2K',   qty: 2000,  priceBRL: 24.90,  smmCost: 18.00, smmId: '937' },
  'ig_seg_br_5k':   { name: 'Seguidores BR Instagram 5K',   qty: 5000,  priceBRL: 59.90,  smmCost: 45.00, smmId: '937' },
  'ig_seg_br_10k':  { name: 'Seguidores BR Instagram 10K',  qty: 10000, priceBRL: 119.90, smmCost: 90.00, smmId: '937' },
  'ig_seg_br_20k':  { name: 'Seguidores BR Instagram 20K',  qty: 20000, priceBRL: 229.90, smmCost: 180.00,smmId: '937' },

  // ── INSTAGRAM — Curtidas Brasileiras (smmId 1016, R$1.90/1K) ─────────
  'ig_like_100':  { name: 'Curtidas Instagram 100',  qty: 100,   priceBRL: 0.79,   smmCost: 0.19,  smmId: '1016' },
  'ig_like_500':  { name: 'Curtidas Instagram 500',  qty: 500,   priceBRL: 2.29,   smmCost: 0.95,  smmId: '1016' },
  'ig_like_1k':   { name: 'Curtidas Instagram 1K',   qty: 1000,  priceBRL: 4.19,   smmCost: 1.90,  smmId: '1016' },
  'ig_like_2k':   { name: 'Curtidas Instagram 2K',   qty: 2000,  priceBRL: 7.90,   smmCost: 3.80,  smmId: '1016' },
  'ig_like_5k':   { name: 'Curtidas Instagram 5K',   qty: 5000,  priceBRL: 17.90,  smmCost: 9.50,  smmId: '1016' },
  'ig_like_10k':  { name: 'Curtidas Instagram 10K',  qty: 10000, priceBRL: 32.90,  smmCost: 19.00, smmId: '1016' },
  'ig_like_20k':  { name: 'Curtidas Instagram 20K',  qty: 20000, priceBRL: 59.90,  smmCost: 38.00, smmId: '1016' },
  'ig_like_50k':  { name: 'Curtidas Instagram 50K',  qty: 50000, priceBRL: 139.90, smmCost: 95.00, smmId: '1016' },

  // ── INSTAGRAM — Views Reels (smmId 800, R$0.80/1K) ───────────────────
  'ig_view_1k':    { name: 'Views Reels Instagram 1K',   qty: 1000,   priceBRL: 1.99,   smmCost: 0.80,  smmId: '800' },
  'ig_view_2k':    { name: 'Views Reels Instagram 2K',   qty: 2000,   priceBRL: 3.49,   smmCost: 1.60,  smmId: '800' },
  'ig_view_5k':    { name: 'Views Reels Instagram 5K',   qty: 5000,   priceBRL: 8.39,   smmCost: 4.00,  smmId: '800' },
  'ig_view_10k':   { name: 'Views Reels Instagram 10K',  qty: 10000,  priceBRL: 14.90,  smmCost: 8.00,  smmId: '800' },
  'ig_view_25k':   { name: 'Views Reels Instagram 25K',  qty: 25000,  priceBRL: 29.90,  smmCost: 20.00, smmId: '800' },
  'ig_view_50k':   { name: 'Views Reels Instagram 50K',  qty: 50000,  priceBRL: 54.90,  smmCost: 40.00, smmId: '800' },
  'ig_view_100k':  { name: 'Views Reels Instagram 100K', qty: 100000, priceBRL: 99.90,  smmCost: 80.00, smmId: '800' },
  'ig_view_500k':  { name: 'Views Reels Instagram 500K', qty: 500000, priceBRL: 449.90, smmCost: 400.00,smmId: '800' },

  // ── INSTAGRAM — Views BR 🇧🇷 (smmId 800, R$0.80/1K · "Visualizações Brasileiras") ──
  'ig_view_br_1k':   { name: 'Views BR Reels Instagram 1K',   qty: 1000,   priceBRL: 3.49,   smmCost: 0.80,  smmId: '800' },
  'ig_view_br_5k':   { name: 'Views BR Reels Instagram 5K',   qty: 5000,   priceBRL: 14.90,  smmCost: 4.00,  smmId: '800' },
  'ig_view_br_10k':  { name: 'Views BR Reels Instagram 10K',  qty: 10000,  priceBRL: 24.90,  smmCost: 8.00,  smmId: '800' },
  'ig_view_br_50k':  { name: 'Views BR Reels Instagram 50K',  qty: 50000,  priceBRL: 99.90,  smmCost: 40.00, smmId: '800' },
  'ig_view_br_100k': { name: 'Views BR Reels Instagram 100K', qty: 100000, priceBRL: 189.90, smmCost: 80.00, smmId: '800' },

  // ── INSTAGRAM — Comentários BR (smmId 1007, R$40/1K) ─────────────────
  'ig_cmt_10':   { name: 'Comentários Instagram 10',  qty: 10,  priceBRL: 6.99,  smmCost: 0.40, smmId: '1007' },
  'ig_cmt_20':   { name: 'Comentários Instagram 20',  qty: 20,  priceBRL: 12.90, smmCost: 0.80, smmId: '1007' },
  'ig_cmt_30':   { name: 'Comentários Instagram 30',  qty: 30,  priceBRL: 17.90, smmCost: 1.20, smmId: '1007' },
  'ig_cmt_50':   { name: 'Comentários Instagram 50',  qty: 50,  priceBRL: 27.90, smmCost: 2.00, smmId: '1007' },
  'ig_cmt_100':  { name: 'Comentários Instagram 100', qty: 100, priceBRL: 49.90, smmCost: 4.00, smmId: '1007' },

  // ── TIKTOK — Seguidores Mundiais (smmId 211, R$11/1K) ────────────────
  'tt_seg_100':   { name: 'Seguidores TikTok 100',   qty: 100,   priceBRL: 1.99,   smmCost: 1.10,  smmId: '211' },
  'tt_seg_500':   { name: 'Seguidores TikTok 500',   qty: 500,   priceBRL: 7.90,   smmCost: 5.50,  smmId: '211' },
  'tt_seg_1k':    { name: 'Seguidores TikTok 1K',    qty: 1000,  priceBRL: 14.90,  smmCost: 11.00, smmId: '211' },
  'tt_seg_2k':    { name: 'Seguidores TikTok 2K',    qty: 2000,  priceBRL: 27.90,  smmCost: 22.00, smmId: '211' },
  'tt_seg_5k':    { name: 'Seguidores TikTok 5K',    qty: 5000,  priceBRL: 64.90,  smmCost: 55.00, smmId: '939' },
  'tt_seg_10k':   { name: 'Seguidores TikTok 10K',   qty: 10000, priceBRL: 119.90, smmCost: 140.00,smmId: '939' },
  'tt_seg_20k':   { name: 'Seguidores TikTok 20K',   qty: 20000, priceBRL: 219.90, smmCost: 280.00,smmId: '939' },
  'tt_seg_50k':   { name: 'Seguidores TikTok 50K',   qty: 50000, priceBRL: 499.90, smmCost: 700.00,smmId: '939' },

  // ── TIKTOK — Seguidores BR 🇧🇷 (smmId 220, R$30/1K · Orgânicos 97% · R30) ──
  'tt_seg_br_500':  { name: 'Seguidores BR TikTok 500',  qty: 500,   priceBRL: 21.90,  smmCost: 15.00, smmId: '220' },
  'tt_seg_br_1k':   { name: 'Seguidores BR TikTok 1K',   qty: 1000,  priceBRL: 41.90,  smmCost: 30.00, smmId: '220' },
  'tt_seg_br_2k':   { name: 'Seguidores BR TikTok 2K',   qty: 2000,  priceBRL: 81.90,  smmCost: 60.00, smmId: '220' },
  'tt_seg_br_5k':   { name: 'Seguidores BR TikTok 5K',   qty: 5000,  priceBRL: 199.90, smmCost: 150.00,smmId: '220' },
  'tt_seg_br_10k':  { name: 'Seguidores BR TikTok 10K',  qty: 10000, priceBRL: 389.90, smmCost: 300.00,smmId: '220' },

  // ── TIKTOK — Curtidas (smmId 898, R$0.70/1K) ─────────────────────────
  'tt_like_100':  { name: 'Curtidas TikTok 100',   qty: 100,    priceBRL: 0.59,   smmCost: 0.07,  smmId: '898' },
  'tt_like_500':  { name: 'Curtidas TikTok 500',   qty: 500,    priceBRL: 1.99,   smmCost: 0.35,  smmId: '898' },
  'tt_like_1k':   { name: 'Curtidas TikTok 1K',    qty: 1000,   priceBRL: 2.79,   smmCost: 0.70,  smmId: '898' },
  'tt_like_5k':   { name: 'Curtidas TikTok 5K',    qty: 5000,   priceBRL: 11.90,  smmCost: 3.50,  smmId: '898' },
  'tt_like_10k':  { name: 'Curtidas TikTok 10K',   qty: 10000,  priceBRL: 21.90,  smmCost: 7.00,  smmId: '898' },
  'tt_like_50k':  { name: 'Curtidas TikTok 50K',   qty: 50000,  priceBRL: 99.90,  smmCost: 35.00, smmId: '898' },
  'tt_like_100k': { name: 'Curtidas TikTok 100K',  qty: 100000, priceBRL: 179.90, smmCost: 70.00, smmId: '898' },

  // ── TIKTOK — Visualizações (smmId 45, R$0.25/1K) ─────────────────────
  'tt_view_1k':    { name: 'Views TikTok 1K',    qty: 1000,    priceBRL: 1.49,   smmCost: 0.25,  smmId: '45' },
  'tt_view_5k':    { name: 'Views TikTok 5K',    qty: 5000,    priceBRL: 5.90,   smmCost: 1.25,  smmId: '45' },
  'tt_view_10k':   { name: 'Views TikTok 10K',   qty: 10000,   priceBRL: 11.19,  smmCost: 2.50,  smmId: '45' },
  'tt_view_25k':   { name: 'Views TikTok 25K',   qty: 25000,   priceBRL: 24.90,  smmCost: 6.25,  smmId: '45' },
  'tt_view_50k':   { name: 'Views TikTok 50K',   qty: 50000,   priceBRL: 44.90,  smmCost: 12.50, smmId: '45' },
  'tt_view_100k':  { name: 'Views TikTok 100K',  qty: 100000,  priceBRL: 84.90,  smmCost: 25.00, smmId: '45' },
  'tt_view_500k':  { name: 'Views TikTok 500K',  qty: 500000,  priceBRL: 369.90, smmCost: 125.00,smmId: '45' },
  'tt_view_1m':    { name: 'Views TikTok 1M',    qty: 1000000, priceBRL: 699.90, smmCost: 250.00,smmId: '45' },

  // ── TIKTOK — Views BR: SMMHub NÃO oferece views BR em vídeo TikTok.
  // Removido do catálogo para não bloquear pedidos com 503.

  // ── TIKTOK — Comentários (smmId 946, R$9.70/1K) ──────────────────────
  'tt_cmt_10':   { name: 'Comentários TikTok 10',  qty: 10,  priceBRL: 9.79,  smmCost: 0.10, smmId: '946' },
  'tt_cmt_20':   { name: 'Comentários TikTok 20',  qty: 20,  priceBRL: 18.90, smmCost: 0.19, smmId: '946' },
  'tt_cmt_30':   { name: 'Comentários TikTok 30',  qty: 30,  priceBRL: 24.90, smmCost: 0.29, smmId: '946' },
  'tt_cmt_50':   { name: 'Comentários TikTok 50',  qty: 50,  priceBRL: 39.90, smmCost: 0.49, smmId: '946' },
  'tt_cmt_100':  { name: 'Comentários TikTok 100', qty: 100, priceBRL: 69.90, smmCost: 0.97, smmId: '946' },

  // ── YOUTUBE — Inscritos Mundiais (smmId 1014, R$1/1K) ────────────────
  'yt_sub_100':   { name: 'Inscritos YouTube 100',   qty: 100,    priceBRL: 2.49,   smmCost: 0.10,  smmId: '1014' },
  'yt_sub_500':   { name: 'Inscritos YouTube 500',   qty: 500,    priceBRL: 5.99,   smmCost: 0.50,  smmId: '1014' },
  'yt_sub_1k':    { name: 'Inscritos YouTube 1K',    qty: 1000,   priceBRL: 9.79,   smmCost: 1.00,  smmId: '1014' },
  'yt_sub_2k':    { name: 'Inscritos YouTube 2K',    qty: 2000,   priceBRL: 18.90,  smmCost: 2.00,  smmId: '1014' },
  'yt_sub_5k':    { name: 'Inscritos YouTube 5K',    qty: 5000,   priceBRL: 44.90,  smmCost: 5.00,  smmId: '1014' },
  'yt_sub_10k':   { name: 'Inscritos YouTube 10K',   qty: 10000,  priceBRL: 79.90,  smmCost: 10.00, smmId: '1014' },
  'yt_sub_20k':   { name: 'Inscritos YouTube 20K',   qty: 20000,  priceBRL: 149.90, smmCost: 20.00, smmId: '1014' },
  'yt_sub_50k':   { name: 'Inscritos YouTube 50K',   qty: 50000,  priceBRL: 349.90, smmCost: 50.00, smmId: '1014' },
  'yt_sub_100k':  { name: 'Inscritos YouTube 100K',  qty: 100000, priceBRL: 649.90, smmCost: 100.00,smmId: '1014' },

  // ── YOUTUBE — Inscritos BR: SMMHub NÃO oferece inscritos BR para YouTube.
  // Removido do catálogo para não bloquear pedidos com 503.

  // ── YOUTUBE — Curtidas (smmId 988, R$4.50/1K) ────────────────────────
  'yt_like_100':  { name: 'Curtidas YouTube 100',  qty: 100,   priceBRL: 4.99,   smmCost: 0.45,  smmId: '988' },
  'yt_like_500':  { name: 'Curtidas YouTube 500',  qty: 500,   priceBRL: 19.90,  smmCost: 2.25,  smmId: '988' },
  'yt_like_1k':   { name: 'Curtidas YouTube 1K',   qty: 1000,  priceBRL: 34.90,  smmCost: 4.50,  smmId: '988' },
  'yt_like_2k':   { name: 'Curtidas YouTube 2K',   qty: 2000,  priceBRL: 64.90,  smmCost: 9.00,  smmId: '988' },
  'yt_like_5k':   { name: 'Curtidas YouTube 5K',   qty: 5000,  priceBRL: 149.90, smmCost: 22.50, smmId: '988' },
  'yt_like_10k':  { name: 'Curtidas YouTube 10K',  qty: 10000, priceBRL: 279.90, smmCost: 45.00, smmId: '988' },

  // ── YOUTUBE — Visualizações (smmId 463, R$5/1K) ──────────────────────
  'yt_view_500':   { name: 'Views YouTube 500',    qty: 500,    priceBRL: 3.49,    smmCost: 2.50,  smmId: '463' },
  'yt_view_1k':    { name: 'Views YouTube 1K',     qty: 1000,   priceBRL: 5.99,    smmCost: 5.00,  smmId: '463' },
  'yt_view_2k':    { name: 'Views YouTube 2K',     qty: 2000,   priceBRL: 10.90,   smmCost: 10.00, smmId: '463' },
  'yt_view_5k':    { name: 'Views YouTube 5K',     qty: 5000,   priceBRL: 24.90,   smmCost: 25.00, smmId: '463' },
  'yt_view_10k':   { name: 'Views YouTube 10K',    qty: 10000,  priceBRL: 44.90,   smmCost: 50.00, smmId: '463' },
  'yt_view_15k':   { name: 'Views YouTube 15K',    qty: 15000,  priceBRL: 64.90,   smmCost: 75.00, smmId: '463' },
  'yt_view_25k':   { name: 'Views YouTube 25K',    qty: 25000,  priceBRL: 99.90,   smmCost: 125.00,smmId: '463' },
  'yt_view_50k':   { name: 'Views YouTube 50K',    qty: 50000,  priceBRL: 179.90,  smmCost: 250.00,smmId: '463' },
  'yt_view_100k':  { name: 'Views YouTube 100K',   qty: 100000, priceBRL: 329.90,  smmCost: 500.00,smmId: '463' },
  'yt_view_500k':  { name: 'Views YouTube 500K',   qty: 500000, priceBRL: 1499.90, smmCost: 2500.00,smmId: '463' },

  // ── YOUTUBE — Tráfego BR 🇧🇷 (smmId 710, R$1.90/1K · Origem YouTube) ────
  'yt_view_br_1k':   { name: 'Views BR YouTube 1K',   qty: 1000,  priceBRL: 9.90,   smmCost: 1.90,  smmId: '710' },
  'yt_view_br_5k':   { name: 'Views BR YouTube 5K',   qty: 5000,  priceBRL: 39.90,  smmCost: 9.50,  smmId: '710' },
  'yt_view_br_10k':  { name: 'Views BR YouTube 10K',  qty: 10000, priceBRL: 69.90,  smmCost: 19.00, smmId: '710' },
  'yt_view_br_25k':  { name: 'Views BR YouTube 25K',  qty: 25000, priceBRL: 159.90, smmCost: 47.50, smmId: '710' },
  'yt_view_br_50k':  { name: 'Views BR YouTube 50K',  qty: 50000, priceBRL: 299.90, smmCost: 95.00, smmId: '710' },

  // ── YOUTUBE — Comentários (smmId 421, R$30/1K) ───────────────────────
  'yt_cmt_10':   { name: 'Comentários YouTube 10',  qty: 10,  priceBRL: 7.69,  smmCost: 0.30, smmId: '421' },
  'yt_cmt_20':   { name: 'Comentários YouTube 20',  qty: 20,  priceBRL: 13.90, smmCost: 0.60, smmId: '421' },
  'yt_cmt_30':   { name: 'Comentários YouTube 30',  qty: 30,  priceBRL: 19.90, smmCost: 0.90, smmId: '421' },
  'yt_cmt_50':   { name: 'Comentários YouTube 50',  qty: 50,  priceBRL: 29.90, smmCost: 1.50, smmId: '421' },
  'yt_cmt_100':  { name: 'Comentários YouTube 100', qty: 100, priceBRL: 54.90, smmCost: 3.00, smmId: '421' },

  // ── FACEBOOK — Seguidores (smmId 162, R$3.50/1K) ─────────────────────
  'fb_seg_100':   { name: 'Seguidores Facebook 100',   qty: 100,   priceBRL: 1.49,   smmCost: 0.35,  smmId: '162' },
  'fb_seg_500':   { name: 'Seguidores Facebook 500',   qty: 500,   priceBRL: 4.99,   smmCost: 1.75,  smmId: '162' },
  'fb_seg_1k':    { name: 'Seguidores Facebook 1K',    qty: 1000,  priceBRL: 8.39,   smmCost: 3.50,  smmId: '162' },
  'fb_seg_2k':    { name: 'Seguidores Facebook 2K',    qty: 2000,  priceBRL: 15.90,  smmCost: 7.00,  smmId: '162' },
  'fb_seg_5k':    { name: 'Seguidores Facebook 5K',    qty: 5000,  priceBRL: 34.90,  smmCost: 17.50, smmId: '162' },
  'fb_seg_10k':   { name: 'Seguidores Facebook 10K',   qty: 10000, priceBRL: 64.90,  smmCost: 35.00, smmId: '162' },
  'fb_seg_20k':   { name: 'Seguidores Facebook 20K',   qty: 20000, priceBRL: 119.90, smmCost: 70.00, smmId: '162' },

  // ── FACEBOOK — Curtidas (smmId 167, R$2.40/1K) ───────────────────────
  'fb_like_100':  { name: 'Curtidas Facebook 100',  qty: 100,   priceBRL: 0.99,  smmCost: 0.24, smmId: '167' },
  'fb_like_500':  { name: 'Curtidas Facebook 500',  qty: 500,   priceBRL: 2.99,  smmCost: 1.20, smmId: '167' },
  'fb_like_1k':   { name: 'Curtidas Facebook 1K',   qty: 1000,  priceBRL: 4.89,  smmCost: 2.40, smmId: '167' },
  'fb_like_5k':   { name: 'Curtidas Facebook 5K',   qty: 5000,  priceBRL: 19.90, smmCost: 12.00,smmId: '167' },
  'fb_like_10k':  { name: 'Curtidas Facebook 10K',  qty: 10000, priceBRL: 37.90, smmCost: 24.00,smmId: '167' },

  // ── FACEBOOK — Visualizações (smmId 890, R$1.00/1K · Retenção 3s) ─────
  'fb_view_1k':    { name: 'Views Facebook 1K',    qty: 1000,   priceBRL: 1.99,   smmCost: 1.00,  smmId: '890' },
  'fb_view_5k':    { name: 'Views Facebook 5K',    qty: 5000,   priceBRL: 8.90,   smmCost: 5.00,  smmId: '890' },
  'fb_view_10k':   { name: 'Views Facebook 10K',   qty: 10000,  priceBRL: 14.90,  smmCost: 10.00, smmId: '890' },
  'fb_view_50k':   { name: 'Views Facebook 50K',   qty: 50000,  priceBRL: 62.90,  smmCost: 50.00, smmId: '890' },
  'fb_view_100k':  { name: 'Views Facebook 100K',  qty: 100000, priceBRL: 119.90, smmCost: 100.00,smmId: '890' },

  // ── YOUTUBE — Curtidas BR 🇧🇷 (smmId 146, R$43.00/1K · R30) ──────────
  'yt_like_br_100':  { name: 'Curtidas BR YouTube 100',  qty: 100,   priceBRL: 7.99,   smmCost: 43.00,  smmId: '146' },
  'yt_like_br_500':  { name: 'Curtidas BR YouTube 500',  qty: 500,   priceBRL: 34.90,  smmCost: 43.00,  smmId: '146' },
  'yt_like_br_1k':   { name: 'Curtidas BR YouTube 1K',   qty: 1000,  priceBRL: 64.90,  smmCost: 43.00,  smmId: '146' },
  'yt_like_br_2k':   { name: 'Curtidas BR YouTube 2K',   qty: 2000,  priceBRL: 119.90, smmCost: 43.00,  smmId: '146' },
  'yt_like_br_5k':   { name: 'Curtidas BR YouTube 5K',   qty: 5000,  priceBRL: 279.90, smmCost: 43.00,  smmId: '146' },

  // ── TWITTER/X — Seguidores (smmId 962, R$19.60/1K) ───────────────────
  'tw_seg_100':   { name: 'Seguidores Twitter/X 100',   qty: 100,   priceBRL: 4.99,   smmCost: 19.60, smmId: '962' },
  'tw_seg_500':   { name: 'Seguidores Twitter/X 500',   qty: 500,   priceBRL: 17.90,  smmCost: 19.60, smmId: '962' },
  'tw_seg_1k':    { name: 'Seguidores Twitter/X 1K',    qty: 1000,  priceBRL: 32.90,  smmCost: 19.60, smmId: '962' },
  'tw_seg_2k':    { name: 'Seguidores Twitter/X 2K',    qty: 2000,  priceBRL: 59.90,  smmCost: 19.60, smmId: '962' },
  'tw_seg_5k':    { name: 'Seguidores Twitter/X 5K',    qty: 5000,  priceBRL: 139.90, smmCost: 19.60, smmId: '962' },
  'tw_seg_10k':   { name: 'Seguidores Twitter/X 10K',   qty: 10000, priceBRL: 259.90, smmCost: 19.60, smmId: '962' },

  // ── TWITTER/X — Curtidas (smmId 968, R$14.50/1K) ─────────────────────
  'tw_like_100':  { name: 'Curtidas Twitter/X 100',  qty: 100,   priceBRL: 3.99,   smmCost: 14.50, smmId: '968' },
  'tw_like_500':  { name: 'Curtidas Twitter/X 500',  qty: 500,   priceBRL: 14.90,  smmCost: 14.50, smmId: '968' },
  'tw_like_1k':   { name: 'Curtidas Twitter/X 1K',   qty: 1000,  priceBRL: 24.90,  smmCost: 14.50, smmId: '968' },
  'tw_like_5k':   { name: 'Curtidas Twitter/X 5K',   qty: 5000,  priceBRL: 109.90, smmCost: 14.50, smmId: '968' },
  'tw_like_10k':  { name: 'Curtidas Twitter/X 10K',  qty: 10000, priceBRL: 199.90, smmCost: 14.50, smmId: '968' },

  // ── TWITTER/X — Visualizações (smmId 970, R$0.40/1K) ─────────────────
  'tw_view_1k':    { name: 'Views Twitter/X 1K',    qty: 1000,   priceBRL: 0.99,   smmCost: 0.40,  smmId: '970' },
  'tw_view_5k':    { name: 'Views Twitter/X 5K',    qty: 5000,   priceBRL: 3.49,   smmCost: 0.40,  smmId: '970' },
  'tw_view_10k':   { name: 'Views Twitter/X 10K',   qty: 10000,  priceBRL: 5.99,   smmCost: 0.40,  smmId: '970' },
  'tw_view_50k':   { name: 'Views Twitter/X 50K',   qty: 50000,  priceBRL: 24.90,  smmCost: 0.40,  smmId: '970' },
  'tw_view_100k':  { name: 'Views Twitter/X 100K',  qty: 100000, priceBRL: 44.90,  smmCost: 0.40,  smmId: '970' },

  // ── TELEGRAM — Membros (smmId 977, R$5.30/1K · R30) ──────────────────
  'tg_mem_100':   { name: 'Membros Telegram 100',   qty: 100,   priceBRL: 1.49,   smmCost: 5.30,  smmId: '977' },
  'tg_mem_500':   { name: 'Membros Telegram 500',   qty: 500,   priceBRL: 5.99,   smmCost: 5.30,  smmId: '977' },
  'tg_mem_1k':    { name: 'Membros Telegram 1K',    qty: 1000,  priceBRL: 9.90,   smmCost: 5.30,  smmId: '977' },
  'tg_mem_5k':    { name: 'Membros Telegram 5K',    qty: 5000,  priceBRL: 44.90,  smmCost: 5.30,  smmId: '977' },
  'tg_mem_10k':   { name: 'Membros Telegram 10K',   qty: 10000, priceBRL: 84.90,  smmCost: 5.30,  smmId: '977' },

  // ── TELEGRAM — Visualizações (smmId 974, R$0.15/1K) ──────────────────
  'tg_view_1k':    { name: 'Views Telegram 1K',    qty: 1000,   priceBRL: 0.49,   smmCost: 0.15,  smmId: '974' },
  'tg_view_5k':    { name: 'Views Telegram 5K',    qty: 5000,   priceBRL: 1.99,   smmCost: 0.15,  smmId: '974' },
  'tg_view_10k':   { name: 'Views Telegram 10K',   qty: 10000,  priceBRL: 3.49,   smmCost: 0.15,  smmId: '974' },
  'tg_view_100k':  { name: 'Views Telegram 100K',  qty: 100000, priceBRL: 24.90,  smmCost: 0.15,  smmId: '974' },

  // ── WHATSAPP — Membros Canal BR 🇧🇷 (smmId 1022, R$12/1K · R30) ──────
  'wa_mem_br_100':  { name: 'Membros WhatsApp Canal BR 100',  qty: 100,   priceBRL: 2.99,  smmCost: 12.00, smmId: '1022' },
  'wa_mem_br_500':  { name: 'Membros WhatsApp Canal BR 500',  qty: 500,   priceBRL: 12.90, smmCost: 12.00, smmId: '1022' },
  'wa_mem_br_1k':   { name: 'Membros WhatsApp Canal BR 1K',   qty: 1000,  priceBRL: 22.90, smmCost: 12.00, smmId: '1022' },
  'wa_mem_br_5k':   { name: 'Membros WhatsApp Canal BR 5K',   qty: 5000,  priceBRL: 99.90, smmCost: 12.00, smmId: '1022' },

  // ── THREADS — Seguidores (smmId 1019, R$3.55/1K) ─────────────────────
  'th_seg_100':   { name: 'Seguidores Threads 100',  qty: 100,   priceBRL: 1.09,   smmCost: 3.55,  smmId: '1019' },
  'th_seg_500':   { name: 'Seguidores Threads 500',  qty: 500,   priceBRL: 3.99,   smmCost: 3.55,  smmId: '1019' },
  'th_seg_1k':    { name: 'Seguidores Threads 1K',   qty: 1000,  priceBRL: 6.99,   smmCost: 3.55,  smmId: '1019' },
  'th_seg_5k':    { name: 'Seguidores Threads 5K',   qty: 5000,  priceBRL: 29.90,  smmCost: 3.55,  smmId: '1019' },

  // ── THREADS — Curtidas (smmId 1018, R$3.55/1K) ───────────────────────
  'th_like_100':  { name: 'Curtidas Threads 100',  qty: 100,   priceBRL: 0.99,   smmCost: 3.55,  smmId: '1018' },
  'th_like_500':  { name: 'Curtidas Threads 500',  qty: 500,   priceBRL: 3.49,   smmCost: 3.55,  smmId: '1018' },
  'th_like_1k':   { name: 'Curtidas Threads 1K',   qty: 1000,  priceBRL: 5.99,   smmCost: 3.55,  smmId: '1018' },
  'th_like_5k':   { name: 'Curtidas Threads 5K',   qty: 5000,  priceBRL: 24.90,  smmCost: 3.55,  smmId: '1018' },

  // ── INSTAGRAM — Views em Story BR 🇧🇷 (smmId 1006, R$4.90/1K) ────────
  'ig_story_1k':   { name: 'Views Story BR Instagram 1K',   qty: 1000,  priceBRL: 8.90,   smmCost: 4.90,  smmId: '1006' },
  'ig_story_5k':   { name: 'Views Story BR Instagram 5K',   qty: 5000,  priceBRL: 34.90,  smmCost: 4.90,  smmId: '1006' },
  'ig_story_10k':  { name: 'Views Story BR Instagram 10K',  qty: 10000, priceBRL: 64.90,  smmCost: 4.90,  smmId: '1006' },
  'ig_story_20k':  { name: 'Views Story BR Instagram 20K',  qty: 20000, priceBRL: 119.90, smmCost: 4.90,  smmId: '1006' },

  // ── TIKTOK — Curtidas BR 🇧🇷 (smmId 913, R$3.50/1K · R30) ───────────
  'tt_like_br_100':  { name: 'Curtidas BR TikTok 100',  qty: 100,   priceBRL: 0.79,   smmCost: 3.50,  smmId: '913' },
  'tt_like_br_500':  { name: 'Curtidas BR TikTok 500',  qty: 500,   priceBRL: 3.49,   smmCost: 3.50,  smmId: '913' },
  'tt_like_br_1k':   { name: 'Curtidas BR TikTok 1K',   qty: 1000,  priceBRL: 6.99,   smmCost: 3.50,  smmId: '913' },
  'tt_like_br_5k':   { name: 'Curtidas BR TikTok 5K',   qty: 5000,  priceBRL: 29.90,  smmCost: 3.50,  smmId: '913' },
  'tt_like_br_10k':  { name: 'Curtidas BR TikTok 10K',  qty: 10000, priceBRL: 54.90,  smmCost: 3.50,  smmId: '913' },

  // ── TIKTOK — Compartilhamentos (smmId 216, R$0.90/1K) ────────────────
  'tt_share_1k':   { name: 'Compartilhamentos TikTok 1K',   qty: 1000,  priceBRL: 1.79,   smmCost: 0.90,  smmId: '216' },
  'tt_share_5k':   { name: 'Compartilhamentos TikTok 5K',   qty: 5000,  priceBRL: 7.90,   smmCost: 0.90,  smmId: '216' },
  'tt_share_10k':  { name: 'Compartilhamentos TikTok 10K',  qty: 10000, priceBRL: 14.90,  smmCost: 0.90,  smmId: '216' },

  // ── KWAI — Seguidores BR 🇧🇷 (smmId 142, R$6.70/1K · R30) ───────────
  'kw_seg_br_100':   { name: 'Seguidores BR Kwai 100',   qty: 100,   priceBRL: 1.99,   smmCost: 6.70,  smmId: '142' },
  'kw_seg_br_500':   { name: 'Seguidores BR Kwai 500',   qty: 500,   priceBRL: 7.90,   smmCost: 6.70,  smmId: '142' },
  'kw_seg_br_1k':    { name: 'Seguidores BR Kwai 1K',    qty: 1000,  priceBRL: 12.90,  smmCost: 6.70,  smmId: '142' },
  'kw_seg_br_5k':    { name: 'Seguidores BR Kwai 5K',    qty: 5000,  priceBRL: 54.90,  smmCost: 6.70,  smmId: '142' },

  // ── LINKEDIN — Seguidores (smmId 391, R$90/1K · R30) ─────────────────
  'li_seg_100':  { name: 'Seguidores LinkedIn 100',  qty: 100,   priceBRL: 22.90,  smmCost: 90.00, smmId: '391' },
  'li_seg_500':  { name: 'Seguidores LinkedIn 500',  qty: 500,   priceBRL: 89.90,  smmCost: 90.00, smmId: '391' },
  'li_seg_1k':   { name: 'Seguidores LinkedIn 1K',   qty: 1000,  priceBRL: 159.90, smmCost: 90.00, smmId: '391' },

  // ── COINMARKETCAP — Seguidores (smmId 31, R$7.60/1K) ─────────────────
  'cmc_seg_100':  { name: 'Seguidores CoinMarketCap 100',  qty: 100,   priceBRL: 2.29,   smmCost: 7.60,  smmId: '31' },
  'cmc_seg_500':  { name: 'Seguidores CoinMarketCap 500',  qty: 500,   priceBRL: 9.90,   smmCost: 7.60,  smmId: '31' },
  'cmc_seg_1k':   { name: 'Seguidores CoinMarketCap 1K',   qty: 1000,  priceBRL: 16.90,  smmCost: 7.60,  smmId: '31' },
  'cmc_seg_5k':   { name: 'Seguidores CoinMarketCap 5K',   qty: 5000,  priceBRL: 69.90,  smmCost: 7.60,  smmId: '31' },

  // ── ROBLOX — Seguidores (smmId 806, R$4.50/1K) ───────────────────────
  'rb_seg_100':   { name: 'Seguidores Roblox 100',   qty: 100,   priceBRL: 1.49,   smmCost: 4.50,  smmId: '806' },
  'rb_seg_500':   { name: 'Seguidores Roblox 500',   qty: 500,   priceBRL: 5.99,   smmCost: 4.50,  smmId: '806' },
  'rb_seg_1k':    { name: 'Seguidores Roblox 1K',    qty: 1000,  priceBRL: 8.99,   smmCost: 4.50,  smmId: '806' },
  'rb_seg_5k':    { name: 'Seguidores Roblox 5K',    qty: 5000,  priceBRL: 39.90,  smmCost: 4.50,  smmId: '806' },
  'rb_seg_10k':   { name: 'Seguidores Roblox 10K',   qty: 10000, priceBRL: 74.90,  smmCost: 4.50,  smmId: '806' },
};

// ─── D1: inicializar schema ───────────────────────────────────────────
async function initDb(env) {
  if (!env.DB) return;
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id               TEXT PRIMARY KEY,
      service_id       TEXT NOT NULL,
      service_name     TEXT NOT NULL,
      smm_id           TEXT NOT NULL,
      qty              INTEGER NOT NULL,
      link             TEXT NOT NULL,
      price_brl        REAL NOT NULL,
      payment_method   TEXT NOT NULL,
      tax_number       TEXT,
      payment_status   TEXT DEFAULT 'pending',
      smm_order_id     TEXT,
      smm_status       TEXT DEFAULT 'pending',
      invoice_id       TEXT,
      pay_address      TEXT,
      pay_amount       REAL,
      pay_currency     TEXT,
      qr_code          TEXT,
      payment_url      TEXT,
      retry_count      INTEGER DEFAULT 0,
      refund_status    TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
    CREATE INDEX IF NOT EXISTS idx_orders_smm_status     ON orders(smm_status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_invoice_id     ON orders(invoice_id);
  `);
}

// ─── Entrada principal ────────────────────────────────────────────────
export default {
  // ── HTTP handler ──
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return corsOk();

    // Inicializa D1 lazily na primeira requisição
    await initDb(env).catch(e => console.warn('initDb:', e.message));

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

      if (path === '/webhooks/depix' && request.method === 'POST')
        return handleDePIXWebhook(request, env);

      // Admin panel — token obrigatório
      if (path === '/admin' && request.method === 'GET')
        return handleAdmin(request, env);

      // Admin: lista serviços do painel SMM (para mapeamento do CATALOG)
      if (path === '/admin/smm-services' && request.method === 'GET') {
        const url2 = new URL(request.url);
        const tok  = url2.searchParams.get('token') || '';
        if (tok !== (env.ADMIN_TOKEN || 'admin123'))
          return new Response('Unauthorized', { status: 401 });
        if (!env.SMM_API_KEY || !env.SMM_API_URL)
          return json({ error: 'SMM_API_KEY ou SMM_API_URL nao configurado' }, 503);
        const form = new URLSearchParams({ key: env.SMM_API_KEY, action: 'services' });
        const resp = await fetch(env.SMM_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        const services = await resp.json();
        const q = (url2.searchParams.get('q') || '').toLowerCase();
        const filtered = q ? services.filter(s => (s.name || '').toLowerCase().includes(q)) : services;
        return new Response(JSON.stringify(filtered, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Status do catálogo (SKUs desabilitados) — usado pelo frontend
      if (path === '/api/catalog-status' && request.method === 'GET') {
        try {
          const raw = env.ORDERS ? await env.ORDERS.get('catalog:disabled_skus') : null;
          const data = raw ? JSON.parse(raw) : { disabled: [], checkedAt: null };
          return addCors(new Response(JSON.stringify({ disabled: data.disabled || [] }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
          }));
        } catch {
          return addCors(json({ disabled: [] }));
        }
      }

      return addCors(json({ error: 'Not found' }, 404));
    } catch (e) {
      console.error(e);
      return addCors(json({ error: 'Internal error', detail: e.message }, 500));
    }
  },

  // ── Cron handler ──
  async scheduled(event, env, ctx) {
    await initDb(env).catch(() => {});
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(retryPendingSmmOrders(env));
    } else if (event.cron === '0 */2 * * *') {
      ctx.waitUntil(runCatalogHealthCheck(env));
    }
  },
};

// ─── POST /api/order ──────────────────────────────────────────────────
async function handleCreateOrder(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const { serviceId, link, paymentMethod, taxNumber } = body;

  if (!serviceId || !link || !paymentMethod)
    return json({ error: 'Missing: serviceId, link, paymentMethod' }, 400);

  // CPF/CNPJ obrigatório para PIX (regra DePix)
  if (paymentMethod === 'pix') {
    if (!taxNumber || taxNumber.trim().length < 11)
      return json({ error: 'CPF ou CNPJ obrigatorio para pagamento PIX.' }, 400);
  }

  const service = CATALOG[serviceId];
  if (!service) return json({ error: 'Service not found' }, 404);

  // Serviços com smmId pendente de mapeamento ainda não estão disponíveis
  if (service.smmId === 'TODO')
    return json({ error: 'Serviço temporariamente indisponível. Tente outro.' }, 503);

  const validPayments = ['pix', 'btc', 'lightning', 'usdt', 'eth'];
  if (!validPayments.includes(paymentMethod))
    return json({ error: 'Invalid paymentMethod. Use: ' + validPayments.join(', ') }, 400);

  const orderId = 'SC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  const now = new Date().toISOString();

  const order = {
    id: orderId,
    serviceId,
    serviceName: service.name,
    smmId: service.smmId,
    qty: service.qty,
    link,
    priceBRL: service.priceBRL,
    paymentMethod,
    taxNumber:     paymentMethod === 'pix' ? taxNumber.replace(/\D/g, '') : null,
    paymentStatus: 'pending',
    smmOrderId: null,
    smmStatus: 'pending',
    invoiceId: null,
    payAddress: null,
    payAmount: null,
    payCurrency: null,
    qrCode: null,
    qrBase64: null,
    paymentUrl: null,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    if (paymentMethod === 'pix') {
      const chk = await createDePIXCheckout(service.priceBRL, order.taxNumber, orderId, service.name, env);
      order.invoiceId   = chk.id;
      order.qrCode      = chk.qrCode     || null;
      order.paymentUrl  = chk.qrCodeUrl  || null;
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

  // Persiste em D1 (permanente) + KV (compatibilidade, 7 dias)
  await saveOrderD1(order, env);
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
    paymentUrl:    order.paymentUrl || null,
    status:        order.paymentStatus,
    statusUrl:     `${env.WORKER_BASE_URL || ''}/api/status/${orderId}`,
  }, 201);
}

// ─── GET /api/status/:id ──────────────────────────────────────────────
async function handleGetStatus(orderId, env) {
  // Tenta D1 primeiro, fallback para KV (pedidos antigos)
  let order = await getOrderD1(orderId, env);
  if (!order) {
    const raw = await env.ORDERS.get(orderId);
    if (!raw) return json({ error: 'Order not found' }, 404);
    order = JSON.parse(raw);
  }
  return json({
    orderId:       order.id,
    serviceName:   order.serviceName || order.service_name,
    qty:           order.qty,
    link:          order.link,
    paymentStatus: order.paymentStatus || order.payment_status,
    smmStatus:     order.smmStatus || order.smm_status,
    smmOrderId:    order.smmOrderId || order.smm_order_id,
    retryCount:    order.retryCount  || order.retry_count || 0,
    createdAt:     order.createdAt   || order.created_at,
    updatedAt:     order.updatedAt   || order.updated_at,
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

  const { order_id, payment_status, payment_id } = body;
  if (!order_id) return new Response('Missing order_id', { status: 400 });

  // Idempotência: se payment_id já foi processado, ignora
  if (payment_id && env.DB) {
    const dup = await env.DB.prepare(
      `SELECT id FROM orders WHERE invoice_id = ? AND payment_status = 'confirmed'`
    ).bind(String(payment_id)).first().catch(() => null);
    if (dup) return new Response('OK'); // já processado
  }

  let order = await getOrderD1(order_id, env);
  if (!order) {
    const raw = await env.ORDERS.get(order_id);
    if (!raw) return new Response('Order not found', { status: 404 });
    order = JSON.parse(raw);
    // Migra para D1 se ainda não estava lá
    await saveOrderD1(order, env);
  }

  const confirmed = ['confirmed', 'sending', 'finished'].includes(payment_status);
  const now = new Date().toISOString();
  if (confirmed && order.payment_status !== 'confirmed') {
    order.payment_status = 'confirmed';
    order.updated_at = now;
    await dispatchSmmOrder(order, env);
    await updateOrderD1(order, env);
    await env.ORDERS.put(order_id, JSON.stringify(toKvOrder(order)), { expirationTtl: 604800 });
  } else if (['failed', 'expired'].includes(payment_status)) {
    order.payment_status = 'failed';
    order.updated_at = now;
    await updateOrderD1(order, env);
    await env.ORDERS.put(order_id, JSON.stringify(toKvOrder(order)), { expirationTtl: 604800 });
  }

  return new Response('OK');
}

// ─── POST /webhooks/depix ─────────────────────────────────────────────
// Eulen envia: { id, status, externalId, amountInCents, ... }
// status values: pending | under_review | approved | depix_sent | delayed | expired | refunded | canceled | error
async function handleDePIXWebhook(request, env) {
  const raw = await request.json().catch(() => null);
  if (!raw) return new Response('Bad Request', { status: 400 });

  // Suporta payload envolto em { data: {...} } ou direto
  const payload = raw.data || raw;
  const { id: checkoutId, status, externalId } = payload;
  const orderId = externalId;
  if (!orderId) return new Response('OK');        // webhook sem externalId → ignorar

  // Idempotência: se checkoutId já foi confirmado, ignorar
  if (checkoutId && env.DB) {
    const dup = await env.DB.prepare(
      `SELECT id FROM orders WHERE invoice_id = ? AND payment_status = 'confirmed'`
    ).bind(String(checkoutId)).first().catch(() => null);
    if (dup) return new Response('OK');
  }

  let order = await getOrderD1(orderId, env);
  if (!order) {
    const stored = await env.ORDERS.get(orderId);
    if (!stored) return new Response('OK');
    order = JSON.parse(stored);
    await saveOrderD1(order, env);
  }

  const PAID   = ['approved', 'depix_sent'];
  const FAILED = ['expired', 'refunded', 'canceled', 'error'];
  const now = new Date().toISOString();

  if (PAID.includes(status) && order.payment_status !== 'confirmed') {
    order.payment_status   = 'confirmed';
    order.invoice_id       = order.invoice_id || checkoutId;
    order.updated_at       = now;
    await dispatchSmmOrder(order, env);
    await updateOrderD1(order, env);
    await env.ORDERS.put(orderId, JSON.stringify(toKvOrder(order)), { expirationTtl: 604800 });
  } else if (FAILED.includes(status) && order.payment_status === 'pending') {
    order.payment_status = 'failed';
    order.updated_at     = now;
    await updateOrderD1(order, env);
    await env.ORDERS.put(orderId, JSON.stringify(toKvOrder(order)), { expirationTtl: 604800 });
  }

  return new Response('OK');
}

// ─── SMM Panel: disparar pedido (com retry até 3x) ────────────────────
async function dispatchSmmOrder(order, env) {
  // Normaliza campos (D1 usa snake_case, legado usa camelCase)
  const smmId   = order.smm_id   || order.smmId;
  const link    = order.link;
  const qty     = order.qty;
  const orderId = order.id;

  if (!env.SMM_API_KEY || !env.SMM_API_URL) {
    console.warn('SMM API not configured');
    order.smm_status = order.smmStatus = 'pending';
    return;
  }
  if (!smmId || smmId === '0' || smmId === 'TODO') {
    console.warn(`smmId inválido '${smmId}' para pedido ${orderId}`);
    order.smm_status = order.smmStatus = 'needs_config';
    return;
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = new URLSearchParams({
        key:      env.SMM_API_KEY,
        action:   'add',
        service:  smmId,
        link:     link,
        quantity: String(qty),
      });
      const resp = await fetch(env.SMM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await resp.json();
      if (data.order) {
        order.smm_order_id = order.smmOrderId = String(data.order);
        order.smm_status   = order.smmStatus  = 'processing';
        return; // sucesso
      }
      lastError = JSON.stringify(data);
      console.error(`SMM attempt ${attempt + 1} error:`, lastError);
    } catch (e) {
      lastError = e.message;
      console.error(`SMM attempt ${attempt + 1} exception:`, lastError);
    }
    // Backoff: 0, 2s, 4s
    if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
  }
  order.smm_status = order.smmStatus = 'failed';
  console.error(`SMM falhou após 3 tentativas para ${orderId}: ${lastError}`);
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

// ─── Eulen (DePix): criar depósito PIX ───────────────────────────────
// Docs: https://docs.eulen.app
// POST https://depix.eulen.app/api/deposit
// Resposta: { response: { id, qrCopyPaste, qrImageUrl }, async: false }
async function createDePIXCheckout(amountBRL, taxNumber, orderId, description, env) {
  const amountCents = Math.round(amountBRL * 100);

  const body = {
    amountInCents:    amountCents,
    endUserTaxNumber: taxNumber,                          // CPF/CNPJ somente dígitos
    endUserFullName:  'Cliente SeguidoresCripto',         // nome do pagador (obrigatório)
    // externalId é usado para rastrear o pedido no webhook
    externalId:       orderId,
  };

  const resp = await fetch('https://depix.eulen.app/api/deposit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.DEPIX_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.response?.errorMessage || err?.message || `Eulen HTTP ${resp.status}`;
    throw new Error(msg);
  }

  const data = await resp.json();
  // Normalizar para o formato que o Worker espera:
  //   data.id        → deposit ID
  //   data.qrCode    → PIX copia-e-cola
  //   data.qrCodeUrl → imagem do QR
  return {
    id:         data.response?.id         || data.id,
    qrCode:     data.response?.qrCopyPaste || data.qrCopyPaste,
    qrCodeUrl:  data.response?.qrImageUrl  || data.qrImageUrl,
    raw:        data,
  };
}

// ─── D1: helpers de persistência ─────────────────────────────────────
async function saveOrderD1(order, env) {
  if (!env.DB) return;
  const o = toD1Order(order);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO orders
      (id,service_id,service_name,smm_id,qty,link,price_brl,payment_method,
       tax_number,payment_status,smm_order_id,smm_status,invoice_id,
       pay_address,pay_amount,pay_currency,qr_code,payment_url,
       retry_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    o.id, o.service_id, o.service_name, o.smm_id, o.qty, o.link,
    o.price_brl, o.payment_method, o.tax_number, o.payment_status,
    o.smm_order_id, o.smm_status, o.invoice_id,
    o.pay_address, o.pay_amount, o.pay_currency, o.qr_code, o.payment_url,
    o.retry_count, o.created_at, o.updated_at
  ).run().catch(e => console.warn('saveOrderD1:', e.message));
}

async function updateOrderD1(order, env) {
  if (!env.DB) return;
  const o = toD1Order(order);
  await env.DB.prepare(`
    UPDATE orders SET
      payment_status=?, smm_order_id=?, smm_status=?,
      retry_count=?, invoice_id=?, updated_at=?
    WHERE id=?
  `).bind(
    o.payment_status, o.smm_order_id, o.smm_status,
    o.retry_count, o.invoice_id, o.updated_at, o.id
  ).run().catch(e => console.warn('updateOrderD1:', e.message));
}

async function getOrderD1(orderId, env) {
  if (!env.DB) return null;
  return env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first()
    .catch(() => null);
}

// Converte camelCase → snake_case para D1
function toD1Order(o) {
  return {
    id:             o.id,
    service_id:     o.serviceId    || o.service_id,
    service_name:   o.serviceName  || o.service_name,
    smm_id:         o.smmId        || o.smm_id,
    qty:            o.qty,
    link:           o.link,
    price_brl:      o.priceBRL     || o.price_brl,
    payment_method: o.paymentMethod|| o.payment_method,
    tax_number:     o.taxNumber    || o.tax_number    || null,
    payment_status: o.paymentStatus|| o.payment_status|| 'pending',
    smm_order_id:   o.smmOrderId   || o.smm_order_id  || null,
    smm_status:     o.smmStatus    || o.smm_status     || 'pending',
    invoice_id:     o.invoiceId    || o.invoice_id     || null,
    pay_address:    o.payAddress   || o.pay_address    || null,
    pay_amount:     o.payAmount    || o.pay_amount     || null,
    pay_currency:   o.payCurrency  || o.pay_currency   || null,
    qr_code:        o.qrCode       || o.qr_code        || null,
    payment_url:    o.paymentUrl   || o.payment_url    || null,
    retry_count:    o.retryCount   || o.retry_count    || 0,
    created_at:     o.createdAt    || o.created_at,
    updated_at:     o.updatedAt    || o.updated_at,
  };
}

// Converte D1 (snake_case) → KV (camelCase) para compatibilidade
function toKvOrder(o) {
  return {
    id: o.id, serviceId: o.service_id, serviceName: o.service_name,
    smmId: o.smm_id, qty: o.qty, link: o.link, priceBRL: o.price_brl,
    paymentMethod: o.payment_method, taxNumber: o.tax_number,
    paymentStatus: o.payment_status, smmOrderId: o.smm_order_id,
    smmStatus: o.smm_status, invoiceId: o.invoice_id,
    payAddress: o.pay_address, payAmount: o.pay_amount,
    payCurrency: o.pay_currency, qrCode: o.qr_code,
    paymentUrl: o.payment_url, retryCount: o.retry_count,
    createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

// ─── Cron: retry pedidos SMM pendentes (*/5 min) ──────────────────────
async function retryPendingSmmOrders(env) {
  if (!env.DB || !env.SMM_API_KEY) return;
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(`
    SELECT * FROM orders
    WHERE payment_status = 'confirmed'
      AND (smm_order_id IS NULL OR smm_status = 'failed')
      AND retry_count < 3
      AND created_at < ?
  `).bind(cutoff).all().catch(() => ({ results: [] }));

  console.log(`[retry-cron] ${results.length} pedidos pendentes encontrados`);

  for (const order of results) {
    order.retry_count = (order.retry_count || 0) + 1;
    order.updated_at  = new Date().toISOString();
    await dispatchSmmOrder(order, env);
    await updateOrderD1(order, env);
    // Sincroniza KV também
    const raw = await env.ORDERS.get(order.id).catch(() => null);
    if (raw) {
      const kvOrder = { ...JSON.parse(raw), ...toKvOrder(order) };
      await env.ORDERS.put(order.id, JSON.stringify(kvOrder), { expirationTtl: 604800 });
    }
    console.log(`[retry-cron] ${order.id} → smm_status: ${order.smm_status}`);
  }
}

// ─── Cron: auditoria a cada 2h do catálogo — auto-desabilita no frontend ──
async function runCatalogHealthCheck(env) {
  if (!env.SMM_API_KEY || !env.SMM_API_URL) return;
  try {
    const form = new URLSearchParams({ key: env.SMM_API_KEY, action: 'services' });
    const resp = await fetch(env.SMM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const services = await resp.json();
    const smmMap = {};
    for (const s of (Array.isArray(services) ? services : [])) {
      smmMap[String(s.service)] = s;
    }

    // Determina quais smmIds estão indisponíveis
    const disabledSmmIds = new Set();
    const issues = [];

    for (const [sid, item] of Object.entries(CATALOG)) {
      if (item.smmId === 'TODO') continue;
      const remote = smmMap[item.smmId];
      if (!remote) {
        disabledSmmIds.add(item.smmId);
        issues.push(`${sid}: smmId ${item.smmId} NÃO encontrado no painel`);
      } else if (remote.status && remote.status !== 'Active') {
        disabledSmmIds.add(item.smmId);
        issues.push(`${sid}: smmId ${item.smmId} inativo (${remote.status})`);
      } else {
        // Verifica variação de preço > 15%
        const remoteRate = parseFloat(remote.rate);
        if (!isNaN(remoteRate) && item.smmCost > 0) {
          const diff = Math.abs(remoteRate - item.smmCost) / item.smmCost;
          if (diff > 0.15) {
            issues.push(`${sid}: preço mudou ${(diff*100).toFixed(0)}% (era ${item.smmCost}, agora ${remoteRate})`);
          }
        }
      }
    }

    // Constrói lista de SKUs desabilitados (todos os SKUs cujo smmId está off)
    const disabledSkus = Object.entries(CATALOG)
      .filter(([, item]) => disabledSmmIds.has(item.smmId))
      .map(([sid]) => sid);

    // Persiste no KV para o endpoint /api/catalog-status consumir
    if (env.ORDERS) {
      await env.ORDERS.put('catalog:disabled_skus', JSON.stringify({
        disabled: disabledSkus,
        checkedAt: new Date().toISOString(),
        issues,
      }), { expirationTtl: 14400 }); // TTL 4h (2x o intervalo do cron)
    }

    if (issues.length > 0) {
      console.warn(`[catalog-health] ${disabledSkus.length} SKUs desabilitados, ${issues.length} problemas:\n` + issues.join('\n'));
    } else {
      console.log(`[catalog-health] Tudo OK — ${Object.keys(CATALOG).length} SIDs verificados`);
    }
  } catch (e) {
    console.error('[catalog-health] Erro:', e.message);
  }
}

// ─── Admin panel (/admin?token=...) ───────────────────────────────────
async function handleAdmin(request, env) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const adminToken = env.ADMIN_TOKEN || 'admin123';
  if (token !== adminToken)
    return new Response('Unauthorized', { status: 401 });

  if (!env.DB)
    return new Response('D1 não configurado', { status: 503 });

  const [stats24h, stats7d, stats30d, byStatus, failed, topServices] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as cnt, SUM(price_brl) as rev FROM orders WHERE payment_status='confirmed' AND created_at > datetime('now','-1 day')`).first(),
    env.DB.prepare(`SELECT COUNT(*) as cnt, SUM(price_brl) as rev FROM orders WHERE payment_status='confirmed' AND created_at > datetime('now','-7 days')`).first(),
    env.DB.prepare(`SELECT COUNT(*) as cnt, SUM(price_brl) as rev FROM orders WHERE payment_status='confirmed' AND created_at > datetime('now','-30 days')`).first(),
    env.DB.prepare(`SELECT payment_status, COUNT(*) as cnt FROM orders GROUP BY payment_status ORDER BY cnt DESC`).all(),
    env.DB.prepare(`SELECT id, service_name, price_brl, smm_status, retry_count, created_at FROM orders WHERE smm_status='failed' OR (payment_status='confirmed' AND smm_order_id IS NULL) ORDER BY created_at DESC LIMIT 20`).all(),
    env.DB.prepare(`SELECT service_name, COUNT(*) as cnt, SUM(price_brl) as rev FROM orders WHERE payment_status='confirmed' GROUP BY service_name ORDER BY rev DESC LIMIT 10`).all(),
  ]).catch(e => { throw new Error('DB error: ' + e.message); });

  const fmtBRL = v => 'R$' + (v || 0).toFixed(2).replace('.', ',');
  const rows   = (arr) => (arr?.results || []).map(r =>
    `<tr>${Object.values(r).map(v => `<td>${v ?? '—'}</td>`).join('')}</tr>`
  ).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Admin — seguidoreslike.com</title>
<style>
  body{font-family:monospace;background:#0d1117;color:#e2e8f0;padding:2rem;margin:0}
  h1{color:#00d67f;margin-bottom:1.5rem}h2{color:#60a5fa;margin:1.5rem 0 .5rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
  .card{background:#161b27;border:1px solid #272d42;border-radius:8px;padding:1rem}
  .card .label{font-size:.7rem;color:#7c849c;text-transform:uppercase;letter-spacing:.08em}
  .card .value{font-size:1.5rem;color:#fff;font-weight:bold;margin-top:.25rem}
  .card .sub{font-size:.8rem;color:#7c849c}
  table{width:100%;border-collapse:collapse;font-size:.82rem}
  th{text-align:left;color:#7c849c;padding:.4rem .6rem;border-bottom:1px solid #272d42}
  td{padding:.4rem .6rem;border-bottom:1px solid #1a1f2e;color:#c8d0e0}
  tr:hover td{background:#161b27}
  .badge{padding:.15rem .4rem;border-radius:4px;font-size:.7rem;font-weight:bold}
  .ok{background:rgba(0,214,127,.15);color:#00d67f}
  .fail{background:rgba(248,113,113,.15);color:#f87171}
  .pend{background:rgba(251,191,36,.15);color:#fbbf24}
  a{color:#60a5fa}
</style></head><body>
<h1>📊 Admin — seguidoreslike.com</h1>
<p style="color:#7c849c;margin-bottom:1.5rem">Atualizado em ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p>
<div class="cards">
  <div class="card"><div class="label">Receita 24h</div><div class="value">${fmtBRL(stats24h?.rev)}</div><div class="sub">${stats24h?.cnt || 0} pedidos</div></div>
  <div class="card"><div class="label">Receita 7 dias</div><div class="value">${fmtBRL(stats7d?.rev)}</div><div class="sub">${stats7d?.cnt || 0} pedidos</div></div>
  <div class="card"><div class="label">Receita 30 dias</div><div class="value">${fmtBRL(stats30d?.rev)}</div><div class="sub">${stats30d?.cnt || 0} pedidos</div></div>
  <div class="card"><div class="label">Falhas ativas</div><div class="value" style="color:#f87171">${failed?.results?.length || 0}</div><div class="sub">precisam atenção</div></div>
</div>
<h2>Por status</h2>
<table><thead><tr><th>Status</th><th>Total</th></tr></thead><tbody>
${(byStatus?.results||[]).map(r=>`<tr><td>${r.payment_status}</td><td>${r.cnt}</td></tr>`).join('')}
</tbody></table>
<h2>Falhas / pendentes (SMM)</h2>
<table><thead><tr><th>Pedido</th><th>Serviço</th><th>Valor</th><th>SMM Status</th><th>Retries</th><th>Criado</th></tr></thead><tbody>
${(failed?.results||[]).map(r=>`<tr><td><a href="/api/status/${r.id}">${r.id}</a></td><td>${r.service_name}</td><td>${fmtBRL(r.price_brl)}</td><td><span class="badge fail">${r.smm_status||'pending'}</span></td><td>${r.retry_count||0}</td><td>${r.created_at?.slice(0,16)}</td></tr>`).join('')}
</tbody></table>
<h2>Top 10 serviços (por receita)</h2>
<table><thead><tr><th>Serviço</th><th>Vendas</th><th>Receita</th></tr></thead><tbody>
${(topServices?.results||[]).map(r=>`<tr><td>${r.service_name}</td><td>${r.cnt}</td><td>${fmtBRL(r.rev)}</td></tr>`).join('')}
</tbody></table>
<p style="margin-top:2rem;color:#7c849c;font-size:.75rem">🔄 <a href="?token=${adminToken}">Atualizar</a></p>
</body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'X-Robots-Tag': 'noindex' },
  });
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
  if (!message.trim()) return json({ error: 'Mensagem obrigatoria' }, 400);

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
  return json({ ticketId, status: 'open' });
}

async function handleGetTicket(ticketId, env) {
  const raw = await env.ORDERS.get('ticket:' + ticketId);
  if (!raw) return json({ error: 'Ticket nao encontrado' }, 404);
  return json(JSON.parse(raw));
}
