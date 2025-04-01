const exchangesToFetch = ['binance', 'coinbase', 'kraken', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx'];
const addCryptoWithPair = require('./addCryptoWithPair');
const fs = require('fs');
const path = require('path');

async function getDataPath() {
    const userDataPath = await ipcRenderer.invoke('get-user-data-path');
    return path.join(userDataPath, 'data.json');
}

// Main search function - triggered from the input in widget.html
function searchCryptos(query) {
    const searchResults = document.getElementById('search-results');
    const exchangeResultsContainer = document.getElementById('exchange-results-container');
    const statusEl = document.getElementById('search-status');
    
    if (!query || query.length < 1) {
        searchResults.innerHTML = '';
        exchangeResultsContainer.style.display = 'none';
        if (statusEl) statusEl.textContent = "Enter at least 1 character to search";
        return;
    }
    
    if (!cryptoList || Object.keys(cryptoList).length === 0) {
        cryptoList = fallbackCoins;
    }
    
    query = query.toLowerCase().trim();
    if (statusEl) statusEl.textContent = `Searching for "${query}"...`;
    
    exchangeResultsContainer.style.display = 'block';
    exchangeResultsContainer.innerHTML = '';
    
    try {
        // Find exact match only
        const matches = [];
        
        for (const symbol of Object.keys(cryptoList)) {
            const symbolLower = symbol.toLowerCase();
            
            // Only add exact matches
            if (symbolLower === query) {
                matches.push(symbol);
                break; // Stop after finding exact match
            }
        }

        if (matches.length === 0) {
            if (statusEl) statusEl.textContent = `No results found for "${query}"`;
            exchangeResultsContainer.innerHTML = '<div class="search-no-results">No results found</div>';
        } else {
            if (statusEl) statusEl.textContent = `Found match for "${query}"`;
            
            // Add CSS if not already added
            if (!document.getElementById('exchange-styles')) {
                const style = document.createElement('style');
                style.id = 'exchange-styles';
                style.textContent = `
                .exchange-results-container {
                    height: calc(100vh - 200px); /* Full height minus 100px */
                    overflow-y: auto;
                    border-radius: 8px;
                    color: #fff;
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    z-index: 1000;
                    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
                }
                    .exchange-item {
                        display: flex;
                        align-items: center;
                        padding: 12px 16px;
                        border-bottom: 1px solid #383838;
                    }
                    .exchange-name {
                        font-size: 12px;
                        color: #999;
                        margin-bottom: 4px;
                    }
                    .token-info {
                        display: flex;
                        align-items: center;
                        margin-right: 30px;
                    }
                    .token-icon {
                        width: 24px;
                        height: 24px;
                        border-radius: 50%;
                        margin-right: 12px;
                    }
                    .token-details {
                        flex: 1;
                    }
                    .token-symbol {
                        font-weight: bold;
                        font-size: 16px;
                        color: #fff;
                    }
                    .token-pair {
                        font-size: 12px;
                        color: #999;
                        margin-left: 3px;
                    }
                    .token-volume {
                        font-size: 12px;
                        color: #999;
                        margin-top: 2px;
                    }
                    .token-price-container {
                        display: flex;
                        flex-direction: column;
                        align-items: flex-end;
                        margin-right: 8px;
                    }
                    .token-price {
                        font-size: 16px;
                        font-weight: medium;
                        color: #fff;
                    }
                    .price-change {
                        font-size: 12px;
                        color: #999;
                    }
                    .add-btn {
                        background-color: #1a3a39;
                        color: #35b3a5;
                        border: 1px solid #35b3a5;
                        border-radius: 16px;
                        padding: 6px 18px;
                        font-size: 14px;
                        cursor: pointer;
                        transition: all 0.2s;
                    }
                    .add-btn:hover {
                        background-color: #1f4442;
                    }
                    .add-btn:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    .token-section {
                        margin-bottom: 20px;
                    }
                `;
                document.head.appendChild(style);
            }
            
            displayAllExchangeData(matches, exchangeResultsContainer);
        }
        
    } catch (error) {
        exchangeResultsContainer.innerHTML = '<div class="search-no-results">Search error. Please try again.</div>';
        if (statusEl) statusEl.textContent = `Error: ${error.message || "Search failed"}`;
    }
}

async function addCryptoWithExchange(symbol, pair, exchange) {
    const combinedSymbol = `${symbol}/${pair}`;
    
    // Don't allow self-pairs
    if (symbol === pair) {
        throw new Error(`Invalid self-pair: ${symbol}/${pair}`);
    }
    
    // Add to tracked cryptos if not already there
    if (!trackedCryptos.includes(combinedSymbol)) {
        console.log(`Adding ${combinedSymbol} to tracked cryptos with exchange ${exchange}`);
        
        // Add note about USD pairs
        if (pair === 'USD') {
            console.log('Note: USD pairs will be mapped to USDT for Binance data');
        }
        
        // Add to beginning of array
        trackedCryptos.unshift(combinedSymbol);
        
        // Store the preferred exchange
        localStorage.setItem(`preferred_exchange_${combinedSymbol}`, exchange);
        
        // Notify main process
        ipcRenderer.send('add-crypto', combinedSymbol);
        
        // Refresh the crypto list
        refreshCryptoList();
    }
    
    return combinedSymbol;
}

async function displayAllExchangeData(symbols, container) {
    const dataPath = await getDataPath();
    let currentData = [];
    try {
        currentData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (error) {
        console.error('Error reading data.json:', error);
    }
    
    for (const symbol of symbols) {
        const tokenSection = document.createElement('div');
        tokenSection.className = 'token-section';
        tokenSection.innerHTML = `
            <div class="token-exchanges-${symbol}">
                <div class="exchange-loading">Loading exchange data...</div>
            </div>
        `;
        container.appendChild(tokenSection);
        
        const coin = cryptoList[symbol] || fallbackCoins[symbol];
        const exchangeList = tokenSection.querySelector(`.token-exchanges-${symbol}`);
        exchangeList.innerHTML = '';
        
        const exchangeResults = await fetchExchangePricesForSymbol(symbol);
        
        const allResults = [];
        
        exchangeResults.forEach(result => {
            if (result.success && result.data && result.data.price) {
                allResults.push(result);
            }
        });

        if (allResults.length === 0) {
            exchangeList.innerHTML = '<div class="no-exchange-data">No exchange data available</div>';
        } else {
            allResults.sort((a, b) => {
                const volumeA = a.data.volume || 0;
                const volumeB = b.data.volume || 0;
                return volumeB - volumeA;
            });

            allResults.forEach(result => {
                let imgUrl = 'https://via.placeholder.com/24';
                if (coin && coin.ImageUrl) {
                    imgUrl = `https://www.cryptocompare.com${coin.ImageUrl}`;
                }
                const volume = result.data.volume ? formatVolume(result.data.volume, result.pair) : (result.pair === 'BTC' ? '₿0' : '$0');
                const price = `${result.data.price.toFixed(2)}`;
                // Check if this symbol is already added
                const isAdded = currentData.some(item => 
                    item.Symbol === symbol && 
                    item.exchange === result.exchange &&
                    item.Pair === result.pair
                );
        
                const buttonText = isAdded ? 'Added ✓' : 'Add';
                const buttonStyle = isAdded ? 
                    'background-color: #1f4442; color: #35b3a5; cursor: not-allowed;' : 
                    'background-color: #1a3a39; color: #35b3a5;';
                
                const exchangeItemHTML = `
                    <div class="exchange-item">
                        <div class="token-info">
                            <img src="${imgUrl}" class="token-icon" onerror="this.src='https://via.placeholder.com/24'">
                            <div class="token-details">
                                <div class="exchange-name">${result.exchange.toUpperCase()}</div>
                                <div>
                                    <span class="token-symbol">${symbol}</span>
                                    <span class="token-pair">/${result.pair}</span>
                                </div>
                                <div class="token-volume">${volume}</div>
                            </div>
                        </div>
                        <div class="token-price-container">
                            <div class="token-price">≈${price}</div>
                            <div class="price-change ${result.data.change > 0 ? 'up' : result.data.change < 0 ? 'down' : ''}">${formatPriceChange(result.data.change)}</div>
                        </div>
                        <button class="add-btn" 
                            data-symbol="${symbol}" 
                            data-pair="${result.pair}" 
                            data-exchange="${result.exchange}"
                            ${isAdded ? 'disabled' : ''}
                            style="${buttonStyle}">
                            ${buttonText}
                        </button>
                    </div>`;
                exchangeList.insertAdjacentHTML('beforeend', exchangeItemHTML);
            });

            // Add event listeners for Add buttons
            const addButtons = exchangeList.querySelectorAll('.add-btn');
            addButtons.forEach(btn => {
                btn.addEventListener('click', async () => {
                    const symbol = btn.dataset.symbol;
                    const pair = btn.dataset.pair;
                    const exchange = btn.dataset.exchange;
                    
                    if (symbol && pair) {
                        try {
                            // Disable button and show loading state
                            btn.disabled = true;
                            btn.textContent = 'Adding...';
            
                            // Read current data.json
                            const dataPath = await getDataPath();
                            let currentData = [];
                            try {
                                currentData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                            } catch (error) {
                                console.error('Error reading data.json:', error);
                            }
            
                            // Create new token data
                            const newToken = {
                                "CoinName": coin?.CoinName || symbol,
                                "Symbol": symbol,
                                "Pair":pair,
                                "ImageUrl": coin?.ImageUrl || "/placeholder.png",
                                "exchange": exchange
                            };
            
                            // Add to beginning of array if not already exists
                            if (!currentData.some(item => item.Symbol === symbol && item.exchange === exchange && item.Pair === pair)) {
                                currentData.unshift(newToken);
                                
                                // Write back to data.json
                                fs.writeFileSync(dataPath, JSON.stringify(currentData, null, 2));
                            }
                            if (exchange && exchange !== 'Global') {
                                await addCryptoWithExchange(symbol, pair, exchange);
                                localStorage.setItem(`preferred_exchange_${symbol}/${pair}`, exchange);
                            } else {
                                await addCryptoWithPair(symbol, pair);
                            }
            
                            // Update button to show success
                            btn.textContent = 'Added ✓';
                            btn.style.backgroundColor = '#1f4442';
            
                            await refreshCryptoList();
            
                            setTimeout(() => {
                                toggleSearchModal(false);
                            }, 500);
            
                        } catch (error) {
                            console.error('Error adding cryptocurrency:', error);
                            btn.textContent = 'Error';
                            btn.style.backgroundColor = '#3a1a1a';
                            btn.style.color = '#ff4444';
                            
                            setTimeout(() => {
                                btn.disabled = false;
                                btn.textContent = 'Add';
                                btn.style.backgroundColor = '#1a3a39';
                                btn.style.color = '#35b3a5';
                            }, 2000);
                        }
                    }
                });
            });
        }
    }
    
    const statusEl = document.getElementById('search-status');
    if (statusEl) statusEl.textContent = `Displaying exchange data for ${symbols.length} tokens`;
}

function formatPriceChange(change) {
    if (!change && change !== 0) return '';
    
    const numChange = parseFloat(change);
    if (isNaN(numChange)) return '';
    
    // Handle extreme values
    if (numChange > 999999) return '>999999%';
    if (numChange < -999999) return '<-999999%';
    
    // Add plus sign for positive values
    const sign = numChange > 0 ? '+' : '';
    
    // Determine decimal places based on magnitude
    let decimals;
    const absChange = Math.abs(numChange);
    if (absChange >= 100) {
        decimals = 1;  // 123.4%
    } else if (absChange >= 10) {
        decimals = 2;  // 12.34%
    } else {
        decimals = 2;  // 1.23%
    }
    
    return `${sign}${numChange.toFixed(decimals)}%`;
}

async function fetchExchangePricesForSymbol(symbol) {
    const results = [];
    
    for (const exchange of exchangesToFetch) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const pairs = ['USDT', 'USDC', 'BTC'];

            for (const pair of pairs) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    
                    const result = await fetchPriceFromExchange(exchange, symbol, pair, controller.signal);
                    clearTimeout(timeoutId);
                    
                    if (result && result.price) {
                        results.push({
                            exchange,
                            pair,
                            data: result,
                            success: true
                        });
                    } else {
                        results.push({
                            exchange,
                            pair,
                            success: false
                        });
                    }
                } catch (error) {
                    results.push({
                        exchange,
                        pair,
                        success: false
                    });
                }
            }
        } catch (error) {
            results.push({
                exchange,
                success: false
            });
        }
    }
    
    return results;
}

function initializeSearch() {
    const searchInput = document.getElementById('search-input');
    const clearButton = document.getElementById('clear-search');
    
    if (searchInput && clearButton) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query === '') {
                clearButton.style.display = 'none';
                document.getElementById('search-results').innerHTML = '';
                document.getElementById('exchange-results-container').style.display = 'none';
            } else {
                clearButton.style.display = 'block';
                searchCryptos(query);
            }
        });
        
        clearButton.addEventListener('click', () => {
            searchInput.value = '';
            clearButton.style.display = 'none';
            document.getElementById('search-results').innerHTML = '';
            document.getElementById('exchange-results-container').style.display = 'none';
            searchInput.focus();
        });
    }
}

module.exports = {
    searchCryptos,
    initializeSearch
};