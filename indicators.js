// ============================================================
// CoinTop10 Shared Indicator Library
// 커뮤니티 전략용 공용 보조지표 라이브러리
// 시그널 함수에 pre-calculated 값을 제공
// ============================================================

function calculateEMA(prices, period) {
  const ema = new Array(prices.length).fill(null);
  if (prices.length < period) return ema;
  
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema[period - 1] = sum / period;
  
  const k = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calculateSMA(prices, period) {
  const sma = new Array(prices.length).fill(null);
  if (prices.length < period) return sma;
  
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  sma[period - 1] = sum / period;
  
  for (let i = period; i < prices.length; i++) {
    sum += prices[i] - prices[i - period];
    sma[i] = sum / period;
  }
  return sma;
}

function calculateRSI(prices, period = 14) {
  const rsi = new Array(prices.length).fill(null);
  if (prices.length < period + 1) return rsi;
  
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calculateStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const len = closes.length;
  const k = new Array(len).fill(null);
  const d = new Array(len).fill(null);
  
  for (let i = kPeriod - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    k[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  
  // %D = SMA of %K
  for (let i = kPeriod - 1 + dPeriod - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += k[j];
    d[i] = sum / dPeriod;
  }
  
  return { k, d };
}

function calculateMACD(prices, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calculateEMA(prices, fast);
  const emaSlow = calculateEMA(prices, slow);
  const len = prices.length;
  
  const macdLine = new Array(len).fill(null);
  const signal = new Array(len).fill(null);
  const histogram = new Array(len).fill(null);
  
  for (let i = slow - 1; i < len; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }
  
  // Signal = EMA of MACD line
  const macdValues = macdLine.filter(v => v !== null);
  if (macdValues.length >= signalPeriod) {
    const sigEma = calculateEMA(macdValues, signalPeriod);
    let idx = 0;
    for (let i = 0; i < len; i++) {
      if (macdLine[i] !== null) {
        if (sigEma[idx] !== null) {
          signal[i] = sigEma[idx];
          histogram[i] = macdLine[i] - signal[i];
        }
        idx++;
      }
    }
  }
  
  return { macd: macdLine, signal, histogram };
}

function calculateBB(prices, period = 20, deviation = 2) {
  const sma = calculateSMA(prices, period);
  const len = prices.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  const middle = sma;
  
  for (let i = period - 1; i < len; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = prices[j] - sma[i];
      sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / period);
    upper[i] = sma[i] + deviation * std;
    lower[i] = sma[i] - deviation * std;
  }
  
  return { upper, middle, lower };
}

function calculateATR(highs, lows, closes, period = 14) {
  const len = closes.length;
  const atr = new Array(len).fill(null);
  const tr = new Array(len).fill(0);
  
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < len; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;
  
  for (let i = period; i < len; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  return atr;
}

function calculateCCI(highs, lows, closes, period = 20) {
  const len = closes.length;
  const cci = new Array(len).fill(null);
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  
  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j];
    const mean = sum / period;
    
    let madSum = 0;
    for (let j = i - period + 1; j <= i; j++) madSum += Math.abs(tp[j] - mean);
    const mad = madSum / period;
    
    cci[i] = mad === 0 ? 0 : (tp[i] - mean) / (0.015 * mad);
  }
  return cci;
}

function calculateMomentum(prices, period = 10) {
  const mom = new Array(prices.length).fill(null);
  for (let i = period; i < prices.length; i++) {
    mom[i] = prices[i] - prices[i - period];
  }
  return mom;
}

function calculateWilliamsR(highs, lows, closes, period = 14) {
  const len = closes.length;
  const wr = new Array(len).fill(null);
  
  for (let i = period - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    wr[i] = hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
  }
  return wr;
}

function calculateADX(highs, lows, closes, period = 14) {
  const len = closes.length;
  const adx = new Array(len).fill(null);
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  
  if (len < period * 2) return { adx, plusDI, minusDI };
  
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < len; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  
  let smoothTR = 0, smoothPDM = 0, smoothMDM = 0;
  for (let i = 0; i < period; i++) {
    smoothTR += tr[i];
    smoothPDM += plusDM[i];
    smoothMDM += minusDM[i];
  }
  
  const dxArr = [];
  for (let i = period; i < tr.length; i++) {
    if (i === period) {
      // first value
    } else {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPDM = smoothPDM - smoothPDM / period + plusDM[i];
      smoothMDM = smoothMDM - smoothMDM / period + minusDM[i];
    }
    
    const pdi = smoothTR === 0 ? 0 : (smoothPDM / smoothTR) * 100;
    const mdi = smoothTR === 0 ? 0 : (smoothMDM / smoothTR) * 100;
    plusDI[i + 1] = pdi;
    minusDI[i + 1] = mdi;
    
    const diSum = pdi + mdi;
    const dx = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100;
    dxArr.push(dx);
    
    if (dxArr.length >= period) {
      if (dxArr.length === period) {
        let adxSum = 0;
        for (let j = 0; j < period; j++) adxSum += dxArr[j];
        adx[i + 1] = adxSum / period;
      } else {
        adx[i + 1] = (adx[i] * (period - 1) + dx) / period;
      }
    }
  }
  
  return { adx, plusDI, minusDI };
}

function calculateSuperTrend(highs, lows, closes, period = 10, multiplier = 3) {
  const len = closes.length;
  const supertrend = new Array(len).fill(null);
  const direction = new Array(len).fill(null); // 1=up, -1=down
  const atr = calculateATR(highs, lows, closes, period);
  
  if (len < period) return { supertrend, direction };
  
  let upperBand, lowerBand, prevUpper, prevLower;
  
  for (let i = period; i < len; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    let basicUpper = hl2 + multiplier * atr[i];
    let basicLower = hl2 - multiplier * atr[i];
    
    if (i === period) {
      upperBand = basicUpper;
      lowerBand = basicLower;
      direction[i] = closes[i] > upperBand ? 1 : -1;
    } else {
      upperBand = basicUpper < prevUpper || closes[i - 1] > prevUpper ? basicUpper : prevUpper;
      lowerBand = basicLower > prevLower || closes[i - 1] < prevLower ? basicLower : prevLower;
      
      if (direction[i - 1] === 1) {
        direction[i] = closes[i] < lowerBand ? -1 : 1;
      } else {
        direction[i] = closes[i] > upperBand ? 1 : -1;
      }
    }
    
    supertrend[i] = direction[i] === 1 ? lowerBand : upperBand;
    prevUpper = upperBand;
    prevLower = lowerBand;
  }
  
  return { supertrend, direction };
}

function calculateOBV(closes, volumes) {
  const len = closes.length;
  const obv = new Array(len).fill(0);
  obv[0] = volumes[0] || 0;
  
  for (let i = 1; i < len; i++) {
    if (closes[i] > closes[i - 1]) obv[i] = obv[i - 1] + volumes[i];
    else if (closes[i] < closes[i - 1]) obv[i] = obv[i - 1] - volumes[i];
    else obv[i] = obv[i - 1];
  }
  return obv;
}

function calculateMFI(highs, lows, closes, volumes, period = 14) {
  const len = closes.length;
  const mfi = new Array(len).fill(null);
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  
  for (let i = period; i < len; i++) {
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * volumes[j];
      if (tp[j] > tp[j - 1]) posFlow += flow;
      else if (tp[j] < tp[j - 1]) negFlow += flow;
    }
    mfi[i] = negFlow === 0 ? 100 : 100 - (100 / (1 + posFlow / negFlow));
  }
  return mfi;
}

