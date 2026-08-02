/* ============================================================
   DERIV DASHBOARD – Full WebSocket client
   ============================================================ */

// ---------- State ----------
const state = {
    ws: null,
    isLoggedIn: false,
    symbol: 'R_25',
    ticks: [],
    tickHistory: [],          // last 100 ticks
    digitCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    candles: [],              // aggregated candles
    candleInterval: 5,        // minutes
    currentCandle: null,
    lastPrice: null,
    prevPrice: null,
    balance: 0,
    currency: 'USD',
    loginId: '',
    openContracts: [],
    tradeHistory: [],
    reconnectTimer: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    isReconnecting: false,
};

// ---------- DOM refs ----------
const $ = id => document.getElementById(id);
const tokenInput = $('apiTokenInput');
const loginBtn = $('loginBtn');
const loginError = $('loginError');
const userInfo = $('userInfo');
const loginIdEl = $('loginId');
const balanceDisplay = $('balanceDisplay');
const currencyDisplay = $('currencyDisplay');
const connectionStatus = $('connectionStatus');
const symbolSelect = $('symbolSelect');
const lastPriceEl = $('lastPrice');
const priceChangeEl = $('priceChange');
const tickCountEl = $('tickCount');
const tickTableBody = $('tickTableBody');
const tickCountBadge = $('tickCountBadge');
const digitGrid = $('digitGrid');
const digitTotal = $('digitTotal');
const digitMostFreq = $('digitMostFreq');
const chartSymbolBadge = $('chartSymbolBadge');
const tradeTableBody = $('tradeTableBody');
const refreshTradesBtn = $('refreshTradesBtn');
const contractList = $('contractList');
const openContractsBadge = $('openContractsBadge');
const footerStatus = $('footerStatus');

// Chart canvas
const canvas = $('candleChart');
const ctx = canvas.getContext('2d');

// ---------- Helpers ----------
function setStatus(text, type = 'offline') {
    connectionStatus.innerHTML = `<i class="fas fa-circle"></i> ${text}`;
    connectionStatus.className = 'status-badge ' + type;
    footerStatus.textContent = text;
}

function showError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
}

function hideError() {
    loginError.classList.add('hidden');
}

function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNumber(n, decimals = 2) {
    if (n === null || n === undefined) return '—';
    return Number(n).toFixed(decimals);
}

function getDigit(n) {
    const str = String(n);
    const parts = str.split('.');
    const last = parts[parts.length - 1] || '0';
    return parseInt(last.charAt(last.length - 1), 10);
}

// ---------- WebSocket ----------
const WS_URL = 'wss://ws.deriv.com/websockets/v3?app_id=1089';

function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    setStatus('Connecting...', 'connecting');
    state.ws = new WebSocket(WS_URL);
    state.ws.onopen = onOpen;
    state.ws.onmessage = onMessage;
    state.ws.onclose = onClose;
    state.ws.onerror = onError;
}

function onOpen() {
    setStatus('Connected', 'online');
    state.reconnectAttempts = 0;
    state.isReconnecting = false;
    if (state.isLoggedIn) {
        // re-subscribe after reconnect
        subscribeTicks(state.symbol);
        getBalance();
        getOpenContracts();
        getTradeHistory();
    }
}

function onClose(e) {
    setStatus('Disconnected', 'offline');
    state.ws = null;
    if (!state.isReconnecting) {
        attemptReconnect();
    }
}

function onError(err) {
    console.warn('WebSocket error:', err);
}

function attemptReconnect() {
    if (state.isReconnecting) return;
    state.isReconnecting = true;
    state.reconnectAttempts++;
    if (state.reconnectAttempts > state.maxReconnectAttempts) {
        setStatus('Reconnect failed', 'offline');
        state.isReconnecting = false;
        return;
    }
    const delay = Math.min(1000 * state.reconnectAttempts, 30000);
    setStatus(`Reconnecting in ${delay/1000}s...`, 'connecting');
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
        state.isReconnecting = false;
        connectWebSocket();
    }, delay);
}

function sendRequest(req) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        showError('WebSocket not connected');
        return false;
    }
    state.ws.send(JSON.stringify(req));
    return true;
}

