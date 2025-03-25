const addCryptoWithPair = require('./addCryptoWithPair');
const alternativeExchanges = [
    'coinex', 'bitfinex', 'ascendex', 'bitstamp', 'poloniex', 'huobi', 'gemini'
  ]; // Additional exchanges to try for rare pairs
function handleSearch() {
    const query = document.getElementById('search-input').value.trim();
    const resultsContainer = document.getElementById('search-results');
    
    // Hide exchange comparison section when searching
    document.getElementById('exchange-comparison').style.display = 'none';
    
    if (query.length < 2) {
        resultsContainer.innerHTML = '<div class="search-no-results">Enter at least 2 characters to search</div>';
        return;
    }
    
    // Show loading state
    resultsContainer.innerHTML = '<div class="search-loading">Searching cryptocurrencies...</div>';
    
    // Filter cryptoList by the search query
    const results = Object.keys(cryptoList)
        .filter(symbol => {
            const coinInfo = cryptoList[symbol];
            const coinName = coinInfo.CoinName ? coinInfo.CoinName.toLowerCase() : '';
            return symbol.toLowerCase().includes(query.toLowerCase()) || 
                   coinName.includes(query.toLowerCase());
        })
        .slice(0, 20); // Limit to 20 results
    
    // Update the results
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-no-results">No cryptocurrencies found</div>';
    } else {
        resultsContainer.innerHTML = '';
        
        results.forEach(symbol => {
            const coin = cryptoList[symbol];
            const coinName = coin.CoinName || 'Unknown';
            const imageUrl = coin.ImageUrl ? 
                `https://www.cryptocompare.com${coin.ImageUrl}` : 
                'https://www.cryptocompare.com/media/37746251/empty.png';
            
            const item = document.createElement('div');
            item.className = 'search-item';
            item.innerHTML = `
                <img src="${imageUrl}" class="search-item-icon" onerror="this.src='https://www.cryptocompare.com/media/37746251/empty.png'">
                <div class="search-item-details">
                    <div class="search-item-symbol">${symbol}</div>
                    <div class="search-item-name">${coinName}</div>
                </div>
            `;
            
            // Add click handler to show exchange comparison
            item.addEventListener('click', () => {
                showExchangeComparison(symbol);
            });
            
            resultsContainer.appendChild(item);
        });
    }
}

// Add this new function to show exchange comparison in the search modal
async function showExchangeComparison(symbol) {
    console.log(`Showing exchange comparison for ${symbol}`);
    
    // Hide search results and show comparison section
    document.getElementById('search-results').style.display = 'none';
    const comparisonSection = document.getElementById('exchange-comparison');
    comparisonSection.style.display = 'block';
    
    // Set the title
    document.getElementById('comparison-title').textContent = `${symbol} - Exchange Comparison`;
    
    // Show loading indicator
    document.querySelector('.comparison-loading').style.display = 'block';
    document.getElementById('exchange-comparison-table').style.display = 'none';
    
    // Fetch exchange data
    try {
        // Get common trading pairs for this symbol
        const commonPairs = ['USDT', 'USD', 'BTC', 'ETH'];
        const exchanges = await fetchMultiExchangeData(symbol, commonPairs);
        
        // Hide loading indicator
        document.querySelector('.comparison-loading').style.display = 'none';
        document.getElementById('exchange-comparison-table').style.display = 'table';
        
        // Display results
        displayExchangeComparison(exchanges, symbol);
    } catch (error) {
        console.error('Error fetching exchange data:', error);
        document.getElementById('exchange-comparison-body').innerHTML = 
            `<tr><td colspan="5" class="error-message">Error loading exchange data: ${error.message}</td></tr>`;
        document.querySelector('.comparison-loading').style.display = 'none';
        document.getElementById('exchange-comparison-table').style.display = 'table';
    }
    
    // Add back button handler
    document.getElementById('back-to-search').addEventListener('click', () => {
        document.getElementById('search-results').style.display = 'block';
        document.getElementById('exchange-comparison').style.display = 'none';
    });
}

