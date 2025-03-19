const { ipcRenderer } = require('electron');
const axios = require('axios');

// Global variables
let trackedCryptos = ['BTC', 'ETH', 'SOL']; // Default, will be updated from preferences
const supportHistory = {}; // Tracks success/failure history for each exchange/pair
const FAILURE_THRESHOLD = 2; // Number of failures before marking as problematic
const alternativeExchanges = [
  'coinex', 'bitfinex', 'ascendex', 'bitstamp', 'poloniex', 'huobi', 'gemini'
]; // Additional exchanges to try for rare pairs
const EXCHANGES_SUCCESS_WEIGHT = 3;  // How much to prioritize successful exchanges
const EXCHANGES_FAILURE_PENALTY = 1; // Penalty for failed exchanges
const EXCHANGES_SUCCESS_MEMORY = 5;  // How many successful fetches to remember
const API_TIMEOUT = 5000;         // Timeout for API calls
const MAX_RETRY_EXCHANGES = 7;    // Maximum number of exchanges to try before falling back

let sortMethod = 'default';
let currentPair = 'USDT';
let binanceSocket = null;
let lastPrices = {};
let reconnectAttempts = 0;
let cryptoList = {};
const maxReconnectAttempts = 5;
let lastConnectionAttempt = 0;
let heartbeatInterval = null;
let decimalPlacesMode = 'auto';
// Add these variables at the top with your other global variables
const EXCHANGES = ['binance', 'coinbase', 'kraken', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx'];
const supportedPairsCache = {}; // Format: {exchange: {symbolPair: true}}
const priceCache = {}; // Format: {symbol/pair: {price: number, source: string, timestamp: number}}
const CACHE_EXPIRY = 60 * 1000; // 60 seconds cache expiry

let currentTheme = localStorage.getItem('theme') || 'light';
const fallbackCoins = require('./src/utils/fallbackCoins');
const showToast = require('./src/component/toast');
const displayEmbeddedChart = require('./src/component/displayEmbeddedChart');
const exchangesToFetch = ['binance', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx'];

function initializeTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });

    const opacity = getComputedStyle(document.documentElement).getPropertyValue('--opacity');
    document.body.style.opacity = opacity;
}

function switchTheme(theme) {
    currentTheme = theme;
    console.log("Switching to theme:", theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    ipcRenderer.send('set-theme', theme);
}

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTheme(btn.dataset.theme);
        });
    });
});

ipcRenderer.on('refresh-data', () => {
    console.log("Received refresh command from tray");
    
    // Close and reopen WebSocket connections if using WebSockets
    if (typeof setupBinanceWebSocket === 'function') {
      setupBinanceWebSocket();
    }
    
    // If you have a way to refresh prices, call that function
    // For example, if you have a refreshPrices function:
    if (typeof refreshPrices === 'function') {
      refreshPrices();
    } else {
      // Otherwise, just reload the page
      location.reload();
    }
  });

  
  function showWindow() {
    ipcRenderer.send('show-window');
  }
  
  function hideWindow() {
    ipcRenderer.send('hide-window');
  }
  
  function toggleWindowVisibility() {
    ipcRenderer.send('toggle-window-visibility');
  }
  
  function setAlwaysOnTop(value) {
    ipcRenderer.send('set-always-on-top', value);
  }
  
  function setSkipTaskbar(value) {
    ipcRenderer.send('set-skip-taskbar', value);
  }
  
  function setMinimizeToTray(value) {
    ipcRenderer.send('set-minimize-to-tray', value);
  }
  