// ---------- Message handler ----------
function onMessage(event) {
    try {
        const data = JSON.parse(event.data);
        if (data.error) {
            console.warn('API error:', data.error);
            if (data.error.code === 'InvalidToken') {
                showError('Invalid API token. Please check and try again.');
                setStatus('Auth failed', 'offline');
                state.isLoggedIn = false;
            }
            return;
        }
        // Handle response by type
        if (data.msg_type === 'authorize') {
            handleAuthorize(data);
        } else if (data.msg_type === 'tick') {
            handleTick(data.tick);
        } else if (data.msg_type === 'balance') {
            handleBalance(data.balance);
        } else if (data.msg_type === 'proposal_open_contracts') {
            handleOpenContracts(data);
        } else if (data.msg_type === 'portfolio') {
            handlePortfolio(data);
        } else if (data.msg_type === 'p2p_order_list') {
            // not used
        } else if (data.msg_type === 'trading_times') {
            // not used
        } else if (data.msg_type === 'ticks_history') {
            handleTicksHistory(data);
        } else if (data.msg_type === 'statement') {
            handleStatement(data);
        } else if (data.msg_type === 'subscribe') {
            // subscription ack
        }
    } catch (e) {
        console.error('Parse error:', e);
    }
}

// ---------- Auth ----------
function handleAuthorize(data) {
    if (data.authorize) {
        state.isLoggedIn = true;
        state.loginId = data.authorize.loginid;
        state.currency = data.authorize.currency || 'USD';
        loginIdEl.textContent = state.loginId;
        currencyDisplay.textContent = state.currency;
        userInfo.classList.remove('hidden');
        hideError();
        setStatus('Online', 'online');
        // get initial data
        getBalance();
        subscribeTicks(state.symbol);
        getOpenContracts();
        getTradeHistory();
        // update UI
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-check"></i> Connected';
    }
}

function handleBalance(data) {
    state.balance = data.balance || 0;
    state.currency = data.currency || state.currency;
    balanceDisplay.textContent = `${formatNumber(state.balance)} ${state.currency}`;
    currencyDisplay.textContent = state.currency;
}

// ---------- Ticks ----------
function subscribeTicks(symbol) {
    if (!state.isLoggedIn) return;
    const req = {
        ticks: symbol,
        subscribe: 1
    };
    sendRequest(req);
    // Also get tick history for chart
    getTicksHistory(symbol);
}

function handleTick(tick) {
    const price = tick.quote;
    const epoch = tick.epoch * 1000;
    const digit = getDigit(price);

    // Update last price
    state.prevPrice = state.lastPrice;
    state.lastPrice = price;
    lastPriceEl.textContent = formatNumber(price, 4);

    // Change
    if (state.prevPrice !== null && state.prevPrice !== undefined) {
        const change = price - state.prevPrice;
        priceChangeEl.textContent = (change >= 0 ? '+' : '') + formatNumber(change, 4);
        priceChangeEl.style.color = change >= 0 ? '#34d399' : '#f87171';
    } else {
        priceChangeEl.textContent = '—';
        priceChangeEl.style.color = '#94a3b8';
    }

    // Store tick
    state.ticks.push({ time: epoch, price, digit });
    if (state.ticks.length > 1000) state.ticks.shift();

    // Update tick history table (last 100)
    state.tickHistory.push({ time: epoch, price, digit });
    if (state.tickHistory.length > 100) state.tickHistory.shift();
    renderTickTable();

    // Update digit counts
    state.digitCounts[digit] = (state.digitCounts[digit] || 0) + 1;
    renderDigitGrid();

    // Update candle
    updateCandle(price, epoch);

    // Update tick count
    tickCountEl.textContent = state.ticks.length;
    tickCountBadge.textContent = state.tickHistory.length;
}

// ---------- Tick History table ----------
function renderTickTable() {
    const rows = state.tickHistory.slice().reverse().map(t => `
        <tr>
            <td>${formatTime(t.time)}</td>
            <td>${formatNumber(t.price, 4)}</td>
            <td>${t.digit}</td>
        </tr>
    `).join('');
    tickTableBody.innerHTML = rows || '<tr><td colspan="3" class="empty-msg">No ticks yet</td></tr>';
}

// ---------- Digit Grid ----------
function renderDigitGrid() {
    const max = Math.max(...state.digitCounts, 1);
    let html = '';
    for (let i = 0; i < 10; i++) {
        const count = state.digitCounts[i] || 0;
        const pct = max > 0 ? (count / max) * 100 : 0;
        html += `
            <div class="digit-bar">
                <div class="bar"><div class="fill" style="height:${Math.max(2, pct)}%;"></div></div>
                <span class="digit-label">${i}</span>
                <span class="digit-count">${count}</span>
            </div>
        `;
    }
    digitGrid.innerHTML = html;

    const total = state.digitCounts.reduce((a, b) => a + b, 0);
    digitTotal.textContent = total;

    let maxIdx = 0;
    for (let i = 1; i < 10; i++) {
        if (state.digitCounts[i] > state.digitCounts[maxIdx]) maxIdx = i;
    }
    digitMostFreq.textContent = state.digitCounts[maxIdx] > 0 ? maxIdx : '—';
}