async function showExchangeComparison(symbol, pair) {
    console.log(`Showing exchange comparison for ${symbol}/${pair}`);
    
    // Show the modal
    const modal = document.getElementById('exchange-comparison-modal');
    modal.style.display = 'block';
    
    // Set the title
    document.getElementById('comparison-title').textContent = `${symbol}/${pair} - Exchange Comparison`;
    
    // Show loading indicator
    document.getElementById('exchange-comparison-body').innerHTML = '';
    document.querySelector('.comparison-loading').style.display = 'block';
    
    // Close button handler
    modal.querySelector('.close-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // Fetch exchange data
    try {
        // First try to get data from CoinGecko which provides market data across exchanges
        const exchanges = await fetchExchangeDataForPair(symbol, pair);
        
        // Hide loading indicator
        document.querySelector('.comparison-loading').style.display = 'none';
        
        // Display results
        displayExchangeComparison(exchanges, symbol, pair);
        
        // Set up sorting
        setupExchangeSorting();
    } catch (error) {
        console.error('Error fetching exchange data:', error);
        document.getElementById('exchange-comparison-body').innerHTML = 
            `<tr><td colspan="5" class="error-message">Error loading exchange data: ${error.message}</td></tr>`;
        document.querySelector('.comparison-loading').style.display = 'none';
    }
}

// Function to fetch exchange data for a specific pair
async function fetchExchangeDataForPair(symbol, pair) {
    // Normalize symbols for API compatibility
    const geckoSymbol = symbol.toLowerCase();
    const geckoPair = pair.toLowerCase();
    
    // Try CoinGecko first
    try {
        // Map common symbols to CoinGecko IDs
        const symbolMap = {
            'btc': 'bitcoin',
            'eth': 'ethereum',
            'sol': 'solana',
            'ada': 'cardano',
            'doge': 'dogecoin',
            'dot': 'polkadot',
            'bnb': 'binancecoin',
            'xrp': 'ripple',
            'usdt': 'tether',
            'usdc': 'usd-coin',
        };
        
        const coinId = symbolMap[geckoSymbol] || geckoSymbol;
        
        // Get tickers from CoinGecko
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${coinId}/tickers`,
            { timeout: 10000 }
        );
        
        if (response.data && response.data.tickers) {
            for (const ticker of response.data.tickers) {
                const performance = await fetch24hPerformance(symbol, ticker.market.name);
                
                allResults.push({
                    exchange: ticker.market.name,
                    pair: ticker.target,
                    volume: ticker.converted_volume.usd || 0,
                    price: ticker.last,
                    base: symbol,
                    performance: performance // Add performance data
                });
            }
        }
    } catch (geckoError) {
        console.error('CoinGecko API error:', geckoError);
    }
    
    // Fallback to manually querying major exchanges
    try {
        const exchanges = [...EXCHANGES, ...alternativeExchanges];
        const exchangeData = [];
        
        // Query each exchange for the pair's data
        for (const exchange of exchanges) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
                
                const result = await fetchPriceFromExchange(exchange, symbol, pair, controller.signal);
                clearTimeout(timeoutId);
                
                if (result && result.price && result.volume) {
                    exchangeData.push({
                        exchange: exchange.charAt(0).toUpperCase() + exchange.slice(1), // Capitalize
                        pair: `${symbol}/${pair}`,
                        volume: result.volume,
                        price: result.price,
                        volumeFormatted: formatVolume(result.volume),
                        pairKey: `${symbol}/${pair}`
                    });
                }
            } catch (error) {
                console.log(`Could not fetch ${symbol}/${pair} from ${exchange}`);
            }
        }
        
        // Sort by volume
        exchangeData.sort((a, b) => b.volume - a.volume);
        
        return exchangeData;
    } catch (error) {
        throw new Error(`Could not fetch exchange data: ${error.message}`);
    }
}

async function fetch24hPerformance(symbol, exchange) {
    try {
        // Get 24h ago timestamp
        const now = Math.floor(Date.now() / 1000);
        const yesterday = now - (24 * 60 * 60);
        
        const response = await axios.get(`https://min-api.cryptocompare.com/data/v2/histohour`, {
            params: {
                fsym: symbol,
                tsym: 'USDT',
                limit: 24,
                toTs: now
            }
        });

        if (response.data?.Data?.Data) {
            const historicalData = response.data.Data.Data;
            if (historicalData.length >= 24) {
                const oldPrice = historicalData[0].close;
                const currentPrice = historicalData[historicalData.length - 1].close;
                
                // Calculate percentage change
                const percentChange = ((currentPrice - oldPrice) / oldPrice) * 100;
                
                // Limit to reasonable range (-100% to +1000%)
                return Math.max(Math.min(percentChange, 1000), -100).toFixed(2);
            }
        }
        return null;
    } catch (error) {
        console.error('Error fetching 24h performance:', error);
        return null;
    }
}
// Display exchange comparison results
function displayExchangeComparison(exchanges, symbol, pair) {
    const tbody = document.getElementById('exchange-comparison-body');
    
    if (exchanges.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5">No exchange data found for ${symbol}/${pair}</td></tr>`;
        return;
    }
    
    // Build the table rows
    let html = '';
    exchanges.forEach(ex => {
        html += `
            <tr data-volume="${ex.volume}">
                <td>${ex.exchange}</td>
                <td>${ex.pair}</td>
                <td>${ex.volumeFormatted}</td>
                <td>$${parseFloat(ex.price).toFixed(6)}</td>
                <td>
                    <button class="add-pair-btn" 
                            data-symbol="${symbol}" 
                            data-pair="${ex.pair.split('/')[1]}">
                        Add
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    // Add event listeners for the Add buttons
    tbody.querySelectorAll('.add-pair-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const symbol = e.target.getAttribute('data-symbol');
            const pair = e.target.getAttribute('data-pair');
            addCryptoWithPair(symbol, pair);
            document.getElementById('exchange-comparison-modal').style.display = 'none';
        });
    });
}

// Set up sorting for the exchange comparison table
function setupExchangeSorting() {
    document.querySelector('.volume-header').addEventListener('click', () => {
        const table = document.getElementById('exchange-comparison-table');
        const tbody = document.getElementById('exchange-comparison-body');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        
        // Sort rows by volume
        rows.sort((a, b) => {
            const volumeA = parseFloat(a.getAttribute('data-volume')) || 0;
            const volumeB = parseFloat(b.getAttribute('data-volume')) || 0;
            return volumeB - volumeA; // Descending order
        });
        
        // Re-add rows in sorted order
        rows.forEach(row => tbody.appendChild(row));
    });
}

// Function to fetch exchange data for multiple pairs
async function fetchMultiExchangeData(symbol, pairs) {
    // Initialize results array
    const allResults = [];
    
    // Fetch data from CoinGecko first for comprehensive exchange data
    try {
        // Map common symbols to CoinGecko IDs
        const symbolMap = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'SOL': 'solana',
            'ADA': 'cardano',
            'DOGE': 'dogecoin',
            'DOT': 'polkadot',
            'BNB': 'binancecoin',
            'XRP': 'ripple',
            'USDT': 'tether',
            'USDC': 'usd-coin',
            // Add more mappings as needed
        };
        
        const coinId = symbolMap[symbol] || symbol.toLowerCase();
        
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${coinId}/tickers`, 
            { timeout: 10000 }
        );
        
        if (response.data && response.data.tickers) {
            response.data.tickers.forEach(ticker => {
                allResults.push({
                    exchange: ticker.market.name,
                    pair: ticker.target,
                    volume: ticker.converted_volume.usd || 0,
                    price: ticker.last,
                    base: symbol
                });
            });
        }
    } catch (error) {
        console.log('CoinGecko API error, falling back to direct exchange APIs');
    }
    
    // If CoinGecko didn't return data, fall back to querying exchanges directly
    if (allResults.length === 0) {
        // Use the EXCHANGES array defined earlier
        const exchanges = ['binance', 'coinbase', 'kraken', 'okx', 'bybit', 'kucoin', 'gate', 'mexc'];
        
        // For each exchange and pair combination, try to fetch data
        for (const exchange of exchanges) {
            for (const pair of pairs) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    
                    const result = await fetchPriceFromExchange(exchange, symbol, pair, controller.signal);
                    clearTimeout(timeoutId);
                    
                    if (result && result.price) {
                        allResults.push({
                            exchange: exchange.charAt(0).toUpperCase() + exchange.slice(1),
                            pair: pair,
                            volume: result.volume || 0,
                            price: result.price,
                            base: symbol
                        });
                    }
                } catch (error) {
                    console.log(`Could not fetch ${symbol}/${pair} from ${exchange}`);
                }
            }
        }
    }
    
    // Sort results by volume (descending)
    allResults.sort((a, b) => b.volume - a.volume);
    
    return allResults;
}

