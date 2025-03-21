const tryCryptoCompare = require('./tryCryptoCompare');
const alternativeExchanges = [
    'coinex', 'bitfinex', 'ascendex', 'bitstamp', 'poloniex', 'huobi', 'gemini'
  ]; // Additional exchanges to try for rare pairs
const supportHistory = {}; // Tracks success/failure history for each exchange/pair
const API_TIMEOUT = 5000;         // Timeout for API calls

const FAILURE_THRESHOLD = 2; // Number of failures before marking as problematic
const EXCHANGES_SUCCESS_WEIGHT = 3;  // How much to prioritize successful exchanges
const EXCHANGES_FAILURE_PENALTY = 1; // Penalty for failed exchanges
const MAX_RETRY_EXCHANGES = 7;    // Maximum number of exchanges to try before falling back

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

module.exports = fetchPriceWithWaterfall;