// ---------- Candle Chart ----------
function updateCandle(price, time) {
    const intervalMs = state.candleInterval * 60 * 1000;
    const candleStart = Math.floor(time / intervalMs) * intervalMs;

    if (!state.currentCandle || state.currentCandle.time !== candleStart) {
        // close previous candle
        if (state.currentCandle) {
            state.candles.push(state.currentCandle);
            if (state.candles.length > 200) state.candles.shift();
        }
        state.currentCandle = {
            time: candleStart,
            open: price,
            high: price,
            low: price,
            close: price,
        };
    } else {
        state.currentCandle.high = Math.max(state.currentCandle.high, price);
        state.currentCandle.low = Math.min(state.currentCandle.low, price);
        state.currentCandle.close = price;
    }
    drawChart();
}

function drawChart() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = (rect.width - 4) * dpr;
    canvas.height = (rect.height - 4) * dpr;
    canvas.style.width = (rect.width - 4) + 'px';
    canvas.style.height = (rect.height - 4) + 'px';
    ctx.scale(dpr, dpr);

    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    ctx.clearRect(0, 0, W, H);

    const allCandles = [...state.candles];
    if (state.currentCandle) allCandles.push(state.currentCandle);
    if (allCandles.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for ticks...', W / 2, H / 2);
        return;
    }

    const padding = { top: 16, bottom: 20, left: 10, right: 10 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    const visible = allCandles.slice(-120);
    const len = visible.length;
    if (len === 0) return;

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const c of visible) {
        minPrice = Math.min(minPrice, c.low);
        maxPrice = Math.max(maxPrice, c.high);
    }
    const range = maxPrice - minPrice || 1;
    const pad = range * 0.08;
    minPrice -= pad;
    maxPrice += pad;

    const candleWidth = Math.min(6, (chartW / len) * 0.7);
    const spacing = chartW / len;

    for (let i = 0; i < len; i++) {
        const c = visible[i];
        const x = padding.left + i * spacing;
        const yHigh = padding.top + chartH - ((c.high - minPrice) / (maxPrice - minPrice)) * chartH;
        const yLow = padding.top + chartH - ((c.low - minPrice) / (maxPrice - minPrice)) * chartH;
        const yOpen = padding.top + chartH - ((c.open - minPrice) / (maxPrice - minPrice)) * chartH;
        const yClose = padding.top + chartH - ((c.close - minPrice) / (maxPrice - minPrice)) * chartH;

        const isBull = c.close >= c.open;
        ctx.strokeStyle = isBull ? '#34d399' : '#f87171';
        ctx.lineWidth = 1.5;

        // wick
        ctx.beginPath();
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();

        // body
        const top = Math.min(yOpen, yClose);
        const bottom = Math.max(yOpen, yClose);
        const height = Math.max(bottom - top, 1);
        ctx.fillStyle = isBull ? '#34d399' : '#f87171';
        ctx.fillRect(x - candleWidth / 2, top, candleWidth, height);
    }

    // Price labels
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatNumber(maxPrice, 4), W - 6, padding.top + 12);
    ctx.fillText(formatNumber(minPrice, 4), W - 6, H - padding.bottom + 4);
}

// ---------- Ticks History (for chart) ----------
function getTicksHistory(symbol) {
    if (!state.isLoggedIn) return;
    const req = {
        ticks_history: symbol,
        adjust_to_start: 0,
        start: Math.floor(Date.now() / 1000) - 3600 * 24,
        end: 'latest',
        granularity: 60,
    };
    sendRequest(req);
}

function handleTicksHistory(data) {
    if (data && data.history && data.history.prices) {
        // We could use this to pre-fill candles, but we'll let real-time ticks build them.
    }
}

// ---------- Balance ----------
function getBalance() {
    if (!state.isLoggedIn) return;
    sendRequest({ balance: 1, subscribe: 1 });
}

// ---------- Open Contracts ----------
function getOpenContracts() {
    if (!state.isLoggedIn) return;
    sendRequest({ proposal_open_contracts: 1 });
}

