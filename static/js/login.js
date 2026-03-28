(()=>{const s=document.getElementById('stars');for(let i=0;i<60;i++){const d=document.createElement('div');d.className='star';d.style.left=Math.random()*100+'%';d.style.top=Math.random()*100+'%';d.style.setProperty('--d',(2+Math.random()*4)+'s');d.style.setProperty('--delay',Math.random()*3+'s');d.style.width=d.style.height=(1+Math.random()*1.5)+'px';s.appendChild(d)}})();
let srun=false;
async function runST(){
  if(srun)return;srun=true;
  const btn=document.getElementById('sbtn');btn.disabled=true;btn.textContent='Testing...';
  const mb=parseInt(document.getElementById('smb').value)||25;
  const st=document.getElementById('sst');
  const eps=[{id:'d',u:SPEEDTEST_DIRECT_URL,n:SPEEDTEST_DIRECT_NAME},{id:'c',u:SPEEDTEST_CF_URL,n:SPEEDTEST_CF_NAME}];
  const res=[];
  for(const ep of eps){
    st.textContent='Testing '+ep.n+'...';
    const bar=document.getElementById('bf-'+ep.id),val=document.getElementById('sv-'+ep.id);
    bar.style.width='0%';bar.className='fill';val.className='sval';val.textContent='Testing...';
    try{
      const r=await fetch(ep.u+'?mb='+mb+'&_t='+Date.now(),{cache:'no-store'});
      if(!r.ok){bar.style.width='100%';bar.classList.add('err');val.className='sval';val.textContent=r.status===429?'Rate limited':'Error '+r.status;res.push({n:ep.n,mbps:null});continue}
      const rd=r.body.getReader(),tot=parseInt(r.headers.get('content-length'))||mb*1048576;let got=0;const t0=performance.now();
      while(true){const{done,value}=await rd.read();if(done)break;got+=value.length;bar.style.width=Math.min(got/tot*100,100)+'%'}
      const el=(performance.now()-t0)/1000,mbps=(got*8/el/1e6).toFixed(1);
      bar.style.width='100%';bar.classList.add('ok');val.className='sval done';val.textContent=mbps+' Mbps';
      res.push({n:ep.n,mbps:parseFloat(mbps)});
    }catch(e){bar.style.width='100%';bar.classList.add('err');val.textContent='Failed';res.push({n:ep.n,mbps:null})}
  }
  const v=res.filter(r=>r.mbps!=null);
  if(v.length>1){
    const best=v.reduce((a,b)=>a.mbps>b.mbps?a:b);
    const diff=((best.mbps/Math.min(...v.map(x=>x.mbps)))-1)*100;
    const sm=document.getElementById('ssum');sm.style.display='block';
    sm.textContent=mb+' MB \u2014 '+best.n+' faster'+(diff>1?' by '+diff.toFixed(0)+'%':'')+' ('+v.map(r=>r.n+': '+r.mbps+' Mbps').join(', ')+')';
  }
  btn.disabled=false;btn.textContent='Run Tests';st.textContent='Done';srun=false;
}

// Fetch service status from public API
(async()=>{try{
  const r=await fetch('/api/public');const d=await r.json();
  const g=document.getElementById('svc-grid');
  const s=document.getElementById('svc-summary');
  if(!d.services){g.textContent='Unavailable';return}
  const svcs=Object.values(d.services);
  const up=svcs.filter(v=>v.ok===true).length;
  const total=svcs.length;
  g.innerHTML=svcs.map(v=>{
    const st=v.ok===true?'up':v.ok===false?'down':'unknown';
    return '<span class="svc-chip"><span class="dot '+st+'"></span>'+v.name+'</span>';
  }).join('');
  const pct=Math.round(up/total*100);
  const col=pct===100?'#34d399':pct>=90?'#fbbf24':'#f87171';
  s.innerHTML='<span style="color:'+col+';font-weight:700">'+up+'/'+total+'</span> services up ('+pct+'%)';
}catch(e){document.getElementById('svc-grid').textContent='Could not load status';}})();
