const http = require('http');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');

const ROOT = __dirname;
const EXPORTS = path.join(ROOT, 'exports');
const PORT = Number(process.env.SIGNAL_LAB_PORT || 4186);
const TEMPLATE_HTML = path.join(EXPORTS, 'coins-mentioned-30m-report-2026-05-19.html');
const TEMPLATE_JSON = path.join(EXPORTS, 'coins-mentioned-30m-report-2026-05-19.json');
const CURRENT_REPORT_STATE = path.join(ROOT, 'current-report.json');
const ML_BRAIN_MODEL = path.join(ROOT, 'ml-brain-model.json');
const FIT_LABELS_JSONL = path.join(ROOT, 'fit-labels.jsonl');
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const SYMBOL_FALLBACKS = { WETH: 'ETHUSDT' };
const BINANCE_INTERVALS = [
  { interval: '1m', ms: 60_000 },
  { interval: '3m', ms: 180_000 },
  { interval: '5m', ms: 300_000 },
  { interval: '15m', ms: 900_000 },
  { interval: '30m', ms: 1_800_000 },
  { interval: '1h', ms: 3_600_000 },
  { interval: '2h', ms: 7_200_000 },
  { interval: '4h', ms: 14_400_000 },
  { interval: '6h', ms: 21_600_000 },
  { interval: '8h', ms: 28_800_000 },
  { interval: '12h', ms: 43_200_000 },
  { interval: '1d', ms: 86_400_000 },
];
const TIER_FLOORS = { core: 0.0035, qualityAlt: 0.005, tactical: 0.0075, speculative: 0.011, weak: 0.014 };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

async function serveStatic(res, file, type) {
  try {
    send(res, 200, await fs.readFile(file, 'utf8'), type);
  } catch {
    send(res, 404, { error: 'file not found' });
  }
}