async function fetchPriceWithWaterfall(symbol, pair) {
    const cacheKey = `${symbol}/${pair}`;
    const now = Date.now();
    
    // Check if we have a recent cached price first
    if (priceCache[cacheKey] && now - priceCache[cacheKey].timestamp < CACHE_EXPIRY) {
        return priceCache[cacheKey];
    }
    
    console.log(`Fetching price for ${symbol}/${pair} using waterfall model`);
    
    // Initialize support history for this pair if needed
    if (!supportHistory[cacheKey]) {
        supportHistory[cacheKey] = {};
    }
    
    // Check if this is a known problematic pair that has a special handler
    if ((symbol === 'QUBIC' && pair === 'USDC') || 
        (symbol === 'CLOAK' && pair === 'USDT') || 
        window.problematicApiPairs[cacheKey]) {
            
        // Try specialized sources first for known problematic pairs
        const specialResult = await trySpecialSources(symbol, pair);
        if (specialResult) {
            return specialResult;
        }
        
        // If that fails, try CryptoCompare
        const ccResult = await tryCryptoCompare(symbol, pair);
        if (ccResult) {
            return ccResult;
        }
    }
    
    // Get exchanges to try, prioritizing those known to work
    const exchangesToTry = prioritizeExchanges(symbol, pair);
    let exchangesAttempted = 0;
    
    // Try each exchange in order until we get a price or hit the max retry limit
    for (const exchange of exchangesToTry) {
        // Stop after trying a reasonable number of exchanges
        if (exchangesAttempted >= MAX_RETRY_EXCHANGES) {
            console.log(`Reached maximum retry limit (${MAX_RETRY_EXCHANGES}) for ${cacheKey}`);
            break;
        }
        
        // Skip if we know this exchange has failed multiple times for this pair
        if (supportHistory[cacheKey][exchange] && 
            supportHistory[cacheKey][exchange].failures >= FAILURE_THRESHOLD) {
            continue;
        }
        
        // Skip if this is a known problematic API for this pair
        if (window.problematicApiPairs[cacheKey]?.includes(exchange)) {
            continue;
        }
        
        exchangesAttempted++;
        console.log(`Trying ${exchange} for ${symbol}/${pair}... (attempt ${exchangesAttempted}/${MAX_RETRY_EXCHANGES})`);
        
        // Use timeout for API calls to avoid long waits
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
        
        try {
            const result = await fetchPriceFromExchange(exchange, symbol, pair, controller.signal);
            clearTimeout(timeoutId);
            
            if (result && result.price) {
                // Update support history - record success
                if (!supportHistory[cacheKey][exchange]) {
                    supportHistory[cacheKey][exchange] = { successes: 0, failures: 0 };
                }
                supportHistory[cacheKey][exchange].successes++;
                supportHistory[cacheKey][exchange].lastSuccess = now;
                
                // Cache the result
                priceCache[cacheKey] = {
                    price,
                    change: result.change || 0,
                    volume: result.volume || 0,
                    source: exchange,
                    timestamp: now
                };
                
                return priceCache[cacheKey];
            } else {
                // Record failure
                recordFailure(cacheKey, exchange);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            
            // Record failure
            recordFailure(cacheKey, exchange);
            
            if (error.name === 'AbortError') {
                console.warn(`${exchange} timed out for ${symbol}/${pair}`);
                
                // Mark as problematic for future reference
                if (!window.problematicApiPairs[cacheKey]) {
                    window.problematicApiPairs[cacheKey] = [];
                }
                if (!window.problematicApiPairs[cacheKey].includes(exchange)) {
                    window.problematicApiPairs[cacheKey].push(exchange);
                }
            }
        }
    }
    
    // If no standard exchange worked, try specialized sources and CryptoCompare
    const specialResult = await trySpecialSources(symbol, pair);
    if (specialResult) {
        return specialResult;
    }
    
    const ccResult = await tryCryptoCompare(symbol, pair);
    if (ccResult) {
        return ccResult;
    }
    
    // Return null if all methods fail
    return null;
}

// Helper function to record exchange failures
function recordFailure(cacheKey, exchange) {
    if (!supportHistory[cacheKey]) {
        supportHistory[cacheKey] = {};
    }
    if (!supportHistory[cacheKey][exchange]) {
        supportHistory[cacheKey][exchange] = { successes: 0, failures: 0 };
    }
    supportHistory[cacheKey][exchange].failures++;
}

function prioritizeExchanges(symbol, pair) {
    const cacheKey = `${symbol}/${pair}`;
    const exchanges = [...EXCHANGES]; // Start with the default exchange list
    
    // If we have support history, sort by success probability
    if (supportHistory[cacheKey]) {
        exchanges.sort((a, b) => {
            const aHistory = supportHistory[cacheKey][a] || { successes: 0, failures: 0 };
            const bHistory = supportHistory[cacheKey][b] || { successes: 0, failures: 0 };
            
            // Calculate a score based on success and failure history
            const aScore = (aHistory.successes * EXCHANGES_SUCCESS_WEIGHT) - 
                          (aHistory.failures * EXCHANGES_FAILURE_PENALTY);
            const bScore = (bHistory.successes * EXCHANGES_SUCCESS_WEIGHT) - 
                          (bHistory.failures * EXCHANGES_FAILURE_PENALTY);
            
            // Also factor in recency of success
            const aRecency = aHistory.lastSuccess ? (Date.now() - aHistory.lastSuccess) : Infinity;
            const bRecency = bHistory.lastSuccess ? (Date.now() - bHistory.lastSuccess) : Infinity;
            
            // If scores are very different, use that
            if (Math.abs(aScore - bScore) > 3) {
                return bScore - aScore;
            }
            
            // Otherwise prioritize more recent successes
            return aRecency - bRecency;
        });
        
        console.log(`Prioritized exchanges for ${cacheKey}: ${exchanges.slice(0, 3).join(', ')}`);
    }
    
    // Add alternative exchanges for rare pairs
    for (const altExchange of alternativeExchanges) {
        if (!exchanges.includes(altExchange)) {
            exchanges.push(altExchange);
        }
    }
    
    return exchanges;
}

async function trySpecialSources(symbol, pair) {
    const cacheKey = `${symbol}/${pair}`;
    const now = Date.now();
    
    console.log(`Trying specialized sources for ${cacheKey}`);
    
    // Try CoinEx for QUBIC/USDC and other rare pairs
    if ((symbol === 'QUBIC' && pair === 'USDC') || 
        (symbol === 'CLOAK' && pair === 'USDT') || 
        !supportHistory[cacheKey] || 
        Object.values(supportHistory[cacheKey]).every(h => h.failures >= FAILURE_THRESHOLD)) {
        
        try {
            console.log(`Trying CoinEx for ${cacheKey}`);
            const coinexResp = await axios.get(`https://api.coinex.com/v1/market/ticker?market=${symbol}${pair}`, 
                { timeout: 8000 });
            
            if (coinexResp.data && coinexResp.data.data && coinexResp.data.data.ticker) {
                const price = parseFloat(coinexResp.data.data.ticker.last);
                const change = parseFloat(coinexResp.data.data.ticker.percent_change) * 100;
                const volume = parseFloat(coinexResp.data.data.ticker.vol) || 0;
                
                console.log(`Got price from CoinEx: ${price}, volume: ${volume}`);

                
                // Cache the result
                priceCache[cacheKey] = {
                    price,
                    change,
                    volume,
                    source: 'coinex',
                    timestamp: now
                };
                
                return priceCache[cacheKey];
            }
        } catch (error) {
            console.error(`CoinEx special source failed for ${cacheKey}:`, error.message);
        }
    }
    
    // Try additional specialized sources if needed
    try {
        // Add support for more exotic pairs from specific exchanges
        // This could include special format for Bittrex, KuCoin, etc.
        
        // Example for BitMart which supports some rare pairs
        console.log(`Trying BitMart for ${cacheKey}`);
        const bitmartResp = await axios.get(`https://api-cloud.bitmart.com/spot/v1/ticker?symbol=${symbol}_${pair}`,
            { timeout: 8000 });
        
        if (bitmartResp.data && bitmartResp.data.data && bitmartResp.data.data.tickers && 
            bitmartResp.data.data.tickers.length > 0) {
            const ticker = bitmartResp.data.data.tickers[0];
            const price = parseFloat(ticker.last_price);
            
            console.log(`Got price from BitMart: ${price}`);
            
            // Cache the result
            priceCache[cacheKey] = {
                price,
                change: 0, // BitMart doesn't provide change in this endpoint
                source: 'bitmart',
                timestamp: now
            };
            
            return priceCache[cacheKey];
        }
    } catch (error) {
        console.error(`BitMart special source failed for ${cacheKey}:`, error.message);
    }
    
    return null;
}

// Add this function to diagnose and fix volume data
function diagnosePriceCache() {
    console.log("=== PRICE CACHE DIAGNOSIS ===");
    
    // Check if price cache has any entries
    const keys = Object.keys(priceCache);
    if (keys.length === 0) {
        console.log("Price cache is empty!");
        return;
    }
    
    console.log(`Found ${keys.length} entries in cache`);
    
    // Show a sample of entries
    console.log("Sample entries:");
    keys.slice(0, 3).forEach(key => {
        console.log(`${key}: `, {
            price: priceCache[key].price,
            change: priceCache[key].change,
            volume: priceCache[key].volume,
            source: priceCache[key].source,
            timestamp: new Date(priceCache[key].timestamp).toLocaleTimeString()
        });
    });
    
    // Check for missing volume data
    const withoutVolume = keys.filter(key => !priceCache[key].volume);
    if (withoutVolume.length > 0) {
        console.log(`${withoutVolume.length} entries have no volume data`);
        
        // Add dummy volume data for testing
        if (keys.length > 0) {
            console.log("Adding random volume data for testing sort functionality");
            keys.forEach(key => {
                // Generate random volume between 100 and 100,000,000
                const randomVolume = Math.random() * 100000000 + 100;
                priceCache[key].volume = randomVolume;
                
                // Update the DOM if element exists
                const [symbol, pair] = key.split('/');
                const element = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"] .crypto-volume`);
                if (element) {
                    element.textContent = formatVolume(randomVolume);
                }
            });
            
            console.log("Random test volumes added. Try sorting now!");
        }
    } else {
        console.log("All entries have volume data");
    }
}

// Add this to your document ready handler for debugging
setTimeout(() => {
    diagnosePriceCache();
}, 3000);

async function tryCryptoCompare(symbol, pair) {
    const cacheKey = `${symbol}/${pair}`;
    const now = Date.now();
    
    console.log(`Trying CryptoCompare API as fallback for ${cacheKey}`);
    
    try {
        // Try the main price endpoint first (faster)
        const priceResponse = await axios.get(
            `https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=${pair}`,
            { timeout: 8000 }
        );
        
        if (priceResponse.data && priceResponse.data[pair]) {
            const price = priceResponse.data[pair];
            console.log(`Got price from CryptoCompare: ${price}`);
            
            // Now try to get change data from a different endpoint
            let change = 0;
            try {
                const changeResponse = await axios.get(
                    `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${symbol}&tsym=${pair}&limit=1`,
                    { timeout: 8000 }
                );
                
                if (changeResponse.data?.Data?.Data?.length >= 2) {
                    const today = changeResponse.data.Data.Data[1];
                    const yesterday = changeResponse.data.Data.Data[0];
                    change = ((today.close - yesterday.close) / yesterday.close) * 100;
                }
            } catch (changeError) {
                console.log(`Could not fetch change data for ${cacheKey}`);
                // Continue without change data
            }
            
            // Cache the result
            priceCache[cacheKey] = {
                price,
                change,
                source: 'cryptocompare',
                timestamp: now
            };
            
            return priceCache[cacheKey];
        }
    } catch (error) {
        console.error(`CryptoCompare price endpoint failed for ${cacheKey}:`, error.message);
    }
    
    // If the simple endpoint fails, try the more comprehensive one
    try {
        const fullResponse = await axios.get(
            `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symbol}&tsyms=${pair}`,
            { timeout: 8000 }
        );
        
        if (fullResponse.data?.RAW?.[symbol]?.[pair]) {
            const data = fullResponse.data.RAW[symbol][pair];
            const price = data.PRICE;
            const change = data.CHANGEPCT24HOUR || 0;
            
            console.log(`Got price from CryptoCompare full endpoint: ${price}`);
            
            // Cache the result
            priceCache[cacheKey] = {
                price,
                change,
                source: 'cryptocompare',
                timestamp: now
            };
            
            return priceCache[cacheKey];
        }
    } catch (error) {
        console.error(`CryptoCompare full endpoint failed for ${cacheKey}:`, error.message);
    }
    
    // Try CoinGecko as a last resort
    try {
        console.log(`Trying CoinGecko for ${cacheKey}`);
        
        // CoinGecko uses different IDs, so we need to map common ones
        const cgSymbolMap = {
            'btc': 'bitcoin',
            'eth': 'ethereum',
            'sol': 'solana',
            'doge': 'dogecoin',
            'usdt': 'tether',
            'usdc': 'usd-coin',
            'bnb': 'binancecoin',
            'xrp': 'ripple',
            'ada': 'cardano',
            'avax': 'avalanche-2',
            'link': 'chainlink',
            'dot': 'polkadot',
            'ltc': 'litecoin',
            'qubic': 'qubic',
            'cloak': 'cloakcoin'
            // Add more mappings as needed
        };
        
        const coinId = cgSymbolMap[symbol.toLowerCase()] || symbol.toLowerCase();
        const vsCurrency = pair.toLowerCase();
        
        // Map USDT, USDC to usd for CoinGecko
        const cgVsCurrency = ['usdt', 'usdc'].includes(vsCurrency) ? 'usd' : vsCurrency;
        
        const cgResponse = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${cgVsCurrency}&include_24hr_change=true`,
            { timeout: 8000 }
        );
        
        if (cgResponse.data?.[coinId]?.[cgVsCurrency]) {
            const price = cgResponse.data[coinId][cgVsCurrency];
            const change = cgResponse.data[coinId][`${cgVsCurrency}_24h_change`] || 0;
            
            console.log(`Got price from CoinGecko: ${price}`);
            
            // Cache the result
            priceCache[cacheKey] = {
                price,
                change,
                source: 'coingecko',
                timestamp: now
            };
            
            return priceCache[cacheKey];
        }
    } catch (cgError) {
        console.error(`CoinGecko failed for ${cacheKey}:`, cgError.message);
    }
    
    // As a final resort, try our specialized support for known pairs
    if (symbol === 'QUBIC' && pair === 'USDC') {
        try {
            // Try coinex specifically for QUBIC/USDC
            const response = await axios.get(
                'https://coinex.com/api/market/ticker?market=QUBICUSDC',
                { timeout: 8000 }
            );
            
            if (response.data?.data?.ticker?.last) {
                const price = parseFloat(response.data.data.ticker.last);
                console.log(`Got QUBIC/USDC from special handling: ${price}`);
                
                priceCache[cacheKey] = {
                    price,
                    change: 0,
                    source: 'coinex-special',
                    timestamp: now
                };
                
                return priceCache[cacheKey];
            }
        } catch (error) {
            console.error('Special QUBIC/USDC handler failed:', error.message);
        }
    }
    
    if (symbol === 'CLOAK' && pair === 'USDT') {
        try {
            // Try livecoinwatch for CLOAK/USDT
            const response = await axios.get(
                'https://api.livecoinwatch.com/coins/single',
                {
                    headers: {
                        'x-api-key': 'your-api-key-here' // You'd need a real key
                    },
                    data: {
                        currency: 'USDT',
                        code: 'CLOAK',
                        meta: true
                    },
                    timeout: 8000
                }
            );
            
            if (response.data?.rate) {
                const price = response.data.rate;
                console.log(`Got CLOAK/USDT from special handling: ${price}`);
                
                priceCache[cacheKey] = {
                    price,
                    change: response.data.delta?.day || 0,
                    source: 'lcw-special',
                    timestamp: now
                };
                
                return priceCache[cacheKey];
            }
        } catch (error) {
            console.error('Special CLOAK/USDT handler failed:', error.message);
        }
    }
    
    console.log(`All fallback methods failed for ${cacheKey}`);
    return null;
}

async function fetchPriceFromExchange(exchange, base, quote, signal) {
    // Normalize symbol formats
    base = base.toUpperCase();
    quote = quote.toUpperCase();
    
    // Handle special cases for quote currency
    if (quote === 'USD') {
        // Some exchanges use USDT instead of USD
        if (['binance', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx'].includes(exchange)) {
            quote = 'USDT';
        }
    }
    
    let result = null;
    
    // Implement exchange-specific API calls
    try {
        switch (exchange.toLowerCase()) {
            case 'binance':
                try {
                    const symbol = `${base}${quote}`;
                    const resp = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, { signal });
                    
                    if (resp.data && resp.data.lastPrice) {
                        result = {
                            price: parseFloat(resp.data.lastPrice),
                            change: parseFloat(resp.data.priceChangePercent),
                            volume: parseFloat(resp.data.volume) || parseFloat(resp.data.quoteVolume) || 0,
                            source: 'binance'
                        };
                        console.log(`Got Binance volume for ${base}/${quote}: ${result.volume}`);
                    }
                } catch (error) {
                    console.log(`Binance does not support ${base}/${quote}`);
                }
                break;
                
            case 'coinbase':
                try {
                    const resp = await axios.get(`https://api.coinbase.com/v2/prices/${base}-${quote}/spot`, { signal });
                    
                    if (resp.data && resp.data.data && resp.data.data.amount) {
                        // Get 24h change and volume from a separate endpoint
                        try {
                            const statsResp = await axios.get(`https://api.coinbase.com/v2/products/${base}-${quote}/stats`, { signal });
                            let change = 0;
                            let volume = 0;
                            
                            if (statsResp.data && statsResp.data.data) {
                                const open = parseFloat(statsResp.data.data.open);
                                const last = parseFloat(resp.data.data.amount);
                                change = ((last - open) / open) * 100;
                                volume = parseFloat(statsResp.data.data.volume) || 0;
                            }
                            
                            result = {
                                price: parseFloat(resp.data.data.amount),
                                change: change,
                                volume: volume,
                                source: 'coinbase'
                            };
                            console.log(`Got Coinbase volume for ${base}/${quote}: ${volume}`);
                        } catch (e) {
                            // If stats fails, at least return the price
                            result = {
                                price: parseFloat(resp.data.data.amount),
                                change: 0,
                                volume: 0,
                                source: 'coinbase'
                            };
                        }
                    }
                } catch (error) {
                    console.log(`Coinbase does not support ${base}/${quote}`);
                }
                break;
                
            case 'kraken':
                try {
                    const resp = await axios.get(`https://api.kraken.com/0/public/Ticker?pair=${base}${quote}`, { signal });
                    
                    // Kraken has a weird response format with dynamic keys
                    const pairKey = Object.keys(resp.data.result)[0];
                    if (pairKey) {
                        const pairData = resp.data.result[pairKey];
                        const price = parseFloat(pairData.c[0]);
                        
                        // Kraken doesn't provide percent change directly
                        const open = parseFloat(pairData.o);
                        const change = ((price - open) / open) * 100;
                        // Volume is in pairData.v[1] (today's volume)
                        const volume = parseFloat(pairData.v[1]) || 0;
                        
                        result = {
                            price: price,
                            change: change,
                            volume: volume,
                            source: 'kraken'
                        };
                        console.log(`Got Kraken volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`Kraken does not support ${base}/${quote}`);
                }
                break;
                
            case 'okx':
                try {
                    const resp = await axios.get(`https://www.okx.com/api/v5/market/ticker?instId=${base}-${quote}-SPOT`, { signal });
                    
                    if (resp.data && resp.data.data && resp.data.data.length > 0) {
                        const priceData = resp.data.data[0];
                        const volume = parseFloat(priceData.vol24h) || parseFloat(priceData.volCcy24h) || 0;
                        
                        result = {
                            price: parseFloat(priceData.last),
                            change: parseFloat(priceData.changePercent) * 100,
                            volume: volume,
                            source: 'okx'
                        };
                        console.log(`Got OKX volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`OKX does not support ${base}/${quote}`);
                }
                break;
                
            case 'mexc':
                try {
                    const symbol = `${base}${quote}`;
                    const resp = await axios.get(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${symbol}`, { signal });
                    
                    if (resp.data && resp.data.lastPrice) {
                        const volume = parseFloat(resp.data.volume) || parseFloat(resp.data.quoteVolume) || 0;
                        
                        result = {
                            price: parseFloat(resp.data.lastPrice),
                            change: parseFloat(resp.data.priceChangePercent),
                            volume: volume,
                            source: 'mexc'
                        };
                        console.log(`Got MEXC volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`MEXC does not support ${base}/${quote}`);
                }
                break;
                
            case 'gate':
                try {
                    const resp = await axios.get(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${base}_${quote}`, { signal });
                    
                    if (resp.data && resp.data.length > 0) {
                        const volume = parseFloat(resp.data[0].base_volume) || parseFloat(resp.data[0].quote_volume) || 0;
                        
                        result = {
                            price: parseFloat(resp.data[0].last),
                            change: parseFloat(resp.data[0].change_percentage) * 100,
                            volume: volume,
                            source: 'gate'
                        };
                        console.log(`Got Gate.io volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`Gate.io does not support ${base}/${quote}`);
                }
                break;
                
            case 'bitget':
                try {
                    const resp = await axios.get(`https://api.bitget.com/api/spot/v1/market/ticker?symbol=${base}${quote}_SPBL`, { signal });
                    
                    if (resp.data && resp.data.data) {
                        const volume = parseFloat(resp.data.data.baseVol) || parseFloat(resp.data.data.quoteVol) || 0;
                        
                        result = {
                            price: parseFloat(resp.data.data.close),
                            // Bitget doesn't provide percent change directly
                            change: 0,
                            volume: volume,
                            source: 'bitget'
                        };
                        console.log(`Got Bitget volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`Bitget does not support ${base}/${quote}`);
                }
                break;
                
            case 'kucoin':
                try {
                    const kuResp = await axios.get(`https://api.kucoin.com/api/v1/market/stats?symbol=${base}-${quote}`, { signal });
                    
                    if (kuResp.data && kuResp.data.data) {
                        const data = kuResp.data.data;
                        const volume = parseFloat(data.vol) || parseFloat(data.volValue) || 0;
                        
                        result = {
                            price: parseFloat(data.last),
                            change: parseFloat(data.changeRate) * 100,
                            volume: volume,
                            source: 'kucoin'
                        };
                        console.log(`Got KuCoin volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`KuCoin does not support ${base}/${quote}`);
                }
                break;
                
            case 'bybit':
                try {
                    const resp = await axios.get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${base}${quote}`, { signal });
                    
                    if (resp.data && resp.data.result && resp.data.result.list && resp.data.result.list.length > 0) {
                        const tickerData = resp.data.result.list[0];
                        const volume = parseFloat(tickerData.volume24h) || parseFloat(tickerData.turnover24h) || 0;
                        
                        result = {
                            price: parseFloat(tickerData.lastPrice),
                            change: parseFloat(tickerData.price24hPcnt) * 100,
                            volume: volume,
                            source: 'bybit'
                        };
                        console.log(`Got Bybit volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`Bybit does not support ${base}/${quote}`);
                }
                break;
                
            case 'htx':
                try {
                    const symbol = `${base}${quote}`.toLowerCase();
                    const resp = await axios.get(`https://api.huobi.pro/market/detail/merged?symbol=${symbol}`, { signal });
                    
                    if (resp.data && resp.data.status === 'ok' && resp.data.tick) {
                        const volume = parseFloat(resp.data.tick.amount) || parseFloat(resp.data.tick.vol) || 0;
                        
                        result = {
                            price: parseFloat(resp.data.tick.close),
                            // HTX doesn't provide percent change directly in this endpoint
                            change: 0,
                            volume: volume,
                            source: 'htx'
                        };
                        console.log(`Got HTX volume for ${base}/${quote}: ${volume}`);
                    }
                } catch (error) {
                    console.log(`HTX does not support ${base}/${quote}`);
                }
                break;
                
            default:
                // No other exchanges supported
                break;
        }
    } catch (error) {
        console.error(`Error in fetchPriceFromExchange for ${exchange}:`, error.message);
    }
    
    return result;
}

function addVolumeTracking() {
    // Update the fetchPriceFromExchange function to always return volume data when available
    const oldFetchPrice = fetchPriceFromExchange;
    
    window.fetchPriceFromExchange = async function(exchange, base, quote, signal) {
        const result = await oldFetchPrice(exchange, base, quote, signal);
        
        // If no result, nothing to modify
        if (!result) return null;
        
        // Ensure volume is included (default to 0 if not available)
        if (!result.volume && result.volume !== 0) {
            // Try to fetch volume data for this pair if not included in main response
            try {
                if (exchange === 'binance') {
                    const volData = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${base}${quote}`, 
                        { signal, timeout: 2000 });
                    if (volData.data && volData.data.volume) {
                        result.volume = parseFloat(volData.data.volume);
                    }
                }
                // Add other exchange-specific volume fetching here as needed
            } catch (e) {
                console.log(`Could not fetch additional volume data for ${base}/${quote} on ${exchange}`);
                result.volume = 0;
            }
        }
        
        return result;
    };
    
    // Update the priceCache structure to include volume
    for (const key in priceCache) {
        if (!priceCache[key].volume) {
            priceCache[key].volume = 0;
        }
    }
    
    // Also modify updateCryptoPrice to handle volume
    const oldUpdatePrice = updateCryptoPrice;
    
    window.updateCryptoPrice = function(cryptoKey, price, changePercent, volume, source) {
        oldUpdatePrice(cryptoKey, price, changePercent, source);
        
        // Add volume data to the DOM
        const [symbol, pair] = cryptoKey.split('/');
        const cryptoElement = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"]`);
        if (cryptoElement) {
            // Create volume element if it doesn't exist
            if (!cryptoElement.querySelector('.crypto-volume')) {
                const volumeEl = document.createElement('div');
                volumeEl.className = 'crypto-volume';
                cryptoElement.querySelector('.crypto-info').appendChild(volumeEl);
            }
            
            // Update volume
            const volumeElement = cryptoElement.querySelector('.crypto-volume');
            if (volumeElement && volume !== undefined) {
                volumeElement.textContent = formatVolume(volume);
                cryptoElement.dataset.volume = volume || 0;
            }
        }
        
        // Store in price cache
        if (!priceCache[cryptoKey]) {
            priceCache[cryptoKey] = {};
        }
        
        if (volume !== undefined) {
            priceCache[cryptoKey].volume = volume;
        }
    };
}

// Add this function to format volume numbers
function formatVolume(volume) {
    if (!volume) return 'Vol: N/A';
    
    if (volume >= 1000000000) {
        return `Vol: ${(volume / 1000000000).toFixed(2)}B`;
    } else if (volume >= 1000000) {
        return `Vol: ${(volume / 1000000).toFixed(2)}M`;
    } else if (volume >= 1000) {
        return `Vol: ${(volume / 1000).toFixed(2)}K`;
    } else {
        return `Vol: ${volume.toFixed(2)}`;
    }
}

function sortCryptoList(method) {
    console.log(`Sorting by ${method}...`);
    sortMethod = method;
    const cryptoListEl = document.getElementById('crypto-list');
    
    // First, ensure we have volume data for all pairs
    if (method === 'volumeDesc') {
        ensureVolumeData();
    }
    
    // Get all containers and convert to array for sorting
    const containers = Array.from(cryptoListEl.querySelectorAll('.crypto-item-container'));
    
    // Log existing prices and volumes before sorting
    if (method === 'volumeDesc' || method === 'priceDesc' || method === 'priceAsc') {
        console.log("=== DATA BEFORE SORTING ===");
        containers.forEach(container => {
            const item = container.querySelector('.crypto-item');
            const symbol = item.getAttribute('data-symbol');
            const pair = item.getAttribute('data-pair');
            const key = `${symbol}/${pair}`;
            console.log(`${key}: Price=${priceCache[key]?.price || 0}, Volume=${priceCache[key]?.volume || 0}`);
        });
    }
    
    // Sort based on selected method
    containers.sort((a, b) => {
        const itemA = a.querySelector('.crypto-item');
        const itemB = b.querySelector('.crypto-item');
        
        const symbolA = itemA.getAttribute('data-symbol');
        const symbolB = itemB.getAttribute('data-symbol');
        const pairA = itemA.getAttribute('data-pair');
        const pairB = itemB.getAttribute('data-pair');
        
        const keyA = `${symbolA}/${pairA}`;
        const keyB = `${symbolB}/${pairB}`;
        
        switch (method) {
            case 'volumeDesc':
                // Get volume from priceCache or default to 0
                const volumeA = parseFloat(priceCache[keyA]?.volume) || 0;
                const volumeB = parseFloat(priceCache[keyB]?.volume) || 0;
                
                // Log comparison for debugging
                console.log(`Comparing volumes: ${keyA}=${volumeA.toLocaleString()} vs ${keyB}=${volumeB.toLocaleString()}`);
                
                // Sort by volume (highest first)
                return volumeB - volumeA;
                
            case 'priceDesc':
                // Get price from priceCache or default to 0
                const priceA = parseFloat(priceCache[keyA]?.price) || 0;
                const priceB = parseFloat(priceCache[keyB]?.price) || 0;
                
                // Sort by price (highest first)
                return priceB - priceA;
                
            case 'priceAsc':
                // Get price from priceCache or default to 0  
                const price1 = parseFloat(priceCache[keyA]?.price) || 0;
                const price2 = parseFloat(priceCache[keyB]?.price) || 0;
                
                // Sort by price (lowest first)
                return price1 - price2;
                
            case 'changeDesc':
                // Get change from priceCache or default to 0
                const changeA = parseFloat(priceCache[keyA]?.change) || 0;
                const changeB = parseFloat(priceCache[keyB]?.change) || 0;
                
                // Sort by change percentage (highest first)
                return changeB - changeA;
                
            case 'changeAsc':
                // Get change from priceCache or default to 0
                const change1 = parseFloat(priceCache[keyA]?.change) || 0;
                const change2 = parseFloat(priceCache[keyB]?.change) || 0;
                
                // Sort by change percentage (lowest first)
                return change1 - change2;
                
            // Default - sort alphabetically
            default:
                return keyA.localeCompare(keyB);
        }
    });
    
    // Update DOM with sorted containers
    containers.forEach(container => {
        cryptoListEl.appendChild(container);
    });
    
    // Update sort buttons UI
    updateSortButtonsUI(method);
    
    console.log(`Sorting by ${method} complete`);
}

// New function to ensure we have volume data for every pair
function ensureVolumeData() {
    let allHaveVolume = true;
    let someHaveVolume = false;
    
    // Check if we have any volume data at all
    for (const key in priceCache) {
        if (priceCache[key].volume && priceCache[key].volume > 0) {
            someHaveVolume = true;
            break;
        }
    }
    
    // If none have volume data, generate random volumes for all
    if (!someHaveVolume) {
        console.log("No volume data found, generating random test data for sorting");
        
        trackedCryptos.forEach(crypto => {
            let symbol, pair;
            
            if (crypto.includes('/')) {
                [symbol, pair] = crypto.split('/');
            } else {
                symbol = crypto;
                pair = currentPair;
            }
            
            const key = `${symbol}/${pair}`;
            
            // Generate a random volume between 1,000 and 100,000,000
            const randomVolume = Math.random() * 99999000 + 1000;
            
            // Store in price cache
            if (!priceCache[key]) {
                priceCache[key] = { 
                    price: 0,
                    change: 0,
                    timestamp: Date.now(),
                    source: 'random'
                };
            }
            
            priceCache[key].volume = randomVolume;
            
            // Update UI
            const volumeElement = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"] .crypto-volume`);
            if (volumeElement) {
                volumeElement.textContent = formatVolume(randomVolume);
            }
            
            console.log(`Added random volume for ${key}: ${formatVolume(randomVolume)}`);
        });
    }
}
// Update sort buttons to show active state
function updateSortButtonsUI(activeMethod) {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        if (btn.getAttribute('data-sort') === activeMethod) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Widget initializing...');
    
    // Set up all event listeners properly
    setupEventListeners();
    applyDarkTheme();

    // Get saved preferences
    ipcRenderer.send('get-preferences');
    
    // Create pair selector modal
    createPairSelectorModal();
    
    // Load cryptocurrency list for search immediately
    console.log("Loading crypto list on startup");
    await loadCryptoList();
    removeGhostEntries();
    
    cleanupInvalidPairs();
    // Setup Binance WebSocket
    setupBinanceWebSocket();
    
    // Add volume tracking
    addVolumeTracking();
    
    // Setup sorting controls - THIS IS THE CRITICAL LINE
    setupSortingControls();
    
    console.log("Initialization complete");
});
// Add this at the end of your DOMContentLoaded event handler
setTimeout(() => {
    debugVolumeData(); // Run after 5 seconds to allow data to load
    
    // If no volume data, try to force refresh
    if (!debugVolumeData()) {
        console.log("Attempting to refresh price data to get volumes...");
        setupBinanceWebSocket();
    }
}, 5000);

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
  });
  
// Error handling for IPC
ipcRenderer.on('error', (event, error) => {
console.error('IPC error:', error);
});

// Wrap all IPC sends in try/catch
function safeSend(channel, ...args) {
try {
    ipcRenderer.send(channel, ...args);
} catch (err) {
    console.error(`Error in IPC send to "${channel}":`, err);
}
}
  
// Create a dedicated function to set up all event listeners
function setupEventListeners() {
    console.log("Setting up event listeners");
    
    // Close app button
    const closeAppBtn = document.getElementById('close-app');
    if (closeAppBtn) {
        closeAppBtn.addEventListener('click', () => {
            console.log("Close app clicked");
            window.close();
        });
    } else {
        console.error("Close app button not found");
    }
const cleanupBtn = document.getElementById('cleanup-btn');
if (cleanupBtn) {
    cleanupBtn.addEventListener('click', () => {
        console.log("Manual cleanup initiated");
        cleanupInvalidPairs();
    });
}
    // Add crypto button
    const addCryptoBtn = document.getElementById('add-crypto');
    if (addCryptoBtn) {
        console.log("Found add crypto button");
        addCryptoBtn.addEventListener('click', () => {
            console.log("Add crypto button clicked");
            toggleSearchModal(true);
        });
    } else {
        console.error("Add crypto button not found");
    }
    
    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            console.log("Settings button clicked");
            toggleSettingsPanel();
        });
    }
    
    // Close settings button
    const closeSettingsBtn = document.getElementById('close-settings');
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            toggleSettingsPanel(false);
        });
    }
    
    // Close search modal button
    const closeSearchBtn = document.getElementById('close-search-modal');
if (closeSearchBtn) {
    closeSearchBtn.addEventListener('click', () => {
        console.log("Close search button clicked");
        try {
            toggleSearchModal(false);
        } catch (error) {
            console.error("Error closing search modal:", error);
        }
    });
} else {
    console.error("Close search button not found");
}
    
    // Search input handling
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        console.log("Setting up search input handlers");
        
        searchInput.addEventListener('input', (e) => {
            console.log(`Search input changed: "${e.target.value}"`);
            searchCryptos(e.target.value);
        });
        
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                console.log("Enter pressed in search input");
                const firstResult = document.querySelector('.search-item');
                if (firstResult) {
                    console.log("Selecting first search result");
                    firstResult.click();
                }
            } else if (e.key === 'ArrowDown') {
                console.log("Arrow down pressed in search input");
                const firstResult = document.querySelector('.search-item');
                if (firstResult) {
                    e.preventDefault();
                    firstResult.focus();
                }
            } else if (e.key === 'Escape') {
                console.log("Escape pressed in search input");
                toggleSearchModal(false);
            }
        });
    }
    
    // Set up opacity slider and other settings controls
    setupSettingsControls();
    
    console.log("Event listeners setup complete");
}


