/* ========================================
   Mmeli_FX Deriv Bot - Complete JavaScript
   ======================================== */

(function() {
    'use strict';

    // ----- DOM References -----
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
    const sessionStatus = document.getElementById('sessionStatus');

    const strategyBtns = document.querySelectorAll('.strategy-btn');

    // ----- State -----
    let currentStrategy = 'evenodd';
    let derivToken = '';
    let ws = null;
    let tickHistory = [];
    let isConnected = false;
    let reconnectTimer = null;
    let isConnecting = false;

    // ----- Constants -----
    const WS_URL = 'wss://ws.deriv.com/websockets/v3?app_id=1995';
    const STORAGE_KEY = 'mmeli_fx_deriv_token';
    const MAX_HISTORY = 300;

    // ----- UI Update Functions -----
    function updateHistoryUI() {
        if (!historyContainer) return;

        if (tickHistory.length === 0) {
            historyContainer.innerHTML =
                '<div class="empty-history">📭 No trades yet — waiting for ticks</div>';
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
                        <span class="tick-num">#${item.tick}</span>
                    </span>
                    <span>
                        <span class="result-badge ${winClass}">${label}</span>
                        <span style="margin-left: 10px; color: #9aafd0; font-weight: 500;">
                            ${item.result}
                        </span>
                    </span>
                </div>
            `;
        }

        historyContainer.innerHTML = html;
        historyContainer.scrollTop = 0;

        if (tradeCountSpan) {
            tradeCountSpan.textContent = `${tickHistory.length} trade${tickHistory.length !== 1 ? 's' : ''}`;
        }
    }

    function addHistoryEntry(tick, result, type, won) {
        tickHistory.push({ tick, result, type, won, timestamp: Date.now() });
        if (tickHistory.length > MAX_HISTORY) {
            tickHistory = tickHistory.slice(-MAX_HISTORY);
        }
        updateHistoryUI();
    }

    function setTradeStatus(text, isWin = null) {
        if (tradeStatus) {
            tradeStatus.textContent = text;
            tradeStatus.className = 'value';
            if (isWin === true) {
                tradeStatus.classList.add('win');
            } else if (isWin === false) {
                tradeStatus.classList.add('loss');
            }
        }
    }

    function updateBalance(val) {
        if (balanceDisplay) {
            if (val !== undefined && val !== null) {
                balanceDisplay.textContent = val.toFixed(2);
            } else {
                balanceDisplay.textContent = '—';
            }
        }
    }

    function setConnectionStatus(connected, error = false) {
        isConnected = connected;

        if (statusDot) {
            statusDot.className = 'status-dot';
            if (connected) {
                statusDot.classList.add('online');
            } else if (error) {
                statusDot.classList.add('error');
            }
        }

        if (connectionLabel) {
            if (connected) {
                connectionLabel.textContent = 'connected';
                connectionLabel.style.color = '#8bcf9e';
            } else if (error) {
                connectionLabel.textContent = 'error';
                connectionLabel.style.color = '#f26b7a';
            } else {
                connectionLabel.textContent = 'disconnected';
                connectionLabel.style.color = '#b0bddb';
            }
        }

        if (sessionStatus) {
            if (connected) {
                sessionStatus.textContent = '● Online';
                sessionStatus.className = 'online';
            } else if (error) {
                sessionStatus.textContent = '● Error';
                sessionStatus.className = '';
            } else {
                sessionStatus.textContent = '● Offline';
                sessionStatus.className = '';
            }
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

    // ----- WebSocket Connection -----
    function connectDeriv(token) {
        if (!token || token.length < 6) {
            alert('⚠️ Please enter a valid Deriv token.');
            return;
        }

        if (isConnecting) return;

        // Close existing connection
        if (ws) {
            try {
                ws.close();
            } catch (_) {}
            ws = null;
        }

        setConnecting(true);
        setConnectionStatus(false);

        try {
            ws = new WebSocket(WS_URL);

            ws.onopen = function() {
                console.log('🔌 WebSocket connected (port 1995)');
                const authReq = { authorize: token };
                ws.send(JSON.stringify(authReq));
            };

            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);

                    switch (data.msg_type) {
                        case 'authorize':
                            if (data.error) {
                                console.error('Auth error:', data.error);
                                alert('❌ Authorization failed: ' + data.error.message);
                                setConnectionStatus(false, true);
                                setConnecting(false);
                                return;
                            }
                            if (data.authorize?.balance !== undefined) {
                                updateBalance(data.authorize.balance);
                                setTradeStatus('✅ Authorized', true);
                            }
                            setConnectionStatus(true);
                            setConnecting(false);
                            subscribeTicks();
                            break;

                        case 'balance':
                            if (data.balance?.balance !== undefined) {
                                updateBalance(data.balance.balance);
                            }
                            break;

                        case 'tick':
                            if (data.tick?.quote !== undefined) {
                                const tickVal = data.tick.quote;
                                if (tickValue) tickValue.textContent = tickVal;
                                executeTrade(tickVal);
                            }
                            break;

                        default:
                            if (data.error) {
                                console.warn('API error:', data.error);
                                setTradeStatus('⚠️ ' + data.error.message, false);
                            }
                            break;
                    }
                } catch (err) {
                    // Silent parse error
                }
            };

            ws.onerror = function(err) {
                console.error('WebSocket error:', err);
                setConnectionStatus(false, true);
                setConnecting(false);
                setTradeStatus('❌ Connection error', false);
            };

            ws.onclose = function() {
                console.log('🔌 WebSocket closed');
                setConnectionStatus(false);
                setConnecting(false);
                setTradeStatus('⏳ Disconnected', false);

                // Auto-reconnect
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
            console.error('Connection error:', err);
            setConnectionStatus(false, true);
            setConnecting(false);
            alert('❌ Failed to connect: ' + err.message);
        }
    }

    function subscribeTicks() {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('Cannot subscribe: WebSocket not open');
            return;
        }

        const sub = {
            ticks: 'R_100',
            subscribe: 1
        };

        ws.send(JSON.stringify(sub));
        setTradeStatus('📡 Listening for ticks...', null);
        console.log('📡 Subscribed to R_100 ticks');
    }

    // ----- Trade Execution -----
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
            // Over/Under with threshold 0.5
            const isOver = tick > 0.5;
            won = isOver;
            resultDesc = isOver ? 'Over' : 'Under';
        }

        addHistoryEntry(tick, resultDesc, currentStrategy, won);
        setTradeStatus(won ? '🏆 WIN' : '💔 LOSS', won);
    }

    // ----- Event Listeners -----
    // Strategy selection
    strategyBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            strategyBtns.forEach(function(b) {
                b.classList.remove('active');
            });
            this.classList.add('active');
            currentStrategy = this.dataset.strategy;
            const label = currentStrategy === 'evenodd' ? 'Even/Odd' : 'Over/Under';
            setTradeStatus(`🔄 ${label} selected`, null);
            console.log(`📊 Strategy changed to: ${label}`);
        });
    });

    // Connect button
    connectBtn.addEventListener('click', function() {
        const token = tokenInput.value.trim();
        if (!token) {
            alert('⚠️ Please paste your Deriv token.');
            tokenInput.focus();
            return;
        }
        derivToken = token;
        localStorage.setItem(STORAGE_KEY, token);
        connectDeriv(token);
    });

    // Enter key on token input
    tokenInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            connectBtn.click();
        }
    });

    // Clear history
    clearHistoryBtn.addEventListener('click', function() {
        tickHistory = [];
        updateHistoryUI();
        setTradeStatus('🗑️ History cleared', null);
        console.log('🗑️ History cleared');
    });

    // ----- Load saved token -----
    const savedToken = localStorage.getItem(STORAGE_KEY);
    if (savedToken) {
        tokenInput.value = savedToken;
        // Auto-connect if token exists (optional)
        // Uncomment below to auto-connect on page load
        // setTimeout(() => connectBtn.click(), 500);
    }

    // ----- Initial state -----
    updateBalance(null);
    setTradeStatus('⏳ Ready', null);
    setConnectionStatus(false);
    updateHistoryUI();

    // ----- Cleanup on page unload -----
    window.addEventListener('beforeunload', function() {
        if (ws) {
            try { ws.close(); } catch (_) {}
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
    });

    console.log('🤖 Mmeli_FX Deriv Bot loaded successfully');
    console.log(`📊 Default strategy: ${currentStrategy === 'evenodd' ? 'Even/Odd' : 'Over/Under'}`);
    console.log('🔌 WebSocket port: 1995');
})();
