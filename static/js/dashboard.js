const CATS = {
  system:"System", streaming:"Streaming Stack", indexers:"Indexers", arr:"Arr Suite",
  media:"Media Servers", dispatch:"Dispatching", downloads:"Downloads",
  infra:"Infrastructure", other:"Other"
};
let statusData={}, statsData={}, versionsData={};
let logTimer=null, logsReady=false, curLogUnit='';

// ── Web panel URLs for each service (injected from config) ──

// ── Tabs ──
function tab(n,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('p-'+n).classList.add('active');
  if(n!=='l'&&logTimer){clearInterval(logTimer);logTimer=null;}
}

// ── Utils ──
function esc(s){return String(s==null?'—':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function fmt(n){
  if(n==null||n===undefined)return'—';
  if(typeof n!=='number')return esc(String(n));
  if(n>=1e9)return(n/1e9).toFixed(2)+'B';
  if(n>=1e6)return(n/1e6).toFixed(2)+'M';
  if(n>=1000)return(n/1000).toFixed(1)+'K';
  return n.toLocaleString();
}
function fmtGB(n){if(n==null)return'—';return n>=1000?(n/1000).toFixed(1)+' TB':n.toFixed(1)+' GB'}
function kv(k,v,cls=''){
  return`<div class="kv ${cls}"><div class="vv">${v==='—'||v==null?'<span style="color:var(--muted)">—</span>':esc(String(v))}</div><div class="kk">${esc(k)}</div></div>`;
}
function row(...items){return`<div class="srow">${items.filter(Boolean).join('')}</div>`}
function sysR(k,v,cls=''){return`<div class="sys-r"><span class="sk">${esc(k)}</span><span class="sv ${cls}">${esc(String(v))}</span></div>`}
function sysBar(pct,cls=''){return`<div class="sys-bar"><div class="sys-bar-fill ${cls}" style="width:${Math.min(Math.max(pct,0),100).toFixed(1)}%"></div></div>`}
function fmtRate(bps){
  if(!bps)return'0 B/s';
  if(bps<1024)return bps.toFixed(0)+' B/s';
  if(bps<1048576)return(bps/1024).toFixed(1)+' KB/s';
  if(bps<1073741824)return(bps/1048576).toFixed(1)+' MB/s';
  return(bps/1073741824).toFixed(2)+' GB/s';
}
function fmtBytes(b){
  if(!b)return'0 B';
  if(b<1024)return b+' B';
  if(b<1048576)return(b/1024).toFixed(1)+' KB';
  if(b<1073741824)return(b/1048576).toFixed(1)+' MB';
  return(b/1073741824).toFixed(2)+' GB';
}

// ── Version tags ──
function normVer(v){return v?v.replace(/^[vV]/,'').trim():''}
// Split a version string into numeric parts only (e.g. "1.43.0.10492-abc" → [1,43,0,10492])
function verParts(v){return normVer(v).split(/[.\-+]/).map(p=>parseInt(p,10)).filter(n=>!isNaN(n))}
// Returns -1 if a<b, 0 if a==b, 1 if a>b
function cmpVer(a,b){
  const pa=verParts(a), pb=verParts(b);
  const len=Math.max(pa.length,pb.length);
  for(let i=0;i<len;i++){
    const x=pa[i]||0, y=pb[i]||0;
    if(x<y)return -1; if(x>y)return 1;
  }
  return 0;
}
function renderVersion(sid,installed){
  const gv=versionsData[sid]; if(!installed&&!gv)return'';
  const ni=normVer(installed), tags=[];
  if(ni)tags.push(`<span class="ver-tag inst" title="Installed">v${esc(ni)}</span>`);
  if(gv?.latest){
    const ng=normVer(gv.latest);
    const cmp=ni&&ng?cmpVer(ni,ng):null;
    let cls,arrow,title;
    if(cmp===null){cls='latest';arrow='';title='Latest on GitHub';}
    else if(cmp===0){cls='uptodate';arrow='';title='Up to date';}
    else if(cmp<0){cls='outdated';arrow='↑ ';title='Update available';}
    else{cls='uptodate';arrow='';title='Installed is newer than latest release';}
    tags.push(`<span class="ver-tag ${cls}" title="${title}">${arrow}${esc(gv.latest)}</span>`);
  }
  return tags.length?`<div class="ver-row">${tags.join('')}</div>`:'';
}

// ── System card ──
function renderSystem(s){
  if(!s||!Object.keys(s).length)return'<div style="color:var(--muted);font-size:.78rem;padding:.3rem">Collecting system stats…</div>';
  let h='<div class="sys-panels">';
  // OS + uptime
  h+='<div class="sys-sec"><div class="sys-ttl">System</div>';
  if(s.os_distro)h+=sysR('OS',s.os_distro);
  if(s.uptime)h+=sysR('Uptime',s.uptime,'ok');
  if(s.process_count!=null)h+=sysR('Processes',s.process_count);
  h+='</div>';
  // CPU
  const cpu=s.cpu||{};
  if(Object.keys(cpu).length){
    h+='<div class="sys-sec"><div class="sys-ttl">CPU</div>';
    if(cpu.model)h+=`<div style="font-size:.62rem;color:var(--muted2);margin-bottom:.25rem;line-height:1.3">${esc(cpu.model)}</div>`;
    if(cpu.physical_cores!=null)h+=sysR('Cores / Threads',`${cpu.physical_cores} / ${cpu.logical_cores}`);
    if(cpu.freq_mhz)h+=sysR('Clock',`${cpu.freq_mhz} MHz`);
    if(cpu.usage_pct!=null){
      const c=cpu.usage_pct>80?'err':cpu.usage_pct>50?'warn':'ok';
      h+=sysR('Usage',`${cpu.usage_pct.toFixed(1)}%`,c);
      h+=sysBar(cpu.usage_pct,c);
    }
    if(cpu.load_1m!=null)h+=sysR('Load (1/5/15m)',`${cpu.load_1m} / ${cpu.load_5m} / ${cpu.load_15m}`);
    h+='</div>';
  }
  // RAM
  const ram=s.ram||{};
  if(Object.keys(ram).length){
    h+='<div class="sys-sec"><div class="sys-ttl">Memory</div>';
    const rc=ram.percent>90?'err':ram.percent>70?'warn':'ok';
    h+=sysR('Used / Total',`${ram.used_gb} / ${ram.total_gb} GB`);
    h+=sysBar(ram.percent,rc);
    h+=sysR('Available',`${ram.available_gb} GB`,'ok');
    if(s.swap?.total_gb>0){
      const sc=s.swap.percent>80?'warn':'';
      h+=sysR('Swap',`${s.swap.used_gb} / ${s.swap.total_gb} GB`);
      if(s.swap.percent>0)h+=sysBar(s.swap.percent,sc);
    }
    h+='</div>';
  }
  // GPU
  const gpu=s.gpu||{};
  if(Object.keys(gpu).length){
    h+='<div class="sys-sec"><div class="sys-ttl">GPU</div>';
    if(gpu.name)h+=`<div style="font-size:.62rem;color:var(--muted2);margin-bottom:.25rem">${esc(gpu.name)}</div>`;
    if(gpu.usage_pct!=null){
      const gc=gpu.usage_pct>80?'warn':gpu.usage_pct>0?'ok':'';
      h+=sysR('Usage',`${gpu.usage_pct}%`,gc);
      h+=sysBar(gpu.usage_pct,gc);
    }
    if(gpu.vram_used_mb!=null&&gpu.vram_total_mb){
      const vp=gpu.vram_used_mb/gpu.vram_total_mb*100;
      const vc=vp>90?'err':vp>70?'warn':'ok';
      h+=sysR('VRAM',`${gpu.vram_used_mb} / ${gpu.vram_total_mb} MB`,vc);
      h+=sysBar(vp,vc);
    }
    if(gpu.temp_c!=null){const tc=gpu.temp_c>85?'err':gpu.temp_c>70?'warn':'ok';h+=sysR('Temp',`${gpu.temp_c}°C`,tc);}
    if(gpu.power_w!=null)h+=sysR('Power',`${gpu.power_w} W`);
    if(gpu.core_mhz!=null)h+=sysR('Core / Mem MHz',`${gpu.core_mhz} / ${gpu.mem_mhz||'?'}`);
    if(gpu.fan_rpm!=null)h+=sysR('Fan',`${gpu.fan_rpm} RPM`);
    if(gpu.mem_busy_pct!=null)h+=sysR('Mem busy',`${gpu.mem_busy_pct}%`);
    h+='</div>';
  }
  // Disks
  const disks=s.disks||[];
  if(disks.length){
    h+='<div class="sys-sec"><div class="sys-ttl">Storage</div>';
    for(const d of disks){
      const dc=d.percent>90?'err':d.percent>75?'warn':'ok';
      h+=`<div class="disk-item">`;
      h+=`<div class="disk-lbl"><span>${esc(d.mount)}</span><span style="color:var(--${d.percent>90?'err':d.percent>75?'warn':'muted'})">${d.free} / ${d.total} ${d.unit}</span></div>`;
      h+=`<div class="dbar"><div class="dbar-f ${dc}" style="width:${d.percent}%"></div></div></div>`;
    }
    h+='</div>';
  }
  // Disk I/O
  const dio=s.disk_io||{};
  if(dio.read_rate||dio.write_rate){
    h+='<div class="sys-sec"><div class="sys-ttl">Disk I/O</div>';
    h+=sysR('Read',dio.read_rate||'—','ok');
    h+=sysR('Write',dio.write_rate||'—','warn');
    h+=sysR('Session ↑↓',`${dio.read_total_gb||0} / ${dio.write_total_gb||0} GB`);
    h+='</div>';
  }
  // Network I/O
  const nio=s.net_io||{};
  if(nio.recv_rate||nio.sent_rate){
    const cap=nio.link_rate||'';
    h+='<div class="sys-sec"><div class="sys-ttl">Network</div>';
    const rp=nio.recv_pct||0, sp=nio.sent_pct||0;
    const rc=rp>80?'err':rp>50?'warn':'ok', sc=sp>80?'err':sp>50?'warn':'ok';
    h+=sysR('↓ Recv',cap?`${esc(nio.recv_rate)} / ${esc(cap)}`:esc(nio.recv_rate||'—'),rc);
    if(rp>0)h+=`<div class="dbar" style="margin:.05rem 0 .2rem"><div class="dbar-f ${rc}" style="width:${Math.min(rp,100)}%"></div></div>`;
    h+=sysR('↑ Sent',cap?`${esc(nio.sent_rate)} / ${esc(cap)}`:esc(nio.sent_rate||'—'),sc);
    if(sp>0)h+=`<div class="dbar" style="margin:.05rem 0 .2rem"><div class="dbar-f ${sc}" style="width:${Math.min(sp,100)}%"></div></div>`;
    h+=sysR('Total ↓',`${nio.recv_total_gb||0} GB`);
    h+=sysR('Total ↑',`${nio.sent_total_gb||0} GB`);
    h+='</div>';
  }
  h+='</div>';
  return h;
}

// ── Stats renderers ──
function renderStats(sid, s){
  if(!s||!Object.keys(s).length)return'';
  if(sid==='system')return`<div class="sbox">${renderSystem(s)}</div>`;
  const r={
    comet:()=>{
      let h=row(kv('version',s.version,'blue'),kv('types',s.types?.length),s.active_connections?kv('conns',s.active_connections,'ok'):'');
      if(s.torrents_total)h+=row(kv('torrents',fmt(s.torrents_total),'blue'),kv('queue🎬',s.queue_movies),kv('queue📺',s.queue_series));
      if(s.scraper_running!=null)h+=row(kv('scraper',s.scraper_running?(s.scraper_paused?'paused':'running'):'stopped',s.scraper_running?'ok':'warn'),kv('24h found',fmt(s.slo_torrents_found),'blue'),kv('fail rate',s.slo_fail_rate!=null?`${(s.slo_fail_rate*100).toFixed(0)}%`:'—',s.slo_fail_rate>0.1?'warn':''));
      if(s.top_trackers?.length)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.2rem">${s.top_trackers.slice(0,3).map(t=>esc(t.name)+': '+fmt(t.count)).join(' · ')}</div>`;
      return h;
    },
    mediafusion:()=>{
      let h=row(kv('version',s.version||s.addon_version,'blue'),kv('access',s.is_public?'public':'private',s.is_public?'ok':''));
      if(s.streams_total!=null)h+=row(kv('streams',fmt(s.streams_total),'blue'),s.movies?kv('movies',fmt(s.movies)):'',s.series?kv('series',fmt(s.series)):'');
      if(s.sched_total!=null)h+=row(kv('schedulers',s.sched_active+'/'+s.sched_total),s.scrapers_active?kv('scrapers',s.scrapers_active+'/'+s.scrapers_total,'ok'):'',s.sched_running>0?kv('running',s.sched_running,'ok'):kv('idle','0'));
      if(s.top_sources){let src=Object.entries(s.top_sources);h+=row(...src.slice(0,3).map(([k,v])=>kv(k,fmt(v))));}
      if(s.debrid_cached){let dc=Object.entries(s.debrid_cached);if(dc.length)h+=row(...dc.map(([k,v])=>kv(k+' cache',fmt(v),'ok')));}
      if(s.redis_mem)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">Redis: ${esc(s.redis_mem)} | DB: ${esc(s.db_size||'?')}</div>`;
      return h;
    },
    stremthru:()=>{
      let h=row(kv('version',s.version,'blue'),kv('status',s.status,'ok'),s.store_name?kv('store',s.store_name):'');
      if(s.subscription)h+=row(kv('sub',s.subscription,s.subscription?.includes('premium')?'ok':'warn'));
      if(s.magnet_total!=null)h+=row(kv('magnets',fmt(s.magnet_total),'blue'),s.torrent_info_count?kv('torrents',fmt(s.torrent_info_count)):'',s.dmm_hashes?kv('dmm',fmt(s.dmm_hashes)):'');
      if(s.magnet_cache){let mc=s.magnet_cache;let stores=Object.keys(mc);if(stores.length)h+=row(...stores.map(st=>kv(st,fmt(mc[st].cached)+' cached','ok')));}
      if(s.db_size)h+=row(kv('db',s.db_size));
      return h;
    },
    zilean:()=>{if(!s.responding)return '';
      let h=row(kv('status','online','ok'),s.sample_results!=null?kv('sample hits',s.sample_results,'blue'):'',s.quality_distribution?kv('qualities',Object.entries(s.quality_distribution).map(([k,v])=>k+'('+fmt(v)+')').join(' ')):'');
      if(s.total_torrents!=null)h+=row(kv('torrents',fmt(s.total_torrents),'blue'),kv('w/ IMDB',fmt(s.with_imdb),'ok'),kv('unmatched',fmt(s.total_torrents-s.with_imdb),'warn'));
      if(s.scraper_running!=null)h+=row(kv('scraper',s.scraper_running?'running':'idle',s.scraper_running?'ok':''),s.dmm_status!=null?kv('dmm sync',s.dmm_status,s.dmm_status==='ok'?'ok':'err'):'',s.imdb_entries?kv('imdb titles',fmt(s.imdb_entries)):'');
      if(s.dmm_last_run)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">DMM sync: ${esc(s.dmm_last_run)}</div>`;
      if(s.db_size)h+=`<div style="font-size:.62rem;color:var(--muted)">DB: ${esc(s.db_size)}</div>`;
      if(s.latest_indexed)h+=`<div style="font-size:.62rem;color:var(--muted)">Last indexed: ${esc(s.latest_indexed)}</div>`;
      return h;},
    aiostreams:()=>{
      let h=row(kv('status','online','ok'),kv('version',s.version,'blue'),s.channel?kv('channel',s.channel,s.channel==='stable'?'ok':'warn'):'');
      if(s.user_count!=null)h+=row(kv('users',s.user_count),s.catalogs?kv('catalogs',s.catalogs):'',s.presets_available?kv('presets',s.presets_available):'');
      if(s.forced_services?.length)h+=row(kv('services',s.forced_services.join(', ')));
      if(s.cache_entries!=null)h+=row(kv('cache',fmt(s.cache_entries)),s.max_addons?kv('max addons',s.max_addons):'',s.tmdb_available?kv('tmdb','yes','ok'):kv('tmdb','no','warn'));
      if(s.commit)h+=`<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">Commit: ${esc(s.commit)} | ${esc(s.tag||'')}</div>`;
      return h;},
    flaresolverr:()=>row(kv('status',s.status,s.status==='ok'?'ok':'warn'),s.version?kv('version',s.version,'blue'):''),
    byparr:()=>row(kv('status',s.status,s.status==='ok'?'ok':'warn'),s.browser?kv('browser',s.browser):'',s.version?kv('version',s.version,'blue'):''),
    jackett:()=>{const p=[];if(s.indexers_configured!=null)p.push(kv('indexers',s.indexers_configured));if(s.responding)p.push(kv('torznab','ok','ok'));return p.length?row(...p):'';},
    prowlarr:()=>[
      row(kv('indexers',s.indexers_total),kv('enabled',s.indexers_enabled,'ok'),kv('queries',fmt(s.total_queries),'blue'),kv('grabs',fmt(s.total_grabs))),
      s.total_failed_queries?row(kv('failed q.',fmt(s.total_failed_queries),'warn')):'',
      (s.health_errors||s.health_warnings)?row(s.health_errors?kv('errors',s.health_errors,'err'):'',s.health_warnings?kv('warnings',s.health_warnings,'warn'):''):'',
      s.health_messages?.length?`<div class="health-err">${s.health_messages.map(esc).join(' · ')}</div>`:'',
    ].join(''),
    radarr:()=>[
      row(kv('total',fmt(s.total)),kv('downloaded',fmt(s.downloaded),'ok'),kv('missing',fmt(s.missing),s.missing>0?'err':''),kv('queue',fmt(s.queue),s.queue>0?'warn':'')),
      s.disk_free_gb!=null?row(kv('free disk',fmtGB(s.disk_free_gb)),kv('total',fmtGB(s.disk_total_gb))):'',
      (s.health_errors||s.health_warnings)?row(s.health_errors?kv('h.errors',s.health_errors,'err'):'',s.health_warnings?kv('h.warnings',s.health_warnings,'warn'):''):'',
      s.health_messages?.length?`<div class="health-err">${s.health_messages.map(esc).join('<br>')}</div>`:'',
    ].join(''),
    sonarr:()=>[
      row(kv('series',fmt(s.total)),kv('episodes',fmt(s.episodes_downloaded),'ok'),kv('missing ep.',fmt(s.missing_episodes),s.missing_episodes>0?'warn':''),kv('queue',fmt(s.queue),s.queue>0?'warn':'')),
      s.disk_free_gb!=null?row(kv('free disk',fmtGB(s.disk_free_gb)),kv('total',fmtGB(s.disk_total_gb))):'',
      (s.health_errors||s.health_warnings)?row(s.health_errors?kv('h.errors',s.health_errors,'err'):'',s.health_warnings?kv('h.warnings',s.health_warnings,'warn'):''):'',
      s.health_messages?.length?`<div class="health-err">${s.health_messages.map(esc).join('<br>')}</div>`:'',
    ].join(''),
    lidarr:()=>[
      row(kv('artists',fmt(s.artists)),kv('albums',fmt(s.albums_total)),kv('tracks',fmt(s.track_count),'ok'),kv('queue',fmt(s.queue),s.queue>0?'warn':'')),
      s.disk_free_gb!=null?row(kv('free disk',fmtGB(s.disk_free_gb)),kv('total',fmtGB(s.disk_total_gb))):'',
    ].join(''),
    bazarr:()=>{
      const p=[];
      if(s.version)p.push(row(kv('version',s.version,'blue')));
      if(s.movies_total!=null||s.episodes_total!=null)p.push(row(
        s.movies_total!=null?kv('movies',fmt(s.movies_total)):'',
        s.movies_missing>0?kv('mov. miss.',fmt(s.movies_missing),'warn'):'',
        s.episodes_total!=null?kv('episodes',fmt(s.episodes_total)):'',
        s.episodes_missing>0?kv('ep. miss.',fmt(s.episodes_missing),'warn'):'',
      ));
      return p.join('');
    },
    jellyfin:()=>[
      row(kv('movies',fmt(s.movies),'blue'),kv('series',fmt(s.series)),kv('episodes',fmt(s.episodes)),kv('songs',fmt(s.songs))),
      row(kv('sessions',fmt(s.sessions_total)),kv('playing',fmt(s.sessions_active),s.sessions_active>0?'ok':'')),
      s.now_playing?.filter(Boolean).length?`<div class="np">▶ ${s.now_playing.filter(Boolean).slice(0,2).map(esc).join(' · ')}</div>`:'',
    ].join(''),
    plex:()=>[
      s.movies!=null||s.series!=null?row(s.movies!=null?kv('movies',fmt(s.movies),'blue'):'',s.series!=null?kv('series',fmt(s.series)):'',kv('playing',fmt(s.sessions_active),s.sessions_active>0?'ok':'')):'',
      s.libraries?.length?`<div style="font-size:.63rem;color:var(--muted);margin-top:.2rem">${s.libraries.map(l=>`${esc(l.title)}: ${l.count}`).join(' · ')}</div>`:'',
    ].join(''),
    jellyseerr:()=>row(kv('total req.',fmt(s.requests_total),'blue'),kv('pending',fmt(s.requests_pending),s.requests_pending>0?'warn':''),kv('approved',fmt(s.requests_approved)),kv('available',fmt(s.requests_available),'ok')),
    dispatcharr:()=>[
      row(kv('streams',fmt(s.total_streams),'blue'),kv('channels',fmt(s.total_channels)),kv('m3u accts',fmt(s.m3u_accounts))),
      row(kv('epg src.',fmt(s.epg_sources)),s.epg_errors?kv('epg err.',s.epg_errors,'err'):'',s.epg_ok?kv('epg ok',s.epg_ok,'ok'):''),
    ].join(''),
    mediaflow:()=>s.status?row(kv('status',s.status,s.status==='healthy'?'ok':'warn')):'',
    qbittorrent:()=>{
      const rows=[];
      if(s.version)rows.push(row(kv('version',s.version,'blue')));
      if(s.active_torrents!=null)rows.push(row(
        kv('active',s.active_torrents,s.active_torrents>0?'ok':''),
        kv('dl\'ing',s.downloading!=null?s.downloading:'—'),
        kv('seeding',s.seeding!=null?s.seeding:'—'),
      ));
      if(s.dl_speed!=null)rows.push(row(
        kv('↓ speed',fmtRate(s.dl_speed),'ok'),
        kv('↑ speed',fmtRate(s.up_speed||0)),
      ));
      if(s.dl_session!=null&&(s.dl_session+s.up_session)>0)rows.push(row(
        kv('sess ↓',fmtBytes(s.dl_session)),
        kv('sess ↑',fmtBytes(s.up_session||0)),
      ));
      return rows.join('');
    },
  };
  const fn=r[sid]; if(!fn)return'';
  const html=fn(); if(!html?.trim())return'';
  return`<div class="sbox">${html}</div>`;
}

// ── History bar ──
function bar(h){
  const n=40,pad=n-Math.min(h.length,n);
  return'<span class="x"></span>'.repeat(pad)+
    h.slice(-n).map(r=>`<span class="${r.ok?'ok':'er'}" title="${esc(r.message)}"></span>`).join('');
}

// ── Header ──
function buildOverview(){
  const all=Object.values(statusData); if(!all.length)return'';
  const up=all.filter(s=>s.current.ok).length, dn=all.length-up;
  const issues=Object.values(statsData).reduce((a,s)=>a+(s?.health_errors||0)+(s?.health_warnings||0),0);
  const logErrs=errorsData.filter(e=>e.severity==='error').length;
  const logWarns=errorsData.filter(e=>e.severity==='warning').length;
  updateErrBadge(logErrs,logWarns);
  const errStat=logErrs>0?`<div class="hdr-stat err"><div class="val">${logErrs}</div><div class="lbl">Log Errors</div></div>`:
                logWarns>0?`<div class="hdr-stat warn"><div class="val">${logWarns}</div><div class="lbl">Warnings</div></div>`:'';
  return`
    <div class="hdr-stat ${dn===0?'ok':dn>2?'err':'warn'}"><div class="val">${up}/${all.length}</div><div class="lbl">Services</div></div>
    <div class="hdr-stat ${issues>0?'err':'ok'}"><div class="val">${issues||'&#10003;'}</div><div class="lbl">Issues</div></div>
    ${errStat}`;
}

// ── Card ──
function renderCard(sid, s){
  const cur=s.current, cls=cur.ok===null?'pend':cur.ok?'up':'dn';
  const st=statsData[sid]||{};
  const installed=st.version||st.addon_version||st.bazarr_version||'';
  const webUrl=WEB_URLS[sid]||'';
  if(sid==='system')return`<div class="card up" id="card-${sid}" onclick="openModal('${sid}')" title="Click for details">
    <div class="ct">&#x1F5A5; ${esc(cur.name)}</div>${renderStats(sid,st)}</div>`;
  const acts=`<div class="card-acts">
    ${webUrl?`<button class="card-act" onclick="event.stopPropagation();window.open('${webUrl}','_blank')" title="Open web UI">&#x2197;</button>`:''}
    <button class="card-act" onclick="event.stopPropagation();openModal('${sid}','logs')" title="View logs">&#x2261;</button>
    <button class="card-act danger" onclick="event.stopPropagation();quickRestart('${sid}')" title="Restart service">&#x27F3;</button>
  </div>`;
  return`<div class="card ${cls}" id="card-${sid}" onclick="openModal('${sid}')" title="Click for details">
    ${acts}
    <div class="ct">${esc(cur.name)}<span class="badge ${cls}">${cur.ok===null?'PENDING':cur.ok?'UP':'DOWN'}</span>${cur.latency_ms!=null?`<span class="lat">${cur.latency_ms}ms</span>`:''}</div>
    <div class="meta">${esc(cur.message||'—')} · systemd: ${esc(cur.systemd)}</div>
    ${renderStats(sid,st)}${renderVersion(sid,installed)}
    <div class="bar">${bar(s.history)}</div></div>`;
}

// ── Data fetch ──
async function safeJson(url,opts){
  try{const r=await fetch(url,opts);if(!r.ok)return null;return await r.json();}catch{return null;}
}

async function refresh(){
  const [status,stats,versions]=await Promise.all([
    safeJson('/api/status'),safeJson('/api/stats'),safeJson('/api/versions'),
  ]);
  if(status)statusData=status; if(stats)statsData=stats; if(versions)versionsData=versions;
  if(!Object.keys(statusData).length)return;
  document.getElementById('overview').innerHTML=buildOverview();
  document.getElementById('ts-hdr').textContent='⟳ '+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
  document.getElementById('ts').textContent='Last updated: '+new Date().toLocaleString('en-CA',{timeZone:TZ,hour12:false});
  const cats={};
  for(const[sid,s] of Object.entries(statusData)){const cat=s.current.category||'other';(cats[cat]=cats[cat]||[]).push([sid,s]);}
  let html='';
  for(const catKey of ['system','streaming','indexers','arr','media','dispatch','downloads','infra','other']){
    const items=cats[catKey]; if(!items?.length)continue;
    html+=`<div class="cat-hdr">${CATS[catKey]||catKey}</div>`;
    html+=`<div class="grid${catKey==='system'?' sys-grid':''}">`;
    for(const[sid,s] of items)html+=renderCard(sid,s);
    html+='</div>';
  }
  document.getElementById('cats').innerHTML=html;
}

// ── Logs ──
let _logLines=[];
async function fetchLogs(){
  const u=document.getElementById('unit').value; if(!u)return;
  const n=document.getElementById('log-lines')?.value||'200';
  const b=document.getElementById('logbox'), st=document.getElementById('log-status');
  if(curLogUnit!==u){b.innerHTML='<span class="spin"></span> Loading…';curLogUnit=u;}
  const d=await safeJson('/api/logs/'+encodeURIComponent(u)+'?n='+n);
  if(!d){b.innerHTML='<span style="color:var(--err)">Error fetching logs.</span>';return;}
  if(d.error){b.innerHTML='<span style="color:var(--err)">'+esc(d.error)+'</span>';return;}
  _logLines=d.lines||[];
  filterLogs();
  st.textContent=`${_logLines.length} lines · `+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
}
function filterLogs(){
  const b=document.getElementById('logbox');
  if(!_logLines.length){b.innerHTML='<span style="color:var(--muted)">No logs.</span>';return;}
  const q=(document.getElementById('log-search')?.value||'').toLowerCase();
  const lines=q?_logLines.filter(l=>l.toLowerCase().includes(q)):_logLines;
  if(!lines.length){b.innerHTML='<span style="color:var(--muted)">No lines match filter.</span>';return;}
  const atBot=b.scrollHeight-b.scrollTop-b.clientHeight<60;
  const autoscroll=document.getElementById('log-autoscroll')?.checked!==false;
  b.innerHTML=lines.map(l=>`<span class="${/error|critical|fail|exception/i.test(l)?'le':/warn/i.test(l)?'lw':''}">${esc(l)}</span>`).join('\n');
  if(autoscroll&&atBot)b.scrollTop=b.scrollHeight;
}
function initLogs(){
  if(logsReady)return; logsReady=true;
  fetchLogs();
  logTimer=setInterval(()=>{if(document.getElementById('p-l').classList.contains('active'))fetchLogs();},5000);
}

// ── Settings ──
let keysData={}, keysOriginal={};
function toggleKeyVis(k){
  const inp=document.getElementById('key_'+k);
  const btn=document.getElementById('eye_'+k);
  if(!inp)return;
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈';}
  else{inp.type='password';btn.textContent='👁';}
}
function copyKey(k){
  const inp=document.getElementById('key_'+k);
  if(!inp)return;
  navigator.clipboard.writeText(inp.value).then(()=>{
    const btn=document.getElementById('copy_'+k);
    const prev=btn.textContent; btn.textContent='✓';
    setTimeout(()=>{btn.textContent=prev;},1500);
  });
}
function markChanged(k){
  const inp=document.getElementById('key_'+k);
  if(!inp)return;
  inp.classList.toggle('changed', inp.value!==keysOriginal[k]);
}
async function loadSettings(){
  const g=document.getElementById('settings-grid');
  const keys=await safeJson('/api/settings/keys');
  if(keys){keysData=keys; keysOriginal=Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,v.value||'']));}
  // Group keys
  const groups={};
  for(const [k,v] of Object.entries(keys||{})){
    const gr=v.group||'Other';
    if(!groups[gr])groups[gr]=[];
    groups[gr].push([k,v]);
  }
  const groupOrder=['Arr Suite','Indexers','Media Servers','Streaming','Dispatching','Other'];
  const sorted=groupOrder.filter(g=>groups[g]).concat(Object.keys(groups).filter(g=>!groupOrder.includes(g)));
  const keysHtml=sorted.map(gr=>`
    <div class="key-group">
      <div class="key-group-label">${esc(gr)}</div>
      ${groups[gr].map(([k,v])=>`
      <div class="key-row">
        <label title="${esc(k)}">${esc(v.label)}</label>
        <div class="key-input-wrap">
          <input type="password" id="key_${esc(k)}" value="${esc(v.value||'')}" placeholder="(not set)" oninput="markChanged('${esc(k)}')">
          <button class="key-btn" id="eye_${esc(k)}" onclick="toggleKeyVis('${esc(k)}')" title="Show/hide">👁</button>
          <button class="key-btn" id="copy_${esc(k)}" onclick="copyKey('${esc(k)}')" title="Copy">⎘</button>
        </div>
      </div>`).join('')}
    </div>`).join('');
  g.innerHTML=`
  <div class="settings-sec">
    <h3>API Keys</h3>
    ${keysHtml}
    <button class="btn-save" onclick="saveKeys()">Save Keys</button>
    <div id="keys-msg"></div>
  </div>
  <div class="settings-sec">
    <h3>Admin Password</h3>
    <div class="pw-form">
      <div><label>Current password</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div><label>New password</label><input type="password" id="pw-new" autocomplete="new-password"></div>
      <div><label>Confirm new</label><input type="password" id="pw-conf" autocomplete="new-password"></div>
      <button class="btn-save" onclick="changePassword()">Update Password</button>
      <div id="pw-msg"></div>
    </div>
  </div>`;
}

async function saveKeys(){
  const updates={};
  for(const k of Object.keys(keysData)){
    const el=document.getElementById('key_'+k);
    if(el)updates[k]=el.value.trim();
  }
  const msg=document.getElementById('keys-msg');
  const r=await safeJson('/api/settings/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)});
  if(r?.ok){msg.className='msg-ok';msg.textContent='Saved!';}
  else{msg.className='msg-err';msg.textContent='Error saving keys.';}
  setTimeout(()=>{msg.textContent='';},3000);
}

async function changePassword(){
  const cur=document.getElementById('pw-cur').value;
  const nw=document.getElementById('pw-new').value;
  const cf=document.getElementById('pw-conf').value;
  const msg=document.getElementById('pw-msg');
  if(!nw){msg.className='msg-err';msg.textContent='New password required.';return;}
  if(nw!==cf){msg.className='msg-err';msg.textContent='Passwords do not match.';return;}
  const r=await safeJson('/api/settings/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current:cur,new_password:nw})});
  if(r?.ok){msg.className='msg-ok';msg.textContent='Password changed!';document.getElementById('pw-cur').value='';document.getElementById('pw-new').value='';document.getElementById('pw-conf').value='';}
  else{msg.className='msg-err';msg.textContent=r?.error||'Error changing password.';}
  setTimeout(()=>{msg.textContent='';},4000);
}

// ── Perms tab ──
const TZ = 'America/Vancouver';
function fmtTs(ts){ return ts ? new Date(ts*1000).toLocaleString('en-CA',{timeZone:TZ,hour12:false}) : '—'; }
let permScanData=[], permsScanned=false;
function initPerms(){ if(!permsScanned) runScan(); }

async function runScan(){
  const btn=document.getElementById('scan-btn');
  const meta=document.getElementById('scan-meta');
  btn.disabled=true; btn.textContent='Scanning…'; meta.textContent='';
  const d=await safeJson('/api/perms/scan',{method:'POST'});
  btn.disabled=false; btn.textContent='⟳ Scan directories'; permsScanned=true;
  if(!d){meta.textContent='Scan failed.';return;}
  permScanData=d.results||[];
  const ok=permScanData.filter(r=>r.ok).length;
  const bad=permScanData.filter(r=>!r.ok&&r.exists&&!r.missing).length;
  const miss=permScanData.filter(r=>r.missing).length;
  meta.textContent=`${ok} OK · `+(bad?`<span style="color:var(--err)">${bad} mismatch</span> · `:`0 mismatch · `)+`${miss} missing · ${fmtTs(d.ts)}`;
  meta.innerHTML=meta.textContent;
  renderPermResults();
}

function renderPermResults(){
  const el=document.getElementById('perm-results');
  if(!permScanData.length){el.innerHTML='<div style="color:var(--muted);padding:.5rem">No data. Click Scan.</div>';return;}
  const bad=permScanData.filter(r=>!r.ok&&!r.missing);

  // Populate section filter dropdown (first scan only)
  const secSel=document.getElementById('perm-section-filter');
  if(secSel&&secSel.options.length===1){
    [...new Set(permScanData.map(r=>r.section||'Other'))].forEach(s=>{
      const o=document.createElement('option');o.value=s;o.textContent=s;secSel.appendChild(o);
    });
  }
  const issuesOnly=document.getElementById('perm-issues-only')?.checked;
  const sectionFilter=document.getElementById('perm-section-filter')?.value||'';

  // Group by section (applying filters)
  const sections=[];
  const sectionMap={};
  permScanData.forEach((r,i)=>{
    if(issuesOnly&&r.ok)return;
    const sec=r.section||'Other';
    if(sectionFilter&&sec!==sectionFilter)return;
    if(!sectionMap[sec]){sectionMap[sec]=[];sections.push(sec);}
    sectionMap[sec].push({r,i});
  });

  let tbody='';
  sections.forEach(sec=>{
    const entries=sectionMap[sec];
    const secBad=entries.filter(({r})=>!r.ok&&!r.missing).length;
    const secMiss=entries.filter(({r})=>r.missing).length;
    const badge=secBad?`<span style="color:var(--err);margin-left:.4rem;font-size:.7rem">${secBad} issue${secBad>1?'s':''}</span>`:
                secMiss?`<span style="color:var(--muted);margin-left:.4rem;font-size:.7rem">${secMiss} missing</span>`:
                `<span style="color:var(--ok);margin-left:.4rem;font-size:.7rem">&#10003; OK</span>`;
    tbody+=`<tr class="perm-section-hdr"><td colspan="9"><strong>${esc(sec)}</strong>${badge}</td></tr>`;
    entries.forEach(({r,i})=>{
      const rowCls=r.missing?'missing-row':r.ok?'ok-row':'bad-row';
      const statusIcon=r.missing?'<span class="perm-miss">MISSING</span>':r.ok?'<span class="perm-ok">&#10003;</span>':'<span class="perm-bad">&#10007;</span>';
      const uCls=r.cur_user!==r.exp_user&&!r.missing?'perm-diff':'';
      const gCls=r.cur_group!==r.exp_group&&!r.missing?'perm-diff':'';
      const mCls=r.cur_mode!==r.exp_mode&&!r.missing?'perm-diff':'';
      const cb=r.missing?'':r.ok?'':`<input type="checkbox" class="perm-cb" data-i="${i}" checked onchange="updateSelCount()">`;
      tbody+=`<tr class="${rowCls}" data-i="${i}">
        <td>${cb}</td>
        <td>${statusIcon}</td>
        <td style="color:var(--accent2);font-family:monospace">${esc(r.label)}</td>
        <td style="font-family:monospace;font-size:.68rem;color:var(--muted2)">${esc(r.path)}</td>
        <td><span class="${uCls}">${esc(r.cur_user)}</span></td>
        <td><span class="${gCls}">${esc(r.cur_group)}</span></td>
        <td style="font-family:monospace"><span class="${mCls}">${esc(r.cur_mode)}</span></td>
        <td style="color:var(--muted);font-size:.65rem">${esc(r.exp_user)}:${esc(r.exp_group)} ${esc(r.exp_mode)}</td>
        <td id="perm-res-${i}"></td>
      </tr>`;
    });
  });

  el.innerHTML=`
  <table class="perm-table">
    <thead><tr>
      <th><input type="checkbox" id="perm-all" onchange="toggleAllPerms(this)"></th>
      <th>Status</th><th>Service</th><th>Path</th>
      <th>Owner</th><th>Group</th><th>Mode</th><th>Expected</th><th>Result</th>
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>
  <div class="perm-fix-row">
    <span class="perm-sel-count" id="perm-sel-count">${bad.length} selected</span>
    <label>Owner<input type="text" id="fix-user" value="" placeholder="from expected"></label>
    <label>Group<input type="text" id="fix-group" value="media" placeholder="media"></label>
    <label>Mode<input type="text" id="fix-mode" value="774" placeholder="774"></label>
    <button class="btn-save" onclick="applyPerms()">Apply to selected</button>
    <button class="sm" onclick="selectMismatches()">Select all mismatches</button>
    <div id="perm-apply-msg" style="font-size:.72rem"></div>
  </div>`;
}

