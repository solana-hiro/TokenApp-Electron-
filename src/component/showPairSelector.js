// Show the pair selector for a specific coin
function showPairSelector(symbol, coinName) {
    console.log(`Showing pair selector for ${symbol} (${coinName})`);
    
    // Make sure the modal exists
    createPairSelectorModal();
    
    const modal = document.getElementById('pair-selector');
    if (!modal) {
        console.error("Pair selector modal not found in DOM!");
        return;
    }
    
    modal.setAttribute('data-symbol', symbol);
    
    // Set coin info
    document.getElementById('selected-coin-name').textContent = `${symbol} - ${coinName}`;
    
    const imgUrl = cryptoList[symbol]?.ImageUrl ?
        `https://www.cryptocompare.com${cryptoList[symbol].ImageUrl}` :
        'https://via.placeholder.com/30';
    
    document.getElementById('selected-coin-img').src = imgUrl;
    
    // Reset custom pair input
    document.getElementById('custom-pair-input').value = '';
    
    // Close search modal first
    document.getElementById('search-modal').style.display = 'none';
    
    // Show modal with animation
    setTimeout(() => modal.classList.add('visible'), 10);
}

// Add this function to create and display a price chart
async function displayPriceChart(symbol, pair) {
    console.log(`Displaying chart for ${symbol}/${pair}`);
    
    // Create chart container if it doesn't exist
    let chartContainer = document.getElementById('price-chart-container');
    
    if (!chartContainer) {
        chartContainer = document.createElement('div');
        chartContainer.id = 'price-chart-container';
        chartContainer.className = 'chart-container';
        chartContainer.innerHTML = `
            <div class="chart-header">
                <div class="chart-title">Loading chart...</div>
                <button class="chart-close">×</button>
            </div>
            <canvas id="price-chart" class="price-chart"></canvas>
        `;
        
        document.body.appendChild(chartContainer);
        
        // Add close button event
        chartContainer.querySelector('.chart-close').addEventListener('click', () => {
            chartContainer.classList.remove('visible');
        });
    }
    
    // Update chart title
    chartContainer.querySelector('.chart-title').textContent = `${symbol}/${pair} Price Chart`;
    
    // Show chart container
    chartContainer.classList.add('visible');
    
    try {
        // Convert USD pair to USDT for API compatibility
        const apiPair = pair === 'USD' ? 'USDT' : pair;
        
        // Fetch historical data
        const response = await axios.get(
            `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=${apiPair}&limit=24`
        );
        
        if (response.data && response.data.Data && response.data.Data.Data) {
            const chartData = response.data.Data.Data;
            
            // Extract timestamps and prices
            const timestamps = chartData.map(item => new Date(item.time * 1000));
            const prices = chartData.map(item => item.close);
            
            // If we have data, initialize chart
            if (prices.length > 0) {
                initializeChart(timestamps, prices, symbol, pair);
            } else {
                chartContainer.querySelector('.chart-title').textContent = `No price data for ${symbol}/${pair}`;
            }
        } else {
            throw new Error("Invalid chart data format");
        }
    } catch (error) {
        console.error("Error fetching chart data:", error);
        chartContainer.querySelector('.chart-title').textContent = `Error loading ${symbol}/${pair} chart`;
    }
}

// <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
function initializeChart(timestamps, prices, symbol, pair) {
    // If Chart.js is not available, load it dynamically
    if (!window.Chart) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = () => createChart(timestamps, prices, symbol, pair);
        document.head.appendChild(script);
        return;
    }
    
    createChart(timestamps, prices, symbol, pair);
}


function createChart(timestamps, prices, symbol, pair) {
    const canvas = document.getElementById('price-chart');
    const ctx = canvas.getContext('2d');
    
    // Destroy previous chart if exists
    if (window.priceChart) {
        window.priceChart.destroy();
    }
    
    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(54, 162, 235, 0.6)');
    gradient.addColorStop(1, 'rgba(54, 162, 235, 0.1)');
    
    // Create chart
    window.priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timestamps,
            datasets: [{
                label: `${symbol}/${pair} Price`,
                data: prices,
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm'
                        }
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        maxRotation: 0
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)'
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            animations: {
                tension: {
                    duration: 1000,
                    easing: 'linear'
                }
            }
        }
    });
}

module.exports = showPairSelector;