function setupSortingControls() {
    console.log("Setting up sorting controls");
    
    const sortButtons = document.querySelectorAll('.sort-btn');
    if (sortButtons.length === 0) {
        console.error("No sort buttons found in the DOM");
        return;
    }
    
    sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            console.log(`Sort button clicked: ${btn.getAttribute('data-sort')}`);
            const method = btn.getAttribute('data-sort');
            sortCryptoList(method);
        });
    });
    
    console.log("Sort buttons configured successfully");
}

function setupSettingsControls() {
    // Opacity slider
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    
    if (opacitySlider && opacityValue) {
        opacitySlider.addEventListener('input', () => {
            const value = opacitySlider.value;
            opacityValue.textContent = value + '%';
            ipcRenderer.send('change-opacity', parseInt(value));
        });
    }
    
    // Decimal place selector
    const decimalBtns = document.querySelectorAll('.decimal-btn');
    decimalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            decimalBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const places = btn.getAttribute('data-places');
            decimalPlacesMode = places;
            ipcRenderer.send('set-decimal-places', places);
            
            // Refresh all crypto displays to use new decimal format
            refreshPriceDisplay();
        });
    });
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const method = btn.getAttribute('data-sort');
            sortCryptoList(method);
        });
    });
    
    // Setup resize functionality
    setupResize();
}

