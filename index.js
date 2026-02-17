const express = require('express');
const cors = require('cors');
const { runCommunityBacktest } = require('./community-engine');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ============ AI 전략 확인 (Haiku - 저비용) ============
app.post('/api/preview-strategy', async (req, res) => {
  try {
    const { selected_indicators, strategy_description } = req.body;
    console.log('👁️ Preview Request');
    console.log('📊 Indicators:', selected_indicators?.length || 0);
    console.log('📝 Description:', strategy_description?.length || 0);

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const indicatorsList = selected_indicators.map(ind => {
      const paramsStr = Object.entries(ind.params).map(([k, v]) => `${k}:${v}`).join(', ');
      return `${ind.name}${paramsStr ? ` (${paramsStr})` : ''}`;
    }).join(', ');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Analyze this trading strategy request. Return ONLY JSON, no markdown.

Indicators: ${indicatorsList}
Description: "${strategy_description}"

If valid trading strategy:
{"valid":true,"buy":"buy condition summary","sell":"sell condition summary","tp":"take profit (or 'Not specified')","sl":"stop loss (or 'Not specified')","extra":"other info or null"}

If nonsensical/gibberish/not a trading strategy (random characters, unrelated topics):
{"valid":false,"reason":"Brief reason why"}

IMPORTANT: Vague but valid requests like "make a scalping strategy", "you decide", "trending strategy", "make something with these indicators" are VALID. Fill in reasonable buy/sell conditions using the selected indicators.

Rules:
- Respond in SAME LANGUAGE as the description
- Be concise: 1-2 sentences each field
- If description mentions indicators not in the selected list, still summarize
- TP/SL: extract exact % or values if mentioned. If user says "you decide" or delegates to AI, recommend reasonable defaults (e.g., TP 3-5%, SL 1-2%)`
        }]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.log('❌ Preview API Error:', data.error);
      return res.status(400).json({ error: data.error.message });
    }

    const responseText = data.content?.[0]?.text || '';
    let result;
    try {
      result = JSON.parse(responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch (e) {
      console.log('⚠️ Preview parse error:', responseText);
      result = { valid: false, reason: 'AI response parsing error' };
    }

    console.log('👁️ Preview result:', result.valid ? 'VALID' : 'REJECTED');
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
    
    console.log('🤖 AI Strategy Generation Request (Signal-Only Mode)');
    console.log('📊 Selected Indicators:', selected_indicators?.length || 0);
    console.log('📝 Description length:', strategy_description?.length || 0);
    
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const indicatorsList = selected_indicators.map(ind => {
      const paramsStr = Object.entries(ind.params)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return `- ${ind.name}${paramsStr ? ` (${paramsStr})` : ''}`;
    }).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `You are an expert crypto trading strategy developer. Generate a SIGNAL FUNCTION ONLY based on the user's description.

**Selected Indicators (with default values):**
${indicatorsList}

**User's Strategy Description:**
"${strategy_description}"

**CRITICAL: You generate ONLY a signal function. NO position sizing, NO fee calculation, NO equity tracking, NO trade recording. Those are handled by a separate shared engine.**

**Output Format** - Return ONLY valid JSON (no markdown, no code blocks):
{
  "js_code": "function signal(candles, i, indicators, params, openPositions) { ... return { action: 'hold' }; }",
  "parameters": { ... }
}

**Signal Function Signature:**
function signal(candles, i, indicators, params, openPositions) {
  // candles[i] = {timestamp, open, high, low, close, volume}
  // i = current candle index
  // indicators = pre-calculated indicator values (see below)
  // params = user-adjustable strategy parameters
  // openPositions = [{side, entry_price, coin_size, usdt_size, unrealizedPnl, duration}]
  
  // MUST return one of:
  // { action: 'entry_long', type: 'market' }
  // { action: 'entry_long', type: 'stop', price: 65000 }
  // { action: 'entry_long', type: 'limit', price: 64000 }
  // { action: 'entry_short', type: 'market' }
  // { action: 'entry_short', type: 'stop', price: 64000 }
  // { action: 'entry_short', type: 'limit', price: 65000 }
  // { action: 'exit' }           // close all positions
  // { action: 'exit', index: 0 } // close specific position
  // { action: 'cancel' }         // cancel all pending orders
  // { action: 'hold' }           // do nothing
}

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
- indicators.envelopes['20_2.5'].upper[i], .middle[i], .lower[i]
- indicators.aroon[25].up[i], .down[i]
- indicators.ichimoku.tenkan[i], .kijun[i], .senkouA[i], .senkouB[i]
- indicators.alligator.jaw[i], .teeth[i], .lips[i]
- indicators.demarker[14][i] → DeMarker (0-100)
- indicators.rvi.rvi[i], .signal[i] → Relative Vigor Index
- indicators.stddev[20][i] → Standard Deviation
- indicators.kdj['9_3'].k[i], .d[i], .j[i] → KDJ
- indicators.uo[i] → Ultimate Oscillator
- indicators.trix[15][i] → TRIX
- indicators.ad[i] → Accumulation/Distribution
- indicators.cmf[20][i] → Chaikin Money Flow
- indicators.eom[14][i] → Ease of Movement
- indicators.vwap[i] → VWAP
- indicators.bwmfi[i] → Bill Williams MFI
- indicators.ac[i] → Accelerator Oscillator
- indicators.fractals.up[i], .down[i] → Fractals (null or price)
- indicators.gator.upper[i], .lower[i] → Gator Oscillator
- indicators.pivot.pivot[i], .r1[i], .r2[i], .r3[i], .s1[i], .s2[i], .s3[i]
- indicators.zigzag[5][i] → ZigZag (null or pivot price)
- indicators.linreg[14].value[i], .slope[i] → Linear Regression
- indicators.pricechannel[20].upper[i], .middle[i], .lower[i]
- indicators.highlow[14].highest[i], .lowest[i], .middle[i]
- indicators.hv[20][i] → Historical Volatility (annualized %)
- indicators.vix[14][i] → Volatility Index (ATR/Price %)
- indicators._raw.closes, .highs, .lows, .opens, .volumes → raw arrays
- indicators._calc.ema(prices, period) → custom period calculator

**RULES:**
1. Your function ONLY decides WHEN to buy/sell/exit. Nothing else.
2. Use pre-calculated indicators - do NOT recalculate them.
3. For custom periods: indicators._calc.ema(indicators._raw.closes, params.emaPeriod)
4. Check null values: if (indicators.rsi[14][i] === null) return { action: 'hold' };
5. openPositions.length > 0 means position is open
6. type defaults to 'market' if omitted

**Parameters Format:**
{
  "paramName": {
    "type": "number", "default": 14, "min": 2, "max": 100, "step": 1,
    "label": "Parameter Label", "category": "strategy"
  }
}

**IMPORTANT:**
- category must be "strategy" for all params
- DO NOT include leverage/equityPercent/feePercent
- If vague description: create sensible strategy using ALL selected indicators
- BE CONCISE - signal function under 2000 tokens
- Respond in SAME LANGUAGE as description for labels

Return ONLY valid JSON.`
        }]
      })
    });

    console.log('🔵 Claude API Status:', response.status);
    const data = await response.json();
    
    if (data.error) {
      console.log('❌ API Error:', data.error);
      return res.status(400).json({ error: data.error.message });
    }

    const responseText = data.content?.[0]?.text || '';
    console.log('🔵 Response length:', responseText.length);

    let result;
    try {
      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```javascript\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      result = JSON.parse(cleanText);
    } catch (parseError) {
      console.log('⚠️ JSON parse failed, extracting code...');
      const jsMatch = responseText.match(/```javascript\n([\s\S]*?)\n```/);
      if (jsMatch) {
        result = { js_code: jsMatch[1], parameters: {} };
      } else {
        const functionMatch = responseText.match(/(function signal[\s\S]*)/);
        if (functionMatch) {
          result = { js_code: functionMatch[1], parameters: {} };
        } else {
          throw new Error('Could not extract valid code from response');
        }
      }
    }

    if (!result.js_code || !result.js_code.includes('function signal')) {
      throw new Error('Invalid strategy code: missing signal function');
    }

    console.log('✅ Signal function generated successfully');
    console.log('- Code length:', result.js_code?.length);
    console.log('- Parameters:', Object.keys(result.parameters || {}).length);

    // Workers API에 저장
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const strategyName = custom_name || (
      selected_indicators.length > 0
        ? `AI: ${selected_indicators.slice(0, 3).map(i => i.name).join(' + ')}`
        : 'AI Strategy'
    );

    console.log('📤 Saving to Workers API:', strategyName);

    const uploadResponse = await fetch('https://cointop10-api.cointop10-com.workers.dev/api/strategies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ea_name: strategyName,
        js_code: result.js_code,
        parameters: result.parameters || {},
        source: 'ai_builder',
        engine_version: 'signal_v1',
      })
    });

    const uploadData = await uploadResponse.json();
    console.log('📥 Workers API Response:', JSON.stringify(uploadData));

    if (!uploadData.success) {
      throw new Error(uploadData.error || 'Failed to save strategy');
    }

    const strategyId = uploadData.ea_id || uploadData.id || uploadData.strategy_id;
    console.log('✅ Strategy saved to database:', strategyId);

    // 즐겨찾기 자동 추가
    try {
      await fetch('https://cointop10-library.cointop10-com.workers.dev/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ settings_hash: `untested_${strategyId}` })
      });
      console.log('⭐ Auto-favorited');
    } catch (e) {
      console.log('⚠️ Auto-favorite failed:', e.message);
    }

    res.json({
      success: true,
      strategy_id: strategyId,
      ea_name: strategyName
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ============ MQ → 시그널 함수 변환 ============
app.post('/api/convert-mq', async (req, res) => {
  try {
    const { mq_code, custom_name } = req.body;
    
    console.log('🔄 MQ Conversion Request (Signal-Only Mode)');
    console.log('📝 MQ Code length:', mq_code?.length || 0);
    
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    if (!mq_code || mq_code.length < 50) {
      return res.status(400).json({ error: 'MQ code too short' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `You are an expert at converting MetaTrader 4/5 Expert Advisors to JavaScript signal functions.

**MQ Source Code:**
\`\`\`
${mq_code.substring(0, 8000)}
\`\`\`

**CRITICAL: Convert ONLY the entry/exit LOGIC. NO position sizing, NO fees, NO equity tracking.**

**Output Format** - Return ONLY valid JSON (no markdown):
{
  "js_code": "function signal(candles, i, indicators, params, openPositions) { ... }",
  "parameters": { ... },
  "ea_name": "extracted EA name"
}

**Signal Function returns one of:**
{ action: 'entry_long', type: 'market'|'stop'|'limit', price: number }
{ action: 'entry_short', type: 'market'|'stop'|'limit', price: number }
{ action: 'exit' }  |  { action: 'exit', index: 0 }
{ action: 'cancel' }  |  { action: 'hold' }

**Indicator Mapping:**
- iRSI → indicators.rsi[period][i]
- iMA/iEMA → indicators.ema[period][i] or indicators.sma[period][i]
- iStochastic → indicators.stoch['K_D'].k[i], .d[i]
- iMACD → indicators.macd['12_26_9'].macd[i], .signal[i], .histogram[i]
- iBands → indicators.bb['20_2'].upper[i], .middle[i], .lower[i]
- iATR → indicators.atr[14][i]
- iCCI → indicators.cci[period][i]
- iADX → indicators.adx[14].adx[i], .plusDI[i], .minusDI[i]
- iSAR → indicators.sar[i]
- iDeMarker → indicators.demarker[14][i]
- iRVI → indicators.rvi.rvi[i], .signal[i]
- iStdDev → indicators.stddev[20][i]
- iOBV → indicators.obv[i]
- iMFI → indicators.mfi[14][i]
- iAO → indicators.ao[i]
- iAC → indicators.ac[i]
- iAlligator → indicators.alligator.jaw[i], .teeth[i], .lips[i]
- iFractals → indicators.fractals.up[i], .down[i]
- iIchimoku → indicators.ichimoku.tenkan[i], .kijun[i], .senkouA[i], .senkouB[i]
- VWAP → indicators.vwap[i]
- Custom periods: indicators._calc.ema(indicators._raw.closes, period)

**Order Type Mapping:**
- OP_BUY → { action: 'entry_long', type: 'market' }
- OP_SELL → { action: 'entry_short', type: 'market' }
- OP_BUYSTOP → { action: 'entry_long', type: 'stop', price: X }
- OP_BUYLIMIT → { action: 'entry_long', type: 'limit', price: X }
- OP_SELLSTOP → { action: 'entry_short', type: 'stop', price: X }
- OP_SELLLIMIT → { action: 'entry_short', type: 'limit', price: X }
- OrderClose → { action: 'exit' }
- OrdersTotal() → openPositions.length

**Rules:**
1. Extract ONLY buy/sell conditions from OnTick()/start()
2. TP/SL logic → include as exit conditions in signal function
3. Check null: if (val === null) return { action: 'hold' };
4. Parameters: { "type":"number", "default":14, "min":1, "max":200, "step":1, "label":"Name", "category":"strategy" }

Return ONLY valid JSON.`
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.log('❌ MQ Convert API Error:', data.error);
      return res.status(400).json({ error: data.error.message });
    }

    const responseText = data.content?.[0]?.text || '';
    console.log('🔵 MQ Convert Response length:', responseText.length);

    let result;
    try {
      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```javascript\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      result = JSON.parse(cleanText);
    } catch (parseError) {
      const functionMatch = responseText.match(/(function signal[\s\S]*)/);
      if (functionMatch) {
        result = { js_code: functionMatch[1], parameters: {}, ea_name: 'MQ Strategy' };
      } else {
        throw new Error('Could not extract valid code from MQ conversion');
      }
    }

    if (!result.js_code || !result.js_code.includes('function signal')) {
      throw new Error('Invalid conversion: missing signal function');
    }

    console.log('✅ MQ converted to signal function');

    // Workers API에 저장
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const strategyName = custom_name || result.ea_name || 'MQ Strategy';

    const uploadResponse = await fetch('https://cointop10-api.cointop10-com.workers.dev/api/strategies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ea_name: strategyName,
        js_code: result.js_code,
        parameters: result.parameters || {},
        source: 'mq_converter',
        engine_version: 'signal_v1',
      })
    });

    const uploadData = await uploadResponse.json();
    if (!uploadData.success) {
      throw new Error(uploadData.error || 'Failed to save strategy');
    }

    const strategyId = uploadData.ea_id || uploadData.id || uploadData.strategy_id;
    console.log('✅ MQ Strategy saved:', strategyId);

    // 즐겨찾기
    try {
      await fetch('https://cointop10-library.cointop10-com.workers.dev/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ settings_hash: `untested_${strategyId}` })
      });
    } catch (e) {}

    res.json({
      success: true,
      strategy_id: strategyId,
      ea_name: strategyName
    });

  } catch (error) {
    console.error('❌ MQ Convert Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ 커뮤니티 전략 백테스트 — 공용 엔진 ============
app.post('/api/backtest', async (req, res) => {
  try {
    const { js_code, candles, settings = {} } = req.body;
    
    console.log('🔥 Community Backtest Request');
    console.log('📊 Candles:', candles?.length || 0);
    console.log('⚙️ Settings:', JSON.stringify({
      symbol: settings.symbol,
      timeframe: settings.timeframe,
      market_type: settings.market_type,
      leverage: settings.leverage,
      equityPercent: settings.equityPercent,
      maxConcurrentOrders: settings.maxConcurrentOrders,
      params: settings.params,
    }));

    if (!js_code) {
      return res.status(400).json({ error: 'No strategy code provided' });
    }
    if (!candles || candles.length < 300) {
      return res.status(400).json({ error: 'Not enough candle data (min 300)' });
    }

    // 시그널 함수 생성
    let signalFn;
    try {
      const wrappedCode = `
        ${js_code}
        return signal;
      `;
      signalFn = new Function(wrappedCode)();
      
      if (typeof signalFn !== 'function') {
        throw new Error('signal is not a function');
      }
    } catch (e) {
      console.log('❌ Signal function creation error:', e.message);
      return res.status(400).json({ 
        error: `Invalid signal function: ${e.message}`,
        hint: 'Signal function must be: function signal(candles, i, indicators, params, openPositions) { ... }'
      });
    }

    // 백테스트 실행
    const startTime = Date.now();
    const result = runCommunityBacktest(signalFn, candles, settings);
    const elapsed = Date.now() - startTime;

    console.log(`✅ Backtest complete in ${elapsed}ms`);
    console.log(`   Trades: ${result.total_trades}, ROI: ${result.roi}%, MDD: ${result.mdd}%`);

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
    endpoints: [
      'POST /api/preview-strategy',
      'POST /api/generate-strategy',
      'POST /api/convert-mq',
      'POST /api/backtest',
    ]
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CoinTop10 API running on port ${PORT}`);
  console.log(`   POST /api/preview-strategy    - Preview (Haiku)`);
  console.log(`   POST /api/generate-strategy   - AI → Signal Function`);
  console.log(`   POST /api/convert-mq          - MQ → Signal Function`);
  console.log(`   POST /api/backtest            - Community Backtest Engine`);
  console.log(`   GET  /health                  - Health check`);
});
