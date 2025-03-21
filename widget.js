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

const createPairSelectorModal = require('./src/component/createPairSelectorModal');
let currentTheme = localStorage.getItem('theme') || 'light';
const fallbackCoins = require('./src/utils/fallbackCoins');
const showToast = require('./src/component/toast');
const displayEmbeddedChart = require('./src/component/displayEmbeddedChart');

const searchCryptos = require('./src/component/searchCryptos');
const initDragAndDrop = require('./src/component/initDragAndDrop');

const fs = require('fs');
const path = require('path');

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

    // Initialize search functionality
    const { initializeSearch } = require('./src/component/searchCryptos');
    initializeSearch();
    
    // Handle toggle search modal
    const addCryptoBtn = document.getElementById('add-crypto');
    if (addCryptoBtn) {
        addCryptoBtn.addEventListener('click', () => {
            toggleSearchModal(true);
            
            // Focus the search input when the modal opens
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

function formatVolume(volume) {
    if (volume === undefined || volume === null || isNaN(volume)) {
        return 'N/A';
    }
    
    const numVolume = parseFloat(volume);
    
    if (numVolume >= 1000000000) {
        return `${(numVolume / 1000000000).toFixed(2)}B`;
    } else if (numVolume >= 1000000) {
        return `${(numVolume / 1000000).toFixed(2)}M`;
    } else if (numVolume >= 1000) {
        return `${(numVolume / 1000).toFixed(2)}K`;
    } else {
        return numVolume.toFixed(2);
    }
}

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
        let symbol, pair;
        if (crypto.includes('/')) {
            [symbol, pair] = crypto.split('/');
        } else {
            symbol = crypto;
            pair = currentPair;
        }
        
        const key = `${symbol}/${pair}`;
        if (priceCache[key]) {
            updateCryptoPrice(key, priceCache[key].price, priceCache[key].change, priceCache[key].volume, priceCache[key].source);
        }
    });
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
    cryptoListEl.innerHTML = '';
    const listCryptos = await JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8'));
    console.log("listCryptos", listCryptos);
    await listCryptos.forEach(crypto => {
        const symbol = crypto.Symbol;
        const pair = 'USDT';
        const price = lastPrices[`${symbol}/${pair}`] || '...';
        const cacheKey = `${symbol}/${pair}`;
        const priceData = priceCache[cacheKey] || {};
        
        const container = document.createElement('div');
        container.className = 'crypto-item-container';
        
        const item = document.createElement('div');
        item.className = 'crypto-item';
        item.dataset.symbol = symbol;
        item.dataset.pair = pair;
        let imgUrl = 'https://via.placeholder.com/24';
        if (crypto.ImageUrl) {
            imgUrl = `https://www.cryptocompare.com${crypto.ImageUrl}`;
        }

        item.innerHTML = `
            <img src="${imgUrl}" class="coin-icon">
            <div class="crypto-info">
                <div class="crypto-exchange-badge" style="display: inline-block; font-size: 0.7rem; background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px; margin-bottom: 3px; font-weight: bold;">${(priceData.source || 'LOADING...').toUpperCase()}</div>
                <div class="crypto-name"><strong>${symbol}</strong>/${pair}</div>
                <div class="crypto-volume">${formatVolume(priceData.volume || 0)}</div>
            </div>
            <div class="crypto-price">$ ${price}</div>
            <div class="crypto-change">${formatChange(priceData.change || 0)}</div>
            <button class="btn remove" data-symbol="${symbol}" data-pair="${pair}" style="position: absolute; top: 1px; right: 1px;">×</button>
        `;

        item.addEventListener('click', (e) => {
            // Ignore if clicking the remove button
            if (e.target.classList.contains('remove')) return;
            
            // Get all crypto items and remove active class from others
            const allItems = document.querySelectorAll('.crypto-item');
            allItems.forEach(i => {
                if (i !== item) {
                    i.classList.remove('active');
                    // Also collapse their charts
                    const parentContainer = i.closest('.crypto-item-container');
                    if (parentContainer) {
                        const chart = parentContainer.querySelector('.chart-area');
                        if (chart) {
                            chart.classList.remove('visible');
                        }
                    }
                }
            });
        
            // Toggle active state for clicked item
            item.classList.toggle('active');
        
            // Handle chart visibility
            const chartArea = container.querySelector('.chart-area');
            const isVisible = chartArea.classList.contains('visible');
            
            // Toggle chart visibility
            chartArea.classList.toggle('visible', !isVisible);
        
            // Load chart data if not already loaded
            if (!isVisible && !chartArea.dataset.loaded) {
                chartArea.dataset.loaded = 'true';
                displayEmbeddedChart(symbol, pair, chartArea);
            }
        
            // Initialize drag and drop functionality
            initDragAndDrop();
        
            // Scroll chart into view if it's being shown
            if (!isVisible) {
                chartArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        const removeBtn = item.querySelector('.remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCrypto(`${symbol}/${pair}`);
        });

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

        chartArea.querySelector('.chart-close').addEventListener('click', (e) => {
            e.stopPropagation();
            chartArea.classList.remove('visible');
            item.classList.remove('active');
        });

        container.appendChild(item);
        container.appendChild(chartArea);
        cryptoListEl.appendChild(container);
    });

    setupBinanceWebSocket();
}

function updateCryptoPrice(cryptoKey, price, changePercent, volume, source) {
    const [symbol, pair] = cryptoKey.split('/');
    
    const cryptoElement = document.querySelector(`.crypto-item[data-symbol="${symbol}"][data-pair="${pair}"]`);
    if (!cryptoElement) return;
    
    const priceElement = cryptoElement.querySelector('.crypto-price');
    if (priceElement) {
        priceElement.textContent = `$` + formatPrice(price);
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
    
    ipcRenderer.send('price-update', priceData);
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


// Helper function to format price (you can implement your own)
function formatPrice(price) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price);
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
