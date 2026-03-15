const express = require('express');
const cors = require('cors');
const { runCommunityBacktest } = require('./community-engine');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WORKERS_API = 'https://cointop10-api.cointop10-com.workers.dev';

// ============ 샘플 캔들 가져오기 (Workers R2) ============
async function fetchSampleCandles(symbol = 'BTCUSDT', timeframe = '15m') {
  try {
    const res = await fetch(`${WORKERS_API}/api/candles/sample?symbol=${symbol}&timeframe=${timeframe}&limit=600`);
    if (!res.ok) throw new Error(`Workers candle fetch failed: ${res.status}`);
    const data = await res.json();
    return data.candles || [];
  } catch (e) {
    console.log('⚠️ Sample candle fetch failed:', e.message);
    return [];
  }
}

// ============ 생성된 코드 검증 (실제 엔진으로) ============
async function validateSignalCode(jsCode) {
  try {
    let code = jsCode.trim();
    if (code.startsWith('function ') && !code.startsWith('function signal')) {
      code = code.replace(/^function\s+\w+\s*\(/, 'function signal(');
    }
    // signal 함수만 추출
    const funcStart = code.indexOf('function signal');
    if (funcStart >= 0) {
      let braceCount = 0, funcEnd = -1;
      for (let ci = code.indexOf('{', funcStart); ci < code.length; ci++) {
        if (code[ci] === '{') braceCount++;
        if (code[ci] === '}') braceCount--;
        if (braceCount === 0) { funcEnd = ci + 1; break; }
      }
      if (funcEnd > 0) code = code.substring(funcStart, funcEnd);
    }
    const wrapped = `${code}\nreturn typeof signal === 'function' ? signal : null;`;
    const signalFn = new Function(wrapped)();
    if (typeof signalFn !== 'function') throw new Error('signal function not found');

    // 실제 엔진으로 백테스트
    const candles = await fetchSampleCandles('BTCUSDT', '15m');
    if (candles.length < 300) throw new Error('Not enough sample candles');

    runCommunityBacktest(signalFn, candles, {
      initialBalance: 10000,
      equityPercent: 10,
      leverage: 5,
      market_type: 'futures',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      maxConcurrentOrders: 1,
    });

    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// ============ JSON 파싱 헬퍼 ============
function sanitizeParameters(params) {
  if (!params || typeof params !== 'object') return {};
  const result = {};
  for (const [key, config] of Object.entries(params)) {
    if (!config || typeof config !== 'object') continue;
    const sanitized = { ...config };
    // label 필드들 문자열 강제 변환 + 문제 문자 제거
    for (const field of Object.keys(sanitized)) {
      if (field.startsWith('label')) {
        try {
          sanitized[field] = String(sanitized[field] || '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 제어문자 제거
            .trim()
            .substring(0, 100); // 최대 100자
          if (!sanitized[field]) delete sanitized[field]; // 빈 문자열이면 삭제
        } catch (e) {
          delete sanitized[field]; // 파싱 불가시 해당 label 삭제
        }
      }
    }
    // 필수 필드 검증
    if (!sanitized.type) sanitized.type = 'number';
    if (sanitized.default === undefined) sanitized.default = 0;
    if (!sanitized.category) sanitized.category = 'strategy';
    result[key] = sanitized;
  }
  return result;
}

function parseAIResponse(text) {
  let clean = text.replace(/```json\n?/g, '').replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(clean);
    // parameters sanitize
    if (parsed.parameters) {
      parsed.parameters = sanitizeParameters(parsed.parameters);
    }
    return parsed;
  } catch (e) {
    const match = text.match(/(function signal[\s\S]*)/);
    if (match) return { js_code: match[1], parameters: {} };
    throw new Error('Could not parse AI response');
  }
}

// ============ AI 전략 확인 (Haiku - 저비용) ============
app.post('/api/preview-strategy', async (req, res) => {
  try {
    const { selected_indicators, strategy_description } = req.body;
    console.log('👁️ Preview Request');

    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    const indicatorsList = selected_indicators.map(ind => {
      const paramsStr = Object.entries(ind.params).map(([k, v]) => `${k}:${v}`).join(', ');
      return `${ind.name}${paramsStr ? ` (${paramsStr})` : ''}`;
    }).join(', ');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Analyze this trading strategy request. Return ONLY JSON, no markdown.

Selected Indicators: ${indicatorsList}
Description: "${strategy_description}"

If valid trading strategy:
{"valid":true,"buy":"buy condition summary","sell":"sell condition summary","tp":"take profit (or 'Not specified')","sl":"stop loss (or 'Not specified')","extra":"other info or null","mismatch":["indicator name mentioned in description but NOT in selected list"] or []}

If nonsensical/gibberish/not a trading strategy:
{"valid":false,"reason":"Brief reason why"}

IMPORTANT: Vague but valid requests like "make a scalping strategy", "you decide", "trending strategy" are VALID.

Rules:
- Respond in SAME LANGUAGE as the description
- Be concise: 1-2 sentences each field
- mismatch: list indicator names in description but NOT in Selected Indicators. If none, return [].
- TP/SL: extract exact % or values if mentioned. If delegated to AI, recommend reasonable defaults (TP 3-5%, SL 1-2%)`
        }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const responseText = data.content?.[0]?.text || '';
    let result;
    try {
      result = JSON.parse(responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch (e) {
      result = { valid: false, reason: 'AI response parsing error' };
    }

    console.log('👁️ Preview result:', result.valid ? 'VALID' : 'REJECTED', result.mismatch?.length ? `mismatch: ${result.mismatch}` : '');
    res.json(result);
  } catch (error) {
    console.error('❌ Preview Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ AI 전략 생성 (시그널 함수 전용) ============
app.post('/api/generate-strategy', async (req, res) => {
  try {
    const { selected_indicators, strategy_description, custom_name } = req.body;
    console.log('🤖 AI Strategy Generation Request');

    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    const indicatorsList = selected_indicators.map(ind => {
      const paramsStr = Object.entries(ind.params).map(([k, v]) => `${k}: ${v}`).join(', ');
      return `- ${ind.name}${paramsStr ? ` (${paramsStr})` : ''}`;
    }).join('\n');

    const generatePrompt = (errorContext = '') => `You are an expert crypto trading strategy developer. Generate a SIGNAL FUNCTION ONLY.
${errorContext ? `\n⚠️ PREVIOUS ATTEMPT FAILED WITH ERROR: "${errorContext}"\nFix this error in the new code.\n` : ''}
**Selected Indicators:**
${indicatorsList}

**User's Strategy Description:**
"${strategy_description}"

**CRITICAL: ONLY a signal function. NO position sizing, NO fee calculation, NO equity tracking.**

**Signal Function Signature:**
function signal(candles, i, indicators, params, openPositions) {
  // candles[i] = {timestamp, open, high, low, close, volume}
  // openPositions = array with extra props:
  //   openPositions.consecutiveLosses = number of consecutive losing trades
  //   openPositions.lastPnl = last trade PnL
  //   openPositions.totalTrades = total trades so far
  
  // MUST return one of:
  // { action: 'entry_long', type: 'market', sizeMultiplier: 1.0 }  ← sizeMultiplier optional, 0.1~10
  // { action: 'entry_short', type: 'market', sizeMultiplier: 1.0 }
  // { action: 'entry_long', type: 'stop', price: 65000 }
  // { action: 'entry_long', type: 'limit', price: 64000 }
  // { action: 'entry_short', type: 'stop', price: 64000 }
  // { action: 'entry_short', type: 'limit', price: 65000 }
  // { action: 'exit' }
  // { action: 'exit', index: 0 }
  // { action: 'cancel' }
  // { action: 'hold' }
}

**sizeMultiplier usage (Martingale example):**
const losses = openPositions.consecutiveLosses || 0;
const multiplier = Math.min(Math.pow(2, losses), 8); // double each loss, max 8x
return { action: 'entry_long', type: 'market', sizeMultiplier: multiplier };

**Available Pre-Calculated Indicators (accessed by index i):**
- indicators.ema[period][i] → EMA (periods: 5,8,10,12,20,21,26,50,100,200)
- indicators.sma[period][i] → SMA (periods: 5,10,20,50,100,200)
- indicators.rsi[period][i] → RSI (periods: 7,14,21)
- indicators.stoch['14_3'].k[i], .d[i] → Stochastic (also '5_3', '21_7')
- indicators.macd['12_26_9'].macd[i], .signal[i], .histogram[i]
- indicators.bb['20_2'].upper[i], .middle[i], .lower[i]
- indicators.atr[14][i] → ATR
- indicators.cci[period][i] → CCI (14,20)
- indicators.momentum[period][i] → Momentum (10,14)
- indicators.williamsR[14][i]
- indicators.adx[14].adx[i], .plusDI[i], .minusDI[i]
- indicators.supertrend['10_3'].supertrend[i], .direction[i] (1=up, -1=down)
- indicators.ao[i] → Awesome Oscillator
- indicators.sar[i] → Parabolic SAR
- indicators.obv[i] → On Balance Volume
- indicators.mfi[14][i] → MFI
- indicators.donchian[20].upper[i], .middle[i], .lower[i]
- indicators.keltner['20_1.5'].upper[i], .middle[i], .lower[i]
- indicators.ichimoku.tenkan[i], .kijun[i], .senkouA[i], .senkouB[i]
- indicators.alligator.jaw[i], .teeth[i], .lips[i]
- indicators.vwap[i] → VWAP
- indicators._raw.closes, .highs, .lows, .opens, .volumes → raw arrays
- indicators._calc.ema(prices, period) → custom period calculator

**RULES:**
1. ONLY decides WHEN to buy/sell/exit.
2. Use EXACT accessor paths above. Examples:
   - RSI: indicators.rsi[14][i]  ← NOT indicators.rsi[i]
   - MACD: indicators.macd['12_26_9'].macd[i]  ← NOT indicators.macd.macd[i]
   - BB: indicators.bb['20_2'].upper[i]  ← NOT indicators.bb.upper[i]
   - Stoch: indicators.stoch['14_3'].k[i]  ← NOT indicators.stoch.k[i]
3. ALWAYS null-check ALL indicators at the TOP:
   if (i < 1) return { action: 'hold' };
   if (!indicators.rsi[14] || indicators.rsi[14][i] === null) return { action: 'hold' };
4. openPositions.length > 0 means position is open.
5. For Martingale: use openPositions.consecutiveLosses and return sizeMultiplier.

**Parameters Format:**
{
  "paramName": {
    "type": "number", "default": 14, "min": 2, "max": 100, "step": 1,
    "label": "English Label",
    "label_ko": "한국어", "label_zh": "中文", "label_hi": "हिन्दी",
    "label_es": "Español", "label_fr": "Français", "label_ar": "العربية",
    "label_bn": "বাংলা", "label_ru": "Русский", "label_pt": "Português",
    "label_ur": "اردو", "label_id": "Bahasa Indonesia", "label_de": "Deutsch",
    "label_ja": "日本語", "label_tr": "Türkçe", "label_vi": "Tiếng Việt",
    "label_it": "Italiano", "label_th": "ภาษาไทย", "label_ms": "Bahasa Melayu",
    "category": "strategy"
  }
}

**SIGNAL FUNCTION TEMPLATE:**
function signal(candles, i, indicators, params, openPositions) {
  if (i < 1) return { action: 'hold' };
  // null checks
  if (!indicators.rsi[14] || indicators.rsi[14][i] === null) return { action: 'hold' };
  
  const rsi = indicators.rsi[14][i];
  
  if (openPositions.length === 0) {
    // entry logic
  } else {
    // exit logic
  }
  return { action: 'hold' };
}

**FORWARD TEST INTERFACE (REQUIRED):**
After signal function, add:
function getSignal(candles, settings) {
  // Re-implement entry logic using last candles
  // MUST return one of:
  // { direction: 'long', stopPrice: 12345.6, orderType: 'STOP' }
  // { direction: 'short', stopPrice: 12345.6, orderType: 'LIMIT' }
  // { direction: null }
}

Return ONLY valid JSON (no markdown):
{
  "js_code": "function signal(candles, i, indicators, params, openPositions) { ... }\\n\\nfunction getSignal(candles, settings) { ... }",
  "parameters": { ... }
}`;

    // 1차 생성
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: generatePrompt() }] })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let result = parseAIResponse(data.content?.[0]?.text || '');
    if (!result.js_code || !result.js_code.includes('function signal')) {
      throw new Error('Invalid strategy code: missing signal function');
    }

    // ========== 검증 (1차) ==========
    console.log('🔍 Validating generated code...');
    let validation = await validateSignalCode(result.js_code);
    console.log('🔍 Validation 1:', validation.valid ? '✅' : `❌ ${validation.error}`);

    // 검증 실패 시 재시도
    if (!validation.valid) {
      console.log('⚠️ Retrying with error context...');
      const retryResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: generatePrompt(validation.error) }] })
      });
      const retryData = await retryResponse.json();
      if (!retryData.error) {
        try {
          const retryResult = parseAIResponse(retryData.content?.[0]?.text || '');
          if (retryResult.js_code?.includes('function signal')) {
            const validation2 = await validateSignalCode(retryResult.js_code);
            console.log('🔍 Validation 2:', validation2.valid ? '✅' : `❌ ${validation2.error}`);
            if (validation2.valid) result = retryResult;
          }
        } catch (e) { console.log('⚠️ Retry parse failed:', e.message); }
      }
    }

    // Workers API에 저장
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authorization required' });

    const strategyName = custom_name || (
      selected_indicators.length > 0
        ? `AI: ${selected_indicators.slice(0, 3).map(i => i.name).join(' + ')}`
        : 'AI Strategy'
    );

    const uploadResponse = await fetch(`${WORKERS_API}/api/strategies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ea_name: strategyName, js_code: result.js_code, parameters: result.parameters || {}, source: 'ai_builder', engine_version: 'signal_v1' })
    });

    const uploadData = await uploadResponse.json();
    if (!uploadData.success) throw new Error(uploadData.error || 'Failed to save strategy');

    const strategyId = uploadData.ea_id || uploadData.id || uploadData.strategy_id;
    console.log('✅ Strategy saved:', strategyId);

    // 즐겨찾기 자동 추가
    try {
      await fetch('https://cointop10-library.cointop10-com.workers.dev/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ settings_hash: `untested_${strategyId}` })
      });
    } catch (e) {}

    res.json({ success: true, strategy_id: strategyId, ea_name: strategyName });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ MQ → 시그널 함수 변환 ============
app.post('/api/convert-mq', async (req, res) => {
  try {
    const { mq_code, custom_name } = req.body;
    console.log('🔄 MQ Conversion Request, length:', mq_code?.length || 0);

    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });
    if (!mq_code || mq_code.length < 50) return res.status(400).json({ error: 'MQ code too short' });

    const mqPrompt = (errorContext = '') => `You are an expert at converting MetaTrader 4/5 Expert Advisors to JavaScript signal functions.
${errorContext ? `\n⚠️ PREVIOUS ATTEMPT FAILED WITH ERROR: "${errorContext}"\nFix this error.\n` : ''}
**MQ Source Code:**
\`\`\`
${mq_code.substring(0, 50000)}
\`\`\`

**CRITICAL: Convert ONLY the entry/exit LOGIC. NO position sizing, NO fees, NO equity tracking.**

**Signal Function returns one of:**
{ action: 'entry_long', type: 'market'|'stop'|'limit', price?: number, sizeMultiplier?: number }
{ action: 'entry_short', type: 'market'|'stop'|'limit', price?: number, sizeMultiplier?: number }
{ action: 'exit' } | { action: 'exit', index: 0 } | { action: 'cancel' } | { action: 'hold' }

**sizeMultiplier:** If EA uses martingale/lot multiplier logic, use openPositions.consecutiveLosses and return sizeMultiplier (0.1~10).

**Indicator Mapping:**
- iRSI → indicators.rsi[period][i]
- iMA/iEMA → indicators.ema[period][i] or indicators.sma[period][i]
- iStochastic → indicators.stoch['14_3'].k[i], .d[i]
- iMACD → indicators.macd['12_26_9'].macd[i], .signal[i], .histogram[i]
- iBands → indicators.bb['20_2'].upper[i], .middle[i], .lower[i]
- iATR → indicators.atr[14][i]
- iCCI → indicators.cci[period][i]
- iADX → indicators.adx[14].adx[i], .plusDI[i], .minusDI[i]
- iSAR → indicators.sar[i]
- iAlligator → indicators.alligator.jaw[i], .teeth[i], .lips[i]
- iFractals → indicators.fractals.up[i], .down[i]
- iIchimoku → indicators.ichimoku.tenkan[i], .kijun[i], .senkouA[i], .senkouB[i]
- VWAP → indicators.vwap[i]
- Custom periods: indicators._calc.ema(indicators._raw.closes, period)

**Order Type Mapping:**
- OP_BUY → entry_long market | OP_SELL → entry_short market
- OP_BUYSTOP → entry_long stop | OP_BUYLIMIT → entry_long limit
- OP_SELLSTOP → entry_short stop | OP_SELLLIMIT → entry_short limit
- OrderClose → exit | OrdersTotal() → openPositions.length

**Rules:**
1. Always null-check: if (i < 1) return {action:'hold'}; if (!indicators.rsi[14] || indicators.rsi[14][i]===null) return {action:'hold'};
2. Use EXACT accessor paths.
3. Parameters: { "type":"number","default":14,"min":1,"max":200,"step":1,"label":"English","label_ko":"한국어","label_zh":"中文","label_hi":"हिन्दी","label_es":"Español","label_fr":"Français","label_ar":"العربية","label_bn":"বাংলা","label_ru":"Русский","label_pt":"Português","label_ur":"اردو","label_id":"Bahasa Indonesia","label_de":"Deutsch","label_ja":"日本語","label_tr":"Türkçe","label_vi":"Tiếng Việt","label_it":"Italiano","label_th":"ภาษาไทย","label_ms":"Bahasa Melayu","category":"strategy" }
4. ALWAYS include getSignal function.

**FORWARD TEST (REQUIRED):**
function getSignal(candles, settings) {
  // { direction: 'long'|'short'|null, stopPrice: number, orderType: 'STOP'|'LIMIT' }
}

Return ONLY valid JSON (no markdown):
{
  "js_code": "function signal(...){...}\\n\\nfunction getSignal(candles,settings){...}",
  "parameters": {...},
  "ea_name": "extracted EA name"
}`;

    // 1차 변환
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: mqPrompt() }] })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let result = parseAIResponse(data.content?.[0]?.text || '');
    if (!result.js_code?.includes('function signal')) throw new Error('Invalid conversion: missing signal function');

    // ========== 검증 + 재시도 ==========
    console.log('🔍 Validating MQ conversion...');
    let validation = await validateSignalCode(result.js_code);
    console.log('🔍 MQ Validation 1:', validation.valid ? '✅' : `❌ ${validation.error}`);

    if (!validation.valid) {
      console.log('⚠️ MQ retrying...');
      const retryResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: mqPrompt(validation.error) }] })
      });
      const retryData = await retryResponse.json();
      if (!retryData.error) {
        try {
          const retryResult = parseAIResponse(retryData.content?.[0]?.text || '');
          if (retryResult.js_code?.includes('function signal')) {
            const v2 = await validateSignalCode(retryResult.js_code);
            console.log('🔍 MQ Validation 2:', v2.valid ? '✅' : `❌ ${v2.error}`);
            if (v2.valid) result = retryResult;
          }
        } catch (e) { console.log('⚠️ MQ retry parse failed:', e.message); }
      }
    }

    // 토큰 없으면 변환 결과만 리턴 (upload Worker가 직접 DB 저장)
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.json({ success: true, js_code: result.js_code, parameters: result.parameters || {}, ea_name: result.ea_name || 'MQ Strategy' });
    }

    const strategyName = custom_name || result.ea_name || 'MQ Strategy';

    const uploadResponse = await fetch(`${WORKERS_API}/api/strategies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ea_name: strategyName, js_code: result.js_code, parameters: result.parameters || {}, source: 'mq_converter', engine_version: 'signal_v1' })
    });

    const uploadData = await uploadResponse.json();
    if (!uploadData.success) throw new Error(uploadData.error || 'Failed to save strategy');

    const strategyId = uploadData.ea_id || uploadData.id || uploadData.strategy_id;
    console.log('✅ MQ Strategy saved:', strategyId);

    try {
      await fetch('https://cointop10-library.cointop10-com.workers.dev/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ settings_hash: `untested_${strategyId}` })
      });
    } catch (e) {}

    res.json({ success: true, strategy_id: strategyId, ea_name: strategyName });

  } catch (error) {
    console.error('❌ MQ Convert Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ 커뮤니티 전략 백테스트 — 공용 엔진 ============
app.post('/api/backtest', async (req, res) => {
  try {
    const { js_code, candles, settings = {} } = req.body;
    console.log('🔥 Community Backtest Request, candles:', candles?.length || 0);

    if (!js_code) return res.status(400).json({ error: 'No strategy code provided' });
    if (!candles || candles.length < 300) return res.status(400).json({ error: 'Not enough candle data (min 300)' });

    let signalFn;
    try {
      let code = js_code.trim();
      if (code.startsWith('function ') && !code.startsWith('function signal')) {
        code = code.replace(/^function\s+\w+\s*\(/, 'function signal(');
      }
      // signal 함수만 추출 (getSignal 등 뒤쪽 코드 포함 유지)
      const funcStart = code.indexOf('function signal');
      if (funcStart >= 0) {
        let braceCount = 0, funcEnd = -1;
        for (let ci = code.indexOf('{', funcStart); ci < code.length; ci++) {
          if (code[ci] === '{') braceCount++;
          if (code[ci] === '}') braceCount--;
          if (braceCount === 0) { funcEnd = ci + 1; break; }
        }
        if (funcEnd > 0 && funcEnd < code.length) {
          code = code.substring(funcStart, funcEnd);
        }
      }
      const wrappedCode = `${code}\nreturn typeof signal === 'function' ? signal : null;`;
      signalFn = new Function(wrappedCode)();
      if (typeof signalFn !== 'function') throw new Error('signal is not defined');
    } catch (e) {
      return res.status(400).json({ error: `Invalid signal function: ${e.message}` });
    }

    const startTime = Date.now();
    const result = runCommunityBacktest(signalFn, candles, settings);
    console.log(`✅ Backtest complete in ${Date.now() - startTime}ms, trades: ${result.total_trades}`);

    res.json(result);
  } catch (error) {
    console.error('❌ Backtest Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ Health check ============
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cointop10-api',
    model: 'claude-haiku-4-5-20251001',
    engine: 'community-engine-v1',
    features: ['sizeMultiplier', 'martingale', 'validation', 'retry', 'multilang-labels'],
    endpoints: ['POST /api/preview-strategy', 'POST /api/generate-strategy', 'POST /api/convert-mq', 'POST /api/backtest']
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CoinTop10 API running on port ${PORT}`);
});