function handleOpenContracts(data) {
    if (data.proposal_open_contracts) {
        state.openContracts = data.proposal_open_contracts.contracts || [];
        renderOpenContracts();
    }
}

function renderOpenContracts() {
    const list = state.openContracts;
    openContractsBadge.textContent = list.length;
    if (list.length === 0) {
        contractList.innerHTML = '<div class="empty-msg">No open contracts</div>';
        return;
    }
    let html = '';
    for (const c of list) {
        const pl = c.profit_loss || 0;
        const plClass = pl > 0 ? 'positive' : (pl < 0 ? 'negative' : '');
        html += `
            <div class="contract-item">
                <span class="contract-symbol">${c.symbol || '—'}</span>
                <span class="contract-stake">${formatNumber(c.buy_price)}</span>
                <span class="contract-profit ${plClass}">${pl > 0 ? '+' : ''}${formatNumber(pl)}</span>
            </div>
        `;
    }
    contractList.innerHTML = html;
}

// ---------- Trade History ----------
function getTradeHistory() {
    if (!state.isLoggedIn) return;
    sendRequest({ statement: 1, limit: 20, description: 1 });
}

function handleStatement(data) {
    if (data.statement && data.statement.transactions) {
        state.tradeHistory = data.statement.transactions.filter(t => t.action === 'buy' || t.action === 'sell');
        renderTradeHistory();
    }
}

function renderTradeHistory() {
    const rows = state.tradeHistory.slice(0, 20).map(t => `
        <tr>
            <td>${t.transaction_id || '—'}</td>
            <td>${t.symbol || '—'}</td>
            <td>${t.action || '—'}</td>
            <td>${formatNumber(t.amount)}</td>
            <td style="color:${(t.profit_loss || 0) >= 0 ? '#34d399' : '#f87171'}">
                ${(t.profit_loss || 0) >= 0 ? '+' : ''}${formatNumber(t.profit_loss || 0)}
            </td>
        </tr>
    `).join('');
    tradeTableBody.innerHTML = rows || '<tr><td colspan="5" class="empty-msg">No trades yet</td></tr>';
}

// ---------- Refresh ----------
refreshTradesBtn.addEventListener('click', () => {
    getTradeHistory();
    getOpenContracts();
});

// ---------- Symbol change ----------
symbolSelect.addEventListener('change', () => {
    state.symbol = symbolSelect.value;
    chartSymbolBadge.textContent = state.symbol;
    // Clear ticks and digit counts
    state.ticks = [];
    state.tickHistory = [];
    state.digitCounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    state.candles = [];
    state.currentCandle = null;
    state.lastPrice = null;
    state.prevPrice = null;
    renderTickTable();
    renderDigitGrid();
    lastPriceEl.textContent = '—';
    priceChangeEl.textContent = '—';
    tickCountEl.textContent = '0';
    tickCountBadge.textContent = '0';
    if (state.isLoggedIn) {
        subscribeTicks(state.symbol);
        getOpenContracts();
        getTradeHistory();
    }
});

// ---------- Chart interval buttons ----------
document.querySelectorAll('.chart-controls .btn-sm').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-controls .btn-sm').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.candleInterval = parseInt(btn.dataset.interval, 10);
        // Reset candles to rebuild with new interval
        state.candles = [];
        state.currentCandle = null;
        // Re-process ticks
        for (const t of state.ticks) {
            updateCandle(t.price, t.time);
        }
        drawChart();
    });
});

// ---------- Login ----------
loginBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
        showError('Please enter your API token.');
        return;
    }
    hideError();
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authorizing...';
    connectWebSocket();
    // Send authorize after connection opens
    const checkAuth = setInterval(() => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            clearInterval(checkAuth);
            sendRequest({ authorize: token });
        }
    }, 200);
    // timeout
    setTimeout(() => {
        clearInterval(checkAuth);
        if (!state.isLoggedIn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
            showError('Connection timeout. Please try again.');
        }
    }, 15000);
});

// ---------- Init ----------
function init() {
    setStatus('Disconnected', 'offline');
    renderDigitGrid();
    // Auto-connect on load with demo token (optional)
    // tokenInput.value = 'YOUR_DEMO_TOKEN_HERE'; // uncomment to auto-fill
    // connectWebSocket();
}

// Handle resize for chart
window.addEventListener('resize', () => {
    drawChart();
});

init();

// ---------- Demo token note ----------
console.log('🔑 Enter your Deriv API token to start.');
console.log('💡 Get one from: https://app.deriv.com/account/api-token');
