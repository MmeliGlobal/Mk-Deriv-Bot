(function() {
    'use strict';

    const tokenInput = document.getElementById('tokenInput');
    const connectBtn = document.getElementById('connectBtn');
    const balanceDisplay = document.getElementById('balanceDisplay');
    const tickValue = document.getElementById('tickValue');
    const tradeStatus = document.getElementById('tradeStatus');
    const historyContainer = document.getElementById('historyContainer');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const statusDot = document.getElementById('statusDot');
    const connectionLabel = document.getElementById('connectionLabel');
    const tradeCountSpan = document.getElementById('tradeCount');

    const strategyBtns = document.querySelectorAll('.strategy-btn');

    let currentStrategy = 'evenodd';
    let derivToken = '';
    let ws = null;
    let tickHistory = [];
    let isConnected = false;
    let reconnectTimer = null;
    let isConnecting = false;

    const WS_URL = 'wss://ws.deriv.com/websockets/v3?app_id=1995';
    const STORAGE_KEY = 'mmeli_fx_deriv_token';

    function updateHistoryUI() {
        if (!historyContainer) return;
        if (tickHistory.length === 0) {
            historyContainer.innerHTML = '<div class="empty-history">No trades yet</div>';
            return;
        }
        let html = '';
        const items = tickHistory.slice(-60).reverse();
        for (const item of items) {
            const winClass = item.won ? 'win' : 'loss';
            const label = item.won ? '✅ WIN' : '❌ LOSS';
            const typeLabel = item.type === 'evenodd' ? 'Even/Odd' : 'Over/Under';
            html += `
                <div class="history-item">
                    <span>
                        <span class="badge-type">${typeLabel}</span>
                        <span>#${item.tick}</span>
                    </span>
                    <span>
                        <span class="result-badge ${winClass}">${label}</span>
                        <span style="margin-left: 10px; color: #9aafd0;">${item.result}</span>
                    </span>
                </div>
            `;
        }
        historyContainer.innerHTML = html;
        if (tradeCountSpan) {
            tradeCountSpan.textContent = `Trades: ${tickHistory.length}`;
        }
    }

    function addHistoryEntry(tick, result, type, won) {
        tickHistory.push({ tick, result, type, won });
        if (tickHistory.length > 300) tickHistory.shift();
        updateHistoryUI();
    }

    function setTradeStatus(text, isWin = null) {
        if (tradeStatus) {
            tradeStatus.textContent = text;
            tradeStatus.className = 'value';
            if (isWin === true) tradeStatus.classList.add('win');
            else if (isWin === false) tradeStatus.classList.add('loss');
        }
    }

    function updateBalance(val) {
        if (balanceDisplay) {
            balanceDisplay.textContent = (val !== undefined && val !== null) ? val.toFixed(2) : '—';
        }
    }

    function setConnectionStatus(connected) {
        isConnected = connected;
        if (statusDot) {
            statusDot.className = 'status-dot' + (connected ? ' online' : '');
        }
        if (connectionLabel) {
            connectionLabel.textContent = connected ? 'connected' : 'disconnected';
            connectionLabel.style.color = connected ? '#8bcf9e' : '#b0bddb';
        }
        if (connectBtn) {
            connectBtn.disabled = isConnecting || connected;
        }
    }

    function setConnecting(connecting) {
        isConnecting = connecting;
        if (connectBtn) {
            connectBtn.textContent = connecting ? '⏳ Connecting...' : '🔗 Connect';
            connectBtn.disabled = connecting;
        }
    }

    function connectDeriv(token) {
        if (!token || token.length < 6) {
            alert('Please enter a valid Deriv token.');
            return;
        }

        if (isConnecting) return;

        if (ws) {
            try { ws.close(); } catch (_) {}
            ws = null;
        }

        setConnecting(true);
        setConnectionStatus(false);
        setTradeStatus('⏳ Connecting...', null);

        try {
            ws = new WebSocket(WS_URL);

            ws.onopen = function() {
                console.log('✅ WebSocket connected');
                const authReq = { authorize: token };
                ws.send(JSON.stringify(authReq));
            };

            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📩 Received:', data.msg_type);

                    if (data.msg_type === 'authorize') {
                        if (data.error) {
                            alert('Authorization failed: ' + data.error.message);
                            setConnectionStatus(false);
                            setConnecting(false);
                            return;
                        }
                        if (data.authorize?.balance !== undefined) {
                            updateBalance(data.authorize.balance);
                        }
                        setConnectionStatus(true);
                        setConnecting(false);
                        setTradeStatus('✅ Connected & Authorized', true);
                        subscribeTicks();
                    } else if (data.msg_type === 'balance') {
                        if (data.balance?.balance !== undefined) {
                            updateBalance(data.balance.balance);
                        }
                    } else if (data.msg_type === 'tick') {
                        if (data.tick?.quote !== undefined) {
                            const tickVal = data.tick.quote;
                            if (tickValue) tickValue.textContent = tickVal;
                            executeTrade(tickVal);
                        }
                    } else if (data.error) {
                        console.warn('API error:', data.error);
                        setTradeStatus('⚠️ ' + data.error.message, false);
                    }
                } catch (err) {
                    console.warn('Parse error:', err);
                }
            };

            ws.onerror = function(err) {
                console.error('WebSocket error:', err);
                setConnectionStatus(false);
                setConnecting(false);
                setTradeStatus('❌ Connection error', false);
            };

            ws.onclose = function() {
                console.log('WebSocket closed');
                setConnectionStatus(false);
                setConnecting(false);
                setTradeStatus('⏳ Disconnected', false);

                if (derivToken) {
                    if (reconnectTimer) clearTimeout(reconnectTimer);
                    reconnectTimer = setTimeout(function() {
                        if (!isConnected && derivToken) {
                            console.log('🔄 Auto-reconnecting...');
                            connectDeriv(derivToken);
                        }
                    }, 3000);
                }
            };
        } catch (err) {
            console.error('Fatal error:', err);
            setConnectionStatus(false);
            setConnecting(false);
            alert('Connection error: ' + err.message);
        }
    }

    function subscribeTicks() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const sub = { ticks: 'R_100', subscribe: 1 };
        ws.send(JSON.stringify(sub));
        setTradeStatus('📡 Listening for ticks...', null);
        console.log('📡 Subscribed to R_100');
    }

    function executeTrade(tick) {
        if (!isConnected) {
            setTradeStatus('⏳ Not connected', false);
            return;
        }

        let won = false;
        let resultDesc = '';

        if (currentStrategy === 'evenodd') {
            const isEven = (tick % 2 === 0);
            won = isEven;
            resultDesc = isEven ? 'Even' : 'Odd';
        } else {
            const isOver = tick > 0.5;
            won = isOver;
            resultDesc = isOver ? 'Over' : 'Under';
        }

        addHistoryEntry(tick, resultDesc, currentStrategy, won);
        setTradeStatus(won ? '🏆 WIN' : '💔 LOSS', won);
    }

    // Event Listeners
    strategyBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            strategyBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            currentStrategy = this.dataset.strategy;
            setTradeStatus(`🔄 ${currentStrategy === 'evenodd' ? 'Even/Odd' : 'Over/Under'} selected`, null);
        });
    });

    connectBtn.addEventListener('click', function() {
        const token = tokenInput.value.trim();
        if (!token) {
            alert('Please paste your Deriv token.');
            return;
        }
        derivToken = token;
        localStorage.setItem(STORAGE_KEY, token);
        connectDeriv(token);
    });

    tokenInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') connectBtn.click();
    });

    clearHistoryBtn.addEventListener('click', function() {
        tickHistory = [];
        updateHistoryUI();
        setTradeStatus('🗑️ History cleared', null);
    });

    // Load saved token
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) tokenInput.value = saved;

    // Initial state
    updateBalance(null);
    setTradeStatus('⏳ Enter token & click Connect', null);
    setConnectionStatus(false);
    updateHistoryUI();

    // Auto-connect if token exists
    if (saved) {
        setTimeout(function() {
            if (tokenInput.value.trim()) {
                connectBtn.click();
            }
        }, 500);
    }

    window.addEventListener('beforeunload', function() {
        if (ws) { try { ws.close(); } catch (_) {} }
        if (reconnectTimer) clearTimeout(reconnectTimer);
    });

    console.log('🤖 Mmeli_FX Deriv Bot ready');
})();
