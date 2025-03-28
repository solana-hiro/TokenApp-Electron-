const { ipcRenderer } = require('electron');
const axios = require('axios');

let currentPair = 'USDT';
let lastPrices = {};
let cryptoList = {};
let decimalPlacesMode = 'auto';
// Add these variables at the top with your other global variables
const EXCHANGES = ['binance', 'coinbase', 'kraken', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx'];
const supportedPairsCache = {}; // Format: {exchange: {symbolPair: true}}
const priceCache = {}; // Format: {symbol/pair: {price: number, source: string, timestamp: number}}
const CACHE_EXPIRY = 60 * 1000; // 60 seconds cache expiry
let selectedToken = null;

const createPairSelectorModal = require('./src/component/createPairSelectorModal');
let currentTheme = localStorage.getItem('theme') || 'light';
const fallbackCoins = require('./src/utils/fallbackCoins');
const showToast = require('./src/component/toast');
const displayEmbeddedChart = require('./src/component/displayEmbeddedChart');

const searchCryptos = require('./src/component/searchCryptos');
const initDragAndDrop = require('./src/component/initDragAndDrop');
const fs = require('fs');
const path = require('path');

const { initializeSearch } = require('./src/component/searchCryptos');
const setupEventListeners = require('./src/component/setupEventListeners');

const applyDarkTheme = require('./src/component/applyDarkTheme');

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

document.addEventListener('DOMContentLoaded', async () => {
    initializeTheme();
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTheme(btn.dataset.theme);
        });
    });
    initializeSearch();

    const addCryptoBtn = document.getElementById('add-crypto');
    if (addCryptoBtn) {
        addCryptoBtn.addEventListener('click', () => {
            toggleSearchModal(true);
            setTimeout(() => {
                const searchInput = document.getElementById('search-input');
                if (searchInput) searchInput.focus();
            }, 100);
        });
    }
    
    // Handle close search modal
    const closeSearchBtn = document.getElementById('close-search-modal');
    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            toggleSearchModal(false);
        });
    }

    
    // Set up all event listeners properly
    setupEventListeners();
    applyDarkTheme();

    // Get saved preferences
    ipcRenderer.send('get-preferences');
    
    // Create pair selector modal
    createPairSelectorModal();
    
    // Load cryptocurrency list for search immediately
    await loadCryptoList();
    // removeGhostEntries();
    
    cleanupInvalidPairs();
    // Setup Binance WebSocket
    setupBinanceWebSocket();
    
    // Add volume tracking
    addVolumeTracking();
    
    // Setup sorting controls - THIS IS THE CRITICAL LINE
    setupSortingControls();
    initializeChartArea();
    refreshCryptoList(); 
    console.log("Initialization complete");

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
                            
                            if (statsResp.data && statsResp.data.stats) {  // Changed from data.data to data.stats
                                const open = parseFloat(statsResp.data.stats.open);  // Changed from data.data.open
                                const last = parseFloat(resp.data.data.amount);
                                change = ((last - open) / open) * 100;
                                volume = parseFloat(statsResp.data.stats.volume) || 0;  // Changed from data.data.volume
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

function initializeChartArea() {
    const chartArea = document.querySelector('.chart-area');
    if (!chartArea) return;

    // Clear existing content and set up the structure
    chartArea.innerHTML = `
        <div class="chart-header">
            <div class="chart-title">Select a cryptocurrency</div>
        </div>
        <canvas class="price-chart"></canvas>
    `;

    // Add event listeners for minimize and close buttons
    const minimizeBtn = chartArea.querySelector('.chart-minimize');
    const closeBtn = chartArea.querySelector('.chart-close');

    minimizeBtn?.addEventListener('click', () => {
        chartArea.classList.toggle('minimized');
    });

    closeBtn?.addEventListener('click', () => {
        chartArea.classList.remove('visible');
    });
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

function formatVolume(volume, quote = 'USDT') {
    if (volume === undefined || volume === null || isNaN(volume)) {
        return 'N/A';
    }
    
    const numVolume = parseFloat(volume);
    
    // Handle BTC pairs differently
    if (quote === 'BTC') {
        if (numVolume >= 1000) {
            return `₿${(numVolume / 1000).toFixed(2)}K`;
        } else if (numVolume >= 1) {
            return `₿${numVolume.toFixed(2)}`;
        } else {
            return `₿${numVolume.toFixed(8)}`;
        }
    }
    
    // Default USDT/USD formatting
    if (numVolume >= 1000000000) {
        return `$${(numVolume / 1000000000).toFixed(2)}B`;
    } else if (numVolume >= 1000000) {
        return `$${(numVolume / 1000000).toFixed(2)}M`;
    } else if (numVolume >= 1000) {
        return `$${(numVolume / 1000).toFixed(2)}K`;
    } else {
        return `$${numVolume.toFixed(2)}`;
    }
}

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
  });
  
