const axios = require('axios');
const CRYPTOCOMPARE_API_KEY = 'your-api-key-here'; // Optional: Add your CryptoCompare API key if you have one

async function displayEmbeddedChart(symbol, pair, chartContainer) {
    if (!chartContainer) {
        console.error('Chart container not found');
        return;
    }

    const chartTitle = chartContainer.querySelector('.chart-title');
    const chartCanvas = chartContainer.querySelector('.price-chart');

    if (!chartTitle || !chartCanvas) {
        console.error('Chart elements not found');
        return;
    }
    
    chartTitle.textContent = `Loading ${symbol}/${pair} data...`;
    
    try {
        const chartData = await fetchCryptoCompareChartData(symbol);
        
        if (chartData && chartData.length > 0) {
            const timestamps = chartData.map(item => item.timestamp);
            const prices = chartData.map(item => item.price);
            
            createEmbeddedChart(chartCanvas, timestamps, prices, symbol, pair);
            chartTitle.textContent = `${symbol}/${pair} - 24h`;
        } else {
            throw new Error("No chart data available");
        }
    } catch (error) {
        console.error("Error displaying chart:", error);
        chartTitle.textContent = `Error loading ${symbol}/${pair}`;
    }
}

function createEmbeddedChart(canvas, timestamps, prices, symbol, pair) {
    const ctx = canvas.getContext('2d');
    
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(207, 239, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(207, 239, 255, 0.0)');

    canvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timestamps,
            datasets: [{
                data: prices,
                borderColor: '#cfefff',
                backgroundColor: gradient,
                borderWidth: 1.5,
                pointRadius: 0,
                pointHitRadius: 10,
                fill: true,
                tension: 0,
                cubicInterpolationMode: 'monotone'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(26, 31, 49, 0.9)',
                    titleColor: '#cfefff',
                    bodyColor: '#cfefff',
                    borderColor: 'rgba(207, 239, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => `$${context.parsed.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: 'rgba(207, 239, 255, 0.5)',
                        maxRotation: 0,
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(207, 239, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(207, 239, 255, 0.5)',
                        callback: (value) => `$${value.toFixed(2)}`
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

async function fetchCryptoCompareChartData(symbol, days = 1) {
    try {
        const limit = days * 24; // Get hourly data
        const apiUrl = 'https://min-api.cryptocompare.com/data/v2/histohour';
        const params = {
            fsym: symbol.toUpperCase(),
            tsym: 'USD',
            limit: limit
        };

        // Add API key to headers if available
        const headers = CRYPTOCOMPARE_API_KEY ? 
            { 'authorization': `Apikey ${CRYPTOCOMPARE_API_KEY}` } : {};

        const response = await axios.get(apiUrl, { 
            params,
            headers
        });

        if (response.data?.Data?.Data) {
            return response.data.Data.Data.map(item => ({
                timestamp: new Date(item.time * 1000),
                price: item.close
            }));
        }
        throw new Error('Invalid data format from CryptoCompare');
    } catch (error) {
        console.error('Error fetching CryptoCompare chart data:', error);
        return null;
    }
}

// Utility function to format dates for the chart
function formatChartDate(date) {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

module.exports = displayEmbeddedChart;