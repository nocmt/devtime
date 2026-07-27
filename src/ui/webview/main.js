// DevTime Webview Frontend
const vscode = acquireVsCodeApi();
let chart = null, currentData = null, currentRange = 'daily', activeProjectId = null;

vscode.postMessage({ type: 'getData' });
document.addEventListener('DOMContentLoaded', () => { initChart(); bindEvents(); setTimeout(() => vscode.postMessage({ type: 'getData' }), 300); });
window.addEventListener('message', (event) => { if (event.data?.type === 'updateData') { currentData = event.data.data; activeProjectId = currentData.activeProjectId; updateUI(); } });

function initChart() { const d = document.getElementById('timeChart'); if (!d || typeof echarts === 'undefined') return; chart = echarts.init(d); window.addEventListener('resize', () => chart?.resize()); new ResizeObserver(() => chart?.resize()).observe(d); }
function bindEvents() {
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active')); b.classList.add('active'); currentRange = b.dataset.range; updateChart(); }));
  document.getElementById('projectSelect')?.addEventListener('change', e => vscode.postMessage({ type: 'switchProject', projectId: e.target.value }));
  document.getElementById('btnSettings')?.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
}
function updateUI() {
  if (!currentData) return;
  if (currentData.storagePath) { const s = currentData.storagePath; el('storageInfo','数据: '+(s.length>50?'...'+s.slice(-47):s)); el('storageInfoFooter','数据文件: '+(s.length>50?'...'+s.slice(-47):s)); }
  updateProjectSelector(); updateStatsCards(); updateChart(); updateTypeBreakdown();
}
function updateProjectSelector() {
  const p = currentData.allProjects || [], s = document.getElementById('projectSelect'), cid = currentData.activeProjectId;
  if (!s) return;
  s.innerHTML = p.length === 0 ? '<option value="">暂无项目数据</option>' : p.map(x => `<option value="${x.id}" ${x.id===cid?'selected':''}>${x.name} · ${fmt(x.totalSeconds)}</option>`).join('');
  const b = document.getElementById('currentBadge'); if (b && cid) b.style.display = s.value === cid ? 'inline-block' : 'none';
}
function updateStatsCards() {
  const r = currentData.records || {}, rate = currentData.hourlyRate||100, cur = currentData.currency||'¥', now = new Date(), today = now.toISOString().split('T')[0];
  const ws = new Date(now); ws.setDate(now.getDate()+(now.getDay()===0?-6:1-now.getDay())); const wss = ws.toISOString().split('T')[0];
  const ms = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  let td=0,wk=0,mo=0,tt=0;
  Object.entries(r).forEach(([d,o]) => { tt+=o.totalSeconds||0; if(d===today)td=o.totalSeconds||0; if(d>=wss)wk+=o.totalSeconds||0; if(d>=ms)mo+=o.totalSeconds||0; });
  const c = s => cur+(s/3600*rate).toFixed(2);
  el('todayTime',fmt(td));el('todayCost',c(td));el('weekTime',fmt(wk));el('weekCost',c(wk));el('monthTime',fmt(mo));el('monthCost',c(mo));el('totalTime',fmt(tt));el('totalCost',c(tt));
}
function updateChart() {
  if (!chart||!currentData||typeof echarts==='undefined') return;
  const r = currentData.records||{}, now=new Date(); let dates=[], title='';
  switch(currentRange){
    case'daily':for(let i=29;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);dates.push(d.toISOString().split('T')[0]);}title='每日统计';break;
    case'weekly':for(let i=11;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i*7);dates.push(d.toISOString().split('T')[0]);}title='每周统计';break;
    case'monthly':for(let i=11;i>=0;i--)dates.push(`${now.getFullYear()}-${String(now.getMonth()-i+1).padStart(2,'0')}-01`);title='每月统计';break;
    case'yearly':for(let i=4;i>=0;i--)dates.push(`${now.getFullYear()-i}-01-01`);title='每年统计';break;
  }
  el('chartTitle',title);
  chart.setOption({backgroundColor:'transparent',tooltip:{trigger:'axis',formatter:p=>`${p[0].name}<br/><b>${p[0].value}</b> 小时`},grid:{left:'3%',right:'4%',bottom:'3%',top:'10%',containLabel:true},xAxis:{type:'category',data:dates.map(d=>d.substring(5)),axisLabel:{color:'#999'}},yAxis:{type:'value',name:'小时',nameTextStyle:{color:'#999'},axisLabel:{color:'#999'},splitLine:{lineStyle:{color:'#333'}}},series:[{data:dates.map(d=>{const o=r[d];return o?(o.totalSeconds/3600).toFixed(2):0}),type:'bar',itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#5470c6'},{offset:1,color:'#91cc75'}]),borderRadius:[4,4,0,0]}}]},true);
}
function updateTypeBreakdown() {
  const r = currentData.records||{}, rate = currentData.hourlyRate||100, cur = currentData.currency||'¥'; let m=0,a=0,v=0;
  Object.values(r).forEach(o=>{if(!o.entries)return;o.entries.forEach(e=>{if(e.type==='manual_edit')m+=e.duration||0;else if(e.type==='agent_edit')a+=e.duration||0;else v+=e.duration||0;})});
  const c=s=>cur+(s/3600*rate).toFixed(2);el('manualTime',fmt(m));el('manualCost',c(m));el('agentTime',fmt(a));el('agentCost',c(a));el('viewTime',fmt(v));el('viewCost',c(v));
}
function el(id,t){const e=document.getElementById(id);if(e)e.textContent=t;}
function fmt(s){if(!s||s===0)return'0:00';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}:${m.toString().padStart(2,'0')}`:`${m}分`;}