function patchChartRuntime(html) {
  const splitBuildChart = fsSync.readFileSync(path.join(ROOT, 'chart-runtime-buildChart.js'), 'utf8').trim();
  html = html.replace(/const buildChart=\(coin,mode='mini'\)=>\{[\s\S]*?\};\s*const signalTitle=/, `${splitBuildChart}const signalTitle=`);
  return html
    .replaceAll('step="2.5"', 'step="5"')
    .replaceAll(
      "const forecast=adjustedForecast(coin,bollInfluenceBySymbol[coin.symbol]||0,rsiInfluenceBySymbol[coin.symbol]||0,momentumInfluenceBySymbol[coin.symbol]||0,volatilityInfluenceBySymbol[coin.symbol]||0);const actual=actualSeriesForCoin(coin.symbol);const width=",
      "const sampleSeries=(rows,limit)=>{if(mode==='full'||rows.length<=limit)return rows;const last=rows.length-1;const picked=[];for(let i=0;i<limit;i++){picked.push(rows[Math.round(i*last/(limit-1))]);}return picked.filter((row,index,array)=>row&&(!index||row.label!==array[index-1].label));};const forecastAll=adjustedForecast(coin,bollInfluenceBySymbol[coin.symbol]||0,rsiInfluenceBySymbol[coin.symbol]||0,momentumInfluenceBySymbol[coin.symbol]||0,volatilityInfluenceBySymbol[coin.symbol]||0,compositeInfluenceBySymbol[coin.symbol]||0,supportInfluenceBySymbol[coin.symbol]||0,breakoutInfluenceBySymbol[coin.symbol]||0,mlInfluenceBySymbol[coin.symbol]||0);const actualAll=actualSeriesForCoin(coin.symbol);const forecastLabelSet=new Set(forecastAll.map(point=>point.label));const previewVisible=mode!=='full'||window.__signalShowPreviewLine!==false;const actualFiltered=previewVisible?actualAll:actualAll.filter(point=>forecastLabelSet.has(point.label));const forecast=sampleSeries(forecastAll,90);const actual=sampleSeries(actualFiltered,90);const width="
    )
    .replaceAll(
      "const volatilityInfluenceBySymbol={};",
      "const volatilityInfluenceBySymbol={};const compositeInfluenceBySymbol={};const supportInfluenceBySymbol={};const breakoutInfluenceBySymbol={};const mlInfluenceBySymbol={};"
    )
    .replaceAll(
      "const signalOrder=['boll','rsi','momentum','volatility'];",
      "const signalOrder=['boll','rsi','momentum','volatility','composite','support','breakout','ml'];"
    )
    .replaceAll(
      "const signalLastValues={boll:{},rsi:{},momentum:{},volatility:{}};",
      "const signalLastValues={boll:{},rsi:{},momentum:{},volatility:{},composite:{},support:{},breakout:{},ml:{}};"
    )
    .replaceAll(
      "const adjustedForecast=(coin,bollInfluence,rsiInfluence,momentumInfluence,volatilityInfluence)=>",
      "const adjustedForecast=(coin,bollInfluence,rsiInfluence,momentumInfluence,volatilityInfluence,compositeInfluence,supportInfluence,breakoutInfluence,mlInfluence)=>"
    )
    .replaceAll(
      "const volatilityAmount=clamp(Number(volatilityInfluence||0),0,100)/100;",
      "const volatilityAmount=clamp(Number(volatilityInfluence||0),0,100)/100;const compositeAmount=clamp(Number(compositeInfluence||0),0,100)/100;const supportAmount=clamp(Number(supportInfluence||0),0,100)/100;const breakoutAmount=clamp(Number(breakoutInfluence||0),0,100)/100;const mlAmount=clamp(Number(mlInfluence||0),0,100)/100;"
    )
    .replaceAll(
      "if(volatilityAmount){const half=(high-low)/2;const center=(high+low)/2;const horizon=.35+.65*Math.sqrt(index+1)/Math.sqrt(Math.max(source.length,1));const calmTighten=volPressure<0?volPressure*.28:0;const noisyWiden=volPressure>0?volPressure*.55:0;const regimeScale=1+volatilityAmount*(calmTighten+noisyWiden)*horizon;low=center-half*regimeScale;high=center+half*regimeScale;mid=center;}return {...point,low,high,mid};",
      "if(volatilityAmount){const half=(high-low)/2;const center=(high+low)/2;const horizon=.35+.65*Math.sqrt(index+1)/Math.sqrt(Math.max(source.length,1));const calmTighten=volPressure<0?volPressure*.28:0;const noisyWiden=volPressure>0?volPressure*.55:0;const regimeScale=1+volatilityAmount*(calmTighten+noisyWiden)*horizon;low=center-half*regimeScale;high=center+half*regimeScale;mid=center;}if(compositeAmount){const half=(high-low)/2;const center=(high+low)/2;const horizon=Math.sqrt(index+1)/Math.sqrt(Math.max(source.length,1));const confidence=clamp(Math.abs(trendPressure)*.44+Math.abs(pressure)*.31+Math.max(0,volPressure)*.25,0,1);const direction=clamp(trendPressure*.55+pressure*.30+volPressure*.15,-1,1);const squeeze=1+compositeAmount*(.08+confidence*.34)*horizon;const drift=center*direction*compositeAmount*.010*horizon;low=center+drift-half*squeeze*(1+Math.max(0,-direction)*.20);high=center+drift+half*squeeze*(1+Math.max(0,direction)*.20);mid=center+drift;}if(supportAmount){const center=(high+low)/2;const recent=actual.slice(-34);const support=recent.length?Math.min(...recent):center;const horizon=.25+.75*Math.sqrt(index+1)/Math.sqrt(Math.max(source.length,1));const floor=Math.min(center,support*(1-(bollFloorByTier[coin.qualityTier]||.008)*horizon));low=low*(1-supportAmount*.62)+floor*(supportAmount*.62);}if(breakoutAmount){const half=(high-low)/2;const center=(high+low)/2;const horizon=Math.pow((index+1)/Math.max(source.length,1),.72);const direction=clamp(trendPressure+pressure*.35,-1,1);const scale=1+breakoutAmount*(.10+Math.abs(direction)*.30)*horizon;const lean=direction*breakoutAmount*.24*horizon;low=center-half*scale*(1-Math.max(0,lean)*.35+Math.max(0,-lean)*.55);high=center+half*scale*(1+Math.max(0,lean)*.55-Math.max(0,-lean)*.35);mid=center+center*direction*breakoutAmount*.008*horizon;}if(mlAmount){const half=(high-low)/2;const center=(high+low)/2;const prior=(coin.learning&&coin.learning.prior48h)||{};const moves=(coin.learning&&coin.learning.recentMovePct)||{};const hit=Number.isFinite(Number(prior.hitRate))?Number(prior.hitRate):.5;const widthHint=Number.isFinite(Number(prior.widthMultiplier))?Number(prior.widthMultiplier):1;const move3=(Number(moves['3h'])||0)/100;const move12=(Number(moves['12h'])||0)/100;const move24=(Number(moves['24h'])||0)/100;const labDirection=clamp(move3*.45+move12*.35+move24*.20+trendPressure*.015,-.04,.04);const horizon=Math.pow((index+1)/Math.max(source.length,1),.65);const missWiden=clamp((.72-hit)*.55,0,.28);const learnedScale=1+mlAmount*(missWiden+(widthHint-1)*.25+Math.abs(labDirection)*7)*horizon;const learnedShift=center*labDirection*mlAmount*horizon;low=center+learnedShift-half*learnedScale;high=center+learnedShift+half*learnedScale;mid=center+learnedShift;}return {...point,low,high,mid};"
    )
    .replaceAll(
      "const width=mode==='full'?1280:420;const height=",
      "const zoom=mode==='full'?(window.__signalChartZoom||1):1;const width=mode==='full'?Math.round(1280*zoom):420;const height="
    )
    .replaceAll(
      'const labels=[...actual.map(p=>p.label),...forecast.map(p=>p.label)];',
      "const parseChartLabel=(label)=>{const match=String(label||'').match(/^(\\d{1,2})\\s+([A-Za-z]{3})(?:\\s+(\\d{4}))?\\s+(\\d{2}):(\\d{2})(?::(\\d{2}))?$/);if(!match)return 0;const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};return Date.UTC(Number(match[3]||2026),months[match[2]]??0,Number(match[1]),Number(match[4]),Number(match[5]),Number(match[6]||0));};const labels=[...new Set([...actual.map(p=>p.label),...forecast.map(p=>p.label)])].sort((a,b)=>parseChartLabel(a)-parseChartLabel(b));"
    )
    .replaceAll(
      "const labelStep=mode==='full'?8:12;",
      "const labelTarget=mode==='full'?Math.max(4,Math.floor(width/190)):Math.max(3,Math.floor(width/130));const labelStep=Math.max(1,Math.ceil(labels.length/labelTarget));"
    )
    .replaceAll(
      "const actualPoints=actual.map(p=>`<circle class=\"forecast-point\" data-tip-label=\"${esc(p.label)} actual\" data-tip-value=\"${formatPrice(p.value)}\" cx=\"${xAtLabel(p.label)}\" cy=\"${yAt(p.value)}\" r=\"${mode==='full'?5.2:3.8}\" fill=\"#fff\" stroke=\"#06101d\" stroke-width=\"1.5\"/>`).join('');",
      "const forecastStartLabel=forecast[0]?.label;const actualPoints=actual.map(p=>{const inForecastWindow=forecastStartLabel&&labels.indexOf(p.label)>=labels.indexOf(forecastStartLabel);const pointFill=inForecastWindow?'#fff':'#ffca63';return `<circle class=\"forecast-point\" data-tip-label=\"${esc(p.label)} actual\" data-tip-value=\"${formatPrice(p.value)}\" cx=\"${xAtLabel(p.label)}\" cy=\"${yAt(p.value)}\" r=\"${mode==='full'?5.2:3.8}\" fill=\"${pointFill}\" stroke=\"#06101d\" stroke-width=\"1.5\"/>`;}).join('');"
    )
    .replaceAll(
      "const signalTitle=(coin)=>`${coin.symbol} 30-minute forecast - Boll ${bollInfluenceBySymbol[coin.symbol]||0}% | RSI ${rsiInfluenceBySymbol[coin.symbol]||0}% | Momentum ${momentumInfluenceBySymbol[coin.symbol]||0}% | Volatility ${volatilityInfluenceBySymbol[coin.symbol]||0}% <span class=\"signal-mode\">${activeSignal==='boll'?'B active':activeSignal==='rsi'?'R active':activeSignal==='momentum'?'M active':'V active'}</span>`;",
      "const signalTitle=(coin)=>`${coin.symbol} 30-minute forecast - Boll ${bollInfluenceBySymbol[coin.symbol]||0}% | RSI ${rsiInfluenceBySymbol[coin.symbol]||0}% | Momentum ${momentumInfluenceBySymbol[coin.symbol]||0}% | Volatility ${volatilityInfluenceBySymbol[coin.symbol]||0}% | Frankenstein ${compositeInfluenceBySymbol[coin.symbol]||0}% | Support ${supportInfluenceBySymbol[coin.symbol]||0}% | Breakout ${breakoutInfluenceBySymbol[coin.symbol]||0}% | ML ${mlInfluenceBySymbol[coin.symbol]||0}% <span class=\"signal-mode\">${activeSignal==='boll'?'B active':activeSignal==='rsi'?'R active':activeSignal==='momentum'?'M active':activeSignal==='volatility'?'V active':activeSignal==='composite'?'F active':activeSignal==='support'?'S active':activeSignal==='breakout'?'X active':'ML active'}</span>`;"
    )
    .replaceAll(
      "const controls=boll+rsi+momentum+volatility;",
      "const composite=`<div class=\"boll-control composite-control\" data-signal-key=\"5\"><label><b>5</b> Frankenstein blend <span class=\"boll-value\" data-composite-value=\"${target}\">${compositeInfluenceBySymbol[coin.symbol]||0}%</span></label><input class=\"composite-slider\" data-symbol=\"${esc(coin.symbol)}\" data-target=\"${target}\" type=\"range\" min=\"0\" max=\"100\" step=\"5\" value=\"${compositeInfluenceBySymbol[coin.symbol]||0}\"><small><span>raw signals</span><span>composite pressure</span></small></div>`;const support=`<div class=\"boll-control support-control\" data-signal-key=\"6\"><label><b>6</b> Support memory <span class=\"boll-value\" data-support-value=\"${target}\">${supportInfluenceBySymbol[coin.symbol]||0}%</span></label><input class=\"support-slider\" data-symbol=\"${esc(coin.symbol)}\" data-target=\"${target}\" type=\"range\" min=\"0\" max=\"100\" step=\"5\" value=\"${supportInfluenceBySymbol[coin.symbol]||0}\"><small><span>free downside</span><span>recent support floor</span></small></div>`;const breakout=`<div class=\"boll-control breakout-control\" data-signal-key=\"7\"><label><b>7</b> Breakout bias <span class=\"boll-value\" data-breakout-value=\"${target}\">${breakoutInfluenceBySymbol[coin.symbol]||0}%</span></label><input class=\"breakout-slider\" data-symbol=\"${esc(coin.symbol)}\" data-target=\"${target}\" type=\"range\" min=\"0\" max=\"100\" step=\"5\" value=\"${breakoutInfluenceBySymbol[coin.symbol]||0}\"><small><span>neutral cone</span><span>trend breakout cone</span></small></div>`;const ml=`<div class=\"boll-control ml-control\" data-signal-key=\"8\"><label><b>8</b> Heuristic brain <span class=\"boll-value\" data-ml-value=\"${target}\">${mlInfluenceBySymbol[coin.symbol]||0}%</span></label><input class=\"ml-slider\" data-symbol=\"${esc(coin.symbol)}\" data-target=\"${target}\" type=\"range\" min=\"0\" max=\"100\" step=\"5\" value=\"${mlInfluenceBySymbol[coin.symbol]||0}\"><small><span>prototype</span><span>learned correction</span></small></div>`;const controls=boll+rsi+momentum+volatility+composite+support+breakout+ml;"
    )
    .replaceAll(
      "const controls=boll+rsi+momentum+volatility+composite+support+breakout+ml;",
      "const forecastLabelSet=new Set((coin.forecast30m||[]).map(point=>point.label));const observedCount=actualSeriesForCoin(coin.symbol).filter(point=>forecastLabelSet.has(point.label)).length;const forecastCount=Math.max(1,(coin.forecast30m||[]).length);const fitCoverage=Math.min(1,observedCount/forecastCount);const fitLocked=fitCoverage<.9;const fit=`<div class=\"boll-control fit-control ${fitLocked?'is-locked':''}\" data-signal-key=\"9\"><label><b>9</b> Fit balance <span class=\"boll-value\">${Math.round(fitCoverage*100)}%</span></label><button class=\"fit-open\" data-symbol=\"${esc(coin.symbol)}\" data-coverage=\"${fitCoverage.toFixed(4)}\" ${fitLocked?'disabled':''} type=\"button\">${fitLocked?'Waiting':'Open modal'}</button><small><span>tight area</span><span>trend success</span></small></div>`;const controls=boll+rsi+momentum+volatility+composite+support+breakout+ml+fit;"
    )
    .replaceAll(
      "const bottomLabels=labels.map((label,i)=>i%labelStep?'':",
      "const bottomLabels=labels.map((label,i)=>(i&&i!==labels.length-1&&i%labelStep)?'':"
    )
    .replaceAll(
      "document.querySelectorAll(`.volatility-slider[data-symbol=\"${coin.symbol}\"]`).forEach(slider=>{if(Number(slider.value)!==(volatilityInfluenceBySymbol[coin.symbol]||0))slider.value=volatilityInfluenceBySymbol[coin.symbol]||0;});signalOrder.forEach",
      "document.querySelectorAll(`.volatility-slider[data-symbol=\"${coin.symbol}\"]`).forEach(slider=>{if(Number(slider.value)!==(volatilityInfluenceBySymbol[coin.symbol]||0))slider.value=volatilityInfluenceBySymbol[coin.symbol]||0;});document.querySelectorAll('[data-composite-value]').forEach(el=>{el.textContent=(compositeInfluenceBySymbol[coin.symbol]||0)+'%';});document.querySelectorAll('[data-support-value]').forEach(el=>{el.textContent=(supportInfluenceBySymbol[coin.symbol]||0)+'%';});document.querySelectorAll('[data-breakout-value]').forEach(el=>{el.textContent=(breakoutInfluenceBySymbol[coin.symbol]||0)+'%';});document.querySelectorAll('[data-ml-value]').forEach(el=>{el.textContent=(mlInfluenceBySymbol[coin.symbol]||0)+'%';});document.querySelectorAll(`.composite-slider[data-symbol=\"${coin.symbol}\"]`).forEach(slider=>{if(Number(slider.value)!==(compositeInfluenceBySymbol[coin.symbol]||0))slider.value=compositeInfluenceBySymbol[coin.symbol]||0;});document.querySelectorAll(`.support-slider[data-symbol=\"${coin.symbol}\"]`).forEach(slider=>{if(Number(slider.value)!==(supportInfluenceBySymbol[coin.symbol]||0))slider.value=supportInfluenceBySymbol[coin.symbol]||0;});document.querySelectorAll(`.breakout-slider[data-symbol=\"${coin.symbol}\"]`).forEach(slider=>{if(Number(slider.value)!==(breakoutInfluenceBySymbol[coin.symbol]||0))slider.value=breakoutInfluenceBySymbol[coin.symbol]||0;});document.querySelectorAll(`.ml-slider[data-symbol=\"${coin.symbol}\"]`).forEach(slider=>{if(Number(slider.value)!==(mlInfluenceBySymbol[coin.symbol]||0))slider.value=mlInfluenceBySymbol[coin.symbol]||0;});signalOrder.forEach"
    )
    .replaceAll(
      "document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider')",
      "document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider,.composite-slider,.support-slider,.breakout-slider,.ml-slider')"
    )
    .replaceAll(
      "else if(slider.classList.contains('volatility-slider')){volatilityInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='volatility';}else{bollInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='boll';}",
      "else if(slider.classList.contains('volatility-slider')){volatilityInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='volatility';}else if(slider.classList.contains('composite-slider')){compositeInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='composite';}else if(slider.classList.contains('support-slider')){supportInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='support';}else if(slider.classList.contains('breakout-slider')){breakoutInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='breakout';}else if(slider.classList.contains('ml-slider')){mlInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='ml';}else{bollInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='boll';}"
    )
    .replaceAll(
      "const signalStore={boll:bollInfluenceBySymbol,rsi:rsiInfluenceBySymbol,momentum:momentumInfluenceBySymbol,volatility:volatilityInfluenceBySymbol};const signalSelectors={boll:'.boll-slider',rsi:'.rsi-slider',momentum:'.momentum-slider',volatility:'.volatility-slider'};const signalClassByName={boll:'boll-slider',rsi:'rsi-slider',momentum:'momentum-slider',volatility:'volatility-slider'};const setSignalValue=",
      "const signalStore={boll:bollInfluenceBySymbol,rsi:rsiInfluenceBySymbol,momentum:momentumInfluenceBySymbol,volatility:volatilityInfluenceBySymbol,composite:compositeInfluenceBySymbol,support:supportInfluenceBySymbol,breakout:breakoutInfluenceBySymbol,ml:mlInfluenceBySymbol};const signalSelectors={boll:'.boll-slider',rsi:'.rsi-slider',momentum:'.momentum-slider',volatility:'.volatility-slider',composite:'.composite-slider',support:'.support-slider',breakout:'.breakout-slider',ml:'.ml-slider'};const signalClassByName={boll:'boll-slider',rsi:'rsi-slider',momentum:'momentum-slider',volatility:'volatility-slider',composite:'composite-slider',support:'support-slider',breakout:'breakout-slider',ml:'ml-slider'};const setSignalValue="
    )
    .replaceAll(
      "const stepSignal=(coin,delta)=>{if(activeSignal==='rsi'){const current=rsiInfluenceBySymbol[coin.symbol]||0;rsiInfluenceBySymbol[coin.symbol]=clamp(current+delta,0,100);}else if(activeSignal==='momentum'){const current=momentumInfluenceBySymbol[coin.symbol]||0;momentumInfluenceBySymbol[coin.symbol]=clamp(current+delta,0,100);}else if(activeSignal==='volatility'){const current=volatilityInfluenceBySymbol[coin.symbol]||0;volatilityInfluenceBySymbol[coin.symbol]=clamp(current+delta,0,100);}else{const current=bollInfluenceBySymbol[coin.symbol]||0;bollInfluenceBySymbol[coin.symbol]=clamp(current+delta,0,100);}redrawBollCharts(coin);wireSignalSliders(coin);};",
      "const stepSignal=(coin,delta)=>{const store=signalStore[activeSignal]||bollInfluenceBySymbol;const current=store[coin.symbol]||0;store[coin.symbol]=clamp(current+delta,0,100);redrawBollCharts(coin);wireSignalSliders(coin);};"
    )
    .replaceAll(
      "if(full.classList.contains('is-open')&&(event.key.toLowerCase()==='b'||event.key.toLowerCase()==='r'||event.key.toLowerCase()==='m'||event.key.toLowerCase()==='v')){activeSignal=event.key.toLowerCase()==='r'?'rsi':event.key.toLowerCase()==='m'?'momentum':event.key.toLowerCase()==='v'?'volatility':'boll';const symbol=(fullTitle.textContent||'').split(' ')[0];const coin=coinIndex.get(symbol);if(coin)updateSignalReadouts(coin);return;}",
      "if(full.classList.contains('is-open')&&(event.key.toLowerCase()==='b'||event.key.toLowerCase()==='r'||event.key.toLowerCase()==='m'||event.key.toLowerCase()==='v'||event.key.toLowerCase()==='f'||event.key.toLowerCase()==='s'||event.key.toLowerCase()==='x'||event.key.toLowerCase()==='l')){activeSignal=event.key.toLowerCase()==='r'?'rsi':event.key.toLowerCase()==='m'?'momentum':event.key.toLowerCase()==='v'?'volatility':event.key.toLowerCase()==='f'?'composite':event.key.toLowerCase()==='s'?'support':event.key.toLowerCase()==='x'?'breakout':event.key.toLowerCase()==='l'?'ml':'boll';const symbol=(fullTitle.textContent||'').split(' ')[0];const coin=coinIndex.get(symbol);if(coin)updateSignalReadouts(coin);return;}"
    )
    .replaceAll(
      "const name=signalOrder[Number(event.key)-1];if(name)toggleSignal(coin,name);",
      "const keySignalMap={1:'boll',2:'rsi',3:'momentum',4:'volatility',5:'composite',6:'support',7:'breakout',8:'ml'};const name=keySignalMap[Number(event.key)];if(name)toggleSignal(coin,name);"
    )
    .replaceAll(
      "if(full.classList.contains('is-open')&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){const symbol=(fullTitle.textContent||'').split(' ')[0];const coin=coinIndex.get(symbol);if(coin){event.preventDefault();stepSignal(coin,event.key==='ArrowRight'?5:-5);}}",
      "if(full.classList.contains('is-open')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){const symbol=(fullTitle.textContent||'').split(' ')[0];const coin=coinIndex.get(symbol);if(coin){event.preventDefault();const delta=event.key==='ArrowRight'?5:event.key==='ArrowLeft'?-5:event.key==='ArrowUp'?25:-25;stepSignal(coin,delta);}}"
    )
    .replace(/const wireSignalSliders=\(coin\)=>\{document\.querySelectorAll\('\.boll-slider,\.rsi-slider,\.momentum-slider,\.volatility-slider,\.support-slider,\.breakout-slider'\)\.forEach\(slider=>\{if\(slider\.dataset\.wired\)return;slider\.dataset\.wired='1';slider\.addEventListener\('input',\(\)=>\{[\s\S]*?redrawBollCharts\(coin\);\}\);\}\);\};\nconst signalStore=/,
      "const signalNameForSlider=(slider)=>slider.classList.contains('rsi-slider')?'rsi':slider.classList.contains('momentum-slider')?'momentum':slider.classList.contains('volatility-slider')?'volatility':slider.classList.contains('composite-slider')?'composite':slider.classList.contains('support-slider')?'support':slider.classList.contains('breakout-slider')?'breakout':slider.classList.contains('ml-slider')?'ml':'boll';const pendingSignalRedraw={raf:0,coin:null};const scheduleSignalRedraw=(coin)=>{pendingSignalRedraw.coin=coin;if(pendingSignalRedraw.raf)return;pendingSignalRedraw.raf=requestAnimationFrame(()=>{const nextCoin=pendingSignalRedraw.coin;pendingSignalRedraw.raf=0;if(nextCoin){redrawBollCharts(nextCoin);wireSignalSliders(nextCoin);}});};const wireSignalSliders=(coin)=>{document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider,.composite-slider,.support-slider,.breakout-slider,.ml-slider').forEach(slider=>{if(slider.dataset.wired)return;slider.dataset.wired='1';slider.addEventListener('input',()=>{const name=signalNameForSlider(slider);const symbol=slider.dataset.symbol||coin.symbol;signalStore[name][symbol]=Number(slider.value)||0;activeSignal=name;scheduleSignalRedraw(coinIndex.get(symbol)||coin);},{passive:true});});};\nconst signalStore=")
    .replaceAll(
      "const wireSignalSliders=(coin)=>{document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider,.support-slider,.breakout-slider').forEach(slider=>{if(slider.dataset.wired)return;slider.dataset.wired='1';slider.addEventListener('input',()=>{if(slider.classList.contains('rsi-slider')){rsiInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='rsi';}else if(slider.classList.contains('momentum-slider')){momentumInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='momentum';}else if(slider.classList.contains('volatility-slider')){volatilityInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='volatility';}else if(slider.classList.contains('support-slider')){supportInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='support';}else if(slider.classList.contains('breakout-slider')){breakoutInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='breakout';}else{bollInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='boll';}redrawBollCharts(coin);});});};",
      "const signalNameForSlider=(slider)=>slider.classList.contains('rsi-slider')?'rsi':slider.classList.contains('momentum-slider')?'momentum':slider.classList.contains('volatility-slider')?'volatility':slider.classList.contains('composite-slider')?'composite':slider.classList.contains('support-slider')?'support':slider.classList.contains('breakout-slider')?'breakout':slider.classList.contains('ml-slider')?'ml':'boll';const pendingSignalRedraw={raf:0,coin:null};const scheduleSignalRedraw=(coin)=>{pendingSignalRedraw.coin=coin;if(pendingSignalRedraw.raf)return;pendingSignalRedraw.raf=requestAnimationFrame(()=>{const nextCoin=pendingSignalRedraw.coin;pendingSignalRedraw.raf=0;if(nextCoin){redrawBollCharts(nextCoin);wireSignalSliders(nextCoin);}});};const wireSignalSliders=(coin)=>{document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider,.composite-slider,.support-slider,.breakout-slider,.ml-slider').forEach(slider=>{if(slider.dataset.wired)return;slider.dataset.wired='1';slider.addEventListener('input',()=>{const name=signalNameForSlider(slider);const symbol=slider.dataset.symbol||coin.symbol;signalStore[name][symbol]=Number(slider.value)||0;activeSignal=name;scheduleSignalRedraw(coinIndex.get(symbol)||coin);},{passive:true});});};"
    )
    .replaceAll(
      "const wireSignalSliders=(coin)=>{document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider,.composite-slider,.support-slider,.breakout-slider,.ml-slider').forEach(slider=>{if(slider.dataset.wired)return;slider.dataset.wired='1';slider.addEventListener('input',()=>{if(slider.classList.contains('rsi-slider')){rsiInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='rsi';}else if(slider.classList.contains('momentum-slider')){momentumInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='momentum';}else if(slider.classList.contains('volatility-slider')){volatilityInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='volatility';}else if(slider.classList.contains('composite-slider')){compositeInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='composite';}else if(slider.classList.contains('support-slider')){supportInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='support';}else if(slider.classList.contains('breakout-slider')){breakoutInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='breakout';}else if(slider.classList.contains('ml-slider')){mlInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='ml';}else{bollInfluenceBySymbol[coin.symbol]=Number(slider.value)||0;activeSignal='boll';}redrawBollCharts(coin);});});};",
      "const signalNameForSlider=(slider)=>slider.classList.contains('rsi-slider')?'rsi':slider.classList.contains('momentum-slider')?'momentum':slider.classList.contains('volatility-slider')?'volatility':slider.classList.contains('composite-slider')?'composite':slider.classList.contains('support-slider')?'support':slider.classList.contains('breakout-slider')?'breakout':slider.classList.contains('ml-slider')?'ml':'boll';const pendingSignalRedraw={raf:0,coin:null};const scheduleSignalRedraw=(coin)=>{pendingSignalRedraw.coin=coin;if(pendingSignalRedraw.raf)return;pendingSignalRedraw.raf=requestAnimationFrame(()=>{const nextCoin=pendingSignalRedraw.coin;pendingSignalRedraw.raf=0;if(nextCoin){redrawBollCharts(nextCoin);wireSignalSliders(nextCoin);}});};const wireSignalSliders=(coin)=>{document.querySelectorAll('.boll-slider,.rsi-slider,.momentum-slider,.volatility-slider,.composite-slider,.support-slider,.breakout-slider,.ml-slider').forEach(slider=>{if(slider.dataset.wired)return;slider.dataset.wired='1';slider.addEventListener('input',()=>{const name=signalNameForSlider(slider);const symbol=slider.dataset.symbol||coin.symbol;signalStore[name][symbol]=Number(slider.value)||0;activeSignal=name;scheduleSignalRedraw(coinIndex.get(symbol)||coin);},{passive:true});});};"
    )
    .replaceAll(
      'const openFull=(coin)=>{fullTitle.innerHTML=signalTitle(coin);',
      'const openFull=(coin)=>{window.__signalFullCoinSymbol=coin.symbol;fullTitle.innerHTML=signalTitle(coin);'
    )
    .replaceAll(
      "updateSignalReadouts(coin);};",
      "updateSignalReadouts(coin);};window.__signalRedrawFullChart=()=>{const coin=coinIndex.get(window.__signalFullCoinSymbol);if(coin)redrawBollCharts(coin);};"
    );
}

