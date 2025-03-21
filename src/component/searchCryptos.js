const exchangesToFetch = ['binance', 'coinbase', 'kraken', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx'];
const addCryptoWithPair = require('./addCryptoWithPair');
const fs = require('fs');
const path = require('path');

// Function to read current data.json
function readDataJson() {
    try {
        const dataPath = path.join(__dirname, '..', '..', 'public', 'data.json');
        return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (error) {
        console.error('Error reading data.json:', error);
        return [];
    }
}

// Function to save to data.json
function saveToDataJson(data) {
    try {
        const dataPath = path.join(__dirname, '..', '..', 'public', 'data.json');
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing to data.json:', error);
        throw error;
    }
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
                        background-color: #292929;
                        max-height: 400px;
                        overflow-y: auto;
                        border-radius: 8px;
                        color: #fff;
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
                
                const volume = result.data.volume ? formatVolume(result.data.volume) : '0';
                const price = result.data.price.toFixed(result.data.price < 1 ? 6 : 2);
                
                const exchangeItemHTML = `
                    <div class="exchange-item">
                        <div class="token-info">
                            <img src="${imgUrl}" class="token-icon" onerror="this.src='https://via.placeholder.com/24'">
                            <div class="token-details">
                                <div class="exchange-name">${result.exchange.toUpperCase()}</div>
                                <div>
                                    <span class="token-symbol">${symbol}</span>
                                    <span class="token-pair">/USDT</span>
                                </div>
                                <div class="token-volume">${volume}</div>
                            </div>
                        </div>
                        <div class="token-price-container">
                            <div class="token-price">≈$${price}</div>
                            <div class="price-change">${result.data.change ? result.data.change.toFixed(2) + '%' : ''}</div>
                        </div>
                        <button class="add-btn" data-symbol="${symbol}" data-pair="USDT" data-exchange="${result.exchange}">Add</button>
                    </div>
                `;
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

                            if (exchange && exchange !== 'Global') {
                                await addCryptoWithExchange(symbol, pair, exchange);
                                
                                // Store preferred exchange
                                localStorage.setItem(`preferred_exchange_${symbol}/${pair}`, exchange);
                            } else {
                                await addCryptoWithPair(symbol, pair);
                            }

                            // Update button to show success
                            btn.textContent = 'Added ✓';
                            btn.style.backgroundColor = '#1f4442';

                            // Create and add new crypto element to main screen
                            const cryptoContainer = document.querySelector('.crypto-list');
                            if (cryptoContainer) {
                                const newCryptoElement = document.createElement('div');
                                newCryptoElement.className = 'crypto-item';
                                newCryptoElement.setAttribute('data-symbol', symbol);
                                newCryptoElement.setAttribute('data-pair', pair);

                                let imgUrl = 'https://via.placeholder.com/24';
                                if (coin && coin.ImageUrl) {
                                    imgUrl = `https://www.cryptocompare.com${coin.ImageUrl}`;
                                }
                                
                                newCryptoElement.innerHTML = `
                                    <div class="crypto-info">
                                        <img src="${imgUrl}" class="crypto-icon" onerror="this.src='https://via.placeholder.com/24'">
                                        <div class="crypto-details">
                                            <div class="crypto-symbol">${symbol}</div>
                                            <div class="crypto-exchange">${exchange.toUpperCase()}</div>
                                        </div>
                                    </div>
                                    <div class="crypto-price">Loading...</div>
                                `;
                                cryptoContainer.insertBefore(newCryptoElement, cryptoContainer.firstChild);

                                // Trigger price update if available
                                if (window.updatePrices) {
                                    window.updatePrices();
                                }
                            }

                            // Close modal after delay
                            setTimeout(() => {
                                toggleSearchModal(false);
                            }, 500);

                        } catch (error) {
                            console.error('Error adding cryptocurrency:', error);
                            btn.textContent = 'Error';
                            btn.style.backgroundColor = '#3a1a1a';
                            btn.style.color = '#ff4444';
                            
                            // Reset button after delay
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

async function fetchExchangePricesForSymbol(symbol) {
    const results = [];
    
    for (const exchange of exchangesToFetch) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            const result = await fetchPriceFromExchange(exchange, symbol, 'USDT', controller.signal);
            clearTimeout(timeoutId);
            
            if (result && result.price) {
                results.push({
                    exchange,
                    pair: 'USDT',
                    data: result,
                    success: true
                });
            } else {
                results.push({
                    exchange,
                    success: false
                });
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