const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ============ 페이지 라우트 ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/upload-strategy', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload-strategy.html'));
});

app.get('/ai-strategy', (req, res) => {
  res.sendFile(path.join(__dirname, 'ai-strategy.html'));
});

// ============ 1단계: AI 전략 확인 (Haiku - 저비용) ============
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

If nonsensical/gibberish/not a trading strategy:
{"valid":false,"reason":"Brief reason why"}

Rules:
- Respond in SAME LANGUAGE as the description
- Be concise: 1-2 sentences each field
- If description mentions indicators not in the selected list, still summarize
- TP/SL: extract exact % or values if mentioned`
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

// ============ 2단계: AI 전략 생성 API ============
app.post('/api/generate-strategy', async (req, res) => {
  try {
    const { selected_indicators, strategy_description, custom_name } = req.body;
    
    console.log('🤖 AI Strategy Generation Request');
    console.log('📊 Selected Indicators:', selected_indicators?.length || 0);
    console.log('📝 Description length:', strategy_description?.length || 0);
    
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // 지표 정보 포맷팅
    const indicatorsList = selected_indicators.map(ind => {
      const paramsStr = Object.entries(ind.params)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return `- ${ind.name}${paramsStr ? ` (${paramsStr})` : ''}`;
    }).join('\n');

    // Claude API 호출
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `You are an expert crypto trading strategy developer. Generate a JavaScript trading strategy based on user's description.

**Selected Indicators (with default values):**
${indicatorsList}

**User's Strategy Description:**
"${strategy_description}"

**CRITICAL INSTRUCTIONS:**

1. **Output Format** - Return ONLY valid JSON (no markdown, no code blocks):
{
  "js_code": "function runStrategy(candles, settings) { ... }",
  "parameters": { ... }
}

