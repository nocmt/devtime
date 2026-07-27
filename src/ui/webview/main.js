// WorkTime Webview Frontend

const vscode = acquireVsCodeApi();

let chart = null;
let currentData = null;
let currentRange = 'daily';

document.addEventListener('DOMContentLoaded', () => {
  initChart();
  bindEvents();
  vscode.postMessage({ type: 'getData' });
});

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
  window.addEventListener('resize', () => chart?.resize());
  new ResizeObserver(() => chart?.resize()).observe(chartDom);
}

function bindEvents() {
  document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      updateChart();
    });
  });

  document.getElementById('btnSetPassword')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'setPassword' });
  });
  document.getElementById('btnResetPassword')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'resetPassword' });
  });
}

function updateUI() {
  if (!currentData) return;

  // Project name
  document.getElementById('projectBadge').textContent = '📁 ' + (currentData.projectName || '--');

  // Storage info
  if (currentData.storagePath) {
    const shortPath = currentData.storagePath.length > 50
      ? '...' + currentData.storagePath.slice(-47)
      : currentData.storagePath;
    document.getElementById('storageInfo').textContent = '数据: ' + shortPath;
    document.getElementById('storageInfoFooter').textContent = '数据文件: ' + shortPath;
  }

  updateStatsCards();
  updateChart();
  updateTypeBreakdown();
  updateAllProjects();
}

function updateStatsCards() {
  const records = currentData.records || {};
  const rate = currentData.hourlyRate || 100;
  const currency = currentData.currency || '¥';
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const weekStart = new Date(now);
  const dow = now.getDay();
  weekStart.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  let todayS = 0, weekS = 0, monthS = 0, totalS = 0;
  Object.entries(records).forEach(([date, r]) => {
    totalS += r.totalSeconds || 0;
    if (date === today) todayS = r.totalSeconds || 0;
    if (date >= weekStartStr) weekS += r.totalSeconds || 0;
    if (date >= monthStart) monthS += r.totalSeconds || 0;
  });

  const fmt = formatTime;
  const cost = (s) => currency + (s / 3600 * rate).toFixed(2);

  el('todayTime', fmt(todayS)); el('todayCost', cost(todayS));
  el('weekTime', fmt(weekS)); el('weekCost', cost(weekS));
  el('monthTime', fmt(monthS)); el('monthCost', cost(monthS));
  el('totalTime', fmt(totalS)); el('totalCost', cost(totalS));
}

function updateChart() {
  if (!chart || !currentData || typeof echarts === 'undefined') return;

  const records = currentData.records || {};
  const now = new Date();
  let dates = [], title = '';

  switch (currentRange) {
    case 'daily':
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
      }
      title = '每日统计'; break;
    case 'weekly':
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i * 7);
        dates.push(d.toISOString().split('T')[0]);
      }
      title = '每周统计'; break;
    case 'monthly':
      for (let i = 11; i >= 0; i--) {
        dates.push(`${now.getFullYear()}-${String(now.getMonth() - i + 1).padStart(2, '0')}-01`);
      }
      title = '每月统计'; break;
    case 'yearly':
      for (let i = 4; i >= 0; i--) dates.push(`${now.getFullYear() - i}-01-01`);
      title = '每年统计'; break;
  }

  el('chartTitle', title);

  const data = dates.map(d => {
    const r = records[d];
    return r ? (r.totalSeconds / 3600).toFixed(2) : 0;
  });

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', formatter: p => `${p[0].name}<br/><b>${p[0].value}</b> 小时` },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
    xAxis: { type: 'category', data: dates.map(d => d.substring(5)), axisLabel: { color: '#999' } },
    yAxis: { type: 'value', name: '小时', nameTextStyle: { color: '#999' }, axisLabel: { color: '#999' }, splitLine: { lineStyle: { color: '#333' } } },
    series: [{
      data, type: 'bar',
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#5470c6' }, { offset: 1, color: '#91cc75' }
        ]),
        borderRadius: [4, 4, 0, 0]
      }
    }]
  }, true);
}

function updateTypeBreakdown() {
  const records = currentData.records || {};
  const rate = currentData.hourlyRate || 100;
  const currency = currentData.currency || '¥';
  let m = 0, a = 0, v = 0;

  Object.values(records).forEach(r => {
    if (!r.entries) return;
    r.entries.forEach(e => {
      if (e.type === 'manual_edit') m += e.duration || 0;
      else if (e.type === 'agent_edit') a += e.duration || 0;
      else if (e.type === 'file_view') v += e.duration || 0;
    });
  });

  const fmt = formatTime;
  const cost = (s) => currency + (s / 3600 * rate).toFixed(2);
  el('manualTime', fmt(m)); el('manualCost', cost(m));
  el('agentTime', fmt(a)); el('agentCost', cost(a));
  el('viewTime', fmt(v)); el('viewCost', cost(v));
}

function updateAllProjects() {
  const projects = currentData.allProjects || [];
  const list = document.getElementById('allProjectsList');
  if (!list || projects.length === 0) return;

  list.innerHTML = projects.map(p => `
    <div class="project-row">
      <span class="name">📁 ${p.name}</span>
      <span class="time">${formatTime(p.totalSeconds)}</span>
    </div>
  `).join('');
}

function el(id, text) { const e = document.getElementById(id); if (e) e.textContent = text; }

function formatTime(s) {
  if (!s || s === 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}` : `${m}分`;
}
