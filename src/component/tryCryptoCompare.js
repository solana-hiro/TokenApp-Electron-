
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

module.exports = tryCryptoCompare;