async function serveReport(res, file) {
  try {
    const html = patchChartRuntime(await fs.readFile(file, 'utf8'));
    send(res, 200, injectSignalLabControls(html, path.basename(file)), 'text/html; charset=utf-8');
  } catch {
    send(res, 404, { error: 'report not found' });
  }
}

function isoLocal(ms = Date.now()) {
  const shifted = new Date(ms + TZ_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}+03:00`;
}

function slugLocal(ms = Date.now()) {
  const shifted = new Date(ms + TZ_OFFSET_MS);
  return shifted.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function labelFromUtc(ms, includeSeconds = false, includeYear = false) {
  const shifted = new Date(ms + TZ_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = shifted.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  const second = String(shifted.getUTCSeconds()).padStart(2, '0');
  const date = includeYear ? `${day} ${month} ${year}` : `${day} ${month}`;
  return includeSeconds ? `${date} ${hour}:${minute}:${second}` : `${date} ${hour}:${minute}`;
}

function timestampFromLocalLabel(label) {
  const match = String(label || '').match(/^(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return NaN;
  const [, day, mon, yearText = '2026', hour, minute, second = '0'] = match;
  const year = Number(yearText);
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(mon);
  return Date.UTC(year, monthIndex, Number(day), Number(hour) - 3, Number(minute), Number(second));
}

function latestClosedUtc(stepMs) {
  return Math.floor(Date.now() / stepMs) * stepMs - stepMs;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function stdev(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = mean(clean);
  return Math.sqrt(mean(clean.map((value) => (value - avg) ** 2)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unitMs(unit) {
  const normalized = String(unit || 'minutes').toLowerCase();
  if (normalized.startsWith('sec')) return 1000;
  if (normalized.startsWith('hour')) return 3_600_000;
  if (normalized.startsWith('day')) return 86_400_000;
  return 60_000;
}

function unitLabel(unit) {
  const normalized = String(unit || 'minutes').toLowerCase();
  if (normalized.startsWith('sec')) return 'seconds';
  if (normalized.startsWith('hour')) return 'hours';
  if (normalized.startsWith('day')) return 'days';
  return 'minutes';
}

function densityText(value, unit) {
  const normalized = unitLabel(unit);
  const suffix = normalized === 'seconds' ? 's' : normalized === 'minutes' ? 'm' : normalized === 'hours' ? 'h' : 'd';
  return `${value}${suffix}`;
}

function chooseBinanceInterval(densityMs) {
  let chosen = BINANCE_INTERVALS[0];
  for (const item of BINANCE_INTERVALS) {
    if (Math.abs(item.ms - densityMs) < Math.abs(chosen.ms - densityMs)) chosen = item;
  }
  return chosen;
}

function forecastConfig(input = {}) {
  const legacyDensity = Number(input.densityMinutes || 30);
  const legacyLength = Number(input.forecastLengthHours || 24);
  const densityValue = Math.round(clamp(Number(input.densityValue ?? legacyDensity), 1, 60));
  const densityUnit = unitLabel(input.densityUnit || 'minutes');
  const requestedDensityMs = densityValue * unitMs(densityUnit);
  const pointCount = Math.round(clamp(Number(input.pointCount ?? forecastPointCount(legacyDensity * 60_000, legacyLength)), 10, 300));
  const inputPointCount = Math.round(clamp(Number(input.inputPointCount ?? pointCount), 10, 300));
  const candle = chooseBinanceInterval(requestedDensityMs);
  const densityMs = candle.ms;
  const strategy = String(input.strategy || 'default').replace(/[^a-z0-9-]+/gi, '').slice(0, 40) || 'default';
  return {
    strategy,
    densityValue,
    densityUnit,
    requestedDensityMs,
    requestedDensityLabel: densityText(densityValue, densityUnit),
    densityMs,
    densityMinutes: densityMs / 60_000,
    densityLabel: densityLabel(densityMs / 60_000),
    pointCount,
    inputPointCount,
    lookbackPolicy: inputPointCount === pointCount ? 'mirror-1-to-1' : 'explicit-input-window',
    forecastLengthHours: (pointCount * densityMs) / 3_600_000,
    binanceInterval: candle.interval,
    binanceIntervalMs: candle.ms,
    includeSeconds: densityMs < 60_000,
    includeYear: (pointCount * densityMs) > 30 * 86_400_000,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'corridor-signal-lab/1.0' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function saveFitLabel(input = {}) {
  let current = null;
  try {
    current = path.basename(await currentReportFile());
  } catch {
    current = null;
  }
  const sliderValues = input.sliderValues && typeof input.sliderValues === 'object' ? input.sliderValues : {};
  const row = {
    type: 'manual-fit-label',
    savedAt: isoLocal(),
    reportName: String(input.reportName || current || ''),
    symbol: String(input.symbol || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(),
    label: String(input.label || 'unlabeled').replace(/[^a-z0-9-]+/gi, '').slice(0, 40),
    coverage: clamp(Number(input.coverage || 0), 0, 1),
    fitBalance: clamp(Number(input.fitBalance || 50), 0, 100),
    sliderValues: {
      bollinger: clamp(Number(sliderValues.bollinger || 0), 0, 100),
      rsi: clamp(Number(sliderValues.rsi || 0), 0, 100),
      momentum: clamp(Number(sliderValues.momentum || 0), 0, 100),
      volatility: clamp(Number(sliderValues.volatility || 0), 0, 100),
      composite: clamp(Number(sliderValues.composite || 0), 0, 100),
      support: clamp(Number(sliderValues.support || 0), 0, 100),
      breakout: clamp(Number(sliderValues.breakout || 0), 0, 100),
      heuristic: clamp(Number(sliderValues.heuristic || 0), 0, 100),
    },
    notes: String(input.notes || '').slice(0, 1200),
  };
  if (!row.symbol) throw new Error('Missing fit label symbol.');
  await fs.appendFile(FIT_LABELS_JSONL, `${JSON.stringify(row)}\n`, 'utf8');
  return { ok: true, row };
}

async function fetchKlines(symbol, { startTime, endTime, interval = '30m', limit = 1000 }) {
  const binanceSymbol = SYMBOL_FALLBACKS[symbol] || `${symbol}USDT`;
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', binanceSymbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', String(Math.min(1000, Math.max(1, limit))));
  return fetchJson(url);
}

function intervalMs(interval) {
  if (interval.endsWith('m')) return Number(interval.slice(0, -1)) * 60_000;
  if (interval.endsWith('h')) return Number(interval.slice(0, -1)) * 3_600_000;
  if (interval.endsWith('d')) return Number(interval.slice(0, -1)) * 86_400_000;
  return 60_000;
}

function sampleRows(rows, densityMs, binanceInterval) {
  const rawMs = intervalMs(binanceInterval);
  const every = Math.max(1, Math.round(densityMs / rawMs));
  if (every <= 1) return rows;
  return rows.filter((_, index) => ((rows.length - 1 - index) % every) === 0);
}

function readJsonFromHtml(html, id = 'report-data') {
  const match = html.match(new RegExp(`<script id="${id}" type="application/json">\\s*([\\s\\S]*?)\\s*</script>`));
  if (!match) throw new Error(`${id} not found`);
  return JSON.parse(match[1]);
}

async function writeJsonIntoHtml(file, id, data) {
  const html = await fs.readFile(file, 'utf8');
  const json = JSON.stringify(data, null, 2);
  const rx = new RegExp(`(<script id="${id}" type="application/json">\\s*)([\\s\\S]*?)(\\s*</script>)`);
  await fs.writeFile(file, html.replace(rx, `$1\n${json}\n$3`), 'utf8');
}

async function currentReportFile() {
  try {
    const state = JSON.parse(await fs.readFile(CURRENT_REPORT_STATE, 'utf8'));
    const file = path.resolve(EXPORTS, state.name || '');
    if (file.startsWith(EXPORTS) && (await fs.stat(file)).isFile()) return file;
  } catch {}
  return TEMPLATE_HTML;
}

async function setCurrentReport(name) {
  await fs.writeFile(CURRENT_REPORT_STATE, JSON.stringify({ name, selectedAt: isoLocal() }, null, 2), 'utf8');
}

function reportJsonName(htmlName) {
  return htmlName.replace(/\.html$/i, '.json');
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function forecastVisual(seed) {
  const colors = ['#23cffb', '#61efb2', '#ffd06d', '#ff7a90', '#b98cff', '#ff9d42', '#7dd3fc', '#f0abfc', '#a3e635', '#f472b6'];
  const fonts = [
    'Verdana, sans-serif',
    'Georgia, serif',
    'Trebuchet MS, sans-serif',
    'Courier New, monospace',
    'Lucida Console, monospace',
    'Segoe UI, sans-serif',
  ];
  const hash = hashString(seed);
  return {
    color: colors[hash % colors.length],
    fontFamily: fonts[Math.floor(hash / 11) % fonts.length],
    fontStyle: Math.floor(hash / 29) % 2 ? 'italic' : 'normal',
    fontWeight: Math.floor(hash / 53) % 2 ? '900' : '700',
  };
}

function shortForecastCreatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'UNKNOWN';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('day')}${part('month').replace('.', '').toUpperCase()} ${part('hour')}:${part('minute')}`;
}

