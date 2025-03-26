const axios = require('axios');
const CRYPTOCOMPARE_API_KEY = 'your-api-key-here';

const TIMEFRAMES = {
    '1H': { interval: 'minute', limit: 60, days: 1/24 },
    '4H': { interval: 'minute', limit: 240, days: 1/6 },
    '24H': { interval: 'minute', limit: 24 * 60, days: 1 },
    '1W': { interval: 'hour', limit: 7 * 24, days: 7 }
};

const CHART_TYPES = {
    LINE: 'line'
};

const COLORS = {
    UP: '#ea3943',        // Red for price decrease #ea3943
    DOWN: '#ea3943',      // Green for price increase
    GRID: '#363c4e',      // Dark grid lines
    TEXT: '#a6b0c3',      // Light gray text
    TOOLTIP_BG: '#1c1f2d' // Dark tooltip background
};

async function displayEmbeddedChart(symbol, pair, chartContainer, chartType = CHART_TYPES.LINE, timeframe = '1H') {
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
        if (minimizeBtn) {
            chartHeader.insertBefore(timeSelector, minimizeBtn);
        } else {
            chartHeader.appendChild(timeSelector);
        }
    }

    chartTitle.textContent = `Loading ${symbol}/${pair} data...`;

    try {
        const selectedTimeframe = TIMEFRAMES[timeframe] || TIMEFRAMES['1H'];
        const chartData = await fetchCryptoCompareChartData(symbol, selectedTimeframe, pair);
        
        if (chartData && chartData.length > 0) {
            createEmbeddedChart(chartCanvas, chartData, symbol, pair);
            chartTitle.textContent = `${symbol}/${pair}`;
        } else {
            throw new Error("No chart data available");
        }
    } catch (error) {
        console.error("Error displaying chart:", error);
        chartTitle.textContent = `Error loading ${symbol}/${pair}`;
    }
}

async function fetchCryptoCompareChartData(symbol, timeframe, pair = 'USD') {
    if (!symbol || !timeframe) {
        console.error('Invalid parameters:', { symbol, timeframe, pair });
        return null;
    }

    try {
        let apiUrl;
        const params = {
            fsym: symbol.toUpperCase(),
            tsym: pair.toUpperCase(), // Use the provided pair instead of hardcoding USD
            limit: timeframe.limit
        };

        // Handle special cases for pairs
        if (pair.toUpperCase() === 'USD') {
            params.tsym = 'USDT'; // Use USDT as fallback for USD
        }

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
        throw new Error(`Invalid data format from CryptoCompare for ${symbol}/${pair}`);
    } catch (error) {
        console.error(`Error fetching CryptoCompare chart data for ${symbol}/${pair}:`, error);
        return null;
    }
}

