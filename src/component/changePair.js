function changePair(pair) {
    if (pair === currentPair) return;
    
    // Update in main process
    ipcRenderer.send('change-pair', pair);
    
    // Update UI
    updatePairButtons(pair);
    
    // Update current pair and reconnect WebSocket
    currentPair = pair;
    setupBinanceWebSocket();
}



module.exports = changePair;