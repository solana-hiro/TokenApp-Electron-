const axios = require('axios');
const CRYPTOCOMPARE_API_KEY = 'your-api-key-here';

const TIMEFRAMES = {
    '1H': { interval: 'minute', limit: 60, days: 1/24 },
    '4H': { interval: 'minute', limit: 240, days: 1/6 },
    '24H': { interval: 'minute', limit: 24 * 60, days: 1 },
    '7D': { interval: 'hour', limit: 7 * 24, days: 7 },
    '30D': { interval: 'hour', limit: 30 * 24, days: 30 }
};

const CHART_TYPES = {
    LINE: 'line'
};

const COLORS = {
    UP: '#16c784',        // Green for price increase
    DOWN: '#ea3943',      // Red for price decrease
    GRID: '#363c4e',      // Dark grid lines
    TEXT: '#a6b0c3',      // Light gray text
    TOOLTIP_BG: '#1c1f2d' // Dark tooltip background
};

async function displayEmbeddedChart(symbol, pair, chartContainer, chartType = CHART_TYPES.LINE, timeframe = '7D') {
    if (!chartContainer) return;

    const chartTitle = chartContainer.querySelector('.chart-title');
    const chartCanvas = chartContainer.querySelector('.price-chart');
    const chartHeader = chartContainer.querySelector('.chart-header');

    // Create time range selector
    if (!chartHeader.querySelector('.time-range-selector')) {
        const timeSelector = document.createElement('div');
        timeSelector.className = 'time-range-selector';

        Object.keys(TIMEFRAMES).forEach(time => {
            const button = document.createElement('button');
            button.textContent = time;
            button.className = `time-range-button ${time === timeframe ? 'active' : ''}`;
            button.onclick = () => {
                document.querySelectorAll('.time-range-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                displayEmbeddedChart(symbol, pair, chartContainer, chartType, time);
            };
            timeSelector.appendChild(button);
        });

        const minimizeBtn = chartHeader.querySelector('.chart-minimize');
        chartHeader.insertBefore(timeSelector, minimizeBtn);
    }

    chartTitle.textContent = `Loading ${symbol}/${pair} data...`;

    try {
        const selectedTimeframe = TIMEFRAMES[timeframe];
        const chartData = await fetchCryptoCompareChartData(symbol, selectedTimeframe);
        if (chartData && chartData.length > 0) {
            createEmbeddedChart(chartCanvas, chartData, symbol, pair, chartType);
            chartTitle.textContent = `${symbol}/${pair}`;
        } else {
            throw new Error("No chart data available");
        }
    } catch (error) {
        console.error("Error displaying chart:", error);
        chartTitle.textContent = `Error loading ${symbol}/${pair}`;
    }
}

async function fetchCryptoCompareChartData(symbol, timeframe) {
    try {
        let apiUrl;
        const params = {
            fsym: symbol.toUpperCase(),
            tsym: 'USD',
            limit: timeframe.limit
        };

        if (timeframe.interval === 'minute') {
            apiUrl = 'https://min-api.cryptocompare.com/data/v2/histominute';
        } else if (timeframe.interval === 'hour') {
            apiUrl = 'https://min-api.cryptocompare.com/data/v2/histohour';
        } else {
            apiUrl = 'https://min-api.cryptocompare.com/data/v2/histoday';
        }

        const headers = CRYPTOCOMPARE_API_KEY ? 
            { 'authorization': `Apikey ${CRYPTOCOMPARE_API_KEY}` } : {};

        const response = await axios.get(apiUrl, { params, headers });

        if (response.data?.Data?.Data) {
            return response.data.Data.Data.map(item => ({
                timestamp: new Date(item.time * 1000),
                close: item.close,
                price: item.close
            }));
        }
        throw new Error('Invalid data format from CryptoCompare');
    } catch (error) {
        console.error('Error fetching CryptoCompare chart data:', error);
        return null;
    }
}
function createEmbeddedChart(canvas, chartData, symbol, pair) {
    if (!canvas || !chartData || chartData.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    
    // Properly destroy any existing chart
    if (window.Chart.getChart(canvas)) {
        window.Chart.getChart(canvas).destroy();
    }

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Calculate segments for color changes
    const segments = chartData.map((point, index) => {
        if (index === 0) return { ...point, isUp: true };
        return {
            ...point,
            isUp: point.close >= chartData[index - 1].close
        };
    });

    const chartConfig = {
        type: 'line',
        data: {
            labels: segments.map(d => d.timestamp),
            datasets: [{
                data: segments.map(d => d.close),
                borderColor: function(context) {
                    if (!context || typeof context.dataIndex === 'undefined') {
                        return COLORS.UP;
                    }
                    const index = context.dataIndex;
                    // Handle first point
                    if (index === 0) {
                        return segments.length > 1 ? 
                            (segments[1].close >= segments[0].close ? COLORS.UP : COLORS.DOWN) : 
                            COLORS.UP;
                    }
                    // Handle other points
                    return segments[index] && segments[index].isUp ? COLORS.UP : COLORS.DOWN;
                },
                segment: {
                    borderColor: ctx => {
                        if (!ctx || typeof ctx.p0DataIndex === 'undefined') {
                            return COLORS.UP;
                        }
                        const index = ctx.p0DataIndex;
                        // Handle last segment
                        if (index >= segments.length - 1) {
                            return COLORS.UP;
                        }
                        // Handle other segments
                        return segments[index + 1].close >= segments[index].close ? 
                            COLORS.UP : COLORS.DOWN;
                    }
                },
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 0,
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 10,
                    right: 16,
                    bottom: 10,
                    left: 10
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: COLORS.TOOLTIP_BG,
                    titleColor: COLORS.TEXT,
                    bodyColor: COLORS.TEXT,
                    borderColor: COLORS.GRID,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => {
                            const value = context.parsed.y;
                            return `$${value.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { 
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        color: COLORS.TEXT,
                        maxRotation: 0,
                        maxTicksLimit: 8,
                        font: { size: 11 }
                    },
                    display: true,
                    offset: false
                },
                y: {
                    position: 'left',
                    grid: { 
                        color: COLORS.GRID,
                        drawBorder: false
                    },
                    ticks: {
                        color: COLORS.TEXT,
                        callback: (value) => `$${value.toFixed(2)}`,
                        font: { size: 11 },
                        padding: 8
                    },
                    display: true,
                    beginAtZero: false,
                    min: Math.min(...chartData.map(d => d.close)) * 0.9995,
                    max: Math.max(...chartData.map(d => d.close)) * 1.0005
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            animation: {
                duration: 750
            }
        }
    };

    // Create new chart instance
    const newChart = new Chart(ctx, chartConfig);

    // Handle resize
    if (!canvas.resizeObserver) {
        canvas.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const chart = window.Chart.getChart(canvas);
                if (!chart) return;
                
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    const dpr = window.devicePixelRatio || 1;
                    canvas.width = width * dpr;
                    canvas.height = height * dpr;
                    canvas.style.width = `${width}px`;
                    canvas.style.height = `${height}px`;
                    
                    requestAnimationFrame(() => {
                        chart.resize();
                    });
                }
            }
        });
        canvas.resizeObserver.observe(canvas.parentElement);
    }

    // Clean up observer when chart is destroyed
    const originalDestroy = newChart.destroy;
    newChart.destroy = function() {
        if (canvas.resizeObserver) {
            canvas.resizeObserver.disconnect();
            delete canvas.resizeObserver;
        }
        originalDestroy.call(this);
    };

    return newChart;
}

module.exports = displayEmbeddedChart;