function calculateDonchian(highs, lows, period = 20) {
  const len = highs.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  const middle = new Array(len).fill(null);
  
  for (let i = period - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    upper[i] = hh;
    lower[i] = ll;
    middle[i] = (hh + ll) / 2;
  }
  return { upper, middle, lower };
}

function calculateAO(highs, lows) {
  const len = highs.length;
  const ao = new Array(len).fill(null);
  const midpoints = highs.map((h, i) => (h + lows[i]) / 2);
  const sma5 = calculateSMA(midpoints, 5);
  const sma34 = calculateSMA(midpoints, 34);
  
  for (let i = 33; i < len; i++) {
    if (sma5[i] !== null && sma34[i] !== null) {
      ao[i] = sma5[i] - sma34[i];
    }
  }
  return ao;
}

function calculateEnvelopes(prices, period = 20, deviation = 2.5) {
  const sma = calculateSMA(prices, period);
  const len = prices.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  
  for (let i = period - 1; i < len; i++) {
    if (sma[i] !== null) {
      upper[i] = sma[i] * (1 + deviation / 100);
      lower[i] = sma[i] * (1 - deviation / 100);
    }
  }
  return { upper, middle: sma, lower };
}

function calculateKeltner(highs, lows, closes, period = 20, multiplier = 1.5) {
  const ema = calculateEMA(closes, period);
  const atr = calculateATR(highs, lows, closes, period);
  const len = closes.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  
  for (let i = period - 1; i < len; i++) {
    if (ema[i] !== null && atr[i] !== null) {
      upper[i] = ema[i] + multiplier * atr[i];
      lower[i] = ema[i] - multiplier * atr[i];
    }
  }
  return { upper, middle: ema, lower };
}