// Error handling for IPC
ipcRenderer.on('error', (event, error) => {
console.error('IPC error:', error);
});



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
        });
    });
    
    console.log("Sort buttons configured successfully");
}

function formatChange(changePercent) {
    if (changePercent === undefined || changePercent === null || isNaN(changePercent)) {
        return '0.00%';
    }
    
    // Convert to number if it's a string
    const numChange = parseFloat(changePercent);
    
    // Add validation for extreme values
    if (numChange > 999999) {
        return '>999999%';
    } else if (numChange < -999999) {
        return '<-999999%';
    }
    
    // Determine number of decimal places based on the magnitude
    let decimalPlaces;
    const absChange = Math.abs(numChange);
    
    if (absChange >= 100) {
        numChange = numChange/100;
        decimalPlaces = 2; // Show only 1 decimal for large changes
    } else if (absChange >= 10) {
        decimalPlaces = 2; // Show 2 decimals for medium changes
    } else {
        decimalPlaces = 2; // Show 2 decimals for small changes
    }
    
    // Add plus sign for positive values, keep minus for negative
    
    const sign = numChange > 0 ? '+' : '';
    
    // Format with appropriate decimal places
    return `${sign}${numChange.toFixed(decimalPlaces)}%`;
}

// Also add the missing formatPrice function if you don't have it
function formatPrice(price, pair) {
    if (price === undefined || price === null || isNaN(price)) {
        return '-.--';
    }
    
    // Convert to number if it's a string
    const numPrice = parseFloat(price);
    
    // Determine appropriate decimal places based on price magnitude
    let decimalPlaces;
    
    if (decimalPlacesMode === 'auto') {
        if (numPrice >= 1000) {
            decimalPlaces = 2; // $1,000+: show 2 decimals
        } else if (numPrice >= 1) {
            decimalPlaces = 4; // $1-999: show 4 decimals
        } else {
            // For numbers less than 1, count zeros after decimal point
            const priceStr = numPrice.toString();
            const matchZeros = priceStr.match(/^0\.0*/);
            if (matchZeros) {
                // Count leading zeros after decimal and add 4 more digits
                decimalPlaces = matchZeros[0].length - 2 + 4;
            } else {
                decimalPlaces = 4;
            }
        }
    } else {
        // Fixed decimal places mode
        decimalPlaces = parseInt(decimalPlacesMode);
        if (isNaN(decimalPlaces)) decimalPlaces = 4; // Default to 4 if invalid
    }
    
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
    const isCurrentlyShown = searchModal.classList.contains('visible');
    
    // Determine if we should show or hide
    const shouldShow = forceShow === undefined ? !isCurrentlyShown : forceShow;
    
    if (shouldShow && !isCurrentlyShown) {
        // SHOW the modal
        console.log("Showing search modal");
        searchModal.style.display = 'block';
        // Use requestAnimationFrame to ensure display: block is applied before adding visible class
        requestAnimationFrame(() => {
            searchModal.classList.add('visible');
        });
        
        // Update status
        const statusEl = document.getElementById('search-status');
        if (statusEl) {
            if (!cryptoList || Object.keys(cryptoList).length === 0) {
                statusEl.textContent = "Loading coin data...";
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
        searchModal.classList.remove('visible');
        
        // Wait for animation to complete before hiding
        setTimeout(() => {
            if (!searchModal.classList.contains('visible')) {
                searchModal.style.display = 'none';
            }
        }, 300); // Match this with your CSS transition duration
        
        // Clear results
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.innerHTML = '';
        }
    }
}

function initSearchModalSwipe() {
    const searchModal = document.getElementById('search-modal');
    if (!searchModal) return;

    let startX = 0;
    let currentX = 0;

    searchModal.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
    });

    searchModal.addEventListener('touchmove', (e) => {
        currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        
        // Only allow right swipe to close
        if (diff > 0) {
            searchModal.style.right = `-${diff}px`;
            e.preventDefault();
        }
    });

    searchModal.addEventListener('touchend', (e) => {
        const diff = currentX - startX;
        
        // If swiped more than 100px to the right, close the modal
        if (diff > 100) {
            toggleSearchModal(false);
        } else {
            // Reset position if not swiped enough
            searchModal.style.right = '0';
        }
        
        startX = 0;
        currentX = 0;
    });
}