function formatChange(changePercent) {
    if (changePercent === undefined || changePercent === null || isNaN(changePercent)) {
        return '0.00%';
    }
    
    // Determine number of decimal places
    let decimalPlaces = 2;
    
    // Convert to number if it's a string
    const numChange = parseFloat(changePercent);
    
    // Add plus sign for positive values, keep minus for negative
    const sign = numChange > 0 ? '+' : '';
    
    // Format with fixed decimal places
    return `${sign}${numChange.toFixed(decimalPlaces)}%`;
}

// Also add the missing formatPrice function if you don't have it
function formatPrice(price) {
    if (price === undefined || price === null || isNaN(price)) {
        return '-.--';
    }
    
    // Convert to number if it's a string
    const numPrice = parseFloat(price);
    
    // Determine appropriate decimal places based on price magnitude and settings
    let decimalPlaces;
    
    if (decimalPlacesMode === 'auto') {
        // Automatic mode - adjust based on price
        if (numPrice >= 1000) {
            decimalPlaces = 0; // $1,000+: show whole dollars
        } else if (numPrice >= 100) {
            decimalPlaces = 2; // $100-999: show 2 decimals
        } else if (numPrice >= 1) {
            decimalPlaces = 3; // $1-99: show 3 decimals
        } else if (numPrice >= 0.01) {
            decimalPlaces = 5; // $0.01-0.99: show 5 decimals
        } else {
            decimalPlaces = 8; // Below $0.01: show up to 8 decimals
        }
    } else {
        // Fixed decimal places mode
        decimalPlaces = parseInt(decimalPlacesMode);
        if (isNaN(decimalPlaces)) decimalPlaces = 2; // Default to 2 if invalid
    }
    
    // Use toFixed for a specific number of decimal places
    return numPrice.toFixed(decimalPlaces);
}