// Display exchange comparison results in the search modal
function displayExchangeComparison(exchanges, symbol) {
    const tbody = document.getElementById('exchange-comparison-body');
    
    if (exchanges.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5">No exchange data found for ${symbol}</td></tr>`;
        return;
    }
    
    // Build the table rows
    let html = '';
    exchanges.forEach(ex => {
        html += `
            <tr>
                <td>${ex.exchange}</td>
                <td>${symbol}/${ex.pair}</td>
                <td>${formatVolume(ex.volume)}</td>
                <td>$${parseFloat(ex.price).toFixed(6)}</td>
                <td>
                    <button class="add-exchange-btn" 
                            data-symbol="${symbol}" 
                            data-pair="${ex.pair}"
                            data-exchange="${ex.exchange}">
                        Add
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    // Add event listeners for the Add buttons
    tbody.querySelectorAll('.add-exchange-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const symbol = e.target.getAttribute('data-symbol');
            const pair = e.target.getAttribute('data-pair');
            const exchange = e.target.getAttribute('data-exchange');
            
            // Add this pair and close the modal
            addCryptoWithPair(symbol, pair);
            
            // Store the preferred exchange for this pair
            const key = `${symbol}/${pair}`;
            localStorage.setItem(`preferred_exchange_${key}`, exchange);
            
            // Show a toast notification
            showToast(`Added ${symbol}/${pair} from ${exchange}`);
            
            // Optional: close the search modal
            // document.getElementById('search-modal').style.display = 'none';
        });
    });
}


module.exports = handleSearch;