function calculateAroon(highs, lows, period = 25) {
  const len = highs.length;
  const up = new Array(len).fill(null);
  const down = new Array(len).fill(null);
  
  for (let i = period; i < len; i++) {
    let highIdx = 0, lowIdx = 0;
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j <= period; j++) {
      if (highs[i - j] > hh) { hh = highs[i - j]; highIdx = j; }
      if (lows[i - j] < ll) { ll = lows[i - j]; lowIdx = j; }
    }
    up[i] = ((period - highIdx) / period) * 100;
    down[i] = ((period - lowIdx) / period) * 100;
  }
  return { up, down };
}

function calculateSAR(highs, lows, accelStart = 0.02, accelMax = 0.2) {
  const len = highs.length;
  const sar = new Array(len).fill(null);
  if (len < 2) return sar;
  
  let isLong = highs[1] > highs[0];
  let af = accelStart;
  let ep = isLong ? highs[0] : lows[0];
  sar[0] = isLong ? lows[0] : highs[0];
  
  for (let i = 1; i < len; i++) {
    let prevSar = sar[i - 1] || (isLong ? lows[0] : highs[0]);
    sar[i] = prevSar + af * (ep - prevSar);
    
    if (isLong) {
      if (i >= 2) sar[i] = Math.min(sar[i], lows[i - 1], lows[i - 2] || lows[i - 1]);
      if (lows[i] < sar[i]) {
        isLong = false;
        sar[i] = ep;
        ep = lows[i];
        af = accelStart;
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + accelStart, accelMax);
        }
      }
    } else {
      if (i >= 2) sar[i] = Math.max(sar[i], highs[i - 1], highs[i - 2] || highs[i - 1]);
      if (highs[i] > sar[i]) {
        isLong = true;
        sar[i] = ep;
        ep = highs[i];
        af = accelStart;
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + accelStart, accelMax);
        }
      }
    }
  }
  return sar;
}