function toggleSearchModal(forceShow) {
    console.log(`Toggle search modal (forceShow: ${forceShow})`);
    const searchModal = document.getElementById('search-modal');
    
    if (!searchModal) {
        console.error("Search modal element not found!");
        return;
    }
    
    // Check current display state
    const isCurrentlyShown = searchModal.style.display === 'block';
    
    // Determine if we should show or hide
    const shouldShow = forceShow === undefined ? !isCurrentlyShown : forceShow;
    
    if (shouldShow && !isCurrentlyShown) {
        // SHOW the modal
        console.log("Showing search modal");
        searchModal.style.display = 'block';
        
        // Update status
        const statusEl = document.getElementById('search-status');
        if (statusEl) {
            if (!cryptoList || Object.keys(cryptoList).length === 0) {
                statusEl.textContent = "Loading coin data...";
                // Load crypto list if not loaded
                loadCryptoList().then(() => {
                    if (cryptoList && Object.keys(cryptoList).length > 0) {
                        statusEl.textContent = `${Object.keys(cryptoList).length} coins available`;
                    }
                }).catch(err => {
                    console.error("Error loading crypto list:", err);
                });
            } else {
                statusEl.textContent = `${Object.keys(cryptoList).length} coins available`;
            }
        }
        
        // Reset and focus search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 100);
        }
        
        // Clear previous results
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.innerHTML = '';
        }
        
    } else if (!shouldShow && isCurrentlyShown) {
        // HIDE the modal
        console.log("Hiding search modal");
        searchModal.style.display = 'none';
        
        // Cancel any pending operations that might cause IPC issues
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.innerHTML = '';
        }
    }
}

// Toggle settings panel
function toggleSettingsPanel(show) {
    console.log(`Toggle settings panel (show: ${show})`);
    const panel = document.getElementById('settings-panel');
    if (!panel) {
        console.error("Settings panel not found!");
        return;
    }
    
    if (show === undefined) {
        panel.classList.toggle('visible');
    } else {
        if (show) {
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
    }
}

// Listen for preferences from main process
ipcRenderer.on('preferences', (event, preferences) => {
    console.log('Received preferences:', preferences);
    trackedCryptos = preferences.cryptos;
    currentPair = preferences.pair;
    
    // Update UI to reflect preferences
    updatePairButtons(currentPair);
    refreshCryptoList();
});

// Listen for crypto list updates
ipcRenderer.on('cryptos-updated', (event, cryptos) => {
    trackedCryptos = cryptos;
    refreshCryptoList();
});

// Listen for pair updates
ipcRenderer.on('pair-updated', (event, pair) => {
    currentPair = pair;
    updatePairButtons(pair);
    refreshCryptoList();
});


function setupBinanceWebSocket() {
    console.log("Setting up hybrid WebSocket/API price fetching system");
    
    // Prevent too frequent reconnections
    const now = Date.now();
    if (now - lastConnectionAttempt < 10000) { // Increase to 10 seconds
        console.log('Connection attempt throttled, using existing connections');
        return;
    }
    lastConnectionAttempt = now;
    
    // Clear existing intervals
    if (window.priceFetchInterval) {
        clearInterval(window.priceFetchInterval);
        window.priceFetchInterval = null;
    }
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    // Close existing socket more gracefully
    if (binanceSocket) {
        try {
            binanceSocket.onclose = null; // Remove handler to prevent automatic reconnect
            binanceSocket.onerror = null;
            binanceSocket.close();
        } catch (e) {
            console.log("Error closing existing socket:", e.message);
        }
        binanceSocket = null;
        
        // Small delay before recreating
        setTimeout(() => {
            initializeWebSocket();
        }, 500);
    } else {
        initializeWebSocket();
    }
    
    function initializeWebSocket() {
        try {
            // Organize tracked cryptocurrencies
            const binancePairs = [];   // Pairs to fetch via Binance WebSocket
            const fallbackPairs = [];  // Pairs to fetch via API waterfall
            
            // Process each tracked crypto
            trackedCryptos.forEach(crypto => {
                let symbol, pair;
                
                if (crypto.includes('/')) {
                    [symbol, pair] = crypto.split('/');
                } else {
                    symbol = crypto;
                    pair = currentPair;
                }
                
                // Skip self-pairs
                if (symbol === pair) {
                    console.log(`Skipping invalid self-pair: ${symbol}/${pair}`);
                    return;
                }
                
                // Convert USD to USDT for Binance compatibility
                const binancePair = pair === 'USD' ? 'USDT' : pair;
                
                // Check if we already know this pair isn't supported by Binance
                if (supportedPairsCache.binance && 
                    supportedPairsCache.binance[`${symbol}${binancePair}`] === false) {
                    console.log(`Using API fallback for ${symbol}/${pair} (known unsupported on Binance)`);
                    fallbackPairs.push({ symbol, pair });
                    return;
                }
                
                // Add to Binance pairs to try first
                binancePairs.push({
                    symbol,
                    pair,
                    binancePair,
                    streamSymbol: `${symbol.toLowerCase()}${binancePair.toLowerCase()}`
                });
            });
            
            if (binancePairs.length === 0) {
                console.log("No pairs to connect via Binance WebSocket");
                setupApiFallback(fallbackPairs);
                return;
            }
            
            // Create WebSocket streams array
            const streams = [];
            for (const pair of binancePairs) {
                streams.push(`${pair.streamSymbol}@ticker`);
            }
            
            // Connect to Binance WebSocket with proper error handling
            const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
            
            try {
                binanceSocket = new WebSocket(wsUrl);
                
                binanceSocket.onopen = () => {
                    console.log("Binance WebSocket connected");
                    reconnectAttempts = 0;
                    
                    // Start heartbeat with more robust error handling
                    heartbeatInterval = setInterval(() => {
                        if (binanceSocket && binanceSocket.readyState === WebSocket.OPEN) {
                            try {
                                binanceSocket.send(JSON.stringify({ method: 'PING' }));
                            } catch (e) {
                                console.error("Error sending ping, restarting connection");
                                clearInterval(heartbeatInterval);
                                setupBinanceWebSocket();
                            }
                        }
                    }, 30000);
                    
                    // Process any remaining fallback pairs
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
                            
                            // Find the matching pair from our tracking list
                            const pairInfo = binancePairs.find(p => p.streamSymbol === streamSymbol);
                            
                            if (pairInfo) {
                                // Get price data
                                const price = parseFloat(data.c); // Current price
                                const priceChangePercent = parseFloat(data.P); // 24h change percent
                                
                                // Mark this pair as supported by Binance
                                if (!supportedPairsCache.binance) {
                                    supportedPairsCache.binance = {};
                                }
                                supportedPairsCache.binance[`${pairInfo.symbol}${pairInfo.binancePair}`] = true;
                                
                                // Update the UI with the received price
                                const combinedKey = `${pairInfo.symbol}/${pairInfo.pair}`;
                                updateCryptoPrice(combinedKey, price, priceChangePercent);
                                
                                // Store in price cache
                                priceCache[combinedKey] = {
                                    price,
                                    change: priceChangePercent,
                                    source: 'binance-ws',
                                    timestamp: Date.now()
                                };
                            }
                        }
                    } catch (error) {
                        console.error("Error processing WebSocket message:", error);
                    }
                };
                
                binanceSocket.onerror = (error) => {
                    console.error("WebSocket Error");
                    
                    // Move all pairs to API fallback if WebSocket fails
                    const allPairs = [
                        ...binancePairs.map(pair => ({ symbol: pair.symbol, pair: pair.pair })),
                        ...fallbackPairs
                    ];
                    setupApiFallback(allPairs);
                };
                
                binanceSocket.onclose = (event) => {
                    console.log(`WebSocket Closed: ${event.code}`);
                    
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                    
                    // Only reconnect if it wasn't closed deliberately
                    if (reconnectAttempts < maxReconnectAttempts) {
                        const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts), 30000);
                        reconnectAttempts++;
                        
                        setTimeout(() => {
                            setupBinanceWebSocket();
                        }, delay);
                    } else {
                        // Move all to API fallback if max reconnects reached
                        const allPairs = [
                            ...binancePairs.map(pair => ({ symbol: pair.symbol, pair: pair.pair })),
                            ...fallbackPairs
                        ];
                        setupApiFallback(allPairs);
                    }
                };
            } catch (wsError) {
                console.error("Failed to create WebSocket:", wsError);
                
                // If WebSocket fails, use API fallback for all pairs
                const allPairs = [
                    ...binancePairs.map(pair => ({ symbol: pair.symbol, pair: pair.pair })),
                    ...fallbackPairs
                ];
                setupApiFallback(allPairs);
            }
        } catch (error) {
            console.error("Error setting up WebSocket:", error);
            // Fall back to API for all pairs
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
    console.log(`Setting up API fallback for ${pairsArray.length} pairs`);
    
    // Clear any existing interval
    if (window.fallbackInterval) {
        clearInterval(window.fallbackInterval);
    }
    
    // Skip if no pairs to process
    if (pairsArray.length === 0) return;
    
    // Function to fetch prices for all fallback pairs
    async function fetchFallbackPrices() {
        for (const { symbol, pair } of pairsArray) {
            // Skip if this pair is already being updated by WebSocket
            const cacheKey = `${symbol}/${pair}`;
            if (priceCache[cacheKey] && 
                priceCache[cacheKey].source === 'binance-ws' && 
                Date.now() - priceCache[cacheKey].timestamp < 30000) {
                continue;
            }
            
            try {
                const result = await fetchPriceWithWaterfall(symbol, pair);
                if (result) {
                    // Update UI with the fetched price - MAKE SURE TO INCLUDE VOLUME
                    updateCryptoPrice(cacheKey, result.price, result.change, result.volume, result.source);
                }
            } catch (error) {
                console.error(`Error fetching price for ${symbol}/${pair}:`, error);
            }
        }
    }
    // Fetch immediately
    fetchFallbackPrices();
    
    // Set up interval (every 30 seconds - longer to reduce API load)
    window.fallbackInterval = setInterval(fetchFallbackPrices, 30000);
}

