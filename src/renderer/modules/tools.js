import appState from '../state/appState.js';
import { escapeHtml, escapeAttr } from './utils.js';

const getMessage = deps => deps?.mostrarMensaje || (() => {});
const getDisplayInstances = deps => deps?.displayInstances || (() => {});

export async function loadToolInstances(deps = {}) {
  const box=document.getElementById('tool-instances-list'); if(!box) return;
  const instances=await window.launcherAPI.getInstances();
  if(!instances.length){ box.innerHTML='<div class="tool-card">No hay instancias instaladas.</div>'; return; }
  box.innerHTML=instances.map(i=>`<div class="tool-card"><div><strong>${escapeHtml(i.name)}</strong><p>${escapeHtml(i.version||'?')} · ${escapeHtml(i.loader||'vanilla')}</p></div><div style="display:flex;gap:6px"><button class="btn-secondary tool-diagnose" data-path="${escapeAttr(i.path)}"><i class="fa-solid fa-stethoscope"></i></button><button class="btn-primary tool-repair" data-path="${escapeAttr(i.path)}"><i class="fa-solid fa-wrench"></i> Reparar</button></div></div>`).join('');
  box.querySelectorAll('.tool-repair').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Reparando...';const r=await window.launcherAPI.repairInstance(b.dataset.path);getMessage(deps)(r.success?'✅ Reparación completada':'❌ '+(r.error||'Error'));b.disabled=false;b.innerHTML='<i class="fa-solid fa-wrench"></i> Reparar';}));
  box.querySelectorAll('.tool-diagnose').forEach(b=>b.addEventListener('click',async()=>{const r=await window.launcherAPI.diagnoseInstance(b.dataset.path);if(!r.success)return getMessage(deps)('❌ '+r.error);const issues=[];if(!r.minecraftPresent)issues.push('Minecraft base');if(r.missingFiles?.length)issues.push(`${r.missingFiles.length} archivos`);if(r.javaRequired&&(r.javaDetected||0)<r.javaRequired)issues.push(`Java ${r.javaRequired}`); if(r.languagesAvailable===false)issues.push('Idiomas de Minecraft');getMessage(deps)(issues.length?'⚠️ Problemas: '+issues.join(', '):'✅ Instancia saludable');}));
}

export async function loadJavaManager(deps = {}) {
  const box=document.getElementById('java-manager-list'); if(!box) return;
  const data=await window.launcherAPI.getJavaStatus();
  box.innerHTML=[8,17,21,25].map(v=>{const sys=(data.system||0)>=v,local=(data.installed||[]).includes(v);return `<div class="tool-card"><div><strong>Java ${v}</strong><p>${sys?'Disponible en el sistema':local?'Instalado en MineSteam':'No instalado'}</p></div><button class="${sys||local?'btn-secondary':'btn-primary'} java-install" data-version="${v}" ${sys||local?'disabled':''}>${sys||local?'✓ Disponible':'Descargar'}</button></div>`}).join('');
  box.querySelectorAll('.java-install').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Descargando...';const r=await window.launcherAPI.installJava(Number(b.dataset.version));getMessage(deps)(r.success?`✅ Java ${b.dataset.version} instalado`:'❌ '+(r.error||'Error'));loadJavaManager(deps);}));
}

export function terminalOpen(){
  const nav=document.querySelector('[data-target="page-terminal"]'); if(nav) nav.click();
  const badge=document.getElementById('terminal-badge'); if(badge) badge.textContent='';
}

export function terminalAppend(entry){
  const normalized={time:new Date().toISOString(),level:String(entry?.level||'info'),source:String(entry?.source||'launcher'),message:String(entry?.message||''),progress:entry?.progress};
  appState.tools.terminalEntries.push(normalized);
  if(appState.tools.terminalEntries.length>2500) appState.tools.terminalEntries.splice(0,appState.tools.terminalEntries.length-2500);
  renderTerminal();
}

export function renderTerminal(){
  const box=document.getElementById('terminal-log'); if(!box) return;
  const query=String(appState.tools.terminalSearch||'').trim().toLowerCase();
  const filter=appState.tools.terminalFilter||'all';
  const filtered=appState.tools.terminalEntries.filter(e=>(filter==='all'||e.level===filter)&&(!query||`${e.source} ${e.message}`.toLowerCase().includes(query)));
  box.innerHTML=filtered.map(e=>{const time=new Date(e.time).toLocaleTimeString();const progress=Number.isFinite(e.progress)?`<span class="terminal-progress"> ${Math.round(e.progress)}%</span>`:'';return `<div class="terminal-line ${escapeAttr(e.level)}"><span class="terminal-time">[${escapeHtml(time)}]</span><span class="terminal-source">[${escapeHtml(e.source)}]</span>${escapeHtml(e.message)}${progress}</div>`;}).join('');
  box.scrollTop=box.scrollHeight;
  const left=document.getElementById('terminal-status-left'); const right=document.getElementById('terminal-status-right');
  if(left) left.textContent=appState.tools.terminalEntries.length?`Live Log · ${escapeHtml(appState.tools.terminalEntries[appState.tools.terminalEntries.length-1].source)}`:'Esperando actividad...';
  if(right) right.textContent=`${filtered.length} eventos`;
}