function calculateIchimoku(highs, lows, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  const len = highs.length;
  const tenkan = new Array(len).fill(null);
  const kijun = new Array(len).fill(null);
  const senkouA = new Array(len).fill(null);
  const senkouB = new Array(len).fill(null);
  const chikou = new Array(len).fill(null);
  
  const calcHL = (start, end) => {
    let hh = -Infinity, ll = Infinity;
    for (let j = start; j <= end; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    return (hh + ll) / 2;
  };
  
  for (let i = 0; i < len; i++) {
    if (i >= tenkanPeriod - 1) tenkan[i] = calcHL(i - tenkanPeriod + 1, i);
    if (i >= kijunPeriod - 1) kijun[i] = calcHL(i - kijunPeriod + 1, i);
    if (i >= senkouBPeriod - 1) {
      const a = (tenkan[i] !== null && kijun[i] !== null) ? (tenkan[i] + kijun[i]) / 2 : null;
      const b = calcHL(i - senkouBPeriod + 1, i);
      // Shift forward by kijunPeriod
      if (i + kijunPeriod < len) {
        senkouA[i + kijunPeriod] = a;
        senkouB[i + kijunPeriod] = b;
      }
    }
    // Chikou = close shifted back
    if (i >= kijunPeriod) {
      chikou[i - kijunPeriod] = null; // placeholder, actual close
    }
  }
  
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function calculateAlligator(highs, lows, closes) {
  const midpoints = highs.map((h, i) => (h + lows[i]) / 2);
  // Jaw: SMA(13) shifted 8 bars forward
  // Teeth: SMA(8) shifted 5 bars forward
  // Lips: SMA(5) shifted 3 bars forward
  const jawSma = calculateSMA(midpoints, 13);
  const teethSma = calculateSMA(midpoints, 8);
  const lipsSma = calculateSMA(midpoints, 5);
  
  const len = closes.length;
  const jaw = new Array(len).fill(null);
  const teeth = new Array(len).fill(null);
  const lips = new Array(len).fill(null);
  
  for (let i = 0; i < len; i++) {
    if (i + 8 < len && jawSma[i] !== null) jaw[i + 8] = jawSma[i];
    if (i + 5 < len && teethSma[i] !== null) teeth[i + 5] = teethSma[i];
    if (i + 3 < len && lipsSma[i] !== null) lips[i + 3] = lipsSma[i];
  }
  
  return { jaw, teeth, lips };
}

// ============================================================
// 추가 보조지표 21개
// ============================================================

// DeMarker
function calculateDeMarker(highs, lows, period = 14) {
  const len = highs.length;
  const result = new Array(len).fill(null);
  for (let i = period; i < len; i++) {
    let deMax = 0, deMin = 0;
    for (let j = i - period + 1; j <= i; j++) {
      deMax += highs[j] > highs[j - 1] ? highs[j] - highs[j - 1] : 0;
      deMin += lows[j] < lows[j - 1] ? lows[j - 1] - lows[j] : 0;
    }
    result[i] = (deMax + deMin) === 0 ? 50 : (deMax / (deMax + deMin)) * 100;
  }
  return result;
}

// RVI (Relative Vigor Index)
function calculateRVI(opens, highs, lows, closes, period = 10) {
  const len = closes.length;
  const rviLine = new Array(len).fill(null);
  const signalLine = new Array(len).fill(null);
  for (let i = period + 3; i < len; i++) {
    let numSum = 0, denSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const num = ((closes[j] - opens[j]) + 2 * (closes[j-1] - opens[j-1]) + 2 * (closes[j-2] - opens[j-2]) + (closes[j-3] - opens[j-3])) / 6;
      const den = ((highs[j] - lows[j]) + 2 * (highs[j-1] - lows[j-1]) + 2 * (highs[j-2] - lows[j-2]) + (highs[j-3] - lows[j-3])) / 6;
      numSum += num;
      denSum += den;
    }
    rviLine[i] = denSum === 0 ? 0 : numSum / denSum;
  }
  for (let i = 3; i < len; i++) {
    if (rviLine[i] !== null && rviLine[i-1] !== null && rviLine[i-2] !== null && rviLine[i-3] !== null) {
      signalLine[i] = (rviLine[i] + 2 * rviLine[i-1] + 2 * rviLine[i-2] + rviLine[i-3]) / 6;
    }
  }
  return { rvi: rviLine, signal: signalLine };
}

// Standard Deviation
function calculateStdDev(prices, period = 20) {
  const len = prices.length;
  const result = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    result[i] = Math.sqrt(variance);
  }
  return result;
}

// A/D (Accumulation/Distribution)
function calculateAD(highs, lows, closes, volumes) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  let ad = 0;
  for (let i = 0; i < len; i++) {
    const range = highs[i] - lows[i];
    const clv = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    ad += clv * volumes[i];
    result[i] = ad;
  }
  return result;
}

// Accelerator Oscillator (AC)
function calculateAC(highs, lows) {
  const ao = calculateAO(highs, lows);
  const len = ao.length;
  const result = new Array(len).fill(null);
  for (let i = 4; i < len; i++) {
    if (ao[i] === null) continue;
    let sum = 0, count = 0;
    for (let j = i - 4; j <= i; j++) {
      if (ao[j] !== null) { sum += ao[j]; count++; }
    }
    if (count === 5) result[i] = ao[i] - sum / 5;
  }
  return result;
}