initSearchModalSwipe();
// Listen for preferences from main process
ipcRenderer.on('preferences', (event, preferences) => {
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
const setupBinanceWebSocket = require('./src/component/setupBinanceWebSocket');

function updatePageTitle() {
    if (selectedToken && priceCache[selectedToken]) {
        const [symbol, pair] = selectedToken.split('/');
        const price = formatPrice(priceCache[selectedToken].price, pair);
        const change = priceCache[selectedToken].change;
        const arrow = change >= 0 ? '↑' : '↓';
        const volume = formatVolume(priceCache[selectedToken].volume, pair);
        
        // Create title with selected token's information
        document.title = `${symbol}/${pair}: ${price} ${arrow}${Math.abs(change).toFixed(1)}% | Vol: ${volume} - Coin Tracker`;
    } else {
        // Fallback to showing BTC if no token is selected
        const btcKey = 'BTC/USDT';
        if (priceCache[btcKey]) {
            const price = formatPrice(priceCache[btcKey].price, 'USDT');
            const change = priceCache[btcKey].change;
            const arrow = change >= 0 ? '↑' : '↓';
            document.title = `BTC: ${price} ${arrow}${Math.abs(change).toFixed(1)}% - Coin Tracker`;
        }
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
async function refreshCryptoList() {
    const cryptoListEl = document.getElementById('crypto-list');
    const listCryptos = await JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8'));
    
    const fetchPromises = listCryptos.map(async (crypto, index) => {
        const symbol = crypto.Symbol;
        const pair = crypto.Pair;
        const exchange = crypto.exchange;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            // Fetch real-time data from exchange
            const priceData = await fetchPriceFromExchange(exchange, symbol, pair, controller.signal);
            clearTimeout(timeoutId);
            
            let imgUrl = crypto.ImageUrl ? 
                `https://www.cryptocompare.com${crypto.ImageUrl}` : 
                'https://via.placeholder.com/24';

            const container = document.createElement('div');
            container.className = 'crypto-item-container';
            
            const item = document.createElement('div');
            item.className = 'crypto-item';
            item.dataset.symbol = symbol;
            item.dataset.pair = pair;
            item.dataset.exchange = exchange;

            const price = priceData ? formatPrice(priceData.price, pair) : '...';
            const change = priceData ? formatChange(priceData.change) : '0.00%';
            const volume = priceData ? formatVolume(priceData.volume) : '0';
            item.innerHTML = `
            <div class="flex">
                <img src="${imgUrl}" class="coin-icon">
                <div class="crypto-info">
                    <div class="crypto-exchange-badge" style="display: inline-block; font-size: 0.7rem; background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px; font-weight: bold;">${exchange.charAt(0).toUpperCase() + exchange.slice(1).toLowerCase()}</div>
                    <div class="crypto-name"><strong>${symbol}&nbsp;</strong>/${pair}</div>
                    <div class="crypto-volume">${volume}</div>
                </div>
            </div>
            <div class="flex">
                ${pair === 'BTC' 
                    ? `<div class="flex" style="flex-direction:column; gap:4px; align-items: flex-end;">
                            <div class="flex" style="gap: 0px; align-items: flex-end;">
                                $<div class="crypto-price-usdt">
                                    ${await getBTCValue(price, symbol)}
                                </div>
                            </div>
                            <div class="flex" style="gap: 0px; align-items: flex-end;">
                                <img src="https://www.cryptocompare.com/media/37746251/btc.png" class="coin-icon" style="width: 16px; height: 16px; margin-right: 4px;align-items: flex-end;">
                                <div class="crypto-price">
                                    ${price}
                                </div>
                            </div>
                        </div>`
                    : `<div class="for-crypto-price flex" style="gap: 0px; align-items: flex-end;">
                        $<div class="crypto-price">${price}</div>
                    </div>`
                }
                <div class="crypto-change ${priceData?.change > 0 ? 'up' : priceData?.change < 0 ? 'down' : ''}">${change}</div>
            </div>
            <button class="btn remove" data-symbol="${symbol}" data-pair="${pair}" data-exchange="${exchange}" style="position: absolute; top: 1px; right: 1px;">×</button>
            `;

            // Add click event for chart display
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove')) return;
                const chartArea = document.querySelector('.chart-area');
                if (!chartArea) return;

                // Show the chart area if it's hidden
                chartArea.classList.add('visible');
                const allItems = document.querySelectorAll('.crypto-item');
                allItems.forEach(i => {
                    if (i !== item) i.classList.remove('active');
                });
                item.classList.toggle('active');
                selectedToken = `${symbol}/${pair}`;
                initializeChartArea();
                displayEmbeddedChart(symbol, pair, chartArea);
                initDragAndDrop();
            });
            // Add remove button handler
            const removeBtn = item.querySelector('.remove');
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const dataPath = path.join(__dirname, 'public', 'data.json');
                    const currentData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                    const updatedData = currentData.filter(item => 
                        !(item.Symbol === symbol && item.exchange === exchange && item.Pair === pair)
                    );
                    const chartArea = document.querySelector('.chart-area');
                    const chartTitle = document.querySelector('.chart-title');

                    if (chartTitle && chartTitle.textContent.includes(`${symbol}/${pair}`)) {
                        initializeChartArea();
                    }
                    chartArea.classList.add('visible');
                    fs.writeFileSync(dataPath, JSON.stringify(updatedData, null, 2));
                    container.remove();
                } catch (error) {
                    console.error('Error updating data.json:', error);
                }
            });

            container.appendChild(item);
            return container;
        } catch (error) {
            console.error(`Error fetching data for ${symbol} on ${exchange}:`, error);
            return null;
        }
    });
    const results = await Promise.all(fetchPromises);
    
    cryptoListEl.innerHTML = '';
    results.forEach(container => {
        if (container) {
            cryptoListEl.appendChild(container);
        }
    });

    setupWebSocketConnections(listCryptos);
}