export async function setupCrashAnalyzer(deps={}){
  const select=document.getElementById('crash-instance-select'); if(!select) return;
  const instances=await window.launcherAPI.getInstances(); select.innerHTML='<option value="">Selecciona una instancia...</option>'+instances.map(i=>`<option value="${escapeAttr(i.path)}">${escapeHtml(i.name)}</option>`).join('');
  document.getElementById('crash-analyze-btn')?.addEventListener('click',async()=>{const path=select.value;if(!path)return getMessage(deps)('⚠️ Selecciona una instancia');const box=document.getElementById('crash-analysis-result');box.style.display='block';box.innerHTML='<p class="muted">Analizando logs...</p>';const r=await window.launcherAPI.analyzeCrash(path);if(r?.error){box.innerHTML=`<p>❌ ${escapeHtml(r.error)}</p>`;return;}box.innerHTML=`<strong>${escapeHtml(r.summary||'Análisis completado')}</strong>`+(r.details?`<p class="muted">${escapeHtml(r.details)}</p>`:'');});
}

export async function setupOptimizer(deps={}){
  const select=document.getElementById('optimizer-instance-select'); if(!select) return;
  const instances=await window.launcherAPI.getInstances(); select.innerHTML='<option value="">Selecciona una instancia...</option>'+instances.map(i=>`<option value="${escapeAttr(i.path)}">${escapeHtml(i.name)}</option>`).join('');
  const render=async()=>{const p=select.value;if(!p)return;const r=await window.launcherAPI.optimizerRecommendations(p);const box=document.getElementById('optimizer-status');box.style.display='block';if(r?.error){box.innerHTML=`❌ ${escapeHtml(r.error)}`;return;}box.innerHTML=`<strong>${escapeHtml(r.profile||'Perfil recomendado')}</strong><p class="muted" style="margin-top:6px;">RAM del sistema: ${escapeHtml(String(r.totalRamGb??'?'))} GB · Distancia de render: ${escapeHtml(String(r.settings?.renderDistance??'?'))} · Simulación: ${escapeHtml(String(r.settings?.simulationDistance??'?'))}</p>`;};
  document.getElementById('optimizer-analyze-btn')?.addEventListener('click',render);
  document.getElementById('optimizer-apply-btn')?.addEventListener('click',async()=>{if(!select.value)return getMessage(deps)('⚠️ Selecciona una instancia');const r=await window.launcherAPI.optimizerApply(select.value,{});if(r?.error)return getMessage(deps)('❌ '+r.error);await render();getMessage(deps)('✅ Optimización aplicada. Se utilizará al abrir Minecraft.');});
}

export async function openInstanceBackupsModal(deps={}){
  const modal=document.getElementById('modal-instance-backups'); const box=document.getElementById('instance-backups-list'); if(!modal||!box||!appState.instance.detailPath)return;
  const backups=await window.launcherAPI.listInstanceBackups(appState.instance.detailPath);
  box.innerHTML=backups.length?backups.map(b=>`<div class="tool-card"><div><strong>${escapeHtml(b.name)}</strong><p>${(b.size/1024/1024).toFixed(1)} MB · ${new Date(b.modifiedAt).toLocaleString()}</p></div><button class="btn-secondary restore-instance-backup" data-path="${escapeAttr(b.path)}">Restaurar</button></div>`).join(''):'<div class="feature-card"><p class="muted">No hay backups de esta instancia.</p></div>';
  box.querySelectorAll('.restore-instance-backup').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Restaurar este backup reemplazará el contenido actual de la instancia. ¿Continuar?'))return;const r=await window.launcherAPI.restoreInstanceBackup(appState.instance.detailPath,btn.dataset.path);if(r?.error)return getMessage(deps)('❌ '+r.error);getMessage(deps)('✅ Backup restaurado.');modal.classList.remove('show');getDisplayInstances(deps)();}));
  modal.classList.add('show');
}

export async function createCurrentInstanceBackup(deps={}){
  if(!appState.instance.detailPath)return;
  terminalAppend({level:'info',source:'backup',message:'Creando backup completo de la instancia...'});
  const r=await window.launcherAPI.createInstanceBackup(appState.instance.detailPath,'manual');
  if(r?.error)return getMessage(deps)('❌ '+r.error);
  terminalAppend({level:'info',source:'backup',message:`Backup creado: ${r.name}`});
  getMessage(deps)('✅ Backup completo creado.');
  openInstanceBackupsModal(deps);
}