async function readReportData(file) {
  const jsonFile = path.join(EXPORTS, reportJsonName(path.basename(file)));
  try {
    return JSON.parse(await fs.readFile(jsonFile, 'utf8'));
  } catch {
    return readJsonFromHtml(await fs.readFile(file, 'utf8'));
  }
}

async function forecastList() {
  const current = path.basename(await currentReportFile());
  const entries = await fs.readdir(EXPORTS, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^coins-mentioned-30m-report-.*\.html$/i.test(entry.name))
    .map((entry) => path.join(EXPORTS, entry.name));
  const items = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      const data = await readReportData(file);
      const name = path.basename(file);
      const pointCount = data.pointCount || data.coins?.[0]?.forecast30m?.length || 0;
      const shortCreatedAt = shortForecastCreatedAt(data.generatedAt || stat.mtimeMs);
      const density = data.densityLabel || densityLabel(Number(data.densityMinutes || 30));
      items.push({
        name,
        url: `/report/${encodeURIComponent(name)}`,
        current: name === current,
        generatedAt: data.generatedAt,
        shortCreatedAt,
        displayLabel: `${density} / ${pointCount} pts / ${shortCreatedAt}`,
        visual: forecastVisual(`${name}:${data.generatedAt || stat.mtimeMs}`),
        densityLabel: density,
        densityValue: data.densityValue || data.densityMinutes || 30,
        densityUnit: data.densityUnit || 'minutes',
        densityMinutes: data.densityMinutes || 30,
        forecastLengthHours: data.forecastLengthHours || 24,
        pointCount,
        points: pointCount,
        coins: data.coins?.length || 0,
        updatedAt: data.realPriceUpdate?.updatedAt || null,
        mtimeMs: stat.mtimeMs,
      });
    } catch {}
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { forecasts: items };
}

function horizonLabel(hours) {
  if (hours % 24 === 0 && hours >= 144) return `${hours / 24} days`;
  return `${hours}h`;
}

function densityLabel(minutes) {
  if (minutes >= 60) return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return `${minutes}m`;
}

function forecastPointCount(densityMsOrMinutes, forecastLengthHours) {
  const densityMs = densityMsOrMinutes > 1000 ? densityMsOrMinutes : densityMsOrMinutes * 60_000;
  return Math.max(1, Math.round((forecastLengthHours * 3_600_000) / densityMs));
}

function tierFloor(coin) {
  return TIER_FLOORS[coin?.qualityTier] || 0.008;
}

