const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Add tray as a global reference to prevent garbage collection
let tray = null;
let isQuitting = false;
let mainWindow;

let preferences = {
  position: { x: null, y: null },
  size: { width: 320, height: 600 },
  opacity: 80,
  decimalPlaces: 'auto',
  cryptos: ['BTC', 'ETH', 'SOL'],
  pair: 'USDT',
  minimizeToTray: true,
  theme: 'dark'
};

const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
try {
  if (fs.existsSync(prefsPath)) {
    const savedPrefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    preferences = { ...preferences, ...savedPrefs };
    // Make sure minimizeToTray is set if not in saved prefs
    if (savedPrefs.minimizeToTray === undefined) {
      preferences.minimizeToTray = true;
    }
  }
} catch (err) {
  console.error('Failed to load preferences:', err);
}

// Save preferences periodically
function savePreferences() {
  try {
    fs.writeFileSync(prefsPath, JSON.stringify(preferences), 'utf8');
  } catch (err) {
    console.error('Failed to save preferences:', err);
  }
}

preferences.minimizeToTray = true; // Default to true

// The rest of your existing code until createWindow function

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Set default position if not saved (right side of screen)
  if (preferences.position.x === null) {
    preferences.position = {
      x: width - preferences.size.width - 20,
      y: Math.floor(height / 2 - preferences.size.height / 2)
    };
  }

  mainWindow = new BrowserWindow({
    width: preferences.size.width,
    height: preferences.size.height,
    x: preferences.position.x,
    y: preferences.position.y,
    icon: './icon.ico',
    frame: false,
    transparent: true,
    alwaysOnTop: preferences.alwaysOnTop || false, // Make this a preference
    resizable: true,
    skipTaskbar: preferences.skipTaskbar || false, // Make this a preference
    minWidth: 250, 
    minHeight: 400, 
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  cleanupInvalidPairs();

  // Set initial opacity 
  mainWindow.setOpacity(preferences.opacity / 100);

  // Load the widget HTML file
  mainWindow.loadFile('widget.html');
  
  // Save position when window is moved
  mainWindow.on('moved', () => {
    const bounds = mainWindow.getBounds();
    preferences.position = { x: bounds.x, y: bounds.y };
    savePreferences();
  });

  // Save size when window is resized
  mainWindow.on('resize', () => {
    const bounds = mainWindow.getBounds();
    preferences.size = { width: bounds.width, height: bounds.height };
    savePreferences();
  });

  // Modify the close event to hide the window if minimizeToTray is enabled
  mainWindow.on('close', (event) => {
    if (!isQuitting && preferences.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    
    // Otherwise, continue with normal close and save preferences
    savePreferences();
    return true;
  });
  
  // Add this to handle when the minimize button is clicked
  mainWindow.on('minimize', (event) => {
    if (preferences.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Add the function to create tray
function createTray() {
  try {
    // Try to load the app icon first
    const iconPath = path.join(__dirname, 'icon.ico');
    let trayIcon;
    
    if (fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
    } else {
      // Fallback to a simple icon if the app icon doesn't exist
      trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABs0lEQVR42mNkwAEazsz4z8DAyIjLDGz8oRwMDNeN/RiRxRnRBJm6v/xnZGb+z8DAhN0ABkYGBkzN6OD2X0dUE/D9Z2RiYnz65g+yGBOyAKqLsRiAbAA2cP75X8b/DP8ZjVXYGVpvfmf4wi7AwIjuAqwGwNTfN3FjePj+D8OzL38Z7JU4GFa9/crgIsLEiO4FRlwGfP77j+EM01+GMBVOBmFOZgZpHhaGX7//MfQIsjAK/fvP+J+RkQnd2YzIYYCseebrv4whYhygoIBoPnb/JwMLCzODlgArg9nNrwyf/jAwMDOBwgTTAAbGllNv/lVzMzC0cLEysDIxMmRd/sYw1FyI4e6XfwzP//5jZONgYbz/9hfj//+MyC7Gm5A+MPCxtX/5y/iDnQla8P1nePT3L8PHH38Zf/z8y/T+xx/Gf8xMjP95WRlZvv9lZPr/H+xiXAa8YOBnZQNphoHrDP8YuRgYGH8w/GdkZf7PysjCwvTl+z9Gxn8gsRfIiRgr+M/AxDj/2Z//PxkYmFUZGJju/GdgFPjPwPT3D1jNpb8M/9jYGRlZWSB6MRIVdgNw5YT/OHMDAFiVxVRVY0bjAAAAAElFTkSuQmCC`);
    }
    
    // Create the tray icon
    tray = new Tray(trayIcon);
    tray.setToolTip('Coin Tracker');
    
    // Add context menu to tray
    updateTrayMenu();
    
    // Add click handler
    tray.on('click', () => {
      toggleWindowVisibility();
    });
    
  } catch (error) {
    console.error('Error creating tray:', error);
  }
}

// Create a function to toggle window visibility
function toggleWindowVisibility() {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

// Function to update the tray menu with current state
function updateTrayMenu() {
  if (!tray) return;
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: mainWindow && mainWindow.isVisible() ? 'Hide Widget' : 'Show Widget', 
      click: toggleWindowVisibility 
    },
    { type: 'separator' },
    {
      label: 'Always On Top',
      type: 'checkbox',
      checked: preferences.alwaysOnTop || false,
      click: () => {
        preferences.alwaysOnTop = !preferences.alwaysOnTop;
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(preferences.alwaysOnTop);
        }
        savePreferences();
        updateTrayMenu(); // Update the menu to reflect the new state
      }
    },
    {
      label: 'Hide From Taskbar',
      type: 'checkbox',
      checked: preferences.skipTaskbar || false,
      click: () => {
        preferences.skipTaskbar = !preferences.skipTaskbar;
        if (mainWindow) {
          mainWindow.setSkipTaskbar(preferences.skipTaskbar);
        }
        savePreferences();
        updateTrayMenu(); // Update the menu to reflect the new state
      }
    },
    {
      label: 'Minimize To Tray',
      type: 'checkbox',
      checked: preferences.minimizeToTray,
      click: () => {
        preferences.minimizeToTray = !preferences.minimizeToTray;
        savePreferences();
        updateTrayMenu(); // Update the menu to reflect the new state
      }
    },
    { type: 'separator' },
    {
      label: 'Refresh Data',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('refresh-data');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

// Modify app.whenReady to create the tray
app.whenReady().then(() => {
  createWindow();
  createTray(); // Add this line to create the tray icon

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createTray(); // Also recreate tray if needed
    }
  });
});

// Update the window-all-closed handler to prevent quitting when all windows are closed
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    // Only quit if we're actually quitting
    if (isQuitting) {
      app.quit();
    }
  }
});

// Add this handler for before-quit event
app.on('before-quit', () => {
  isQuitting = true;
});

// Add these new IPC handlers

// Show the window
ipcMain.on('show-window', () => {
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});

// Add to your existing IPC handlers
ipcMain.on('set-theme', (event, theme) => {
  preferences.theme = theme;
  savePreferences();
});

// Hide the window
ipcMain.on('hide-window', () => {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  }
});

