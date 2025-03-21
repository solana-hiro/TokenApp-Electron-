const addCryptoWithPair = require('./addCryptoWithPair');

function createPairSelectorModal() {
    // Check if it already exists
    if (document.getElementById('pair-selector')) {
        console.log("Pair selector already exists");
        return;
    }
    
    console.log("Creating pair selector modal");
    
    const modal = document.createElement('div');
    modal.id = 'pair-selector';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Select Trading Pair</h3>
                <button class="btn close-modal">×</button>
            </div>
            <div class="modal-body">
                <div class="selected-coin">
                    <img id="selected-coin-img" src="https://via.placeholder.com/30" class="coin-icon">
                    <div id="selected-coin-name">Selected Coin</div>
                </div>
                
                <div class="pair-options">
                    <div class="pair-option-group">
                        <h4>Fiat/Stablecoin Pairs</h4>
                        <div class="pair-buttons" id="fiat-pairs">
                            <button class="pair-select-btn" data-pair="USDT">USDT</button>
                            <button class="pair-select-btn" data-pair="USDC">USDC</button>
                            <button class="pair-select-btn" data-pair="BUSD">BUSD</button>
                            <button class="pair-select-btn" data-pair="USD">USD</button>
                            <button class="pair-select-btn" data-pair="EUR">EUR</button>
                        </div>
                    </div>
                    
                    <div class="pair-option-group">
                        <h4>Crypto Pairs</h4>
                        <div class="pair-buttons" id="crypto-pairs">
                            <button class="pair-select-btn" data-pair="BTC">BTC</button>
                            <button class="pair-select-btn" data-pair="ETH">ETH</button>
                            <button class="pair-select-btn" data-pair="BNB">BNB</button>
                        </div>
                    </div>
                    
                    <div class="custom-pair-input">
                        <input type="text" id="custom-pair-input" placeholder="Enter custom pair...">
                        <button id="custom-pair-btn">Add</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    console.log("Pair selector modal created and added to DOM");
    
    // Add event listeners
    modal.querySelector('.close-modal').addEventListener('click', () => {
        modal.classList.remove('visible');
    });
    
    // Handle pair selection
    modal.querySelectorAll('.pair-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pair = btn.getAttribute('data-pair');
            const symbol = modal.getAttribute('data-symbol');
            console.log(`Selected pair: ${symbol}/${pair}`);
            addCryptoWithPair(symbol, pair);
            modal.classList.remove('visible');
        });
    });
    
    // Handle custom pair
    modal.querySelector('#custom-pair-btn').addEventListener('click', () => {
        const customPair = modal.querySelector('#custom-pair-input').value.trim().toUpperCase();
        if (customPair) {
            const symbol = modal.getAttribute('data-symbol');
            console.log(`Custom pair selected: ${symbol}/${customPair}`);
            addCryptoWithPair(symbol, customPair);
            modal.classList.remove('visible');
        }
    });
    
    // Enter key for custom pair
    modal.querySelector('#custom-pair-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            modal.querySelector('#custom-pair-btn').click();
        }
    });
}

module.exports = createPairSelectorModal;