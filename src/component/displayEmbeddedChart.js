async function displayEmbeddedChart(symbol, pair, chartContainer) {
    const chartTitle = chartContainer.querySelector('.chart-title');
    const chartCanvas = chartContainer.querySelector('.price-chart');
    
    chartTitle.textContent = `Loading ${symbol}/${pair} data...`;
    
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
                createEmbeddedChart(chartCanvas, timestamps, prices, symbol, pair);
                chartTitle.textContent = `${symbol}/${pair} - 24h`;
            } else {
                chartTitle.textContent = `No price data for ${symbol}/${pair}`;
            }
        } else {
            throw new Error("Invalid chart data format");
        }
    } catch (error) {
        console.error("Error fetching chart data:", error);
        chartTitle.textContent = `Error loading ${symbol}/${pair}`;
    }
}

function createEmbeddedChart(canvas, timestamps, prices, symbol, pair) {
    // Ensure Chart.js is loaded
    if (!window.Chart) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = () => renderChart(canvas, timestamps, prices, symbol, pair);
        document.head.appendChild(script);
        return;
    }
    
    renderChart(canvas, timestamps, prices, symbol, pair);
}

function renderChart(canvas, timestamps, prices, symbol, pair) {
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart if there is one
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(54, 162, 235, 0.4)');
    gradient.addColorStop(1, 'rgba(54, 162, 235, 0.05)');
    
    // Find min and max price to ensure proper scaling
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice;
    
    // Add 10% padding to the range
    const padding = range * 0.1;
    
    // Create chart
    canvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timestamps,
            datasets: [{
                label: `Price`,
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
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    display: false
                },
                y: {
                    display: true,
                    beginAtZero: false, // Important: Allow chart to show values below 0
                    suggestedMin: minPrice - padding, // Add padding below the minimum
                    suggestedMax: maxPrice + padding, // Add padding above the maximum
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        font: {
                            size: 10
                        }
                    }
                }
            },
            layout: {
                padding: {
                    top: 10,
                    bottom: 10
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

module.exports = displayEmbeddedChart;