// Toggle window visibility
ipcMain.on('toggle-window-visibility', () => {
  toggleWindowVisibility();
});

// Set always on top
ipcMain.on('set-always-on-top', (event, value) => {
  preferences.alwaysOnTop = value;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(value);
  }
  savePreferences();
  updateTrayMenu();
});

// Set skip taskbar
ipcMain.on('set-skip-taskbar', (event, value) => {
  preferences.skipTaskbar = value;
  if (mainWindow) {
    mainWindow.setSkipTaskbar(value);
  }
  savePreferences();
  updateTrayMenu();
});

// Set minimize to tray preference
ipcMain.on('set-minimize-to-tray', (event, value) => {
  preferences.minimizeToTray = value;
  savePreferences();
  updateTrayMenu();
});


process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
});


// Load saved preferences if available

// Add this function to clean up invalid pairs
function cleanupInvalidPairs() {
  if (!preferences.cryptos) return;
  
  const originalCount = preferences.cryptos.length;
  let hasInvalidPairs = false;
  
  // Filter out invalid pairs
  preferences.cryptos = preferences.cryptos.filter(crypto => {
    if (typeof crypto !== 'string') return false;
    
    // Check for self-pairs like BTC/BTC
    if (crypto.includes('/')) {
      const [symbol, pair] = crypto.split('/');
      if (symbol === pair) {
        console.log(`Removing invalid self-pair: ${crypto}`);
        hasInvalidPairs = true;
        return false;
      }
    }
    return true;
  });
  
  // If we found invalid pairs, save the changes
  if (hasInvalidPairs || preferences.cryptos.length !== originalCount) {
    console.log(`Removed ${originalCount - preferences.cryptos.length} invalid pairs`);
    savePreferences();
  }
}