// Fractals
function calculateFractals(highs, lows) {
  const len = highs.length;
  const up = new Array(len).fill(null);
  const down = new Array(len).fill(null);
  for (let i = 2; i < len - 2; i++) {
    if (highs[i] > highs[i-2] && highs[i] > highs[i-1] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
      up[i] = highs[i];
    }
    if (lows[i] < lows[i-2] && lows[i] < lows[i-1] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
      down[i] = lows[i];
    }
  }
  return { up, down };
}

// Gator Oscillator
function calculateGator(highs, lows, closes) {
  const alligator = calculateAlligator(highs, lows, closes);
  const len = closes.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (alligator.jaw[i] !== null && alligator.teeth[i] !== null) {
      upper[i] = Math.abs(alligator.jaw[i] - alligator.teeth[i]);
    }
    if (alligator.teeth[i] !== null && alligator.lips[i] !== null) {
      lower[i] = -Math.abs(alligator.teeth[i] - alligator.lips[i]);
    }
  }
  return { upper, lower };
}

// BW MFI (Bill Williams Market Facilitation Index)
function calculateBWMFI(highs, lows, volumes) {
  const len = highs.length;
  const result = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const range = highs[i] - lows[i];
    result[i] = volumes[i] === 0 ? 0 : range / volumes[i] * 100000;
  }
  return result;
}

// VWAP
function calculateVWAP(highs, lows, closes, volumes) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < len; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += tp * volumes[i];
    cumV += volumes[i];
    result[i] = cumV === 0 ? closes[i] : cumPV / cumV;
  }
  return result;
}

// Pivot Points
function calculatePivot(highs, lows, closes) {
  const len = closes.length;
  const pivot = new Array(len).fill(null);
  const r1 = new Array(len).fill(null), r2 = new Array(len).fill(null), r3 = new Array(len).fill(null);
  const s1 = new Array(len).fill(null), s2 = new Array(len).fill(null), s3 = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const h = highs[i-1], l = lows[i-1], c = closes[i-1];
    const pp = (h + l + c) / 3;
    pivot[i] = pp;
    r1[i] = 2 * pp - l; r2[i] = pp + (h - l); r3[i] = h + 2 * (pp - l);
    s1[i] = 2 * pp - h; s2[i] = pp - (h - l); s3[i] = l - 2 * (h - pp);
  }
  return { pivot, r1, r2, r3, s1, s2, s3 };
}

// ZigZag
function calculateZigZag(highs, lows, closes, deviation = 5) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  const devPercent = deviation / 100;
  let lastPivotPrice = closes[0], lastDirection = 0;
  for (let i = 1; i < len; i++) {
    if (lastDirection >= 0 && highs[i] >= lastPivotPrice * (1 + devPercent)) {
      lastPivotPrice = highs[i]; lastDirection = 1; result[i] = highs[i];
    } else if (lastDirection <= 0 && lows[i] <= lastPivotPrice * (1 - devPercent)) {
      lastPivotPrice = lows[i]; lastDirection = -1; result[i] = lows[i];
    } else if (lastDirection === 1 && lows[i] <= lastPivotPrice * (1 - devPercent)) {
      lastPivotPrice = lows[i]; lastDirection = -1; result[i] = lows[i];
    } else if (lastDirection === -1 && highs[i] >= lastPivotPrice * (1 + devPercent)) {
      lastPivotPrice = highs[i]; lastDirection = 1; result[i] = highs[i];
    }
  }
  return result;
}

// Linear Regression
function calculateLinReg(prices, period = 14) {
  const len = prices.length;
  const value = new Array(len).fill(null);
  const slope = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      sumX += j; sumY += slice[j]; sumXY += j * slice[j]; sumX2 += j * j;
    }
    const s = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    const b = (sumY - s * sumX) / period;
    slope[i] = s;
    value[i] = b + s * (period - 1);
  }
  return { value, slope };
}

