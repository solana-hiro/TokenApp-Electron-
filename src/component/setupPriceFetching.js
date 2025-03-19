
function setupPriceFetching() {
    console.log("Setting up exchange waterfall price fetching system");
    
    // Clear any existing intervals and connections
    if (window.priceFetchInterval) {
        clearInterval(window.priceFetchInterval);
    }
    
    if (binanceSocket) {
        binanceSocket.close();
        binanceSocket = null;
    }
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    // Make sure we have the correct exchange order from preferences
    ipcRenderer.send('get-exchange-order');
    
    // Function to update prices for all tracked coins
    async function updateAllPrices() {
        // Update UI to show we're fetching
        updateConnectionStatus('fetching');
        
        const fetchPromises = [];
        const exchangeUse = {}; // Track which exchange was used for each coin
        
        // Process each tracked crypto
        for (const crypto of trackedCryptos) {
            let symbol, pair;
            
            if (crypto.includes('/')) {
                [symbol, pair] = crypto.split('/');
            } else {
                symbol = crypto;
                pair = currentPair;
            }
            
            // Skip self-pairs
            if (symbol === pair) continue;
            
            console.log(`Fetching price for ${symbol}/${pair} using waterfall model`);
            
            // Create a fetch promise for each crypto
            const fetchPromise = fetchPriceWithWaterfall(symbol, pair)
                .then(result => {
                    if (result) {
                        // Update UI with the price
                        updateCryptoPrice(`${symbol}/${pair}`, result.price, result.change, result.source);
                        
                        // Track which exchange was used
                        if (!exchangeUse[result.source]) {
                            exchangeUse[result.source] = [];
                        }
                        exchangeUse[result.source].push(`${symbol}/${pair}`);
                        
                        console.log(`${symbol}/${pair}: ${result.price} from ${result.source}`);
                    } else {
                        // Update UI to show no price available
                        const cryptoElement = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"]`);
                        if (cryptoElement) {
                            const priceElement = cryptoElement.querySelector('.crypto-price');
                            if (priceElement) {
                                priceElement.textContent = 'N/A';
                                priceElement.setAttribute('data-source', 'none');
                                priceElement.title = 'Price not available on any exchange';
                            }
                        }
                        console.log(`${symbol}/${pair}: No price available on any exchange`);
                    }
                })
                .catch(error => {
                    console.error(`Error fetching price for ${symbol}/${pair}:`, error);
                });
            
            fetchPromises.push(fetchPromise);
        }
        
        // Wait for all fetches to complete
        await Promise.allSettled(fetchPromises);
        
        // Log exchange usage summary
        console.log("Exchange usage summary:", exchangeUse);
        
        // Update connection status
        updateConnectionStatus('connected');
        
        // Return true to indicate successful update
        return true;
    }
    
    // Run immediately
    updateAllPrices().then(success => {
        if (success) {
            console.log("Initial price fetch complete");
        } else {
            console.error("Initial price fetch failed");
        }
    });
    
    // Then set up interval (every 15 seconds)
    window.priceFetchInterval = setInterval(updateAllPrices, 15000);
    
    // Add or update status indicator for exchange sources
    let statusIndicator = document.querySelector('.exchange-status-indicator');
    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.className = 'exchange-status-indicator';
        document.body.appendChild(statusIndicator);
    }
    
    statusIndicator.innerHTML = `
        <span class="status-icon">●</span>
        <span class="status-text">Connected</span>
    `;
    
    // Add tooltip to show all active exchanges
    statusIndicator.addEventListener('click', () => {
        const activeExchanges = Object.keys(priceCache)
            .map(key => `${key}: ${priceCache[key].source}`)
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort(); // Sort for readability
            
        alert(`Active price sources:\n${activeExchanges.join('\n')}`);
    });
}

function updateConnectionStatus(status) {
    const statusElement = document.querySelector('.exchange-status-indicator');
    if (!statusElement) return;
    
    const statusIcon = statusElement.querySelector('.status-icon');
    const statusText = statusElement.querySelector('.status-text');
    
    statusElement.className = `exchange-status-indicator status-${status}`;
    
    switch(status) {
        case 'connected':
            statusIcon.style.color = '#4caf50';
            statusText.textContent = 'Connected';
            break;
        case 'fetching':
            statusIcon.style.color = '#ff9800';
            statusText.textContent = 'Updating...';
            break;
        case 'disconnected':
            statusIcon.style.color = '#f44336';
            statusText.textContent = 'Offline';
            break;
        default:
            statusIcon.style.color = '#2196f3';
            statusText.textContent = 'Connecting...';
    }
}

module.exports = setupPriceFetching;