app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Listen for IPC messages from renderer
ipcMain.on('change-opacity', (event, opacity) => {
  preferences.opacity = opacity;
  mainWindow.setOpacity(opacity / 100);
  savePreferences();
});

ipcMain.on('cleanup-invalid-pairs', (event) => {
  cleanupInvalidPairs();
  event.reply('preferences', preferences);
});
// Add this to your main.js file near other IPC handlers
ipcMain.on('set-exchange-order', (event, order) => {
  preferences.exchangeOrder = order;
  savePreferences();
});

// Add to the resetAllPreferences function
function resetAllPreferences() {
  console.log("Resetting all preferences to default values");
  
  preferences = {
    cryptos: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    pair: 'USDT',
    opacity: 90,
    size: { width: 300, height: 500 },
    decimalPlaces: 'auto',
    position: { x: undefined, y: undefined },
    exchangeOrder: ['binance', 'coinbase', 'kraken', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx']
  };
  
  savePreferences();
  
  // If window exists, apply new settings
  if (mainWindow) {
    mainWindow.setOpacity(preferences.opacity / 100);
    mainWindow.setSize(preferences.size.width, preferences.size.height);
  }
  
  return preferences;
}

ipcMain.on('resize-window', (event, size) => {
  if (mainWindow) {
    // Ensure size isn't below minimums
    const finalWidth = Math.max(size.width, 250);
    const finalHeight = Math.max(size.height, 400);
    
    mainWindow.setSize(finalWidth, finalHeight);
    preferences.size = { width: finalWidth, height: finalHeight };
    savePreferences();
  }
});

ipcMain.on('set-decimal-places', (event, places) => {
  preferences.decimalPlaces = places;
  savePreferences();
  event.reply('decimal-places-updated', places);
});

// ipcMain.on('get-exchange-order', (event) => {
//     event.reply('exchange-order', preferences.exchangeOrder || 
//       ['binance', 'coinbase', 'kraken', 'okx', 'mexc', 'gate', 'bitget', 'kucoin', 'bybit', 'htx']);
// });

ipcMain.on('add-crypto', (event, symbol) => {
  if (!preferences.cryptos.includes(symbol)) {
    preferences.cryptos.push(symbol);
    savePreferences();
    event.reply('cryptos-updated', preferences.cryptos);
  }
});

ipcMain.on('remove-crypto', (event, symbol) => {
  try {
    // Add validation
    if (!symbol || typeof symbol !== 'string') {
      console.error(`Invalid crypto data received for removal: ${symbol}`);
      return;
    }
    
    console.log(`Removing crypto: ${symbol}`);
    
    // Check if the symbol exists before trying to remove it
    const index = preferences.cryptos.indexOf(symbol);
    if (index !== -1) {
      preferences.cryptos.splice(index, 1);
      console.log(`Successfully removed ${symbol} from preferences`);
      savePreferences();
    } else {
      console.log(`Symbol ${symbol} not found in preferences`);
    }
    
    // Always send back updated list - WRAPPED IN TRY/CATCH
    try {
      // Make sure we have a valid array to send
      const safeArray = Array.isArray(preferences.cryptos) ? 
                         preferences.cryptos.filter(item => item && typeof item === 'string') : 
                         [];
      event.reply('cryptos-updated', safeArray);
    } catch (err) {
      console.error("Error sending cryptos-updated reply:", err);
    }
  } catch (error) {
    console.error("Error in remove-crypto handler:", error);
  }
});

ipcMain.on('change-pair', (event, pair) => {
  preferences.pair = pair;
  savePreferences();
  event.reply('pair-updated', pair);
});

ipcMain.on('get-preferences', (event) => {
  event.reply('preferences', preferences);
});