function setupWebSocketConnections(cryptos) {
    // Group by exchange to avoid duplicate connections
    const exchangeGroups = {};
    cryptos.forEach(crypto => {
        if (!exchangeGroups[crypto.exchange]) {
            exchangeGroups[crypto.exchange] = [];
        }
        exchangeGroups[crypto.exchange].push(crypto.Symbol);
    });

    // Set up WebSocket for each exchange
    Object.entries(exchangeGroups).forEach(([exchange, symbols]) => {
        switch (exchange) {
            case 'binance':
                setupBinanceWebSocket(symbols);
                break;
            // Add other exchange WebSocket setups here
            default:
                // For exchanges without WebSocket support, set up polling
                setupPricePolling(exchange, symbols);
                break;
        }
    });
}

function setupPricePolling(exchange, symbols) {
    const POLL_INTERVAL = 10000; // 10 seconds

    setInterval(async () => {
        symbols.forEach(async (symbol) => {
            try {
                const priceData = await fetchPriceFromExchange(exchange, symbol, 'USDT');
                if (priceData) {
                    updateCryptoPrice(
                        `${symbol}/USDT`,
                        priceData.price,
                        priceData.change,
                        priceData.volume,
                        exchange
                    );
                }
            } catch (error) {
                console.error(`Error polling ${symbol} on ${exchange}:`, error);
            }
        });
    }, POLL_INTERVAL);
}