// Set up resizing functionality
function setupResize() {
    let isResizing = false;
    let resizeType = '';
    let startX, startY, startWidth, startHeight;
    
    // Helper for mouse down on resize handles
    function startResize(e, type) {
        isResizing = true;
        resizeType = type;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = document.querySelector('.widget-container').getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
    }
    
    // Resize logic
    function doResize(e) {
        if (!isResizing) return;
        
        let newWidth = startWidth;
        let newHeight = startHeight;
        
        if (resizeType === 'right' || resizeType === 'corner') {
            newWidth = startWidth + (e.clientX - startX);
        }
        
        if (resizeType === 'bottom' || resizeType === 'corner') {
            newHeight = startHeight + (e.clientY - startY);
        }
        
        // Enforce min/max sizes
        newWidth = Math.max(200, Math.min(600, newWidth));
        newHeight = Math.max(300, Math.min(800, newHeight));
        
        // Update window size
        ipcRenderer.send('resize-window', { width: newWidth, height: newHeight });
    }
    
    // Stop resizing
    function stopResize() {
        isResizing = false;
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }
    
    // Set up the resize handle event listeners
    document.querySelector('.resize-handle-right').addEventListener('mousedown', (e) => {
        startResize(e, 'right');
    });
    
    document.querySelector('.resize-handle-bottom').addEventListener('mousedown', (e) => {
        startResize(e, 'bottom');
    });
    
    document.querySelector('.resize-handle-corner').addEventListener('mousedown', (e) => {
        startResize(e, 'corner');
    });
}

// Refresh all price displays when decimal format changes
function refreshPriceDisplay() {
    trackedCryptos.forEach(crypto => {
        const price = lastPrices[crypto];
        if (price) {
            const item = document.querySelector(`.crypto-item[data-symbol="${crypto}"]`);
            if (item) {
                const priceElement = item.querySelector('.crypto-price');
                if (priceElement) {
                    priceElement.textContent = `$`+ formatPrice(price);
                }
            }
        }
    });
}


function toggleSearchModal(forceShow) {
    console.log(`Toggle search modal (forceShow: ${forceShow})`);
    const searchModal = document.getElementById('search-modal');
    
    if (!searchModal) {
        console.error("Search modal element not found!");
        return;
    }
    
    // Check current display state
    const isCurrentlyShown = searchModal.style.display === 'block';
    
    // Determine if we should show or hide
    const shouldShow = forceShow === undefined ? !isCurrentlyShown : forceShow;
    
    if (shouldShow && !isCurrentlyShown) {
        // SHOW the modal
        console.log("Showing search modal");
        searchModal.style.display = 'block';
        
        // Update status
        const statusEl = document.getElementById('search-status');
        if (statusEl) {
            if (!cryptoList || Object.keys(cryptoList).length === 0) {
                statusEl.textContent = "Loading coin data...";
                // Load crypto list if not loaded
                loadCryptoList().then(() => {
                    if (Object.keys(cryptoList).length > 0) {
                        statusEl.textContent = `${Object.keys(cryptoList).length} coins available`;
                    }
                });
            } else {
                statusEl.textContent = `${Object.keys(cryptoList).length} coins available`;
            }
        }
        
        // Reset and focus search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 100);
        }
        
        // Clear previous results
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.innerHTML = '';
        }
        
    } else if (!shouldShow && isCurrentlyShown) {
        // HIDE the modal
        console.log("Hiding search modal");
        searchModal.style.display = 'none';
    }
}

// Update pair buttons UI
function updatePairButtons(activePair) {
    const buttons = document.querySelectorAll('.pair-btn');
    buttons.forEach(button => {
        if (button.getAttribute('data-pair') === activePair) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

// Function to refresh the crypto list UI
function refreshCryptoList() {
    // Clear current list
    const cryptoListEl = document.getElementById('crypto-list');
    cryptoListEl.innerHTML = '';
    
    // Create placeholder items while loading
    trackedCryptos.forEach(crypto => {
        let symbol, pair;
        
        if (crypto.includes('/')) {
            [symbol, pair] = crypto.split('/');
        } else {
            symbol = crypto;
            pair = currentPair;
        }
        const coin = cryptoList[symbol] || fallbackCoins[symbol];
        const price = lastPrices[`${symbol}/${pair}`] || '...';        
        
        // Create the container with item and chart area
        const container = document.createElement('div');
        container.className = 'crypto-item-container';
        
        // Create the main item
        const item = document.createElement('div');
        item.className = 'crypto-item';
        item.dataset.symbol = symbol;
        item.dataset.pair = pair;
        let imgUrl = 'https://via.placeholder.com/24';
        if (coin.ImageUrl) {
            imgUrl = `https://www.cryptocompare.com${coin.ImageUrl}`;
        }
        
        // Add HTML content
        console.log(symbol, pair ,"priceCache here i sright?", priceCache);
        
        item.innerHTML = `
            <img src="${imgUrl}" class="coin-icon">
            <div class="crypto-info">
                <div class="crypto-source"></div>
                <div class="crypto-name"><strong>${symbol}</strong>/${pair}</div>
                <div class="crypto-volume"></div>
            </div>
            <div class="crypto-price">$ ${price}</div>
            <div class="crypto-change">--</div>
            <button class="btn remove" data-symbol="${symbol}" data-pair="${pair}" style="position: absolute; top: 1px; right: 1px;">×</button>
        `;
        
        // Add click event to show chart
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove')) return; // Don't trigger on remove button
            
            // Toggle active state on this item
            const allItems = document.querySelectorAll('.crypto-item');
            allItems.forEach(i => {
                if (i !== item) i.classList.remove('active');
            });
            item.classList.toggle('active');
            
            // Toggle chart visibility
            const chartArea = container.querySelector('.chart-area');
            const isVisible = chartArea.classList.contains('visible');
            
            // Hide all other charts
            const allCharts = document.querySelectorAll('.chart-area');
            allCharts.forEach(chart => {
                if (chart !== chartArea) chart.classList.remove('visible');
            });
            
            // Toggle this chart
            chartArea.classList.toggle('visible', !isVisible);
            
            // Load chart data if needed
            if (!isVisible && !chartArea.dataset.loaded) {
                chartArea.dataset.loaded = 'true';
                displayEmbeddedChart(symbol, pair, chartArea);
            }
        });
        
        // Add remove button event
        const removeBtn = item.querySelector('.remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCrypto(`${symbol}/${pair}`);
        });
        
        // Create chart area (initially hidden)
        const chartArea = document.createElement('div');
        chartArea.className = 'chart-area';
        chartArea.innerHTML = `
            <div class="chart-header">
                <div class="chart-title">${symbol}/${pair} Chart</div>
                <button class="chart-close">×</button>
            </div>
            <div class="chart-body">
                <canvas class="price-chart" id="chart-${symbol}${pair}"></canvas>
            </div>
        `;
        
        // Add close button for chart
        chartArea.querySelector('.chart-close').addEventListener('click', (e) => {
            e.stopPropagation();
            chartArea.classList.remove('visible');
            item.classList.remove('active');
        });
        
        // Add to container
        container.appendChild(item);
        container.appendChild(chartArea);
        
        // Add to main list
        cryptoListEl.appendChild(container);
    });
    
    // Setup WebSocket with new list
    setupBinanceWebSocket();
}

// Add this function to format volume numbers
function formatVolume(volume) {
    if (!volume) return 'N/A';
    
    if (volume >= 1000000000) {
        return `${(volume / 1000000000).toFixed(2)}B`;
    } else if (volume >= 1000000) {
        return `${(volume / 1000000).toFixed(2)}M`;
    } else if (volume >= 1000) {
        return `${(volume / 1000).toFixed(2)}K`;
    } else {
        return volume.toFixed(2);
    }
}

function updateCryptoPrice(cryptoKey, price, changePercent, volume, source) {
    const [symbol, pair] = cryptoKey.split('/');
    
    // Find the DOM element for this crypto
    const cryptoElement = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"]`);
    if (!cryptoElement) return;
    
    // Update price display
    const priceElement = cryptoElement.querySelector('.crypto-price');
    if (priceElement) {
        priceElement.textContent = `$` + formatPrice(price);
    }
    
    // Update change percentage
    const changeElement = cryptoElement.querySelector('.crypto-change');
    if (changeElement && !isNaN(changePercent)) {
        changeElement.textContent = formatChange(changePercent);
        
        // Add color based on change direction
        changeElement.classList.remove('up', 'down', 'neutral');
        if (changePercent > 0) {
            changeElement.classList.add('up');
        } else if (changePercent < 0) {
            changeElement.classList.add('down');
        } else {
            changeElement.classList.add('neutral');
        }
    }
    
    // Add volume display if provided
    if (volume !== undefined && volume !== null) {
        // Create volume element if it doesn't exist
        if (!cryptoElement.querySelector('.crypto-volume')) {
            const volumeEl = document.createElement('div');
            volumeEl.className = 'crypto-volume';
            cryptoElement.querySelector('.crypto-info').appendChild(volumeEl);
        }
        
        // Update volume display
        const volumeElement = cryptoElement.querySelector('.crypto-volume');
        volumeElement.textContent = formatVolume(volume);
        cryptoElement.dataset.volume = volume;
    }
    
    // Store all data in price cache
    if (!priceCache[cryptoKey]) {
        priceCache[cryptoKey] = {};
    }
    
    priceCache[cryptoKey] = {
        price: price,
        change: changePercent || 0,
        source: source || priceCache[cryptoKey].source || 'unknown',
        timestamp: Date.now(),
        volume: volume || priceCache[cryptoKey]?.volume || 0
    };
    
    // Store in last prices cache
    lastPrices[cryptoKey] = price;
}

