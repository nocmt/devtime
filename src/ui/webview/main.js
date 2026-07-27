// WorkTime Webview Frontend
// Note: Runs in webview browser environment, uses acquireVsCodeApi

const vscode = acquireVsCodeApi();

let chart = null;
let currentData = null;
let currentRange = 'daily';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  bindEvents();

  // Request data from extension
  vscode.postMessage({ type: 'getData' });
});

// Receive messages from extension
window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'updateData':
      currentData = message.data;
      updateUI();
      break;
  }
});

function initChart() {
  const chartDom = document.getElementById('timeChart');
  if (!chartDom || typeof echarts === 'undefined') return;
  chart = echarts.init(chartDom);

  // Resize on window resize
  window.addEventListener('resize', () => {
    chart?.resize();
  });

  // Also observe container resize
  const observer = new ResizeObserver(() => {
    chart?.resize();
  });
  observer.observe(chartDom);
}

function bindEvents() {
  // Tab switching
  document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      updateChart();
    });
  });

  // Password buttons
  document.getElementById('btnSetPassword')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'setPassword' });
  });

  document.getElementById('btnResetPassword')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'resetPassword' });
  });
}

function updateUI() {
  if (!currentData) return;

  updateStatsCards();
  updateChart();
  updateTypeBreakdown();
}

function updateStatsCards() {
  const records = currentData.records || {};
  const rate = currentData.hourlyRate || 100;
  const currency = currentData.currency || '¥';

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Week start (Monday)
  const weekStart = new Date(now);
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(now.getDate() + diff);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  // Month start
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  let todaySeconds = 0;
  let weekSeconds = 0;
  let monthSeconds = 0;
  let totalSeconds = 0;

  Object.entries(records).forEach(([date, record]) => {
    totalSeconds += (record.totalSeconds || 0);
    if (date === today) todaySeconds = record.totalSeconds || 0;
    if (date >= weekStartStr) weekSeconds += (record.totalSeconds || 0);
    if (date >= monthStart) monthSeconds += (record.totalSeconds || 0);
  });

  const fmt = formatTime;
  const cost = (s) => `${currency}${(s / 3600 * rate).toFixed(2)}`;

  document.getElementById('todayTime').textContent = fmt(todaySeconds);
  document.getElementById('todayCost').textContent = cost(todaySeconds);
  document.getElementById('weekTime').textContent = fmt(weekSeconds);
  document.getElementById('weekCost').textContent = cost(weekSeconds);
  document.getElementById('monthTime').textContent = fmt(monthSeconds);
  document.getElementById('monthCost').textContent = cost(monthSeconds);
  document.getElementById('totalTime').textContent = fmt(totalSeconds);
  document.getElementById('totalCost').textContent = cost(totalSeconds);
}

function updateChart() {
  if (!chart || !currentData || typeof echarts === 'undefined') return;

  const records = currentData.records || {};
  const now = new Date();
  let filteredDates = [];
  let title = '';

  switch (currentRange) {
    case 'daily':
      // Last 30 days
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        filteredDates.push(d.toISOString().split('T')[0]);
      }
      title = '每日统计';
      break;

    case 'weekly':
      // Last 12 weeks (aggregated)
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        filteredDates.push(d.toISOString().split('T')[0]);
      }
      title = '每周统计';
      break;

    case 'monthly':
      // Last 12 months
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        filteredDates.push(d.toISOString().split('T')[0]);
      }
      title = '每月统计';
      break;

    case 'yearly':
      // Last 5 years
      for (let i = 4; i >= 0; i--) {
        filteredDates.push(`${now.getFullYear() - i}-01-01`);
      }
      title = '每年统计';
      break;
  }

  document.getElementById('chartTitle').textContent = title;

  const data = filteredDates.map(date => {
    const record = records[date];
    return record ? (record.totalSeconds / 3600).toFixed(2) : 0;
  });

  const labels = filteredDates.map(d => d.substring(5)); // MM-DD

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        const val = params[0];
        return `${val.name}<br/><b>${val.value}</b> 小时`;
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#999' },
      axisLine: { lineStyle: { color: '#555' } }
    },
    yAxis: {
      type: 'value',
      name: '小时',
      nameTextStyle: { color: '#999' },
      axisLabel: { color: '#999' },
      splitLine: { lineStyle: { color: '#333' } }
    },
    series: [{
      data: data,
      type: 'bar',
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#5470c6' },
          { offset: 1, color: '#91cc75' }
        ]),
        borderRadius: [4, 4, 0, 0]
      },
      emphasis: {
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#6d8bf0' },
            { offset: 1, color: '#a8e08c' }
          ])
        }
      }
    }]
  };

  chart.setOption(option, true);
}

function updateTypeBreakdown() {
  const records = currentData.records || {};
  const rate = currentData.hourlyRate || 100;
  const currency = currentData.currency || '¥';

  let manualSeconds = 0;
  let agentSeconds = 0;
  let viewSeconds = 0;

  Object.values(records).forEach(record => {
    if (!record.entries) return;
    record.entries.forEach(entry => {
      switch (entry.type) {
        case 'manual_edit': manualSeconds += entry.duration || 0; break;
        case 'agent_edit': agentSeconds += entry.duration || 0; break;
        case 'file_view': viewSeconds += entry.duration || 0; break;
      }
    });
  });

  const fmt = formatTime;
  const cost = (s) => `${currency}${(s / 3600 * rate).toFixed(2)}`;

  document.getElementById('manualTime').textContent = fmt(manualSeconds);
  document.getElementById('manualCost').textContent = cost(manualSeconds);
  document.getElementById('agentTime').textContent = fmt(agentSeconds);
  document.getElementById('agentCost').textContent = cost(agentSeconds);
  document.getElementById('viewTime').textContent = fmt(viewSeconds);
  document.getElementById('viewCost').textContent = cost(viewSeconds);
}

function formatTime(seconds) {
  if (!seconds || seconds === 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}`;
  }
  return `${m}分`;
}
