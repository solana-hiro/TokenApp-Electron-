const fetchPriceWithWaterfall = require('./fetchPriceWithWaterfall');
let binanceSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let lastConnectionAttempt = 0;
let heartbeatInterval = null;

function setupBinanceWebSocket() {
    const now = Date.now();
    if (now - lastConnectionAttempt < 10000) {
        return;
    }
    lastConnectionAttempt = now;
    
    if (window.priceFetchInterval) {
        clearInterval(window.priceFetchInterval);
        window.priceFetchInterval = null;
    }
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    if (binanceSocket) {
        try {
            binanceSocket.onclose = null;
            binanceSocket.onerror = null;
            binanceSocket.close();
        } catch (e) {}
        binanceSocket = null;
        
        setTimeout(() => {
            initializeWebSocket();
        }, 500);
    } else {
        initializeWebSocket();
    }
  
    function initializeWebSocket() {
        try {
            const binancePairs = [];
            const fallbackPairs = [];
            
            trackedCryptos.forEach(crypto => {
                let symbol, pair;
                
                if (crypto.includes('/')) {
                    [symbol, pair] = crypto.split('/');
                } else {
                    symbol = crypto;
                    pair = currentPair;
                }
                
                if (symbol === pair) {
                    return;
                }
                
                const binancePair = pair === 'USD' ? 'USDT' : pair;
                
                if (supportedPairsCache.binance && 
                    supportedPairsCache.binance[`${symbol}${binancePair}`] === false) {
                    fallbackPairs.push({ symbol, pair });
                    return;
                }
                
                binancePairs.push({
                    symbol,
                    pair,
                    binancePair,
                    streamSymbol: `${symbol.toLowerCase()}${binancePair.toLowerCase()}`
                });
            });
            
            if (binancePairs.length === 0) {
                setupApiFallback(fallbackPairs);
                return;
            }
            
            const streams = binancePairs.map(pair => `${pair.streamSymbol}@ticker`);
            const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
            
            try {
                binanceSocket = new WebSocket(wsUrl);
                
                binanceSocket.onopen = () => {
                    reconnectAttempts = 0;
                    
                    heartbeatInterval = setInterval(() => {
                        if (binanceSocket && binanceSocket.readyState === WebSocket.OPEN) {
                            try {
                                binanceSocket.send(JSON.stringify({ method: 'PING' }));
                            } catch (e) {
                                clearInterval(heartbeatInterval);
                                setupBinanceWebSocket();
                            }
                        }
                    }, 30000);
                    
                    if (fallbackPairs.length > 0) {
                        setupApiFallback(fallbackPairs);
                    }
                };
                
                binanceSocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        
                        if (message.stream && message.stream.endsWith('@ticker') && message.data) {
                            const data = message.data;
                            const streamName = message.stream;
                            const streamSymbol = streamName.replace('@ticker', '');
                            
                            const pairInfo = binancePairs.find(p => p.streamSymbol === streamSymbol);
                            
                            if (pairInfo) {
                                const price = parseFloat(data.c);
                                const priceChangePercent = parseFloat(data.p);
                                
                                if (!supportedPairsCache.binance) {
                                    supportedPairsCache.binance = {};
                                }
                                supportedPairsCache.binance[`${pairInfo.symbol}${pairInfo.binancePair}`] = true;
                                
                                const combinedKey = `${pairInfo.symbol}/${pairInfo.pair}`;
                                updateCryptoPrice(combinedKey, price, priceChangePercent, data.q, 'binance-ws');
                                
                                priceCache[combinedKey] = {
                                    price,
                                    change: priceChangePercent,
                                    source: 'binance-ws',
                                    timestamp: Date.now()
                                };
                            }
                        }
                    } catch (error) {}
                };
                
                binanceSocket.onerror = () => {
                    const allPairs = [
                        ...binancePairs.map(pair => ({ symbol: pair.symbol, pair: pair.pair })),
                        ...fallbackPairs
                    ];
                    setupApiFallback(allPairs);
                };
                
                binanceSocket.onclose = () => {
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                    
                    if (reconnectAttempts < maxReconnectAttempts) {
                        const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts), 30000);
                        reconnectAttempts++;
                        
                        setTimeout(() => {
                            setupBinanceWebSocket();
                        }, delay);
                    } else {
                        const allPairs = [
                            ...binancePairs.map(pair => ({ symbol: pair.symbol, pair: pair.pair })),
                            ...fallbackPairs
                        ];
                        setupApiFallback(allPairs);
                    }
                };
            } catch (wsError) {
                const allPairs = [
                    ...binancePairs.map(pair => ({ symbol: pair.symbol, pair: pair.pair })),
                    ...fallbackPairs
                ];
                setupApiFallback(allPairs);
            }
        } catch (error) {
            setupApiFallback(trackedCryptos.map(crypto => {
                if (crypto.includes('/')) {
                    const [symbol, pair] = crypto.split('/');
                    return { symbol, pair };
                }
                return { symbol: crypto, pair: currentPair };
            }));
        }
    }
}

function setupApiFallback(pairsArray) {
    if (window.fallbackInterval) {
        clearInterval(window.fallbackInterval);
    }
    
    if (pairsArray.length === 0) return;
    
    async function fetchFallbackPrices() {
        for (const { symbol, pair } of pairsArray) {
            const cacheKey = `${symbol}/${pair}`;
            if (priceCache[cacheKey] && 
                priceCache[cacheKey].source === 'binance-ws' && 
                Date.now() - priceCache[cacheKey].timestamp < 30000) {
                continue;
            }
            
            try {
                const result = await fetchPriceWithWaterfall(symbol, pair);
                if (result) {
                    updateCryptoPrice(cacheKey, result.price, result.change, result.volume, result.source);
                }
            } catch (error) {}
        }
    }

    fetchFallbackPrices();
    window.fallbackInterval = setInterval(fetchFallbackPrices, 30000);
}

module.exports = setupBinanceWebSocket;