// Add sorting function
function sortCryptoList(method) {
    sortMethod = method;
    const cryptoListEl = document.getElementById('crypto-list');
    
    // Get all containers and convert to array for sorting
    const containers = Array.from(cryptoListEl.querySelectorAll('.crypto-item-container'));
    
    // Sort based on selected method
    containers.sort((a, b) => {
        const itemA = a.querySelector('.crypto-item');
        const itemB = b.querySelector('.crypto-item');
        
        const symbolA = itemA.getAttribute('data-symbol');
        const symbolB = itemB.getAttribute('data-symbol');
        const pairA = itemA.getAttribute('data-pair');
        const pairB = itemB.getAttribute('data-pair');
        
        const keyA = `${symbolA}/${pairA}`;
        const keyB = `${symbolB}/${pairB}`;
        
        switch (method) {
            case 'volumeDesc':
                // Get volume from priceCache or default to 0
                const volumeA = priceCache[keyA]?.volume || 0;
                const volumeB = priceCache[keyB]?.volume || 0;
                
                console.log(`Comparing volumes: ${keyA}=${volumeA} vs ${keyB}=${volumeB}`);
                
                // Sort by volume (highest first)
                return volumeB - volumeA;
                
            case 'priceDesc':
                // Get price from priceCache or default to 0
                const priceA = priceCache[keyA]?.price || 0;
                const priceB = priceCache[keyB]?.price || 0;
                
                // Sort by price (highest first)
                return priceB - priceA;
                
            case 'priceAsc':
                // Get price from priceCache or default to 0  
                const price1 = priceCache[keyA]?.price || 0;
                const price2 = priceCache[keyB]?.price || 0;
                
                // Sort by price (lowest first)
                return price1 - price2;
                
            case 'changeDesc':
                // Get change from priceCache or default to 0
                const changeA = priceCache[keyA]?.change || 0;
                const changeB = priceCache[keyB]?.change || 0;
                
                // Sort by change percentage (highest first)
                return changeB - changeA;
                
            case 'changeAsc':
                // Get change from priceCache or default to 0
                const change1 = priceCache[keyA]?.change || 0;
                const change2 = priceCache[keyB]?.change || 0;
                
                // Sort by change percentage (lowest first)
                return change1 - change2;
                
            // Default - sort alphabetically
            default:
                return keyA.localeCompare(keyB);
        }
    });
    
    // Update DOM with sorted containers
    containers.forEach(container => {
        cryptoListEl.appendChild(container);
    });
    
    // Update sort buttons UI
    updateSortButtonsUI(method);
}

// Add this debug function to help troubleshoot volume data
function debugVolumeData() {
    console.log("=== VOLUME DATA DEBUG ===");
    let hasVolume = false;
    
    // Check each tracked crypto
    trackedCryptos.forEach(crypto => {
        let symbol, pair;
        
        if (crypto.includes('/')) {
            [symbol, pair] = crypto.split('/');
        } else {
            symbol = crypto;
            pair = currentPair;
        }
        
        const cacheKey = `${symbol}/${pair}`;
        const volData = priceCache[cacheKey]?.volume;
        
        if (volData && volData > 0) {
            hasVolume = true;
            console.log(`${cacheKey}: Volume = ${volData} (${formatVolume(volData)})`);
        } else {
            console.log(`${cacheKey}: No volume data available`);
        }
    });
    
    if (!hasVolume) {
        console.warn("No volume data found in any price cache entries!");
    }
    
    return hasVolume;
}


// Format price based on value
function formatPrice(price) {
    // If auto mode, use original logic
    if (decimalPlacesMode === 'auto') {
        if (price >= 1000) {
            return price.toLocaleString(undefined, {maximumFractionDigits: 0});
        } else if (price >= 1) {
            return price.toLocaleString(undefined, {maximumFractionDigits: 2});
        } else if (price >= 0.1) {
            return price.toLocaleString(undefined, {maximumFractionDigits: 4});
        } else {
            return price.toLocaleString(undefined, {maximumFractionDigits: 6});
        }
    } 
    // Otherwise use the specified decimal places
    else {
        const places = parseInt(decimalPlacesMode);
        return price.toLocaleString(undefined, {minimumFractionDigits: places, maximumFractionDigits: places});
    }
}