2. **Function Signature:**
\`\`\`javascript
function runStrategy(candles, settings) {
  // candles: [{timestamp, open, high, low, close, volume}]
  // settings: all parameters + base settings (symbol, timeframe, market_type, initialBalance, leverage, equityPercent, etc)
  
  return {
    trades: [...],
    equity_curve: [...],
    roi: number,
    mdd: number,
    win_rate: number,
    total_trades: number,
    final_balance: number,
    // ... other stats
  };
}
\`\`\`

3. **Indicator Library Available:**
These functions are already defined and can be used directly:
- calculateRSI(prices, period)
- calculateStochastic(highs, lows, closes, kPeriod, dPeriod)
- calculateMACD(prices, fast, slow, signal)
- calculateBB(prices, period, deviation)
- calculateATR(highs, lows, closes, period)
- calculateEMA(prices, period)
- calculateSMA(prices, period)
- calculateCCI(highs, lows, closes, period)
- calculateMomentum(prices, period)
- calculateWilliamsR(highs, lows, closes, period)
- calculateADX(highs, lows, closes, period)
- calculateSAR(highs, lows, closes, accel, max)
- calculateIchimoku(highs, lows, tenkan, kijun, senkouB)
- calculateOBV(closes, volumes)
- calculateMFI(highs, lows, closes, volumes, period)
- calculateAO(highs, lows)
- calculateAlligator(highs, lows, closes)
- calculateEnvelopes(prices, period, deviation)
- calculateKeltner(highs, lows, closes, period, multiplier)
- calculateDonchian(highs, lows, period)
- calculateSuperTrend(highs, lows, closes, period, multiplier)
- calculateAroon(highs, lows, period)
- ... and more (see full list in backtest server)

4. **Position Sizing (MANDATORY):**
\`\`\`javascript
const equity = settings.equityPercent || 10;
const lev = settings.market_type === 'futures' ? settings.leverage : 1;
const rawUSDT = balance * (equity / 100) * lev;
const positionUSDT = Math.floor(rawUSDT / 100) * 100;
const positionSize = positionUSDT / entryPrice;
\`\`\`

5. **Trade Tracking (MANDATORY):**
\`\`\`javascript
trades.push({
  entry_time: candles[entryIdx].timestamp,
  entry_price: entryPrice,
  exit_time: candles[i].timestamp,
  exit_price: exitPrice,
  side: "LONG" | "SHORT",
  pnl: profitLoss,
  fee: totalFee,
  size: positionSize,
  duration: i - entryIdx,
  order_type: "MARKET" | "BUY LIMIT" | "SELL STOP" | etc,
  balance: balance
});
\`\`\`

6. **Parameters Format (CRITICAL):**
\`\`\`javascript
{
  "rsiPeriod": {
    "type": "number",
    "default": 14,
    "min": 2,
    "max": 100,
    "step": 1,
    "label": "RSI Period",
    "category": "strategy"
  },
  "takeProfitPercent": {
    "type": "number",
    "default": 5,
    "min": 0.5,
    "max": 50,
    "step": 0.5,
    "label": "Take Profit %",
    "category": "strategy"
  },
  "stopLossPercent": {
    "type": "number",
    "default": 2,
    "min": 0.5,
    "max": 20,
    "step": 0.5,
    "label": "Stop Loss %",
    "category": "strategy"
  }
}
\`\`\`

**IMPORTANT:**
- ALL parameters must be dynamically adjustable
- Use \`category: "strategy"\` for all user-facing parameters
- DO NOT include: leverage, equityPercent, feePercent (handled in base settings)

7. **Include Parameters for Selected Indicators:**
${selected_indicators.map(ind => {
  return `- ${ind.name}: Extract all parameters (periods, thresholds, etc.)`;
}).join('\n')}

8. **Stop if Bankrupt:**
\`\`\`javascript
if (balance <= 0) { break; }
\`\`\`

9. **Equity Curve Tracking:**
\`\`\`javascript
equityCurve.push({
  timestamp: candles[i].timestamp,
  balance: balance,
  equity: balance + unrealizedPnL,
  drawdown: (peak - equity) / peak * 100
});
\`\`\`

10. **Return Object:**
\`\`\`javascript
return {
  trades, equity_curve: equityCurve,
  roi: ((finalBalance - initialBalance) / initialBalance * 100).toFixed(2),
  mdd: maxDrawdown.toFixed(2),
  win_rate: (winTrades / totalTrades * 100).toFixed(2),
  total_trades: totalTrades, winning_trades: winTrades, losing_trades: loseTrades,
  long_trades: longTrades, short_trades: shortTrades,
  max_profit: maxProfit, max_loss: maxLoss,
  avg_profit: avgProfit, avg_loss: avgLoss,
  avg_duration: avgDuration, max_duration: maxDuration,
  total_fee: totalFee,
  final_balance: finalBalance.toFixed(2),
  initial_balance: initialBalance, symbol: settings.symbol,
  timeframe: settings.timeframe, market_type: settings.market_type
};
\`\`\`

11. **BE CONCISE** - Keep code under 4000 tokens
12. **Test Your Logic** - Ensure entry/exit signals make sense

Generate the strategy now. Return ONLY valid JSON with no markdown formatting.`
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

    // JSON 파싱
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
        const functionMatch = responseText.match(/(function runStrategy[\s\S]*)/);
        if (functionMatch) {
          result = { js_code: functionMatch[1], parameters: {} };
        } else {
          throw new Error('Could not extract valid code from response');
        }
      }
    }

    if (!result.js_code || !result.js_code.includes('function runStrategy')) {
      throw new Error('Invalid strategy code: missing runStrategy function');
    }

    console.log('✅ Strategy generated successfully');
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
        source: 'ai_builder'
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'ai-strategy-builder',
    model: 'claude-haiku-4-5-20251001'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Strategy Builder running on port ${PORT}`);
  console.log(`📊 Available endpoints:`);
  console.log(`   GET  /                  - Main page`);
  console.log(`   GET  /ai-strategy       - AI Builder page`);
  console.log(`   GET  /upload-strategy   - MQ Upload page`);
  console.log(`   POST /api/preview-strategy  - Preview (Haiku)`);
  console.log(`   POST /api/generate-strategy - Generate (Haiku)`);
  console.log(`   GET  /health            - Health check`);
  console.log(`🤖 Model: claude-haiku-4-5-20251001`);
});
