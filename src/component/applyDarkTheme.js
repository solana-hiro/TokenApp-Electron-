function applyDarkTheme() {
    const styleTag = document.createElement('style');
    styleTag.innerHTML = `
        /* Dark Theme Styles */
        body {
            background-color: var(--bg-color) !important; /* Use !important if necessary */
            color: var(--text-color) !important;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        .widget-container {
            background-color: var(--bg-color);
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            color: var(--text-color);
            border-radius: 8px;
        }
        
        .header-bar {
            background: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
        }
        
        button {
            background-color: var(--btn-bg);
            color: var(--btn-color);
            border: 1px solid var(--border-color);
        }
        
        button:hover {
            background-color: var(--item-hover);
        }
        
        button.active {
            background-color: var(--accent-gradient);
            color: white;
        }
        
        /* Crypto items */
        .crypto-item {
            background-color: var(--item-bg);
            border: 1px solid var(--border-color);
            transition: all 0.2s ease;
        }
        
        .crypto-item:hover {
            background-color: var(--item-hover);
            border-color: var(--border-color);
        }
        
        .crypto-item.active {
            background-color: var(--item-hover);
            border-color: var(--accent-gradient);
        }
        
        .crypto-name {
            color: var(--text-color);
        }
        
        .crypto-volume {
            color: var(--text-color);
            font-size: 0.8em;
        }
        
        .crypto-price {
            color: white;
            font-weight: bold;
        }
        
        .crypto-change.up {
            color: var(--primary-gradient);
        }
        
        .crypto-change.down {
            color: var(--accent-gradient);
        }
        
        /* Charts */
        .chart-area {
            background-color: var(--item-bg);
            border: 1px solid var(--border-color);
        }
        
        .chart-header {
            background-color: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
        }
        
        /* Modal */
        .modal-content {
            background-color: var(--item-bg);
            border: 1px solid var(--border-color);
        }
        
        .modal-header {
            background-color: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
        }
        
        /* Search */
        .search-input {
            background-color: var(--item-bg);
            border: 1px solid var(--border-color);
            color: var(--text-color);
        }
        
        .search-item {
            background-color: var(--item-bg);
            border-bottom: 1px solid var(--border-color);
        }
        
        .search-item:hover {
            background-color: var(--item-hover);
        }
        
        /* Sort controls */
        .sort-controls {
            background-color: var(--item-bg);
            padding: 5px 10px;
            margin-bottom: 10px;
            border-radius: 5px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .sort-label {
            margin-right: 8px;
            font-size: 0.9em;
            color: var(--text-color);
        }
        
        .sort-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }
        
        .sort-btn {
            padding: 3px 8px;
            font-size: 0.8em;
            border-radius: 4px;
            background-color: var(--item-bg);
            border: 1px solid var(--border-color);
            color: var(--text-color);
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .sort-btn:hover {
            background-color: var(--item-hover);
        }
        
        .sort-btn.active {
            background-color: var(--accent-gradient);
            color: white;
        }
        
        /* Settings panel */
        .settings-panel {
            background-color: var(--item-bg);
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }
        
        /* Chart theming */
        canvas.price-chart {
            background-color: var(--item-bg);
        }
    
    document.head.appendChild(styleTag);`
}

module.exports = applyDarkTheme;