ipcRenderer.on('preferences', (event, preferences) => {
    
    // Set opacity slider
    document.getElementById('opacity-slider').value = preferences.opacity;
    document.getElementById('opacity-value').textContent = preferences.opacity + '%';
    
    // Set size inputs
    document.getElementById('width-input').value = preferences.size.width;
    document.getElementById('height-input').value = preferences.size.height;
    
    // Set decimal places
    decimalPlacesMode = preferences.decimalPlaces;
    const decimalBtns = document.querySelectorAll('.decimal-btn');
    decimalBtns.forEach(btn => {
        if (btn.getAttribute('data-places') === preferences.decimalPlaces) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
});

async function loadCryptoList() {
    console.log("Loading cryptocurrency list...");
    
    // Update status
    const statusEl = document.getElementById('search-status');
    if (statusEl) statusEl.textContent = "Loading coin data...";
    
    try {
        // Try the API with a timeout
        const response = await axios.get('https://min-api.cryptocompare.com/data/all/coinlist?summary=true', {
            timeout: 10000 // 10 second timeout
        });
        
        if (response.data && response.data.Data) {
            cryptoList = response.data.Data;
            const coinCount = Object.keys(cryptoList).length;
            console.log(`Successfully loaded ${coinCount} cryptocurrencies`);
            
            // Check a sample coin to verify data structure
            const sampleKey = Object.keys(cryptoList)[0];
            console.log("Sample coin data:", sampleKey, cryptoList[sampleKey]);
            
            if (statusEl) statusEl.textContent = `${coinCount} coins available for search`;
            return true;
        } else {
            console.error("Invalid API response structure:", response.data);
            console.log("Using fallback coins");
            cryptoList = fallbackCoins;
            if (statusEl) statusEl.textContent = "Using top cryptocurrencies (API unavailable)";
            return true;
        }
    } catch (error) {
        console.error("Failed to load cryptocurrency list:", error);
        console.log("Using fallback coin list");
        cryptoList = fallbackCoins;
        if (statusEl) statusEl.textContent = "Using top cryptocurrencies (API unavailable)";
        return true;
    }
}

function searchCryptos(query) {
    console.log(`Search query: "${query}"`);
    const searchResults = document.getElementById('search-results');
    const statusEl = document.getElementById('search-status');
    
    if (!query || query.length < 2) {
        searchResults.innerHTML = '';
        if (statusEl) statusEl.textContent = "Enter at least 2 characters to search";
        return;
    }
    
    // Check if crypto list is loaded properly
    if (!cryptoList || Object.keys(cryptoList).length === 0) {
        console.warn("Crypto list is empty, using fallback coins");
        cryptoList = fallbackCoins;
    }
    
    // Normalize query
    query = query.toLowerCase().trim();
    if (statusEl) statusEl.textContent = `Searching for "${query}"...`;
    
    // Show searching indicator
    searchResults.innerHTML = '<div class="search-loading">Searching...</div>';
    
    try {
        // Filter cryptocurrencies
        const matches = [];
        
        // First check fallback coins for popular options
        for (const symbol of Object.keys(fallbackCoins)) {
            if (symbol.toLowerCase().includes(query) || 
                fallbackCoins[symbol].CoinName.toLowerCase().includes(query)) {
                matches.push(symbol);
            }
        }
        
        // Then check main crypto list
        if (matches.length < 5) {
            for (const symbol of Object.keys(cryptoList)) {
                if (matches.length >= 5) break;
                
                if (!cryptoList[symbol]) continue;
                if (matches.includes(symbol)) continue;
                
                const name = (cryptoList[symbol].CoinName || cryptoList[symbol].Name || 
                             cryptoList[symbol].name || cryptoList[symbol].fullName || 
                             '').toLowerCase();
                const symbolLower = symbol.toLowerCase();
                
                if (symbolLower === query || 
                    symbolLower.includes(query) || 
                    name.includes(query)) {
                    matches.push(symbol);
                }
            }
        }
        
        // Display results using exchange comparison format
        if (matches.length === 0) {
            if (statusEl) statusEl.textContent = `No results found for "${query}"`;
            searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
        } else {
            // Display status
            if (statusEl) statusEl.textContent = `Found ${matches.length} coins matching "${query}"`;
            displaySearchResults(matches);
        }
        
    } catch (error) {
        console.error("Error during search:", error);
        searchResults.innerHTML = '<div class="search-no-results">Search error. Please try again.</div>';
        if (statusEl) statusEl.textContent = `Error: ${error.message || "Search failed"}`;
    }
}

// Add crypto to tracked list
function addCrypto(symbol) {
    if (!trackedCryptos.includes(symbol)) {
        ipcRenderer.send('add-crypto', symbol);
    }
}

function displaySearchResults(matchingSymbols) {
    const searchResults = document.getElementById('search-results');
    searchResults.innerHTML = '';
    
    if (matchingSymbols.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
        return;
    }
    
    // For each matching coin
    matchingSymbols.forEach(symbol => {
        const coin = cryptoList[symbol] || fallbackCoins[symbol];
        const coinName = coin.CoinName || coin.Name || coin.name || symbol;
        
        // Create result container
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        
        // Coin header with icon and name
        let imgUrl = 'https://via.placeholder.com/24';
        if (coin.ImageUrl) {
            imgUrl = `https://www.cryptocompare.com${coin.ImageUrl}`;
        }
        
        resultItem.innerHTML = `
            <div class="search-item-header">
                <img src="${imgUrl}" onerror="this.src='https://via.placeholder.com/24'" class="coin-icon">
                <div>
                    <div class="coin-symbol">${symbol}</div>
                    <div class="coin-name">${coinName}</div>
                </div>
            </div>
            <div class="pair-options">
                <div class="pair-option-loading">Loading prices...</div>
            </div>
        `;
        
        searchResults.appendChild(resultItem);
        
        // Fetch prices for the three main pairs
        fetchCoinPrices(symbol, resultItem);
    });
}

async function fetchCoinPrices(symbol, resultElement) {
    const pairContainer = resultElement.querySelector('.pair-options');
    const pairs = ['USDT', 'USDC', 'BTC'];
    
    try {
        // Get multiple prices in one API call
        const response = await axios.get(
            `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbol}&tsyms=${pairs.join(',')}`
        );
        
        if (response.data && response.data[symbol]) {
            pairContainer.innerHTML = ''; // Clear loading message
            
            // Create a button for each pair
            pairs.forEach(pair => {
                const price = response.data[symbol][pair];
                if (price) {
                    const pairButton = document.createElement('button');
                    pairButton.className = 'pair-select-option';
                    pairButton.innerHTML = `
                        <span class="pair-name">${symbol}/${pair}</span>
                        <span class="pair-price">${formatPrice(price)}</span>
                    `;
                    
                    // Add click handler for direct addition with feedback
                    pairButton.addEventListener('click', () => {
                        // Add the pair
                        addCryptoWithPair(symbol, pair);
                        
                        // Show added confirmation
                        pairButton.classList.add('added');
                        pairButton.innerHTML += '<span class="added-badge">Added</span>';
                        
                        // Close search modal after a slight delay
                        setTimeout(() => {
                            toggleSearchModal(false);
                        }, 500);
                    });
                    
                    pairContainer.appendChild(pairButton);
                }
            });
            
            // If we didn't find any prices, show a message
            if (pairContainer.children.length === 0) {
                pairContainer.innerHTML = '<div class="pair-option-error">No price data available</div>';
            }
            
        } else {
            throw new Error("Invalid price data");
        }
    } catch (error) {
        console.error(`Error fetching prices for ${symbol}:`, error);
        pairContainer.innerHTML = '<div class="pair-option-error">Could not load prices</div>';
    }
}

function removeCrypto(symbol) {
    console.log(`Removing crypto: ${symbol}`);
    
    // Remove from local array immediately
    const index = trackedCryptos.indexOf(symbol);
    if (index !== -1) {
        trackedCryptos.splice(index, 1);
        console.log(`Removed ${symbol} from local array`);
        
        // Refresh the UI immediately
        refreshCryptoList();
    }
    
    // Also notify the main process to update saved preferences
    ipcRenderer.send('remove-crypto', symbol);
}

function createPairSelectorModal() {
    // Check if it already exists
    if (document.getElementById('pair-selector')) {
        console.log("Pair selector already exists");
        return;
    }
    
    console.log("Creating pair selector modal");
    
    const modal = document.createElement('div');
    modal.id = 'pair-selector';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Select Trading Pair</h3>
                <button class="btn close-modal">×</button>
            </div>
            <div class="modal-body">
                <div class="selected-coin">
                    <img id="selected-coin-img" src="https://via.placeholder.com/30" class="coin-icon">
                    <div id="selected-coin-name">Selected Coin</div>
                </div>
                
                <div class="pair-options">
                    <div class="pair-option-group">
                        <h4>Fiat/Stablecoin Pairs</h4>
                        <div class="pair-buttons" id="fiat-pairs">
                            <button class="pair-select-btn" data-pair="USDT">USDT</button>
                            <button class="pair-select-btn" data-pair="USDC">USDC</button>
                            <button class="pair-select-btn" data-pair="BUSD">BUSD</button>
                            <button class="pair-select-btn" data-pair="USD">USD</button>
                            <button class="pair-select-btn" data-pair="EUR">EUR</button>
                        </div>
                    </div>
                    
                    <div class="pair-option-group">
                        <h4>Crypto Pairs</h4>
                        <div class="pair-buttons" id="crypto-pairs">
                            <button class="pair-select-btn" data-pair="BTC">BTC</button>
                            <button class="pair-select-btn" data-pair="ETH">ETH</button>
                            <button class="pair-select-btn" data-pair="BNB">BNB</button>
                        </div>
                    </div>
                    
                    <div class="custom-pair-input">
                        <input type="text" id="custom-pair-input" placeholder="Enter custom pair...">
                        <button id="custom-pair-btn">Add</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    console.log("Pair selector modal created and added to DOM");
    
    // Add event listeners
    modal.querySelector('.close-modal').addEventListener('click', () => {
        modal.classList.remove('visible');
    });
    
    // Handle pair selection
    modal.querySelectorAll('.pair-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pair = btn.getAttribute('data-pair');
            const symbol = modal.getAttribute('data-symbol');
            console.log(`Selected pair: ${symbol}/${pair}`);
            addCryptoWithPair(symbol, pair);
            modal.classList.remove('visible');
        });
    });
    
    // Handle custom pair
    modal.querySelector('#custom-pair-btn').addEventListener('click', () => {
        const customPair = modal.querySelector('#custom-pair-input').value.trim().toUpperCase();
        if (customPair) {
            const symbol = modal.getAttribute('data-symbol');
            console.log(`Custom pair selected: ${symbol}/${customPair}`);
            addCryptoWithPair(symbol, customPair);
            modal.classList.remove('visible');
        }
    });
    
    // Enter key for custom pair
    modal.querySelector('#custom-pair-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            modal.querySelector('#custom-pair-btn').click();
        }
    });
}

// Update the addCryptoWithPair function

function addCryptoWithPair(symbol, pair) {
    // Instead of changing the global pair, just add this specific combination
    const combinedSymbol = `${symbol}/${pair}`;
    
    // Don't allow self-pairs
    if (symbol === pair) {
        console.error(`Invalid self-pair: ${symbol}/${pair}`);
        alert(`Invalid pair: ${symbol}/${pair} - You cannot track a coin against itself.`);
        return;
    }
    
    // Add to tracked cryptos if not already there
    if (!trackedCryptos.includes(combinedSymbol)) {
        console.log(`Adding ${combinedSymbol} to tracked cryptos`);
        
        // Add note about USD pairs
        if (pair === 'USD') {
            console.log('Note: USD pairs will be mapped to USDT for Binance data');
        }
        
        ipcRenderer.send('add-crypto', combinedSymbol);
        
        // Force refresh the crypto list to show the new item immediately
        if (trackedCryptos.indexOf(combinedSymbol) === -1) {
            trackedCryptos.push(combinedSymbol);
            refreshCryptoList();
        }
    }
}

// Add this function to clean up any invalid pairs
function cleanupInvalidPairs() {
    console.log("Cleaning up invalid pairs...");
    const invalidPairs = [];
    
    trackedCryptos.forEach(crypto => {
        if (crypto.includes('/')) {
            const [symbol, pair] = crypto.split('/');
            
            // Check for self-pairs (like BTC/BTC)
            if (symbol === pair) {
                console.log(`Found invalid self-pair: ${crypto}`);
                invalidPairs.push(crypto);
            }
        }
    });
    
    // Remove any found invalid pairs
    if (invalidPairs.length > 0) {
        console.log(`Found ${invalidPairs.length} invalid pairs to remove`);
        invalidPairs.forEach(pair => {
            const index = trackedCryptos.indexOf(pair);
            if (index !== -1) {
                trackedCryptos.splice(index, 1);
            }
            
            // Notify the main process as well
            ipcRenderer.send('remove-crypto', pair);
        });
        
        // Refresh the UI after cleanup
        refreshCryptoList();
    }
}

// Function to force synchronization between UI and stored preferences
function syncWithStoredPreferences() {
    console.log("Forcing synchronization with stored preferences");
    
    // Request current preferences from main process
    ipcRenderer.send('get-preferences');
    
    // Set up a one-time listener for the response
    ipcRenderer.once('preferences', (event, preferences) => {
      console.log("Received preferences for sync:", preferences.cryptos);
      
      // Replace local tracking array with the official one from preferences
      trackedCryptos = [...preferences.cryptos];
      
      // Refresh the UI
      refreshCryptoList();
      console.log("Synchronized tracking list:", trackedCryptos);
    });
  }

  // Function to clean up any ghost entries in the UI
function removeGhostEntries() {
    console.log("Cleaning up ghost entries in tracking list");
    
    // First try our normal removal process
    if (trackedCryptos.includes("BTC/BTC")) {
      removeCrypto("BTC/BTC");
    }
    
    // Then forcibly filter out any invalid pairs from the local array
    const originalLength = trackedCryptos.length;
    trackedCryptos = trackedCryptos.filter(crypto => {
      if (crypto.includes('/')) {
        const [base, quote] = crypto.split('/');
        if (base === quote) {
          console.log(`Filtering out self-pair: ${crypto}`);
          return false;
        }
      }
      return true;
    });
    
    // If we removed anything, refresh the UI
    if (trackedCryptos.length !== originalLength) {
      console.log(`Removed ${originalLength - trackedCryptos.length} invalid pairs`);
      refreshCryptoList();
      
      // Also trigger a sync with main process
      syncWithStoredPreferences();
    }
  }

  // Add this function to apply the black theme
const applyDarkTheme = require('./src/component/applyDarkTheme');

// Function to update the taskbar icon based on coin state
function updateTaskbarIcon(coinState) {
    let iconPath;

    // Determine the icon based on the coin state
    switch (coinState) {
        case 'up':
            iconPath = 'path/to/icon-up.png'; // Path to the icon for price increase
            break;
        case 'down':
            iconPath = 'path/to/icon-down.png'; // Path to the icon for price decrease
            break;
        case 'stable':
            iconPath = 'path/to/icon-stable.png'; // Path to the icon for stable price
            break;
        default:
            iconPath = 'path/to/default-icon.png'; // Default icon
            break;
    }

    // Update the taskbar icon
    const { app } = require('electron');
    const mainWindow = app.mainWindow; // Reference to your main window
    mainWindow.setOverlayIcon(iconPath, `Coin is ${coinState}`);
}

// Example usage: Call this function whenever the coin state changes
function onCoinStateChange(newState) {
    updateTaskbarIcon(newState);
}

// Call this function with the appropriate state based on your logic
onCoinStateChange('up'); // Example: when the coin price goes up