function mlFeatures({ progress, midReturn, widthPct, move3, move12, move24, volPct, floor }) {
  return [
    progress,
    midReturn,
    widthPct,
    move3,
    move12,
    move24,
    volPct,
    floor,
    progress * widthPct,
    progress * move3,
  ].map((value) => (Number.isFinite(value) ? value : 0));
}

function predictMlCorrection(model, features) {
  if (!model?.weights?.length || !model?.mean?.length || !model?.scale?.length) return 0;
  let value = Number(model.bias || 0);
  for (let i = 0; i < model.weights.length; i += 1) {
    value += model.weights[i] * ((features[i] - model.mean[i]) / (model.scale[i] || 1));
  }
  return clamp(value, -0.08, 0.08);
}

async function trainMlBrainModel() {
  const rows = [];
  const files = (await fs.readdir(EXPORTS)).filter((name) => /^coins-mentioned-30m-report-.*\.json$/i.test(name));
  for (const name of files) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(EXPORTS, name), 'utf8'));
      const actualByLabel = new Map((data.actualSnapshots || []).map((snapshot) => [snapshot.label, snapshot.prices || {}]));
      for (const coin of data.coins || []) {
        const forecast = coin.forecast30m || [];
        const base = Number(coin.priceUsdApprox || forecast[0]?.mid || 0);
        const learning = coin.learning || {};
        const moves = learning.recentMovePct || {};
        const move3 = (Number(moves['3h']) || 0) / 100;
        const move12 = (Number(moves['12h']) || 0) / 100;
        const move24 = (Number(moves['24h']) || 0) / 100;
        const volPct = (Number(learning.volatility30mPct) || 0) / 100;
        forecast.forEach((point, index) => {
          const actual = Number(actualByLabel.get(point.label)?.[coin.symbol]);
          const mid = Number(point.mid);
          if (!Number.isFinite(actual) || !Number.isFinite(mid) || actual <= 0 || mid <= 0 || base <= 0) return;
          const progress = forecast.length ? (index + 1) / forecast.length : 0;
          const widthPct = (Number(point.high) - Number(point.low)) / Math.max(mid, 1);
          const midReturn = mid / base - 1;
          const target = clamp(actual / mid - 1, -0.10, 0.10);
          rows.push({ x: mlFeatures({ progress, midReturn, widthPct, move3, move12, move24, volPct, floor: tierFloor(coin) }), y: target });
        });
      }
    } catch {}
  }
  if (rows.length < 30) throw new Error(`Not enough matched forecast/actual points to train ML brain (${rows.length}).`);
  const featureCount = rows[0].x.length;
  const meanX = Array.from({ length: featureCount }, (_, i) => mean(rows.map((row) => row.x[i])));
  const scaleX = Array.from({ length: featureCount }, (_, i) => Math.max(stdev(rows.map((row) => row.x[i])), 1e-9));
  const meanY = mean(rows.map((row) => row.y));
  const weights = Array(featureCount).fill(0);
  const rate = 0.035;
  const ridge = 0.0008;
  for (let epoch = 0; epoch < 650; epoch += 1) {
    const grad = Array(featureCount).fill(0);
    let biasGrad = 0;
    for (const row of rows) {
      const zx = row.x.map((value, i) => (value - meanX[i]) / scaleX[i]);
      const pred = meanY + weights.reduce((sum, weight, i) => sum + weight * zx[i], 0);
      const error = pred - row.y;
      biasGrad += error;
      for (let i = 0; i < featureCount; i += 1) grad[i] += error * zx[i] + ridge * weights[i];
    }
    for (let i = 0; i < featureCount; i += 1) weights[i] -= rate * grad[i] / rows.length;
    const biasStep = rate * biasGrad / rows.length;
    if (Math.abs(biasStep) < 1e-10 && grad.every((value) => Math.abs(value / rows.length) < 1e-8)) break;
  }
  const model = {
    version: 1,
    kind: 'local-ridge-correction',
    trainedAt: isoLocal(),
    samples: rows.length,
    features: ['progress', 'midReturn', 'widthPct', 'move3', 'move12', 'move24', 'volPct', 'tierFloor', 'progressWidth', 'progressMove3'],
    bias: meanY,
    weights,
    mean: meanX,
    scale: scaleX,
  };
  await fs.writeFile(ML_BRAIN_MODEL, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  return model;
}

async function loadMlBrainModel() {
  try {
    return JSON.parse(await fs.readFile(ML_BRAIN_MODEL, 'utf8'));
  } catch {
    return trainMlBrainModel();
  }
}

function recentMove(closes, bars) {
  if (closes.length <= bars || !closes.at(-bars - 1)) return 0;
  return (closes.at(-1) - closes.at(-bars - 1)) / closes.at(-bars - 1);
}

function buildForecastPoints(coin, closes, config, forecastStartUtc, historyStepMinutes) {
  const points = config.pointCount;
  const stepMs = config.densityMs;
  const last = closes.at(-1) || Number(coin.priceUsdApprox || 0);
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1]) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const barsPerHour = Math.max(1, 60 / Math.max(historyStepMinutes, 1 / 60));
  const move3 = recentMove(closes, Math.round(3 * barsPerHour));
  const move12 = recentMove(closes, Math.round(12 * barsPerHour));
  const move24 = recentMove(closes, Math.round(24 * barsPerHour));
  const drift = clamp(move3 * 0.34 + move12 * 0.30 + move24 * 0.20 + mean(returns.slice(-16)) * 16 * 0.16, -0.16, 0.16);
  const vol = Math.max(stdev(returns.slice(-96)), 0.0008);
  const floor = tierFloor(coin);
  const shock = Math.max(...returns.slice(-24).map((value) => Math.abs(value)), floor);
  const prior = coin.learning?.prior48h || {};
  const hitRate = Number.isFinite(Number(prior.hitRate)) ? Number(prior.hitRate) : 0.5;
  const widthMultiplier = Number.isFinite(Number(prior.widthMultiplier)) ? Number(prior.widthMultiplier) : 1;
  const labDrift = clamp(move3 * 0.50 + move12 * 0.32 + move24 * 0.18, -0.045, 0.045);
  const labWidthBoost = 1 + clamp((0.72 - hitRate) * 0.45, 0, 0.35) + clamp((widthMultiplier - 1) * 0.24, 0, 0.30);

  return Array.from({ length: points }, (_, index) => {
    const n = index + 1;
    const progress = n / points;
    const t = forecastStartUtc + index * stepMs;
    const driftComponent = drift * progress;
    const meanRevert = clamp((last - mean(closes.slice(-48))) / Math.max(last, 1), -0.06, 0.06) * -0.18 * progress;
    let mid = last * (1 + driftComponent + meanRevert);
    let width = Math.max(
      last * floor * (1 + Math.sqrt(n) * 0.12),
      last * (vol * Math.sqrt(n) * 2.1 + shock * 0.55 * Math.sqrt(progress))
    );
    if (config.strategy === 'ml-brain') {
      const horizon = Math.pow(progress, 0.7);
      const midReturn = mid / Math.max(last, 1) - 1;
      const widthPct = width * 2 / Math.max(mid, 1);
      const modelCorrection = predictMlCorrection(config.mlModel, mlFeatures({
        progress,
        midReturn,
        widthPct,
        move3,
        move12,
        move24,
        volPct: vol,
        floor,
      }));
      mid += last * labDrift * horizon + mid * modelCorrection * horizon;
      width *= labWidthBoost * (1 + horizon * 0.14 + Math.abs(modelCorrection) * 1.8);
    }
    return {
      label: labelFromUtc(t, config.includeSeconds, config.includeYear),
      low: Math.max(0, mid - width),
      mid,
      high: mid + width,
    };
  });
}

