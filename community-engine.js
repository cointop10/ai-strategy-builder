// ============================================================
// CoinTop10 Community Backtest Engine (공용 바보 실행기)
// 
// 시그널 함수가 시키는 대로만 실행한다.
// - 사라 → 산다
// - 팔아라 → 판다
// - 취소해라 → 취소한다
// - 엔진은 판단 안 함
// ============================================================

const { preCalculateIndicators } = require('./indicators');

/**
 * 커뮤니티 전략 백테스트 실행
 * 
 * @param {Function} signalFn - 시그널 함수 (candles, i, indicators, params, openPositions) => signal
 * @param {Array} candles - [{timestamp, open, high, low, close, volume}]
 * @param {Object} settings - 백테스트 설정
 * @returns {Object} 백테스트 결과
 */
function runCommunityBacktest(signalFn, candles, settings) {
  // ========== 설정 파싱 ==========
  const {
    initialBalance = 10000,
    equityPercent = 10,
    leverage = 1,
    market_type = 'futures',
    feePercent = null,         // null이면 기본값 사용
    maxPositionUSDT = 10000000,
    maxConcurrentOrders = 1,
    compound = true,
    reverse = false,
    allowLong = true,
    allowShort = true,
    symbol = 'BTCUSDT',
    timeframe = '1h',
    volumeFilter = 0,
    params = {},               // 전략 파라미터
  } = settings;

  // 수수료 기본값: futures 0.05%, spot 0.1%
  const fee = feePercent !== null ? feePercent / 100 : (market_type === 'futures' ? 0.0005 : 0.001);
  
  // maxPosition caps
  const isLargeCap = symbol.includes('BTC') || symbol.includes('ETH');
  const effectiveMaxPosition = Math.min(maxPositionUSDT, isLargeCap ? 10000000 : 1000000);

  // ========== 보조지표 사전 계산 ==========
  const indicators = preCalculateIndicators(candles);

  // ========== 상태 변수 ==========
  let balance = initialBalance;
  let equity = initialBalance;
  let peak = initialBalance;
  let maxDrawdown = 0;
  
  const openPositions = [];     // 현재 열린 포지션들
  const pendingOrders = [];     // 대기 주문 (stop/limit)
  const trades = [];            // 체결 완료된 거래 기록
  const equityCurve = [];       // 에쿼티 커브
  
  let totalFees = 0;
  let winTrades = 0, loseTrades = 0;
  let longTrades = 0, shortTrades = 0;
  let maxProfit = 0, maxLoss = 0;
  let sumProfit = 0, sumLoss = 0;
  let sumDuration = 0, maxDuration = 0;

  // ========== 유틸리티 함수 ==========
  
  // 포지션 사이즈 계산 (equity% × leverage, $100 반올림)
  function calcPositionSize(entryPrice) {
    const base = compound ? equity : initialBalance;
    const rawUSDT = base * (equityPercent / 100) * leverage;
    const positionUSDT = Math.min(
      Math.floor(rawUSDT / 100) * 100,
      effectiveMaxPosition
    );
    if (positionUSDT < 100) return { usdt: 0, coins: 0 };
    return {
      usdt: positionUSDT,
      coins: positionUSDT / entryPrice
    };
  }

  // 포지션 열기
  function openPosition(side, price, candleIndex, orderType = 'MARKET') {
    // reverse 모드면 방향 반전
    const actualSide = reverse ? (side === 'LONG' ? 'SHORT' : 'LONG') : side;
    
    // long/short 필터
    if (actualSide === 'LONG' && !allowLong) return null;
    if (actualSide === 'SHORT' && !allowShort) return null;
    if (market_type === 'spot' && actualSide === 'SHORT') return null;
    
    // 동시 주문 수 제한
    if (openPositions.length >= maxConcurrentOrders) return null;
    
    const size = calcPositionSize(price);
    if (size.usdt === 0) return null;
    
    const entryFee = size.usdt * fee;
    balance -= entryFee;
    totalFees += entryFee;
    
    const pos = {
      id: trades.length + openPositions.length,
      side: actualSide,
      entry_price: price,
      entry_time: candles[candleIndex].timestamp,
      entry_index: candleIndex,
      coin_size: size.coins,
      usdt_size: size.usdt,
      order_type: orderType,
    };
    
    openPositions.push(pos);
    return pos;
  }

  // 포지션 닫기
  function closePosition(posIndex, price, candleIndex) {
    if (posIndex < 0 || posIndex >= openPositions.length) return null;
    
    const pos = openPositions[posIndex];
    const exitFee = pos.usdt_size * fee;
    
    // P&L 계산
    let pnl;
    if (pos.side === 'LONG') {
      pnl = (price - pos.entry_price) / pos.entry_price * pos.usdt_size;
    } else {
      pnl = (pos.entry_price - price) / pos.entry_price * pos.usdt_size;
    }
    
    balance += pnl - exitFee;
    totalFees += exitFee;
    
    const duration = candleIndex - pos.entry_index;
    const netPnl = pnl - exitFee - (pos.usdt_size * fee); // entry fee already deducted
    
    // 통계 갱신
    if (pnl > 0) {
      winTrades++;
      sumProfit += pnl;
      if (pnl > maxProfit) maxProfit = pnl;
    } else {
      loseTrades++;
      sumLoss += Math.abs(pnl);
      if (pnl < maxLoss) maxLoss = pnl;
    }
    if (pos.side === 'LONG') longTrades++;
    else shortTrades++;
    sumDuration += duration;
    if (duration > maxDuration) maxDuration = duration;
    
    // 거래 기록
    const trade = {
      entry_time: pos.entry_time,
      entry_price: pos.entry_price,
      exit_time: candles[candleIndex].timestamp,
      exit_price: price,
      side: pos.side,
      pnl: parseFloat(pnl.toFixed(2)),
      fee: parseFloat((exitFee + pos.usdt_size * fee).toFixed(2)),
      coin_size: pos.coin_size,
      usdt_size: pos.usdt_size,
      size: pos.coin_size,
      duration,
      order_type: pos.order_type,
      balance: parseFloat(balance.toFixed(2)),
    };
    
    trades.push(trade);
    openPositions.splice(posIndex, 1);
    return trade;
  }

  // 전체 포지션 닫기
  function closeAllPositions(price, candleIndex) {
    while (openPositions.length > 0) {
      closePosition(0, price, candleIndex);
    }
  }

  // 대기 주문 체크 (stop/limit 체결 확인)
  function checkPendingOrders(candle, candleIndex) {
    for (let p = pendingOrders.length - 1; p >= 0; p--) {
      const order = pendingOrders[p];
      let filled = false;
      
      if (order.type === 'stop') {
        // Stop order: 가격이 도달하면 체결
        if (order.action === 'entry_long' && candle.high >= order.price) {
          filled = true;
        } else if (order.action === 'entry_short' && candle.low <= order.price) {
          filled = true;
        }
      } else if (order.type === 'limit') {
        // Limit order: 가격이 도달하면 체결
        if (order.action === 'entry_long' && candle.low <= order.price) {
          filled = true;
        } else if (order.action === 'entry_short' && candle.high >= order.price) {
          filled = true;
        }
      }
      
      if (filled) {
        const side = order.action === 'entry_long' ? 'LONG' : 'SHORT';
        const orderType = order.type === 'stop' ? 
          (side === 'LONG' ? 'BUY STOP' : 'SELL STOP') :
          (side === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT');
        
        openPosition(side, order.price, candleIndex, orderType);
        pendingOrders.splice(p, 1);
      }
    }
  }

  // ========== 메인 백테스트 루프 ==========
  const startIndex = 200; // 보조지표 워밍업
  
  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];
    
    // 볼륨 필터
    if (volumeFilter > 0 && (candle.volume || 0) < volumeFilter) {
      // 볼륨 부족 시 대기 주문만 체크하고 넘어감
      checkPendingOrders(candle, i);
      continue;
    }
    
    // 1) 대기 주문 체결 체크
    checkPendingOrders(candle, i);
    
    // 2) equity ≤ 0 체크
    equity = balance;
    for (const pos of openPositions) {
      if (pos.side === 'LONG') {
        equity += (candle.close - pos.entry_price) / pos.entry_price * pos.usdt_size;
      } else {
        equity += (pos.entry_price - candle.close) / pos.entry_price * pos.usdt_size;
      }
    }
    
    if (equity <= 0) {
      closeAllPositions(candle.close, i);
      balance = 0;
      equity = 0;
      // 에쿼티 커브 기록
      equityCurve.push({
        timestamp: candle.timestamp,
        balance: 0,
        equity: 0,
        drawdown: 100,
      });
      break; // 파산 → 종료
    }
    
    // 3) 시그널 함수 호출
    // openPositions의 읽기 전용 복사본 전달
    const posSnapshot = openPositions.map(p => ({
      side: p.side.toLowerCase(),       // 'long' or 'short' (소문자 — AI 코드 호환)
      SIDE: p.side,                     // 'LONG' or 'SHORT' (대문자 — 혹시 모를 호환)
      entry_price: p.entry_price,
      coin_size: p.coin_size,
      usdt_size: p.usdt_size,
      unrealizedPnl: p.side === 'LONG'
        ? (candle.close - p.entry_price) / p.entry_price * p.usdt_size
        : (p.entry_price - candle.close) / p.entry_price * p.usdt_size,
      duration: i - p.entry_index,
    }));
    
    let signal;
    try {
      signal = signalFn(candles, i, indicators, params, posSnapshot);
    } catch (e) {
      // 시그널 함수 에러 → hold
      signal = { action: 'hold' };
    }
    
    if (!signal || !signal.action) signal = { action: 'hold' };
    
    // 4) 시그널 실행
    switch (signal.action) {
      case 'entry_long': {
        const type = signal.type || 'market';
        const price = signal.price || candle.close;
        
        if (type === 'market') {
          openPosition('LONG', candle.close, i, 'MARKET');
        } else {
          // stop 또는 limit → 대기 주문 등록
          pendingOrders.push({
            action: 'entry_long',
            type,
            price,
            createdAt: i,
          });
        }
        break;
      }
      
      case 'entry_short': {
        const type = signal.type || 'market';
        const price = signal.price || candle.close;
        
        if (type === 'market') {
          openPosition('SHORT', candle.close, i, 'MARKET');
        } else {
          pendingOrders.push({
            action: 'entry_short',
            type,
            price,
            createdAt: i,
          });
        }
        break;
      }
      
      case 'exit': {
        // 전부 닫기 (또는 특정 인덱스)
        const targetIndex = signal.index !== undefined ? signal.index : -1;
        if (targetIndex >= 0 && targetIndex < openPositions.length) {
          closePosition(targetIndex, signal.price || candle.close, i);
        } else {
          // 전체 청산
          closeAllPositions(signal.price || candle.close, i);
        }
        break;
      }
      
      case 'cancel': {
        // 대기 주문 전부 취소 (또는 특정 인덱스)
        if (signal.index !== undefined && signal.index >= 0) {
          if (signal.index < pendingOrders.length) {
            pendingOrders.splice(signal.index, 1);
          }
        } else {
          pendingOrders.length = 0;
        }
        break;
      }
      
      case 'hold':
      default:
        // 아무것도 안 함
        break;
    }
    
    // 5) 에쿼티 커브 기록
    equity = balance;
    for (const pos of openPositions) {
      if (pos.side === 'LONG') {
        equity += (candle.close - pos.entry_price) / pos.entry_price * pos.usdt_size;
      } else {
        equity += (pos.entry_price - candle.close) / pos.entry_price * pos.usdt_size;
      }
    }
    
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    
    equityCurve.push({
      timestamp: candle.timestamp,
      balance: parseFloat(balance.toFixed(2)),
      equity: parseFloat(equity.toFixed(2)),
      drawdown: parseFloat(dd.toFixed(2)),
    });
  }
  
  // ========== 마지막: 열린 포지션 정리 (선택) ==========
  if (openPositions.length > 0 && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    closeAllPositions(lastCandle.close, candles.length - 1);
  }
  
  // ========== 결과 포맷 ==========
  const totalTrades = trades.length;
  const roi = initialBalance > 0 ? ((balance - initialBalance) / initialBalance * 100) : 0;
  const avgProfit = winTrades > 0 ? sumProfit / winTrades : 0;
  const avgLoss = loseTrades > 0 ? sumLoss / loseTrades : 0;
  const avgDuration = totalTrades > 0 ? sumDuration / totalTrades : 0;
  
  return {
    trades,
    equity_curve: equityCurve,
    roi: parseFloat(roi.toFixed(2)),
    mdd: parseFloat(maxDrawdown.toFixed(2)),
    win_rate: totalTrades > 0 ? parseFloat((winTrades / totalTrades * 100).toFixed(2)) : 0,
    total_trades: totalTrades,
    winning_trades: winTrades,
    losing_trades: loseTrades,
    long_trades: longTrades,
    short_trades: shortTrades,
    max_profit: parseFloat(maxProfit.toFixed(2)),
    max_loss: parseFloat(maxLoss.toFixed(2)),
    avg_profit: parseFloat(avgProfit.toFixed(2)),
    avg_loss: parseFloat(avgLoss.toFixed(2)),
    avg_duration: parseFloat(avgDuration.toFixed(1)),
    max_duration: maxDuration,
    total_fee: parseFloat(totalFees.toFixed(2)),
    final_balance: parseFloat(balance.toFixed(2)),
    initial_balance: initialBalance,
    symbol,
    timeframe,
    market_type,
  };
}

module.exports = { runCommunityBacktest };