function createEmbeddedChart(canvas, chartData, symbol, pair) {
    if (!canvas || !chartData || chartData.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    
    if (window.Chart.getChart(canvas)) {
        window.Chart.getChart(canvas).destroy();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const prices = chartData.map(d => d.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceDiff = maxPrice - minPrice;
    
    // Increase padding for better visibility
    const paddingPercentage = 0.05; // Increased from 0.02 to 0.05
    const yMin = minPrice - (priceDiff * paddingPercentage);
    const yMax = maxPrice + (priceDiff * paddingPercentage);

    const segments = chartData.map((point, index) => {
        if (index === 0) return { ...point, isUp: true };
        return {
            ...point,
            isUp: point.close >= chartData[index - 1].close
        };
    });

    const minIndex = prices.indexOf(minPrice);
    const maxIndex = prices.indexOf(maxPrice);

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
                    return index === 0 ? 
                        (segments.length > 1 ? (segments[1].close >= segments[0].close ? COLORS.UP : COLORS.DOWN) : COLORS.UP) :
                        (segments[index].isUp ? COLORS.UP : COLORS.DOWN);
                },
                segment: {
                    borderColor: ctx => {
                        if (!ctx || typeof ctx.p0DataIndex === 'undefined') return COLORS.UP;
                        const index = ctx.p0DataIndex;
                        return index >= segments.length - 1 ? COLORS.UP :
                            segments[index + 1].close >= segments[index].close ? COLORS.UP : COLORS.DOWN;
                    }
                },
                borderWidth: 2,
                pointRadius: (ctx) => {
                    if (!ctx || typeof ctx.dataIndex === 'undefined') return 0;
                    return ctx.dataIndex === minIndex || ctx.dataIndex === maxIndex ? 6 : 0; // Increased from 4 to 6
                },
                pointBackgroundColor: (ctx) => {
                    if (!ctx || typeof ctx.dataIndex === 'undefined') return 'transparent';
                    if (ctx.dataIndex === minIndex) return COLORS.DOWN;
                    if (ctx.dataIndex === maxIndex) return COLORS.UP;
                    return 'transparent';
                },
                pointBorderColor: (ctx) => {
                    if (!ctx || typeof ctx.dataIndex === 'undefined') return 'transparent';
                    if (ctx.dataIndex === minIndex) return COLORS.DOWN;
                    if (ctx.dataIndex === maxIndex) return COLORS.UP;
                    return 'transparent';
                },
                pointBorderWidth: 3, // Increased from 2 to 3
                pointHitRadius: 8, // Increased from 6 to 8
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 10,    // Increased padding
                    right: 5,
                    bottom: 20,
                    left: 5
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
                    padding: 8,
                    displayColors: false,
                    callbacks: {
                        label: (context) => {
                            const value = context.parsed.y;
                    return `$${value.toFixed(2)}`; // Single $ symbol
                        }
                    }
                },
                annotation: {
                    annotations: {
                        minPoint: {
                            type: 'point',
                            xValue: segments[minIndex].timestamp,
                            yValue: minPrice,
                            backgroundColor: COLORS.DOWN,
                            radius: 6
                        },
                        maxPoint: {
                            type: 'point',
                            xValue: segments[maxIndex].timestamp,
                            yValue: maxPrice,
                            backgroundColor: COLORS.UP,
                            radius: 6
                        },
                        minLine: {
                            type: 'line',
                            xMin: segments[minIndex].timestamp,
                            xMax: segments[minIndex].timestamp,
                            yMin: yMin,
                            yMax: minPrice,
                            borderColor: COLORS.DOWN,
                            borderWidth: 1,
                            borderDash: [5, 5]
                        },
                        maxLine: {
                            type: 'line',
                            xMin: segments[maxIndex].timestamp,
                            xMax: segments[maxIndex].timestamp,
                            yMin: yMin,
                            yMax: maxPrice,
                            borderColor: COLORS.UP,
                            borderWidth: 1,
                            borderDash: [5, 5]
                        },
                        minLabel: {
                            type: 'label',
                            xValue: segments[minIndex].timestamp,
                            yValue: minPrice,
                            yAdjust: -25,
                            backgroundColor: COLORS.DOWN,
                            content: `Min: $${minPrice.toFixed(2)}`,
                            color: '#FFFFFF',
                            padding: 5,
                            borderRadius: 4,
                            font: {
                                size: 12,
                                weight: 'bold'
                            }
                        },
                        maxLabel: {
                            type: 'label',
                            xValue: segments[maxIndex].timestamp,
                            yValue: maxPrice,
                            yAdjust: 25,
                            backgroundColor: COLORS.UP,
                            content: `Max: $${maxPrice.toFixed(2)}`,
                            color: '#FFFFFF',
                            padding: 5,
                            borderRadius: 4,
                            font: {
                                size: 12,
                                weight: 'bold'
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { 
                        display: true,
                        drawBorder: false,
                        color: COLORS.GRID
                    },
                    ticks: {
                        display: true,
                        color: COLORS.TEXT,
                        maxRotation: 0,
                        maxTicksLimit: 20,
                        autoSkip: false,
                        font: { size: 11 },
                        callback: function(value, index) {
                            const date = new Date(this.getLabelForValue(value));
                            return date.toLocaleTimeString([], { 
                                hour: '2-digit', 
                                minute: '2-digit'
                            });
                        }
                    },
                    display: true,
                    offset: true
                },
                y: {
                    position: 'right',
                    grid: { 
                        color: COLORS.GRID,
                        drawBorder: false,
                        display: true
                    },
                    ticks: {
                        color: COLORS.TEXT,
                        callback: (value) => `$${value.toFixed(2)}`,
                        font: { size: 11 },
                        padding: 8,
                        maxTicksLimit: 8,
                        autoSkip: false
                    },
                    display: true,
                    min: yMin,
                    max: yMax
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

    const newChart = new Chart(ctx, chartConfig);

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