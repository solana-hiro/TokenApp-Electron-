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
        trackedCryptos.unshift(combinedSymbol);
        ipcRenderer.send('add-crypto', combinedSymbol);
        
        // Force refresh the crypto list to show the new item immediately
        if (trackedCryptos.indexOf(combinedSymbol) === -1) {
            trackedCryptos.push(combinedSymbol);
            refreshCryptoList();
        }
    }
}

module.exports = addCryptoWithPair;