// KDJ
function calculateKDJ(highs, lows, closes, kPeriod = 9, dPeriod = 3) {
  const len = closes.length;
  const k = new Array(len).fill(null), d = new Array(len).fill(null), j = new Array(len).fill(null);
  for (let i = kPeriod - 1; i < len; i++) {
    const highest = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const lowest = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    const rsv = highest === lowest ? 50 : ((closes[i] - lowest) / (highest - lowest)) * 100;
    k[i] = i === kPeriod - 1 ? rsv : (2 / 3) * (k[i-1] || 50) + (1 / 3) * rsv;
  }
  for (let i = 0; i < len; i++) {
    if (k[i] === null) continue;
    d[i] = d[i-1] === null || d[i-1] === undefined ? k[i] : (2 / 3) * d[i-1] + (1 / 3) * k[i];
    j[i] = 3 * k[i] - 2 * d[i];
  }
  return { k, d, j };
}

// Ultimate Oscillator
function calculateUO(highs, lows, closes, p1 = 7, p2 = 14, p3 = 28) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  for (let i = p3; i < len; i++) {
    let bp1 = 0, tr1 = 0, bp2 = 0, tr2 = 0, bp3 = 0, tr3 = 0;
    for (let j = i - p3 + 1; j <= i; j++) {
      const bp = closes[j] - Math.min(lows[j], closes[j - 1]);
      const tr = Math.max(highs[j], closes[j - 1]) - Math.min(lows[j], closes[j - 1]);
      if (j > i - p1) { bp1 += bp; tr1 += tr; }
      if (j > i - p2) { bp2 += bp; tr2 += tr; }
      bp3 += bp; tr3 += tr;
    }
    const a1 = tr1 === 0 ? 0 : bp1 / tr1;
    const a2 = tr2 === 0 ? 0 : bp2 / tr2;
    const a3 = tr3 === 0 ? 0 : bp3 / tr3;
    result[i] = ((a1 * 4 + a2 * 2 + a3) / 7) * 100;
  }
  return result;
}

// TRIX
function calculateTRIX(prices, period = 15) {
  const len = prices.length;
  const ema1 = calculateEMA(prices, period);
  const ema2 = calculateEMA(ema1.map(v => v === null ? prices[0] : v), period);
  const ema3 = calculateEMA(ema2.map(v => v === null ? prices[0] : v), period);
  const result = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    if (ema3[i] !== null && ema3[i-1] !== null && ema3[i-1] !== 0) {
      result[i] = ((ema3[i] - ema3[i-1]) / ema3[i-1]) * 10000;
    }
  }
  return result;
}

// CMF (Chaikin Money Flow)
function calculateCMF(highs, lows, closes, volumes, period = 20) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    let mfvSum = 0, volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const range = highs[j] - lows[j];
      const clv = range === 0 ? 0 : ((closes[j] - lows[j]) - (highs[j] - closes[j])) / range;
      mfvSum += clv * volumes[j];
      volSum += volumes[j];
    }
    result[i] = volSum === 0 ? 0 : mfvSum / volSum;
  }
  return result;
}

// EOM (Ease of Movement)
function calculateEOM(highs, lows, volumes, period = 14) {
  const len = highs.length;
  const result = new Array(len).fill(null);
  const raw = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const dm = ((highs[i] + lows[i]) / 2) - ((highs[i-1] + lows[i-1]) / 2);
    const range = highs[i] - lows[i];
    const boxRatio = range === 0 ? 0 : (volumes[i] / 10000) / range;
    raw[i] = boxRatio === 0 ? 0 : dm / boxRatio;
  }
  for (let i = period; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += raw[j] || 0;
    result[i] = sum / period;
  }
  return result;
}

// Historical Volatility
function calculateHV(closes, period = 20) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  for (let i = period; i < len; i++) {
    const returns = [];
    for (let j = i - period + 1; j <= i; j++) {
      if (closes[j-1] > 0) returns.push(Math.log(closes[j] / closes[j-1]));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    result[i] = Math.sqrt(variance * 365) * 100;
  }
  return result;
}

// Volatility Index (ATR-based)
function calculateVolatilityIndex(highs, lows, closes, period = 14) {
  const atr = calculateATR(highs, lows, closes, period);
  const len = closes.length;
  const result = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (atr[i] !== null && closes[i] > 0) result[i] = (atr[i] / closes[i]) * 100;
  }
  return result;
}