function updateCryptoPrice(cryptoKey, price, changePercent, volume, source) {
    const [symbol, pair] = cryptoKey.split('/');
    
    const cryptoElement = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"]`);
    if (!cryptoElement) return;
    
    const priceElement = cryptoElement.querySelector('.crypto-price');
    if (priceElement) {
        priceElement.textContent = formatPrice(price, pair);
    }
    
    const changeElement = cryptoElement.querySelector('.crypto-change');
    if (changeElement && !isNaN(changePercent)) {
        changeElement.textContent = formatChange(changePercent);
        
        changeElement.classList.remove('up', 'down', 'neutral');
        if (changePercent > 0) {
            changeElement.classList.add('up');
        } else if (changePercent < 0) {
            changeElement.classList.add('down');
        } else {
            changeElement.classList.add('neutral');
        }
    }
    
    const exchangeBadge = cryptoElement.querySelector('.crypto-exchange-badge');
    if (exchangeBadge && source) {
        exchangeBadge.textContent = source.toUpperCase();
        exchangeBadge.style.animation = 'none';
        exchangeBadge.offsetHeight;
        exchangeBadge.style.animation = 'pulse 0.5s';
    }
    
    const volumeElement = cryptoElement.querySelector('.crypto-volume');
    if (volumeElement) {
        volumeElement.textContent = formatVolume(volume || 0);
    }
    
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
    
    lastPrices[cryptoKey] = price;

    const { ipcRenderer } = require('electron');
    const priceData = {};
    for (const key in priceCache) {
        const [sym, pr] = key.split('/');
        if (pr === 'USDT') {  // Only show USDT pairs in tooltip
            priceData[sym] = {
                price: priceCache[key].price,
                change: priceCache[key].change
            };
        }
    }
    updatePageTitle();
    ipcRenderer.send('price-update', priceData);
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
    const statusEl = document.getElementById('search-status');
    if (statusEl) statusEl.textContent = "Loading coin data...";
    
    try {
        const response = await axios.get('https://min-api.cryptocompare.com/data/all/coinlist?summary=true', {
            timeout: 10000 // 10 second timeout
        });
        
        if (response.data && response.data.Data) {
            cryptoList = response.data.Data;
            const coinCount = Object.keys(cryptoList).length;            
            if (statusEl) statusEl.textContent = `${coinCount} coins available for search`;
            return true;
        } else {
            console.error("Invalid API response structure:", response.data);
            cryptoList = fallbackCoins;
            if (statusEl) statusEl.textContent = "Using top cryptocurrencies (API unavailable)";
            return true;
        }
    } catch (error) {
        console.error("Failed to load cryptocurrency list:", error);
        cryptoList = fallbackCoins;
        if (statusEl) statusEl.textContent = "Using top cryptocurrencies (API unavailable)";
        return true;
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

async function getBTCValue(price, symbol) {
    try {
        const btcPriceData = await fetchPriceFromExchange('binance', 'BTC', 'USDT');
        const btcUsdtPrice = btcPriceData?.price || 1;
        console.log("btcUsdtPrice",btcUsdtPrice);
        if (symbol === 'BTC') {
            return await formatPrice(price * btcUsdtPrice);
        }
        return await formatPrice(price * btcUsdtPrice);
    } catch (error) {
        console.error('Error fetching BTC price:', error);
        return price;
    }
}