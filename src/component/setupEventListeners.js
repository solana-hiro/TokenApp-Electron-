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
        newWidth = Math.max(250, Math.min(680, newWidth));    // Updated max width
        newHeight = Math.max(400, Math.min(1150, newHeight)); // Updated max height
        
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

module.exports = setupEventListeners;