function toggleAllPerms(cb){ document.querySelectorAll('.perm-cb').forEach(c=>c.checked=cb.checked); updateSelCount(); }
function selectMismatches(){ document.querySelectorAll('.perm-cb').forEach(c=>c.checked=true); updateSelCount(); }
function updateSelCount(){ const el=document.getElementById('perm-sel-count'); if(el)el.textContent=document.querySelectorAll('.perm-cb:checked').length+' selected'; }

async function applyPerms(){
  const recursive=document.getElementById('perm-recursive').checked;
  const defUser=document.getElementById('fix-user').value.trim();
  const defGroup=document.getElementById('fix-group').value.trim()||'media';
  const defMode=document.getElementById('fix-mode').value.trim()||'774';
  const selected=[...document.querySelectorAll('.perm-cb:checked')].map(c=>parseInt(c.dataset.i));
  if(!selected.length){document.getElementById('perm-apply-msg').textContent='Nothing selected.';return;}
  const msg=document.getElementById('perm-apply-msg');
  msg.textContent=`Applying to ${selected.length} path(s)…`;
  const fixes=selected.map(i=>{
    const r=permScanData[i];
    return{path:r.path, user:defUser||r.exp_user, group:defGroup||r.exp_group, mode:defMode||r.exp_mode, recursive};
  });
  const d=await safeJson('/api/perms/fix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixes)});
  if(!d){msg.textContent='Request failed.';return;}
  let ok=0,fail=0;
  for(const res of (d.results||[])){
    const i=permScanData.findIndex(r=>r.path===res.path);
    const cell=document.getElementById('perm-res-'+i);
    if(cell){
      if(res.ok){cell.innerHTML='<span class="perm-ok">✓</span>';ok++;}
      else{cell.innerHTML=`<span class="perm-bad" title="${esc(res.error||'')}">✗</span>`;fail++;}
    }
  }
  msg.textContent=`Done: ${ok} OK, ${fail} failed.`;
  if(ok>0) setTimeout(runScan, 800);
}

// ── Errors tab ──
let errorsData=[], errorsLoaded=false;

function updateErrBadge(errors,warnings){
  const tab=document.getElementById('err-tab'); if(!tab)return;
  let badge=tab.querySelector('.tab-badge');
  const total=errors+warnings;
  if(total>0){
    if(!badge){badge=document.createElement('span');tab.appendChild(badge);}
    badge.className='tab-badge'+(errors===0?' warn':'');
    badge.textContent=total>99?'99+':total;
  } else {
    if(badge)badge.remove();
  }
}

async function loadErrors(){
  errorsLoaded=true;
  const d=await safeJson('/api/errors');
  if(!d)return;
  errorsData=d.errors||[];
  // Populate service filter
  const svcs=[...new Set(errorsData.map(e=>e.sid))].sort();
  const sel=document.getElementById('err-svc');
  const cur=sel.value;
  sel.innerHTML='<option value="">All services</option>'+svcs.map(s=>`<option value="${esc(s)}"${s===cur?' selected':''}>${esc(s)}</option>`).join('');
  // Meta info
  const meta=document.getElementById('err-meta');
  const errs=errorsData.filter(e=>e.severity==='error').length;
  const warns=errorsData.filter(e=>e.severity==='warning').length;
  if(d.last_scan){
    const ago=Math.round((Date.now()/1000-d.last_scan)/60);
    meta.textContent=`${errorsData.length} entries · scan #${d.scan_count} · ${ago<1?'just now':ago+'m ago'}`;
  }
  const summary=document.getElementById('err-summary');
  summary.innerHTML=errs||warns?
    `<span style="color:var(--err)">${errs} error${errs!==1?'s':''}</span> · `+
    `<span style="color:var(--warn)">${warns} warning${warns!==1?'s':''}</span>`:'All clear';
  updateErrBadge(errs,warns);
  filterErrors();
}

function filterErrors(){
  const svc=document.getElementById('err-svc').value;
  const sev=document.getElementById('err-sev').value;
  const sort=document.getElementById('err-sort')?.value||'newest';
  let items=[...errorsData];
  if(svc)items=items.filter(e=>e.sid===svc);
  if(sev)items=items.filter(e=>e.severity===sev);
  // Sort
  if(sort==='newest')items.reverse();
  else if(sort==='oldest'){/* already oldest-first */}
  else if(sort==='count')items.sort((a,b)=>(b.count||1)-(a.count||1));
  else if(sort==='svc')items.sort((a,b)=>a.sid.localeCompare(b.sid));
  const el=document.getElementById('err-list');
  if(!items.length){el.innerHTML='<div style="color:var(--muted);padding:.5rem;font-family:system-ui">No entries match the filter.</div>';return;}
  el.innerHTML=items.map(e=>{
    const ts=new Date(e.ts*1000).toLocaleString('en-CA',{timeZone:TZ,hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const cnt=e.count&&e.count>1?`<span class="err-cnt${e.count>5?' hot':''}" title="${e.count} occurrences">×${e.count}</span>`:'';
    const full=e.line.length>180?e.line:'';
    const short=e.line.length>180?e.line.slice(0,180)+'…':e.line;
    return`<div class="err-row ${esc(e.severity)}" onclick="this.classList.toggle('expanded')">`+
      `<span class="err-sev">${esc(e.severity)}</span>`+
      `<span class="err-svc">${esc(e.sid)}</span>`+
      `<span class="err-ts">${esc(ts)}</span>`+
      `<span class="err-line">${esc(short)}</span>${cnt}</div>`+
      (full?`<div class="err-expand">${esc(full)}</div>`:'');
  }).join('');
}

async function scanNow(){
  const btns=document.querySelectorAll('#p-e button.sm');
  const btn=btns[0];
  if(btn){btn.disabled=true;btn.textContent='Scanning…';}
  await safeJson('/api/errors/scan',{method:'POST'});
  await loadErrors();
  if(btn){btn.disabled=false;btn.textContent='⟳ Scan now';}
}

async function clearErrors(){
  await safeJson('/api/errors',{method:'DELETE'});
  errorsData=[];
  document.getElementById('err-list').innerHTML='<div style="color:var(--muted);padding:.5rem;font-family:system-ui">History cleared.</div>';
  document.getElementById('err-summary').textContent='';
  document.getElementById('err-meta').textContent='';
  updateErrBadge(0,0);
}

// ── Service Modal ──
let modalSid=null, modalUnit=null, modalLogTimer=null, _modalLogLines=[];

function openModal(sid, tab='overview'){
  const s=statusData[sid]; if(!s)return;
  const st=statsData[sid]||{};
  const cur=s.current;
  modalSid=sid;
  modalUnit=cur.unit||'';

  // Header
  document.getElementById('modal-name').textContent=cur.name;
  const cls=cur.ok===null?'pend':cur.ok?'up':'dn';
  const badge=document.getElementById('modal-badge');
  badge.className=`badge ${cls}`;
  badge.textContent=cur.ok===null?'PENDING':cur.ok?'UP':'DOWN';
  const latEl=document.getElementById('modal-lat');
  latEl.textContent=cur.latency_ms!=null?cur.latency_ms+'ms':'';

  // Web URL
  const webUrl=WEB_URLS[sid]||'';
  const urlEl=document.getElementById('modal-weburl');
  if(webUrl){urlEl.href=webUrl;urlEl.style.display='';}else{urlEl.style.display='none';}

  // Meta
  document.getElementById('modal-msg').textContent=cur.message||'—';
  document.getElementById('modal-unit').textContent=cur.unit?`unit: ${cur.unit}`:'';
  const tsEl=document.getElementById('modal-ts');
  if(cur.timestamp)tsEl.textContent=new Date(cur.timestamp).toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});

  // Overview
  const statsHtml=renderStats(sid,st);
  document.getElementById('modal-stats-body').innerHTML=statsHtml||'<div style="color:var(--muted);font-size:.78rem">No stats collected yet.</div>';
  const installed=st.version||st.addon_version||st.bazarr_version||'';
  document.getElementById('modal-version-body').innerHTML=renderVersion(sid,installed);
  document.getElementById('modal-history-body').innerHTML=s.history?.length?
    `<div style="font-size:.6rem;color:var(--muted);margin-bottom:.2rem">Uptime history (last ${s.history.length} checks)</div><div class="bar" style="margin:0">${bar(s.history)}</div>`:'';

  // Controls: web button
  const cwBtn=document.getElementById('ctrl-open-web');
  if(webUrl){cwBtn.style.display='';cwBtn.onclick=()=>window.open(webUrl,'_blank');}
  else{cwBtn.style.display='none';}
  document.getElementById('ctrl-output').textContent='Action output will appear here.';
  document.getElementById('ctrl-output').style.color='var(--muted)';

  // System info panel in controls
  const sysinfo=document.getElementById('ctrl-sysinfo');
  sysinfo.innerHTML=cur.unit?[
    sysR('Unit',cur.unit),sysR('Systemd',cur.systemd,cur.systemd==='active'?'ok':cur.systemd==='inactive'?'err':''),
    sysR('Status',cur.ok?'Healthy':'Unhealthy',cur.ok?'ok':'err'),
    cur.latency_ms!=null?sysR('Latency',cur.latency_ms+'ms'):'',
  ].join(''):'';

  // Show modal, open correct tab
  document.getElementById('svc-modal').classList.add('open');
  document.body.style.overflow='hidden';
  openMTab(tab, document.querySelector(`.mtab[onclick*="'${tab}'"]`)||document.querySelector('.mtab'));
}

function closeModal(){
  document.getElementById('svc-modal').classList.remove('open');
  document.body.style.overflow='';
  if(modalLogTimer){clearInterval(modalLogTimer);modalLogTimer=null;}
  _modalLogLines=[];
  modalSid=null; modalUnit=null;
}

function openMTab(name, el){
  document.querySelectorAll('.mtab').forEach(t=>t.classList.remove('active'));
  if(el)el.classList.add('active');
  document.querySelectorAll('.mpanel').forEach(p=>p.classList.remove('active'));
  document.getElementById('mt-'+name).classList.add('active');
  if(name==='logs'){
    if(modalLogTimer){clearInterval(modalLogTimer);modalLogTimer=null;}
    modalFetchLogs();
    modalLogTimer=setInterval(modalFetchLogs,5000);
  } else {
    if(modalLogTimer){clearInterval(modalLogTimer);modalLogTimer=null;}
  }
}

async function modalFetchLogs(){
  if(!modalUnit)return;
  const n=document.getElementById('modal-log-lines')?.value||'200';
  const box=document.getElementById('modal-logbox');
  const st=document.getElementById('modal-log-status');
  const d=await safeJson('/api/logs/'+encodeURIComponent(modalUnit)+'?n='+n);
  if(!d){box.innerHTML='<span style="color:var(--err)">Error fetching logs.</span>';return;}
  if(d.error){box.innerHTML=`<span style="color:var(--err)">${esc(d.error)}</span>`;return;}
  _modalLogLines=d.lines||[];
  modalFilterLogs();
  st.textContent=`${_modalLogLines.length} lines · `+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
}

function modalFilterLogs(){
  const box=document.getElementById('modal-logbox');
  if(!_modalLogLines.length){box.innerHTML='<span style="color:var(--muted)">No logs.</span>';return;}
  const q=(document.getElementById('modal-log-search')?.value||'').toLowerCase();
  const lines=q?_modalLogLines.filter(l=>l.toLowerCase().includes(q)):_modalLogLines;
  if(!lines.length){box.innerHTML='<span style="color:var(--muted)">No lines match filter.</span>';return;}
  const atBot=box.scrollHeight-box.scrollTop-box.clientHeight<60;
  box.innerHTML=lines.map(l=>`<span class="${/error|critical|fail|exception/i.test(l)?'le':/warn/i.test(l)?'lw':''}">${esc(l)}</span>`).join('\n');
  if(atBot)box.scrollTop=box.scrollHeight;
}

async function svcAction(action){
  if(!modalUnit)return;
  const out=document.getElementById('ctrl-output');
  const btns=document.querySelectorAll('.ctrl-btn');
  btns.forEach(b=>{b.disabled=true;});
  out.style.color='var(--muted)';
  out.textContent=`${action}ing ${modalUnit}…`;
  const r=await safeJson(`/api/service/${encodeURIComponent(modalUnit)}/${action}`,{method:'POST'});
  btns.forEach(b=>{b.disabled=false;});
  if(r?.ok){
    out.style.color='var(--ok)';
    out.textContent=`✓ ${action} succeeded`;
    setTimeout(()=>refresh(),2000);
  } else {
    out.style.color='var(--err)';
    out.textContent=`✗ ${action} failed: ${r?.error||'unknown error'}`;
  }
}

async function quickRestart(sid){
  const s=statusData[sid]; if(!s)return;
  const unit=s.current.unit; if(!unit)return;
  const card=document.getElementById('card-'+sid);
  if(card){card.style.opacity='.5';card.style.pointerEvents='none';}
  await safeJson(`/api/service/${encodeURIComponent(unit)}/restart`,{method:'POST'});
  if(card){card.style.opacity='';card.style.pointerEvents='';}
  setTimeout(()=>refresh(),2000);
}

function openServiceWeb(){
  const url=WEB_URLS[modalSid]; if(url)window.open(url,'_blank');
}

// ── Keyboard: Escape closes modal ──
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

// ── Jellyfin tab ──
let jfLoaded=false;
async function loadJellyfin(){
  const d=await safeJson('/api/jellyfin');
  if(!d)return;
  jfLoaded=true;
  const meta=document.getElementById('jf-meta');
  meta.textContent='Updated: '+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
  // Sessions
  const sesEl=document.getElementById('jf-sessions');
  const sessions=d.sessions||[];
  const active=sessions.filter(s=>s.NowPlayingItem);
  let sh='<h3>Active Sessions ('+sessions.length+')</h3>';
  if(!sessions.length)sh+='<div style="color:var(--muted);font-size:.78rem">No active sessions</div>';
  else{
    for(const s of sessions){
      const user=s.UserName||'Unknown';
      const client=s.Client||'';
      const device=s.DeviceName||'';
      const np=s.NowPlayingItem;
      const playing=np?`<span style="color:var(--ok)">&#x25B6; ${esc(np.Name||'')}${np.SeriesName?' ('+esc(np.SeriesName)+')':''}</span>`:'<span style="color:var(--muted)">Idle</span>';
      sh+=`<div style="padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.75rem">
        <div style="display:flex;gap:.5rem;align-items:center"><strong style="color:var(--accent2)">${esc(user)}</strong><span style="color:var(--muted)">${esc(client)} / ${esc(device)}</span></div>
        <div style="margin-top:.15rem">${playing}</div></div>`;
    }
  }
  sesEl.innerHTML=sh;
  // Activity
  const actEl=document.getElementById('jf-activity');
  const activity=d.activity||[];
  let ah='<h3>Recent Activity ('+activity.length+')</h3>';
  if(!activity.length)ah+='<div style="color:var(--muted);font-size:.78rem">No recent activity</div>';
  else{
    for(const a of activity.slice(0,30)){
      const ts=a.Date?new Date(a.Date).toLocaleString('en-CA',{timeZone:TZ,hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      const sev=a.Severity==='Error'?'err':a.Severity==='Warning'?'warn':'muted';
      ah+=`<div style="padding:.25rem 0;border-bottom:1px solid var(--border);font-size:.7rem;display:flex;gap:.5rem">
        <span style="color:var(--muted);min-width:90px;flex-shrink:0">${esc(ts)}</span>
        <span style="color:var(--${sev})">${esc(a.Name||a.Type||'')}</span>
        <span style="color:var(--muted2);margin-left:auto">${esc(a.ShortOverview||'').slice(0,80)}</span></div>`;
    }
  }
  actEl.innerHTML=ah;
}

// ── Benchmark tab ──
let benchInited=false;
function initBench(){
  if(benchInited)return;benchInited=true;
  const sel=document.getElementById('bench-title');
  // Group titles
  const groups={'Popular Movies':[],'Niche Movies':[],'Popular TV':[],'Niche TV':[],'Popular Anime':[],'Niche Anime':[],'TV Episodes':[]};
  for(const [id,name] of Object.entries(BENCH_TITLES)){
    if(id.includes(':'))groups['TV Episodes'].push([id,name]);
    else if(['tt0468569','tt1375666','tt0111161','tt0816692','tt15398776','tt6718170','tt1517268','tt9362722'].includes(id))groups['Popular Movies'].push([id,name]);
    else if(['tt0118799','tt0087843','tt0347149','tt6751668','tt5311514'].includes(id))groups['Niche Movies'].push([id,name]);
    else if(['tt0903747','tt0944947','tt2861424','tt7366338','tt11280740'].includes(id))groups['Popular TV'].push([id,name]);
    else if(['tt2085059','tt0306414','tt5491994'].includes(id))groups['Niche TV'].push([id,name]);
    else if(['tt0388629','tt0877057','tt0434706','tt10919420','tt5370118'].includes(id))groups['Popular Anime'].push([id,name]);
    else groups['Niche Anime'].push([id,name]);
  }
  for(const [g,items] of Object.entries(groups)){
    if(!items.length)continue;
    const og=document.createElement('optgroup');og.label=g;
    for(const [id,name] of items){const o=document.createElement('option');o.value=id;o.textContent=name+' ('+id.split(':')[0]+')';og.appendChild(o);}
    sel.appendChild(og);
  }
}

async function runBench(){
  const imdb=document.getElementById('bench-title').value;
  if(!imdb){document.getElementById('bench-status').textContent='Select a title first';return;}
  const btn=document.getElementById('bench-run-btn');
  const status=document.getElementById('bench-status');
  btn.disabled=true;status.textContent='Running benchmark for '+BENCH_TITLES[imdb]+'...';
  const d=await safeJson('/api/benchmark?imdb='+encodeURIComponent(imdb));
  btn.disabled=false;
  if(!d){status.textContent='Benchmark failed';return;}
  status.textContent='Done — '+new Date().toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false});
  renderBenchTable(d);
}

async function runAllBench(){
  const status=document.getElementById('bench-status');
  const el=document.getElementById('bench-results');
  const titles=Object.entries(BENCH_TITLES);
  status.textContent='Running all '+titles.length+' benchmarks (this takes a while)...';
  el.innerHTML='';
  let i=0;
  for(const [imdb,name] of titles){
    i++;status.textContent=`[${i}/${titles.length}] ${name}...`;
    const d=await safeJson('/api/benchmark?imdb='+encodeURIComponent(imdb));
    if(d)renderBenchTable(d,true);
  }
  status.textContent='All '+titles.length+' benchmarks complete';
}

function renderBenchTable(d,append){
  const el=document.getElementById('bench-results');
  const sum=d.summary||{};
  const sh=sum.self_hosted||{};
  const pub=sum.public||{};
  let h=`<div style="margin-bottom:1.2rem;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem;overflow-x:auto">`;
  h+=`<div style="display:flex;gap:.8rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap">`;
  h+=`<strong style="color:var(--accent2);font-size:.88rem">${esc(d.title)}</strong>`;
  h+=`<code style="font-size:.68rem">${esc(d.imdb)}</code>`;
  h+=`<span style="font-size:.68rem;color:var(--muted);margin-left:auto">${new Date(d.timestamp).toLocaleTimeString('en-CA',{timeZone:TZ,hour12:false})}</span>`;
  h+=`</div>`;
  // Summary row
  h+=`<div style="display:flex;gap:1rem;margin-bottom:.6rem;flex-wrap:wrap">`;
  h+=`<div style="font-size:.72rem;padding:.3rem .6rem;background:var(--ok-bg);border-radius:6px;border:1px solid #065f46">Self-hosted: <strong style="color:var(--ok)">${sh.total_streams||0}</strong> streams, avg <strong style="color:var(--ok)">${sh.avg_latency_ms||'—'}</strong>ms</div>`;
  h+=`<div style="font-size:.72rem;padding:.3rem .6rem;background:#12232a;border-radius:6px;border:1px solid #164e63">Public: <strong style="color:#67e8f9">${pub.total_streams||0}</strong> streams, avg <strong style="color:#67e8f9">${pub.avg_latency_ms||'—'}</strong>ms</div>`;
  h+=`</div>`;
  // Table
  h+=`<table style="width:100%;border-collapse:collapse;font-size:.72rem"><thead><tr style="border-bottom:1px solid var(--border)">`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Name</th>`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Group</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Latency</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Streams</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">4K</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">1080p</th>`;
  h+=`<th style="text-align:right;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">720p</th>`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Codec</th>`;
  h+=`<th style="text-align:left;padding:.3rem .4rem;color:var(--muted);font-size:.6rem;text-transform:uppercase">Status</th>`;
  h+=`</tr></thead><tbody>`;
  for(const r of (d.results||[])){
    const grpCls=r.group==='self-hosted'?'ok':'';
    const latCls=r.latency_ms!=null?(r.latency_ms<2000?'ok':r.latency_ms<5000?'warn':'err'):'muted';
    const res=r.resolutions||{};
    h+=`<tr style="border-bottom:1px solid #13172a">`;
    h+=`<td style="padding:.25rem .4rem;color:#e2e8f0;font-weight:600">${esc(r.name)}</td>`;
    h+=`<td style="padding:.25rem .4rem;color:var(--${grpCls||'accent2'})">${esc(r.group)}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right;color:var(--${latCls})">${r.latency_ms!=null?r.latency_ms+'ms':'—'}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right;color:var(--accent2);font-weight:700">${r.streams||0}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right">${res['4k']||0}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right">${res['1080p']||0}</td>`;
    h+=`<td style="padding:.25rem .4rem;text-align:right">${res['720p']||0}</td>`;
    h+=`<td style="padding:.25rem .4rem">${esc(r.top_codec||'—')}</td>`;
    h+=`<td style="padding:.25rem .4rem;color:var(--${r.error?'err':'ok'})">${r.error?esc(r.error):'OK'}</td>`;
    h+=`</tr>`;
  }
  h+=`</tbody></table></div>`;
  if(append)el.innerHTML+=h; else el.innerHTML=h;
}

// ── Init ──
refresh(); setInterval(refresh,30000);