// Price Channel
function calculatePriceChannel(highs, lows, period = 20) {
  const len = highs.length;
  const upper = new Array(len).fill(null), lower = new Array(len).fill(null), middle = new Array(len).fill(null);
  for (let i = period; i < len; i++) {
    const h = Math.max(...highs.slice(i - period, i));
    const l = Math.min(...lows.slice(i - period, i));
    upper[i] = h; lower[i] = l; middle[i] = (h + l) / 2;
  }
  return { upper, middle, lower };
}

// High/Low
function calculateHighLow(highs, lows, period = 14) {
  const len = highs.length;
  const highest = new Array(len).fill(null), lowest = new Array(len).fill(null), middle = new Array(len).fill(null);
  for (let i = period - 1; i < len; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1));
    const l = Math.min(...lows.slice(i - period + 1, i + 1));
    highest[i] = h; lowest[i] = l; middle[i] = (h + l) / 2;
  }
  return { highest, lowest, middle };
}


// ============================================================
// Pre-calculate all indicators for a candle set
// Returns object accessible by signal function
// ============================================================
function preCalculateIndicators(candles, params = {}) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const opens = candles.map(c => c.open);
  const volumes = candles.map(c => c.volume || 0);
  
  return {
    // Moving Averages (common periods)
    ema: {
      5: calculateEMA(closes, 5),
      8: calculateEMA(closes, 8),
      10: calculateEMA(closes, 10),
      12: calculateEMA(closes, 12),
      20: calculateEMA(closes, 20),
      21: calculateEMA(closes, 21),
      26: calculateEMA(closes, 26),
      50: calculateEMA(closes, 50),
      100: calculateEMA(closes, 100),
      200: calculateEMA(closes, 200),
    },
    sma: {
      5: calculateSMA(closes, 5),
      10: calculateSMA(closes, 10),
      20: calculateSMA(closes, 20),
      50: calculateSMA(closes, 50),
      100: calculateSMA(closes, 100),
      200: calculateSMA(closes, 200),
    },
    
    // Oscillators
    rsi: {
      7: calculateRSI(closes, 7),
      14: calculateRSI(closes, 14),
      21: calculateRSI(closes, 21),
    },
    stoch: {
      '14_3': calculateStochastic(highs, lows, closes, 14, 3),
      '5_3': calculateStochastic(highs, lows, closes, 5, 3),
      '21_7': calculateStochastic(highs, lows, closes, 21, 7),
    },
    macd: {
      '12_26_9': calculateMACD(closes, 12, 26, 9),
    },
    cci: {
      14: calculateCCI(highs, lows, closes, 14),
      20: calculateCCI(highs, lows, closes, 20),
    },
    momentum: {
      10: calculateMomentum(closes, 10),
      14: calculateMomentum(closes, 14),
    },
    williamsR: {
      14: calculateWilliamsR(highs, lows, closes, 14),
    },
    adx: {
      14: calculateADX(highs, lows, closes, 14),
    },
    ao: calculateAO(highs, lows),
    
    // Bands & Channels
    bb: {
      '20_2': calculateBB(closes, 20, 2),
    },
    keltner: {
      '20_1.5': calculateKeltner(highs, lows, closes, 20, 1.5),
    },
    donchian: {
      20: calculateDonchian(highs, lows, 20),
    },
    envelopes: {
      '20_2.5': calculateEnvelopes(closes, 20, 2.5),
    },
    
    // Trend
    supertrend: {
      '10_3': calculateSuperTrend(highs, lows, closes, 10, 3),
    },
    atr: {
      14: calculateATR(highs, lows, closes, 14),
    },
    sar: calculateSAR(highs, lows),
    ichimoku: calculateIchimoku(highs, lows),
    alligator: calculateAlligator(highs, lows, closes),
    aroon: {
      25: calculateAroon(highs, lows, 25),
    },
    
    // Volume
    obv: calculateOBV(closes, volumes),
    mfi: {
      14: calculateMFI(highs, lows, closes, volumes, 14),
    },
    
    // ===== 추가 보조지표 21개 =====
    
    // Oscillators
    demarker: {
      14: calculateDeMarker(highs, lows, 14),
    },
    rvi: calculateRVI(opens, highs, lows, closes, 10),
    stddev: {
      20: calculateStdDev(closes, 20),
    },
    kdj: {
      '9_3': calculateKDJ(highs, lows, closes, 9, 3),
    },
    uo: calculateUO(highs, lows, closes, 7, 14, 28),
    trix: {
      15: calculateTRIX(closes, 15),
    },
    
    // Volume
    ad: calculateAD(highs, lows, closes, volumes),
    cmf: {
      20: calculateCMF(highs, lows, closes, volumes, 20),
    },
    eom: {
      14: calculateEOM(highs, lows, volumes, 14),
    },
    vwap: calculateVWAP(highs, lows, closes, volumes),
    bwmfi: calculateBWMFI(highs, lows, volumes),
    
    // Bill Williams
    ac: calculateAC(highs, lows),
    fractals: calculateFractals(highs, lows),
    gator: calculateGator(highs, lows, closes),
    
    // Trend/Channel
    pivot: calculatePivot(highs, lows, closes),
    zigzag: {
      5: calculateZigZag(highs, lows, closes, 5),
    },
    linreg: {
      14: calculateLinReg(closes, 14),
    },
    pricechannel: {
      20: calculatePriceChannel(highs, lows, 20),
    },
    highlow: {
      14: calculateHighLow(highs, lows, 14),
    },
    
    // Volatility
    hv: {
      20: calculateHV(closes, 20),
    },
    vix: {
      14: calculateVolatilityIndex(highs, lows, closes, 14),
    },
    
    // Raw individual calculator functions (for custom periods in params)
    _calc: {
      ema: calculateEMA,
      sma: calculateSMA,
      rsi: calculateRSI,
      stoch: calculateStochastic,
      macd: calculateMACD,
      bb: calculateBB,
      atr: calculateATR,
      cci: calculateCCI,
      momentum: calculateMomentum,
      williamsR: calculateWilliamsR,
      adx: calculateADX,
      supertrend: calculateSuperTrend,
      obv: calculateOBV,
      mfi: calculateMFI,
      donchian: calculateDonchian,
      ao: calculateAO,
      envelopes: calculateEnvelopes,
      keltner: calculateKeltner,
      aroon: calculateAroon,
      sar: calculateSAR,
      ichimoku: calculateIchimoku,
      alligator: calculateAlligator,
      // 추가 21개
      demarker: calculateDeMarker,
      rvi: calculateRVI,
      stddev: calculateStdDev,
      ad: calculateAD,
      ac: calculateAC,
      fractals: calculateFractals,
      gator: calculateGator,
      bwmfi: calculateBWMFI,
      vwap: calculateVWAP,
      pivot: calculatePivot,
      zigzag: calculateZigZag,
      linreg: calculateLinReg,
      kdj: calculateKDJ,
      uo: calculateUO,
      trix: calculateTRIX,
      cmf: calculateCMF,
      eom: calculateEOM,
      hv: calculateHV,
      volatilityIndex: calculateVolatilityIndex,
      pricechannel: calculatePriceChannel,
      highlow: calculateHighLow,
    },
    
    // Raw price arrays for custom calculations
    _raw: { closes, highs, lows, opens, volumes }
  };
}

module.exports = {
  preCalculateIndicators,
  // 기존 22개
  calculateEMA, calculateSMA, calculateRSI, calculateStochastic,
  calculateMACD, calculateBB, calculateATR, calculateCCI,
  calculateMomentum, calculateWilliamsR, calculateADX,
  calculateSuperTrend, calculateOBV, calculateMFI,
  calculateDonchian, calculateAO, calculateEnvelopes,
  calculateKeltner, calculateAroon, calculateSAR,
  calculateIchimoku, calculateAlligator,
  // 추가 21개
  calculateDeMarker, calculateRVI, calculateStdDev,
  calculateAD, calculateAC, calculateFractals,
  calculateGator, calculateBWMFI, calculateVWAP,
  calculatePivot, calculateZigZag, calculateLinReg,
  calculateKDJ, calculateUO, calculateTRIX,
  calculateCMF, calculateEOM, calculateHV,
  calculateVolatilityIndex, calculatePriceChannel, calculateHighLow
};