async function createForecast(input = {}) {
  const config = forecastConfig(input);
  if (config.strategy === 'ml-brain') config.mlModel = await loadMlBrainModel();
  const end = latestClosedUtc(config.binanceIntervalMs);
  const historyPoints = config.inputPointCount;
  const start = end - (historyPoints - 1) * config.binanceIntervalMs;
  const fetchStart = start - config.binanceIntervalMs;
  const fetchLimit = historyPoints + 8;
  const base = JSON.parse(await fs.readFile(TEMPLATE_JSON, 'utf8'));
  const market = new Map();
  const errors = [];

  for (const coin of base.coins || []) {
    try {
      const rawRows = await fetchKlines(coin.symbol, {
        interval: config.binanceInterval,
        startTime: fetchStart,
        endTime: end + config.binanceIntervalMs,
        limit: fetchLimit,
      });
      const rows = sampleRows(rawRows, config.densityMs, config.binanceInterval)
        .map((row) => ({ t: Number(row[0]), close: Number(row[4]) }))
        .filter((row) => row.t >= start && row.t <= end && Number.isFinite(row.close));
      market.set(coin.symbol, rows);
    } catch (error) {
      errors.push(`${coin.symbol}: ${error.message}`);
      market.set(coin.symbol, []);
    }
  }

  const actualTimes = [...new Set([...market.values()].flatMap((rows) => rows.map((row) => row.t)))].sort((a, b) => a - b);
  const actualSnapshots = actualTimes.map((t) => {
    const prices = {};
    for (const coin of base.coins || []) {
      const row = market.get(coin.symbol)?.find((item) => item.t === t);
      if (row) prices[coin.symbol] = row.close;
    }
    return { date: new Date(t + TZ_OFFSET_MS).toISOString().slice(0, 10), label: labelFromUtc(t, false), prices };
  }).filter((snapshot) => Object.keys(snapshot.prices).length);

  const forecastStart = end + config.densityMs;
  const next = {
    ...base,
    generatedAt: isoLocal(),
    densityValue: config.densityValue,
    densityUnit: config.densityUnit,
    densityMs: config.densityMs,
    densityMinutes: config.densityMinutes,
    densityLabel: config.densityLabel,
    strategy: config.strategy,
    lookbackPolicy: config.lookbackPolicy,
    inputPointCount: config.inputPointCount,
    mlBrain: config.mlModel ? {
      model: config.mlModel.kind,
      trainedAt: config.mlModel.trainedAt,
      samples: config.mlModel.samples,
      features: config.mlModel.features,
    } : null,
    pointCount: config.pointCount,
    forecastLengthHours: config.forecastLengthHours,
    binanceInterval: config.binanceInterval,
    scope: `Fresh ${config.pointCount}-point ${config.strategy === 'ml-brain' ? 'trained ML-brain ' : ''}forecast at ${config.densityLabel} spacing. Forecast input uses the latest ${config.inputPointCount} real points, mirrored 1:1 in the chart before the corridor.`,
    actualSnapshots,
    realPriceUpdate: {
      updatedAt: isoLocal(),
      source: `Binance public ${config.binanceInterval} klines, forecast spacing ${config.densityLabel}`,
      interval: config.densityLabel,
      actualSnapshots: actualSnapshots.length,
      from: actualSnapshots[0]?.label || null,
      to: actualSnapshots.at(-1)?.label || null,
      errors,
    },
    coins: (base.coins || []).map((coin) => {
      const rows = market.get(coin.symbol) || [];
      const closes = rows.map((row) => row.close);
      const last = closes.at(-1);
      const historyStepMinutes = rows.length > 1 ? Math.max((rows.at(-1).t - rows.at(-2).t) / 60_000, 1 / 60) : config.binanceIntervalMs / 60_000;
      const barsPerHour = Math.max(1, 60 / historyStepMinutes);
      const returns = [];
      for (let i = 1; i < closes.length; i += 1) {
        if (closes[i - 1]) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
      return {
        ...coin,
        priceUsdApprox: Number.isFinite(last) ? last : coin.priceUsdApprox,
        forecast30m: buildForecastPoints(coin, closes, config, forecastStart, historyStepMinutes),
        learning: {
          ...(coin.learning || {}),
          volatility30mPct: (stdev(returns.slice(-96)) * 100).toFixed(4),
          recentMovePct: {
            '3h': (recentMove(closes, Math.round(3 * barsPerHour)) * 100).toFixed(3),
            '12h': (recentMove(closes, Math.round(12 * barsPerHour)) * 100).toFixed(3),
            '24h': (recentMove(closes, Math.round(24 * barsPerHour)) * 100).toFixed(3),
          },
          strategyNote: `Generated in isolated Signal Lab using ${config.pointCount} forecast points at ${config.densityLabel} spacing. Input window: ${config.inputPointCount} points, policy: ${config.lookbackPolicy}. Strategy: ${config.strategy}. History source: Binance ${config.binanceInterval} candles.`,
        },
      };
    }),
  };

  const stamp = slugLocal();
  const safeDensity = config.densityLabel.replace(/[^a-z0-9]+/gi, '');
  const name = `coins-mentioned-30m-report-${stamp}-${safeDensity}-${config.pointCount}pt.html`;
  const outHtml = path.join(EXPORTS, name);
  const outJson = path.join(EXPORTS, reportJsonName(name));
  let html = await fs.readFile(TEMPLATE_HTML, 'utf8');
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>Signal Lab ${config.densityLabel} Forecast</title>`)
    .replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${config.densityLabel} Coin Forecast - ${isoLocal().slice(0, 10)}</h1>`)
    .replace(/<p>Dense[\s\S]*?<\/p>/, `<p>Fresh ${config.pointCount}-point corridor generated from real Binance candles at ${config.densityLabel} forecast spacing. The white line ends before the new forecast window; yellow and green show projected low/high corridor points.</p>`)
    .replace(/<div class="badge">\d+ points \/ coin<\/div>/, `<div class="badge">${config.pointCount} points / coin</div>`);
  const rx = /(<script id="report-data" type="application\/json">\s*)([\s\S]*?)(\s*<\/script>)/;
  html = html.replace(rx, `$1\n${JSON.stringify(next, null, 2)}\n$3`);
  await fs.writeFile(outJson, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await fs.writeFile(outHtml, html, 'utf8');
  await setCurrentReport(name);
  return {
    name,
    file: outHtml,
    url: `/report/${encodeURIComponent(name)}`,
    densityValue: config.densityValue,
    densityUnit: config.densityUnit,
    densityMinutes: config.densityMinutes,
    forecastLengthHours: config.forecastLengthHours,
    strategy: config.strategy,
    lookbackPolicy: config.lookbackPolicy,
    inputPointCount: config.inputPointCount,
    pointCount: config.pointCount,
    points: config.pointCount,
    coins: next.coins.length,
    errors,
  };
}

async function refreshCurrentLivePrices() {
  const file = await currentReportFile();
  const name = path.basename(file);
  const jsonFile = path.join(EXPORTS, reportJsonName(name));
  const data = await readReportData(file);
  const config = forecastConfig(data);
  const coins = data.coins || [];
  const start = timestampFromLocalLabel(data.actualSnapshots?.[0]?.label || coins[0]?.forecast30m?.[0]?.label);
  const forecastEnd = timestampFromLocalLabel(coins[0]?.forecast30m?.at(-1)?.label);
  const end = Math.min(latestClosedUtc(config.binanceIntervalMs), forecastEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('No missing real-price window for this forecast.');

  const errors = [];
  const market = new Map();
  const limit = Math.ceil((end - start) / config.binanceIntervalMs) + 8;
  for (const coin of coins) {
    try {
      const rows = sampleRows(await fetchKlines(coin.symbol, { interval: config.binanceInterval, startTime: start, endTime: end + config.binanceIntervalMs, limit }), config.densityMs, config.binanceInterval);
      market.set(coin.symbol, new Map(rows.map((row) => [Number(row[0]), Number(row[4])])));
    } catch (error) {
      errors.push(`${coin.symbol}: ${error.message}`);
      market.set(coin.symbol, new Map());
    }
  }
  const snapshots = [];
  const actualTimes = [...new Set([...market.values()].flatMap((rows) => [...rows.keys()]))].sort((a, b) => a - b);
  for (const t of actualTimes) {
    const prices = {};
    for (const coin of coins) {
      const value = market.get(coin.symbol)?.get(t);
      if (Number.isFinite(value)) prices[coin.symbol] = value;
    }
    if (Object.keys(prices).length) snapshots.push({ date: new Date(t + TZ_OFFSET_MS).toISOString().slice(0, 10), label: labelFromUtc(t), prices });
  }

  data.actualSnapshots = snapshots;
  data.realPriceUpdate = {
    ...(data.realPriceUpdate || {}),
    updatedAt: isoLocal(),
    source: `Binance public ${config.binanceInterval} klines, forecast spacing ${config.densityLabel}`,
    interval: config.densityLabel,
    actualSnapshots: snapshots.length,
    from: snapshots[0]?.label || null,
    to: snapshots.at(-1)?.label || null,
    errors,
  };
  await fs.writeFile(jsonFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await writeJsonIntoHtml(file, 'report-data', data);
  return { file, name, snapshots: snapshots.length, from: snapshots[0]?.label, to: snapshots.at(-1)?.label, errors };
}

function stripSignalLabControls(html) {
  return html
    .replace(/<style>\s*\.signal-lab-[\s\S]*?<\/style>/g, '')
    .replace(/<details id="signal-lab-panel"[\s\S]*?<\/details>/g, '')
    .replace(/<div id="signal-lab-dock"[\s\S]*?<\/div>/g, '')
    .replace(/<script>\s*\(\(\)\s*=>\s*\{\s*const status = document\.getElementById\('lab-status'\);[\s\S]*?<\/script>/g, '');
}

function injectSignalLabControls(html, activeName) {
  html = stripSignalLabControls(html);
  let activeData = {};
  try {
    activeData = readJsonFromHtml(html);
  } catch {}
  const activePoints = Math.round(clamp(Number(activeData.pointCount || activeData.coins?.[0]?.forecast30m?.length || 48), 10, 300));
  const activeDensityValue = Math.round(clamp(Number(activeData.densityValue || activeData.densityMinutes || 30), 1, 60));
  const activeDensityUnit = unitLabel(activeData.densityUnit || 'minutes');
  const style = `<style>
    :root{--signal-full-chart-width:100vw}
    .grid{grid-template-columns:minmax(0,1.55fr) minmax(280px,.45fr)!important}
    .grid>.panel:nth-child(2){max-width:540px}
    .full-chart{overflow:hidden!important}
    .full-chart-plot{overflow-x:auto!important;overflow-y:hidden!important;width:100vw!important;height:100vh!important;scrollbar-width:thin;scrollbar-color:#23cffb rgba(9,16,29,.72)}
    .full-chart-plot::-webkit-scrollbar{height:13px}
    .full-chart-plot::-webkit-scrollbar-track{background:rgba(9,16,29,.72)}
    .full-chart-plot::-webkit-scrollbar-thumb{background:linear-gradient(90deg,#23cffb,#61efb2);border-radius:999px}
    .full-chart-plot svg{width:var(--signal-full-chart-width,100vw)!important;height:calc(100vh - 4px)!important;max-width:none!important;transform-origin:left center;transition:transform .18s cubic-bezier(.2,.8,.2,1)}
    .full-chart-plot.zoom-spread-in svg{transform:scaleX(1.035)}
    .full-chart-plot.zoom-spread-out svg{transform:scaleX(.965)}
    .full-chart>.boll-dock{bottom:26px!important;grid-template-columns:repeat(9,minmax(0,1fr))!important}
    .composite-control input{accent-color:#38bdf8}
    .support-control input{accent-color:#facc15}
    .breakout-control input{accent-color:#fb7185}
    .ml-control input{accent-color:#e879f9}
    .fit-control button{width:100%;margin-top:5px;border:1px solid #36577c;border-radius:7px;background:#13233a;color:#eaf5ff;font-weight:900;padding:6px 8px;cursor:pointer}
    .fit-control.is-locked{opacity:.42}
    .fit-control button:disabled{cursor:not-allowed;color:#778aa6}
    .fit-modal{position:fixed;inset:0;z-index:130;display:none;align-items:center;justify-content:center;background:rgba(1,6,14,.68);backdrop-filter:blur(8px)}
    .fit-modal.is-open{display:flex}
    .fit-card{width:min(720px,92vw);border:1px solid #34516f;border-radius:16px;background:linear-gradient(180deg,#142039,#0b1221);box-shadow:0 30px 110px rgba(0,0,0,.55);padding:22px;color:#eaf5ff}
    .fit-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}
    .fit-card h3{margin:0;font-size:22px}
    .fit-card p{color:#a9bdd8;line-height:1.5}
    .fit-card label{display:grid;gap:6px;margin:12px 0;color:#9eb5d0;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
    .fit-card select,.fit-card textarea,.fit-card input[type=range]{width:100%}
    .fit-card select,.fit-card textarea{background:#101b2f;color:#eaf5ff;border:1px solid #2c4668;border-radius:10px;padding:10px}
    .fit-card textarea{min-height:90px;resize:vertical;text-transform:none;letter-spacing:0}
    .fit-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
    .fit-actions button{border:1px solid #36577c;border-radius:10px;background:#14243c;color:#eaf5ff;padding:10px 13px;font-weight:900;cursor:pointer}
    .fit-actions .primary{border:0;background:linear-gradient(135deg,#16c7f3,#61efb2);color:#06101d}
    .preview-toggle{position:fixed;right:18px;bottom:112px;z-index:110;display:none;place-items:center;width:38px;height:38px;border:1px solid #34516f;border-radius:10px;background:rgba(9,16,29,.68);color:#fff;font-weight:900;box-shadow:0 12px 36px rgba(0,0,0,.32);backdrop-filter:blur(10px);cursor:pointer}
    .full-modal.is-open~.preview-toggle{display:grid}
    .preview-toggle.is-off{color:#6f85a3;text-decoration:line-through}
    .signal-lab-panel{margin:0 0 18px;border:1px solid #263752;border-radius:10px;background:linear-gradient(180deg,rgba(17,26,43,.96),rgba(9,16,29,.96));box-shadow:0 18px 60px rgba(0,0,0,.28);overflow:hidden}
    .signal-lab-panel summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 12px;color:#edf4ff;font-weight:900}
    .signal-lab-panel summary::-webkit-details-marker{display:none}
    .signal-lab-menu-label{display:flex;align-items:center;gap:10px;color:#9eb5d0;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
    .signal-lab-arrow{display:grid;place-items:center;width:30px;height:30px;border:1px solid #2c4668;border-radius:8px;color:#61efb2;background:#121d30;transition:transform .16s ease,background .16s ease}
    .signal-lab-panel[open] .signal-lab-arrow{transform:rotate(180deg);background:#173449}
    .signal-lab-dock{margin:0;padding:12px 14px;border-top:1px solid rgba(80,130,180,.25);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .signal-lab-dock strong{color:#edf4ff;margin-right:4px}
    .signal-lab-dock select,.signal-lab-dock button{background:#121d30;color:#eaf5ff;border:1px solid #2c4668;border-radius:8px;padding:8px 10px;font-weight:800}
    .signal-lab-dock button.primary{background:linear-gradient(135deg,#16c7f3,#61efb2);color:#06101d;border:0}
    .signal-lab-control{display:grid;grid-template-columns:auto minmax(120px,180px) auto;gap:8px;align-items:center;color:#9eb5d0;font-size:12px}
    .signal-lab-control input[type=range]{width:100%;accent-color:#23cffb}
    .signal-lab-value{color:#edf4ff;font-weight:900;min-width:44px;text-align:right}
    .signal-lab-custom,.signal-lab-presets{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 8px;border:1px solid rgba(80,130,180,.24);border-radius:10px;background:rgba(18,29,48,.44)}
    .signal-lab-custom b,.signal-lab-presets b{color:#61efb2;font-size:11px;text-transform:uppercase;letter-spacing:.09em}
    .signal-lab-dock .status{color:#9eb5d0;font-size:12px;min-width:220px}
    .signal-lab-dock .active-report{color:#61efb2;font-size:12px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style>`;
  const dock = `<details id="signal-lab-panel" class="signal-lab-panel">
    <summary><span class="signal-lab-menu-label">Forecast menu <span class="active-report" title="${activeName}">${activeName}</span></span><span class="signal-lab-arrow" title="show forecast menu">⌄</span></summary>
    <div id="signal-lab-dock" class="signal-lab-dock">
    <span id="lab-custom-controls" class="signal-lab-custom">
      <b>Custom</b>
      <label class="signal-lab-control">Points <input id="lab-points" type="range" min="10" max="300" step="1" value="${activePoints}"><span id="lab-points-value" class="signal-lab-value">${activePoints}</span></label>
      <label class="signal-lab-control">Density <input id="lab-density-value" type="range" min="1" max="60" step="1" value="${activeDensityValue}"><span id="lab-density-readout" class="signal-lab-value">${densityText(activeDensityValue, activeDensityUnit)}</span></label>
      <select id="lab-density-unit"><option value="seconds"${activeDensityUnit === 'seconds' ? ' selected' : ''}>seconds</option><option value="minutes"${activeDensityUnit === 'minutes' ? ' selected' : ''}>minutes</option><option value="hours"${activeDensityUnit === 'hours' ? ' selected' : ''}>hours</option><option value="days"${activeDensityUnit === 'days' ? ' selected' : ''}>days</option></select>
      <button id="lab-generate-custom" class="primary" type="button">FORECAST</button>
      <button id="lab-generate-ml" class="primary" type="button">ML brain forecast</button>
    </span>
    <span id="lab-preset-controls" class="signal-lab-presets">
      <b>Preset</b>
      <label>Density <select id="lab-preset-density">
        <option value="5">5m</option><option value="10">10m</option><option value="15">15m</option><option value="30" selected>30m</option>
        <option value="60">60m</option><option value="120">120m</option><option value="240">4h</option><option value="720">12h</option>
      </select></label>
      <label>Length <select id="lab-preset-length">
        <option value="6">6h</option><option value="12">12h</option><option value="18">18h</option><option value="24" selected>24h</option>
        <option value="48">48h</option><option value="72">72h</option><option value="144">6 days</option><option value="336">14 days</option><option value="720">30 days</option>
      </select></label>
      <button id="lab-generate-preset" class="primary" type="button">FORECAST</button>
    </span>
    <button id="lab-refresh" type="button">Refresh real prices</button>
    <label>Saved <select id="lab-forecast-list"><option>Loading...</option></select></label>
    <button id="lab-load" type="button">Load</button>
    <span id="lab-status" class="status"></span>
    </div>
  </details>`;
  const previewToggle = `<button id="preview-line-toggle" class="preview-toggle" type="button" title="Toggle historical price preview" aria-pressed="true">✓</button>`;
  const fitModal = `<div id="fit-modal" class="fit-modal" aria-hidden="true">
    <section class="fit-card" role="dialog" aria-modal="true" aria-labelledby="fit-modal-title">
      <header><div><h3 id="fit-modal-title">Fit Balance Label</h3><p id="fit-modal-meta">Waiting for coin data.</p></div><button id="fit-modal-close" class="icon-btn" type="button">X</button></header>
      <p>Save this slider state as supervised data. The future algorithm should learn the smallest useful corridor that still respects containment and trend direction.</p>
      <label>Fit balance <input id="fit-balance-range" type="range" min="0" max="100" step="5" value="50"><span id="fit-balance-readout">50% balanced</span></label>
      <label>Human label <select id="fit-label-select"><option value="perfect-fit">perfect-fit</option><option value="good-fit">good-fit</option><option value="trend-fit">trend-fit</option><option value="too-wide">too-wide</option><option value="too-tight">too-tight</option><option value="missed-direction">missed-direction</option><option value="bad-fit">bad-fit</option></select></label>
      <label>Notes <textarea id="fit-label-notes" placeholder="Why this slider state is useful or wrong..."></textarea></label>
      <div class="fit-actions"><button id="fit-modal-cancel" type="button">Cancel</button><button id="fit-modal-save" class="primary" type="button">Save fit label</button></div>
    </section>
  </div>`;
  const script = `<script>
    (() => {
      const status = document.getElementById('lab-status');
      const list = document.getElementById('lab-forecast-list');
      const points = document.getElementById('lab-points');
      const pointsValue = document.getElementById('lab-points-value');
      const densityValue = document.getElementById('lab-density-value');
      const densityUnit = document.getElementById('lab-density-unit');
      const densityReadout = document.getElementById('lab-density-readout');
      const presetDensity = document.getElementById('lab-preset-density');
      const presetLength = document.getElementById('lab-preset-length');
      const previewToggle = document.getElementById('preview-line-toggle');
      const fitModal = document.getElementById('fit-modal');
      const fitMeta = document.getElementById('fit-modal-meta');
      const fitBalance = document.getElementById('fit-balance-range');
      const fitBalanceReadout = document.getElementById('fit-balance-readout');
      const fitLabel = document.getElementById('fit-label-select');
      const fitNotes = document.getElementById('fit-label-notes');
      const detailBodyEl = document.getElementById('detail-body');
      const setStatus = (text) => { status.textContent = text; };
      let pendingFit = null;
      let fullChartZoom = 1;
      let showPreviewLine = true;
      const applyPreviewLineState = () => {
        window.__signalShowPreviewLine = showPreviewLine;
        document.querySelectorAll('.full-chart-plot polyline:nth-of-type(1), .full-chart-plot .forecast-point').forEach((node) => {
          node.style.display = '';
        });
        previewToggle.classList.toggle('is-off', !showPreviewLine);
        previewToggle.textContent = showPreviewLine ? '✓' : '×';
        previewToggle.setAttribute('aria-pressed', String(showPreviewLine));
      };
      const togglePreviewLine = () => {
        showPreviewLine = !showPreviewLine;
        window.__signalShowPreviewLine = showPreviewLine;
        if (typeof window.__signalRedrawFullChart === 'function') window.__signalRedrawFullChart();
        applyPreviewLineState();
        setStatus(showPreviewLine ? 'Preview price line visible.' : 'Preview price line hidden.');
      };
      const sliderValue = (selector) => Number(document.querySelector(selector)?.value || 0);
      const currentSliderValues = () => ({
        bollinger: sliderValue('.full-chart .boll-slider'),
        rsi: sliderValue('.full-chart .rsi-slider'),
        momentum: sliderValue('.full-chart .momentum-slider'),
        volatility: sliderValue('.full-chart .volatility-slider'),
        composite: sliderValue('.full-chart .composite-slider'),
        support: sliderValue('.full-chart .support-slider'),
        breakout: sliderValue('.full-chart .breakout-slider'),
        heuristic: sliderValue('.full-chart .ml-slider'),
      });
      const setFitReadout = () => {
        const value = Number(fitBalance.value || 50);
        fitBalanceReadout.textContent = value <= 25 ? value + '% tight-area biased' : value >= 75 ? value + '% trend biased' : value + '% balanced';
      };
      const openFitModal = (button) => {
        pendingFit = {
          symbol: button.dataset.symbol || activeDrawerSymbol(),
          coverage: Number(button.dataset.coverage || 0),
        };
        fitMeta.textContent = pendingFit.symbol + ' coverage ' + Math.round(pendingFit.coverage * 100) + '%. Slider 9 balances tight area vs trend success.';
        setFitReadout();
        fitModal.classList.add('is-open');
        fitModal.setAttribute('aria-hidden', 'false');
      };
      const closeFitModal = () => {
        fitModal.classList.remove('is-open');
        fitModal.setAttribute('aria-hidden', 'true');
      };
      const saveFitLabel = async () => {
        if (!pendingFit) return;
        const button = document.getElementById('fit-modal-save');
        button.disabled = true;
        try {
          const res = await fetch('/api/save-fit-label', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              symbol: pendingFit.symbol,
              coverage: pendingFit.coverage,
              fitBalance: Number(fitBalance.value || 50),
              label: fitLabel.value,
              notes: fitNotes.value,
              sliderValues: currentSliderValues(),
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          setStatus('Saved fit label for ' + pendingFit.symbol + ' as ' + fitLabel.value + '.');
          closeFitModal();
        } catch (error) {
          setStatus('Fit label save error: ' + error.message);
        } finally {
          button.disabled = false;
        }
      };
      const applyFullChartZoom = () => {
        const plot = document.querySelector('.full-chart-plot');
        const ratio = plot && plot.scrollWidth > plot.clientWidth ? plot.scrollLeft / Math.max(1, plot.scrollWidth - plot.clientWidth) : 0.5;
        window.__signalChartZoom = fullChartZoom;
        document.documentElement.style.setProperty('--signal-full-chart-width', (100 * fullChartZoom) + 'vw');
        if (typeof window.__signalRedrawFullChart === 'function') window.__signalRedrawFullChart();
        requestAnimationFrame(() => {
          const nextPlot = document.querySelector('.full-chart-plot');
          applyPreviewLineState();
          if (nextPlot && nextPlot.scrollWidth > nextPlot.clientWidth) {
            nextPlot.scrollLeft = ratio * (nextPlot.scrollWidth - nextPlot.clientWidth);
          }
        });
        setStatus('Wide chart spacing ' + Math.round(fullChartZoom * 100) + '%. Use + / - while wide chart is open.');
      };
      const animateZoomSpread = (kind) => {
        requestAnimationFrame(() => {
          const plot = document.querySelector('.full-chart-plot');
          if (!plot) return;
          const className = kind === 'plus' ? 'zoom-spread-in' : 'zoom-spread-out';
          plot.classList.remove('zoom-spread-in', 'zoom-spread-out');
          void plot.offsetWidth;
          plot.classList.add(className);
          setTimeout(() => plot.classList.remove(className), 190);
        });
      };
      const zoomChord = { plus: false, minus: false, used: false, timer: null };
      const zoomKeyKind = (event) => {
        if (event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd') return 'plus';
        if (event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') return 'minus';
        return '';
      };
      const runZoomKey = (kind) => {
        fullChartZoom = kind === 'plus'
          ? Math.min(4, Math.round((fullChartZoom + 0.25) * 100) / 100)
          : Math.max(1, Math.round((fullChartZoom - 0.25) * 100) / 100);
        animateZoomSpread(kind);
        applyFullChartZoom();
      };
      document.addEventListener('keydown', (event) => {
        const full = document.getElementById('full-modal');
        if (!full || !full.classList.contains('is-open')) return;
        const kind = zoomKeyKind(event);
        if (!kind) return;
        event.preventDefault();
        zoomChord[kind] = true;
        if (zoomChord.timer) {
          clearTimeout(zoomChord.timer);
          zoomChord.timer = null;
        }
        if (zoomChord.plus && zoomChord.minus) {
          if (!zoomChord.used) {
            zoomChord.used = true;
            togglePreviewLine();
          }
          return;
        }
        if (!event.repeat) {
          zoomChord.timer = setTimeout(() => {
            zoomChord.timer = null;
            if (!zoomChord.used && !(zoomChord.plus && zoomChord.minus)) runZoomKey(kind);
          }, 110);
        }
      });
      document.addEventListener('keyup', (event) => {
        const kind = zoomKeyKind(event);
        if (!kind) return;
        zoomChord[kind] = false;
        if (!zoomChord.plus && !zoomChord.minus) zoomChord.used = false;
      });
      previewToggle.addEventListener('click', togglePreviewLine);
      fitBalance.addEventListener('input', setFitReadout);
      document.getElementById('fit-modal-close').addEventListener('click', closeFitModal);
      document.getElementById('fit-modal-cancel').addEventListener('click', closeFitModal);
      document.getElementById('fit-modal-save').addEventListener('click', saveFitLabel);
      fitModal.addEventListener('click', (event) => {
        if (event.target === fitModal) closeFitModal();
      });
      document.addEventListener('click', (event) => {
        const button = event.target.closest('.fit-open');
        if (button && !button.disabled) openFitModal(button);
      });
      new MutationObserver(applyPreviewLineState).observe(document.getElementById('full-chart'), { childList: true, subtree: true });
      const activeDrawerSymbol = () => (document.getElementById('detail-title')?.textContent || '').split(' ')[0].trim();
      const injectUpdateChartButton = () => {
        const openButton = document.getElementById('open-full');
        if (!openButton || document.getElementById('update-chart')) return;
        const button = document.createElement('button');
        button.id = 'update-chart';
        button.type = 'button';
        button.className = 'action';
        button.textContent = 'Update chart';
        button.title = 'Fetch missing real price points for this report and reopen this coin';
        openButton.insertAdjacentElement('afterend', button);
        button.addEventListener('click', async () => {
          const symbol = activeDrawerSymbol();
          button.disabled = true;
          button.textContent = 'Updating...';
          setStatus('Refreshing real price points...');
          try {
            const res = await fetch('/api/refresh-real-prices', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || res.statusText);
            const next = new URL(location.href);
            if (symbol) next.searchParams.set('openCoin', symbol);
            next.searchParams.set('t', Date.now());
            location.href = next.href;
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Update chart';
            setStatus('Update chart error: ' + error.message);
          }
        });
      };
      const openCoinFromUrl = () => {
        const symbol = new URLSearchParams(location.search).get('openCoin');
        if (!symbol) return;
        const row = [...document.querySelectorAll('.coin-row')].find(item => item.dataset.symbol === symbol);
        if (row) {
          row.click();
          const clean = new URL(location.href);
          clean.searchParams.delete('openCoin');
          history.replaceState(null, '', clean.href);
        }
      };
      if (detailBodyEl) new MutationObserver(injectUpdateChartButton).observe(detailBodyEl, { childList: true, subtree: true });
      const unitSuffix = (unit) => unit === 'seconds' ? 's' : unit === 'minutes' ? 'm' : unit === 'hours' ? 'h' : 'd';
      const updateSliderReadouts = () => {
        pointsValue.textContent = points.value;
        densityReadout.textContent = densityValue.value + unitSuffix(densityUnit.value);
      };
      const customPayload = () => ({
        pointCount: Number(points.value),
        densityValue: Number(densityValue.value),
        densityUnit: densityUnit.value
      });
      const presetPayload = () => {
        const densityMinutes = Number(presetDensity.value);
        const forecastLengthHours = Number(presetLength.value);
        return {
          densityValue: densityMinutes >= 60 ? densityMinutes / 60 : densityMinutes,
          densityUnit: densityMinutes >= 60 ? 'hours' : 'minutes',
          pointCount: Math.max(10, Math.min(300, Math.round((forecastLengthHours * 60) / densityMinutes))),
          densityMinutes,
          forecastLengthHours
        };
      };
      async function runForecast(button, payload, label) {
        button.disabled = true;
        setStatus(label);
        try {
          const res = await fetch('/api/generate-forecast', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          location.href = data.url + '?t=' + Date.now();
        } catch (error) {
          setStatus('Generate error: ' + error.message);
        } finally {
          button.disabled = false;
        }
      }
      async function loadList() {
        try {
          const res = await fetch('/api/forecasts');
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          list.replaceChildren(...data.forecasts.map(item => {
            const option = document.createElement('option');
            const visual = item.visual || {};
            option.value = item.url;
            option.textContent = (item.current ? '* ' : '') + (item.displayLabel || ((item.densityLabel || (item.densityMinutes + 'm')) + ' / ' + (item.pointCount || item.points) + ' pts / ' + (item.shortCreatedAt || item.generatedAt)));
            option.selected = item.name === ${JSON.stringify(activeName)};
            option.dataset.color = visual.color || '#eaf5ff';
            option.dataset.fontFamily = visual.fontFamily || 'inherit';
            option.dataset.fontStyle = visual.fontStyle || 'normal';
            option.dataset.fontWeight = visual.fontWeight || '800';
            option.style.color = option.dataset.color;
            option.style.backgroundColor = '#101a2d';
            option.style.fontFamily = option.dataset.fontFamily;
            option.style.fontStyle = option.dataset.fontStyle;
            option.style.fontWeight = option.dataset.fontWeight;
            return option;
          }));
          applySelectedForecastStyle();
        } catch (error) {
          setStatus('List error: ' + error.message);
        }
      }
      function applySelectedForecastStyle() {
        const option = list.selectedOptions[0];
        if (!option) return;
        list.style.color = option.dataset.color || '#eaf5ff';
        list.style.borderColor = option.dataset.color || '#2c4668';
        list.style.fontFamily = option.dataset.fontFamily || 'inherit';
        list.style.fontStyle = option.dataset.fontStyle || 'normal';
        list.style.fontWeight = option.dataset.fontWeight || '800';
      }
      points.addEventListener('input', updateSliderReadouts);
      densityValue.addEventListener('input', updateSliderReadouts);
      densityUnit.addEventListener('change', updateSliderReadouts);
      list.addEventListener('change', applySelectedForecastStyle);
      document.getElementById('lab-generate-custom').addEventListener('click', (event) => runForecast(event.currentTarget, customPayload(), 'Generating custom slider forecast...'));
      document.getElementById('lab-generate-ml').addEventListener('click', (event) => runForecast(event.currentTarget, { ...customPayload(), strategy: 'ml-brain' }, 'Generating ML-lab brain forecast...'));
      document.getElementById('lab-generate-preset').addEventListener('click', (event) => runForecast(event.currentTarget, presetPayload(), 'Generating preset forecast...'));
      document.getElementById('lab-refresh').addEventListener('click', async () => {
        const button = document.getElementById('lab-refresh');
        button.disabled = true;
        setStatus('Refreshing real prices...');
        try {
          const res = await fetch('/api/refresh-real-prices', { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          setStatus('Updated ' + data.snapshots + ' snapshots: ' + (data.from || 'n/a') + ' -> ' + (data.to || 'n/a'));
          location.reload();
        } catch (error) {
          setStatus('Refresh error: ' + error.message);
        } finally {
          button.disabled = false;
        }
      });
      document.getElementById('lab-load').addEventListener('click', () => {
        if (list.value) location.href = list.value + '?t=' + Date.now();
      });
      updateSliderReadouts();
      loadList();
      setTimeout(openCoinFromUrl, 0);
    })();
  </script>`;
  return html.replace('</head>', `${style}</head>`).replace('<header class="hero">', `${dock}<header class="hero">`).replace('</body>', `${previewToggle}${fitModal}${script}</body>`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/' || url.pathname === '/report/30m') return serveReport(res, await currentReportFile());
    if (url.pathname.startsWith('/report/')) {
      const name = decodeURIComponent(url.pathname.slice('/report/'.length));
      if (!/^coins-mentioned-30m-report-.*\.html$/i.test(name)) return send(res, 400, { error: 'bad report name' });
      const file = path.resolve(EXPORTS, name);
      if (!file.startsWith(EXPORTS)) return send(res, 403, { error: 'forbidden' });
      await setCurrentReport(name);
      return serveReport(res, file);
    }
    if (url.pathname === '/api/forecasts') return send(res, 200, await forecastList());
    if (url.pathname === '/api/generate-forecast' && req.method === 'POST') return send(res, 200, await createForecast(await readJsonBody(req)));
    if (url.pathname === '/api/train-ml-brain' && req.method === 'POST') return send(res, 200, await trainMlBrainModel());
    if (url.pathname === '/api/refresh-real-prices' && req.method === 'POST') return send(res, 200, await refreshCurrentLivePrices());
    if (url.pathname === '/api/save-fit-label' && req.method === 'POST') return send(res, 200, await saveFitLabel(await readJsonBody(req)));
    if (url.pathname === '/docs/strategy') return serveStatic(res, path.join(ROOT, 'docs', '30m-signal-corridor-strategy.md'), 'text/markdown; charset=utf-8');
    if (url.pathname === '/docs/ml-brain') return serveStatic(res, path.join(ROOT, 'docs', 'ml-brain-visual-explainer.html'), 'text/html; charset=utf-8');
    if (url.pathname.startsWith('/exports/')) {
      const file = path.resolve(ROOT, decodeURIComponent(url.pathname.slice(1)));
      if (!file.startsWith(EXPORTS)) return send(res, 403, { error: 'forbidden' });
      return serveStatic(res, file, file.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`30m Signal Lab running at http://127.0.0.1:${PORT}`);
  fs.writeFile(path.join(ROOT, 'signal-lab.pid'), String(process.pid), 'utf8').catch(() => {});
});
