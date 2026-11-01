/* HABITLY — personal habit tracker
   Data is stored locally in this browser. Export backups regularly.
*/
"use strict";
const STORAGE_KEY = "habitly_tracker_v2";
const SUPABASE_URL = "https://tccynzwxgkjminduzqol.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_n6pQUyQnmsB1xs9qTJgzEw_FHs9MIqF";
const CLOUD_TABLE = "tracker_data";
let supabaseClient=null, currentUser=null, cloudSaveTimer=null, cloudSaveInProgress=false, cloudSaveAgain=false;
const $ = id => document.getElementById(id);
const todayISO = () => toISO(new Date());
const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const fromISO = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d,12); };
const addDays = (date,n) => { const d=fromISO(typeof date==="string"?date:toISO(date)); d.setDate(d.getDate()+n); return d; };
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const monthDays = key => { const [y,m]=key.split("-").map(Number); return new Date(y,m,0).getDate(); };
const fmt = (iso,opts={day:"numeric",month:"short",year:"numeric"}) => fromISO(iso).toLocaleDateString("en-IN",opts);
const clamp = n => Math.max(0,Math.min(100,Math.round(n)));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const escapeAttr = escapeHTML;

function freshState(){ return {version:2,startDate:todayISO(),habits:[],mandatory:[],days:{},shownMorning:{},shownEvening:{},morningMessageIndex:{}}; }
function loadState(){
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw) return freshState();
    const old=JSON.parse(raw);
    return {...freshState(),...old,version:2,habits:Array.isArray(old.habits)?old.habits:[],mandatory:Array.isArray(old.mandatory)?old.mandatory:[],days:old.days||{},shownMorning:old.shownMorning||{},shownEvening:old.shownEvening||{}};
  } catch(err){ console.error("Habitly data could not be loaded:",err); return freshState(); }
}
let state=loadState(), activePage="dashboard", dailyMonth=monthKey(new Date()), reportMonth=monthKey(new Date()), selectedDate=todayISO(), weekDate=todayISO();
let habitModal,messageModal,toast,dashboardChart,categoryChart,editingItem=null;
function save(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(err){alert("Your browser could not save this update. Export a backup and check available browser storage.");console.error(err);}
  queueCloudSave();
}
function setCloudStatus(message,isError=false){const el=$("cloudStatus");if(el){el.textContent=message;el.style.color=isError?"#fb7185":"";}}
function queueCloudSave(){
  if(!currentUser)return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>syncStateToCloud(),650);
}
async function syncStateToCloud(){
  if(!currentUser)return;
  if(cloudSaveInProgress){cloudSaveAgain=true;return;}
  cloudSaveInProgress=true;setCloudStatus("Saving your latest changes to the cloud…");
  try{
    const payload={user_id:currentUser.id,data:state,updated_at:new Date().toISOString()};
    const {error}=await supabaseClient.from(CLOUD_TABLE).upsert(payload,{onConflict:"user_id"});
    if(error)throw error;
    setCloudStatus("All changes saved to your cloud account.");
  }catch(err){console.error("Cloud save failed:",err);setCloudStatus("Cloud save failed. Check your connection and try again.",true);}
  finally{cloudSaveInProgress=false;if(cloudSaveAgain){cloudSaveAgain=false;syncStateToCloud();}}
}
async function loadCloudState(){
  const {data,error}=await supabaseClient.from(CLOUD_TABLE).select("data").eq("user_id",currentUser.id).maybeSingle();
  if(error)throw error;
  if(data&&data.data&&Array.isArray(data.data.habits)){
    state={...freshState(),...data.data,version:2};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    setCloudStatus("Your latest tracker data loaded from the cloud.");
  }else{
    // First sign-in: preserve and upload existing browser data instead of replacing it.
    await syncStateToCloud();
    setCloudStatus("Your existing tracker data is now saved to the cloud.");
  }
}
async function showSignedInApp(session){
  currentUser=session.user;
  $("authGate").hidden=true;$("appShell").hidden=false;
  $("accountEmail").textContent=`Signed in as ${currentUser.email||"your account"}`;
  try{await loadCloudState();renderPage(activePage);}
  catch(err){console.error("Could not load cloud data:",err);setCloudStatus("Could not load cloud data. Please refresh and try again.",true);alert("Unable to load your cloud tracker data. Please check the internet connection and Supabase table setup.");}
}
async function handleAuthSubmit(e){
  e.preventDefault();const button=$("authSubmit"),status=$("authStatus");button.disabled=true;button.textContent="Signing in…";status.textContent="Connecting securely…";
  try{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("authEmail").value.trim(),password:$("authPassword").value});
    if(error)throw error;
    await showSignedInApp(data.session);
  }catch(err){status.textContent=err.message||"Sign in failed. Please check your details.";status.style.color="#fb7185";}
  finally{button.disabled=false;button.textContent="Sign in";}
}
function dayData(iso){ if(!state.days[iso])state.days[iso]={checks:{},mandatory:{},reasons:{},note:"",mood:""}; const d=state.days[iso];d.checks=d.checks||{};d.mandatory=d.mandatory||{};d.reasons=d.reasons||{};d.note=d.note||"";return d; }
function isActive(item,iso){return iso>=item.createdAt&&(!item.archivedAt||iso<=item.archivedAt);}
function activeHabits(iso){return state.habits.filter(h=>isActive(h,iso));}
function activeMandatory(iso){return state.mandatory.filter(h=>isActive(h,iso));}
function score(items,checks){const done=items.filter(x=>!!checks[x.id]).length;return {done,total:items.length,pct:items.length?clamp(done/items.length*100):0};}
function dateRange(start,end){const out=[];if(!start||!end||start>end)return out;for(let d=fromISO(start);d<=fromISO(end);d=addDays(d,1))out.push(toISO(d));return out;}
function monthRange(key){const [y,m]=key.split("-").map(Number);return {start:`${key}-01`,end:`${key}-${String(monthDays(key)).padStart(2,"0")}`};}
function dailyScore(iso){return score(activeHabits(iso),dayData(iso).checks);}
function mandatoryScore(iso){return score(activeMandatory(iso),dayData(iso).mandatory);}
function allScore(iso){const a=dailyScore(iso),b=mandatoryScore(iso),total=a.total+b.total,done=a.done+b.done;return {done,total,pct:total?clamp(done/total*100):0};}
function showToast(message){$("toastText").textContent=message;toast.show();}
function hashString(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

/* 365 deterministic daily messages: 5 rotating message structures × 73 distinct day prompts.
   Every calendar date maps to a stable, non-repeating entry within a 365-day cycle. */
const MORNING_STARTS=["A fresh morning is here.","Today is a new page.","Give yourself a gentle beginning.","Your next chapter starts today.","Welcome a new opportunity.","You can make room for progress today.","Let this morning be a quiet reset.","A small beginning is still a beginning.","Your effort matters, even when it feels small.","Step into today with patience."];
const MORNING_ACTIONS=["Choose one small action and complete it with care.","Start with the habit that feels easiest to begin.","Give your most important goal ten focused minutes.","Make your next choice support the person you want to become.","Take one useful step before distractions take over.","Keep your plan realistic and your expectations kind.","Do the next helpful thing, not every possible thing.","Make consistency your goal, not perfection.","Give yourself credit for showing up.","Protect a little time for what matters to you."];
const MORNING_ENDINGS=["You are allowed to grow at your own pace.","A little progress is worth celebrating.","Yesterday does not decide what today can become.","You do not need a perfect day to make a meaningful one.","Keep going gently; small steps add up.","Let your actions be kinder than your doubts.","Your future is shaped by ordinary choices like these.","Try again whenever you need to.","Be proud of effort, not only outcomes.","Make today count in your own way."];
function morningMessageFor(date){
  const dayNumber=Math.floor((fromISO(date)-fromISO("2026-01-01"))/86400000);
  const index=((dayNumber%365)+365)%365;
  const a=index%MORNING_STARTS.length,b=Math.floor(index/10)%MORNING_ACTIONS.length,c=Math.floor(index/3)%MORNING_ENDINGS.length;
  return `${MORNING_STARTS[a]} ${MORNING_ACTIONS[b]} ${MORNING_ENDINGS[c]} Today’s tiny challenge #${index+1}: follow through on one small promise to yourself.`;
}
const EVENING_OPENERS=["You made it through today.","Take a gentle look at your day.","Your day is complete, and your effort deserves acknowledgement.","Pause for a moment and recognise what you did today.","Today had its own pace, and you showed up for it."];
const EVENING_WINS=["You completed {done} of {total} tracked items ({pct}%).","You checked off {done} out of {total} habits ({pct}%).","Your tracker shows {done}/{total} completed items today ({pct}%)."];
const EVENING_MISSED=["You left {missed} item(s) unfinished. That does not cancel the work you did.","There were {missed} habit(s) you did not complete. Treat that as information, not failure.","You missed {missed} item(s); tomorrow gives you another chance to adjust."];
const EVENING_NO_MISSED=["Everything you planned in the tracker is checked off today. Take a moment to enjoy that.","You completed every item you tracked today. Well done, and remember to rest.","All tracked items are complete. Celebrate the follow-through without expecting perfection tomorrow."];
function personalizedEveningMessage(date){
  const all=allScore(date),d=dayData(date),missed=[...activeHabits(date).filter(h=>!d.checks[h.id]).map(h=>h.name),...activeMandatory(date).filter(h=>!d.mandatory[h.id]).map(h=>h.name)];
  const opener=EVENING_OPENERS[hashString(date)%EVENING_OPENERS.length];
  if(!all.total)return `${opener} You did not have any active habits recorded for this date. Rest well, and add a small goal whenever you are ready.`;
  let msg=`${opener} ${EVENING_WINS[hashString(date+"wins")%EVENING_WINS.length].replace("{done}",all.done).replace("{total}",all.total).replace("{pct}",all.pct+"%")} `;
  msg+=missed.length?EVENING_MISSED[hashString(date+"missed")%EVENING_MISSED.length].replace("{missed}",missed.length):EVENING_NO_MISSED[hashString(date+"all")%EVENING_NO_MISSED.length];
  if(missed.length){msg+=` Habits to revisit: ${missed.slice(0,4).join(", ")}.`;const reasons=missed.map(name=>{const h=[...activeHabits(date),...activeMandatory(date)].find(x=>x.name===name);return h&&d.reasons[h.id];}).filter(Boolean);if(reasons.length)msg+=` You noted: ${reasons.slice(0,2).join("; ")}.`;}
  if(d.note.trim())msg+=` Your reflection: “${d.note.trim()}”`;
  if(d.mood)msg+=` You described today as ${d.mood.toLowerCase()}.`;
  msg+=" Tomorrow, choose one small adjustment if it would help. Rest well.";
  return msg;
}
function showMessage(type,manual=false){
  const day=todayISO(),morning=type==="morning";
  $("messageEyebrow").textContent=morning?"A FRESH START":"A LITTLE NOTE BEFORE REST";
  $("messageModalTitle").textContent=morning?"Good morning!":"Your day in review";
  $("messageModalText").textContent=morning?morningMessageFor(day):personalizedEveningMessage(day);
  messageModal.show();
  if(morning)state.shownMorning[day]=true;else state.shownEvening[day]=true;
  save();
}
function maybeMorningMessage(){const t=todayISO();if(!state.shownMorning[t])showMessage("morning");}

function setPage(page){
  const valid=["dashboard","daily","mandatory","weekly","monthly","settings"];
  if(!valid.includes(page))return;
  activePage=page;
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${page}`));
  document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.classList.contains("nav-link")&&b.dataset.page===page));
  const titles={dashboard:"Dashboard",daily:"Daily habits",mandatory:"Mandatory routine",weekly:"Weekly report",monthly:"Monthly report",settings:"Settings & backup"};
  $("pageTitle").textContent=titles[page];
  $("sidebar").classList.remove("open");$("sidebarBackdrop").classList.remove("show");
  renderPage(page);
}
function renderPage(page){({dashboard:renderDashboard,daily:renderDaily,mandatory:renderMandatory,weekly:renderWeekly,monthly:renderMonthly,settings:renderSettings}[page]||(()=>{}))();}

function renderDashboard(){
  const t=todayISO(),a=dailyScore(t),b=mandatoryScore(t),r=monthRange(monthKey(new Date())),end=t<r.end?t:r.end;
  $("headerDate").textContent=fmt(t,{weekday:"short",day:"numeric",month:"short"});
  $("statToday").textContent=`${a.pct}%`;$("statTodaySub").textContent=`${a.done} of ${a.total} completed`;
  $("statMandatory").textContent=`${b.pct}%`;$("statMandatorySub").textContent=`${b.done} of ${b.total} completed`;
  const dates=dateRange(r.start,end).filter(d=>d>=state.startDate);let eligible=0,completed=0;
  dates.forEach(d=>{const x=allScore(d);eligible+=x.total;completed+=x.done;});
  $("statMonth").textContent=`${eligible?clamp(completed/eligible*100):0}%`;
  $("statStreak").textContent=`${bestCurrentStreak()} ${bestCurrentStreak()===1?"day":"days"}`;
  $("statStreakSub").textContent="Current consecutive completion";
  $("dashboardNote").value=dayData(t).note||"";
  $("welcomeTitle").textContent=new Date().getHours()<12?"A fresh start, just for you.":"Keep going at your own pace.";
  $("welcomeText").textContent="You don't need a perfect day. Just take the next small step.";
  const chartDates=dates.slice(-14),labels=chartDates.map(d=>fromISO(d).toLocaleDateString("en-IN",{day:"numeric",month:"short"})),values=chartDates.map(d=>allScore(d).pct);
  if(dashboardChart)dashboardChart.destroy();
  dashboardChart=new Chart($("dashboardChart"),{type:"line",data:{labels,datasets:[{label:"Completion",data:values,borderColor:"#10b981",backgroundColor:"rgba(16,185,129,.13)",fill:true,tension:.35,pointRadius:3,pointBackgroundColor:"#d6b36a"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:"#91a1b7",maxTicksLimit:7}},y:{min:0,max:100,grid:{color:"rgba(145,161,183,.12)"},ticks:{color:"#91a1b7",callback:v=>v+"%"}}}}});
  if(categoryChart)categoryChart.destroy();
  categoryChart=new Chart($("categoryChart"),{type:"doughnut",data:{labels:["Personal","Mandatory"],datasets:[{data:[a.pct,b.pct],backgroundColor:["#10b981","#d6b36a"],borderColor:"#151f32",borderWidth:5,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:"72%",plugins:{legend:{display:false}}}});
  const items=activeHabits(t).map(h=>({h,rate:habitRate(h,monthKey(new Date()))})).sort((x,y)=>x.rate-y.rate).slice(0,4);
  $("attentionList").innerHTML=items.length?items.map(x=>`<div class="attention-item"><div><strong>${escapeHTML(x.h.name)}</strong><small>${escapeHTML(x.h.description||"Personal habit")}</small></div><span class="attention-rate">${x.rate}%</span></div>`).join(""):'<div class="empty-state">Add a few habits to see where your attention can go.</div>';
}
function bestCurrentStreak(){
  let best=0;const all=[...state.habits.map(h=>({h,type:"personal"})),...state.mandatory.map(h=>({h,type:"mandatory"}))];
  all.forEach(({h,type})=>{let n=0;for(let d=fromISO(todayISO());toISO(d)>=state.startDate;d=addDays(d,-1)){const iso=toISO(d);if(!isActive(h,iso))break;const data=dayData(iso),done=type==="personal"?data.checks[h.id]:data.mandatory[h.id];if(done)n++;else break;}best=Math.max(best,n);});
  return best;
}
function habitRate(h,key){const r=monthRange(key),end=todayISO()<r.end?todayISO():r.end;let total=0,done=0;dateRange(r.start,end).forEach(d=>{if(isActive(h,d)&&d>=state.startDate){total++;if(dayData(d).checks[h.id])done++;}});return total?clamp(done/total*100):0;}

function renderDaily(){
  $("dailyMonth").value=dailyMonth;$("dailyMonthTitle").textContent=fromISO(dailyMonth+"-01").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const count=monthDays(dailyMonth),r=monthRange(dailyMonth),today=todayISO();
  $("dailyHead").innerHTML=`<tr><th class="habit-name">HABIT</th>${Array.from({length:count},(_,i)=>{const iso=`${dailyMonth}-${String(i+1).padStart(2,"0")}`;return `<th><button class="date-select ${selectedDate===iso?"selected":""}" data-select-date="${iso}" title="Open ${fmt(iso)}">${i+1}<br><small>${fromISO(iso).toLocaleDateString("en-IN",{weekday:"short"})}</small></button></th>`;}).join("")}<th class="action-cell">EDIT</th></tr>`;
  const habits=state.habits.filter(h=>h.createdAt<=r.end&&(!h.archivedAt||h.archivedAt>=r.start));
  $("dailyBody").innerHTML=habits.length?habits.map(h=>`<tr><td class="habit-name"><strong>${escapeHTML(h.name)}</strong>${h.description?`<small class="d-block muted">${escapeHTML(h.description)}</small>`:""}</td>${Array.from({length:count},(_,i)=>{const iso=`${dailyMonth}-${String(i+1).padStart(2,"0")}`,disabled=iso>today||iso<h.createdAt||(h.archivedAt&&iso>h.archivedAt)||iso<state.startDate,checked=!!dayData(iso).checks[h.id];return `<td><input class="habit-check daily-check" type="checkbox" aria-label="${escapeAttr(h.name)} on ${iso}" data-habit="${h.id}" data-date="${iso}" ${checked?"checked":""} ${disabled?"disabled":""}></td>`;}).join("")}<td class="action-cell"><button class="edit-habit" data-edit="${h.id}" aria-label="Edit ${escapeAttr(h.name)}" title="Edit habit"><i class="bi bi-pencil"></i></button><button class="habit-delete" data-archive="${h.id}" aria-label="Archive ${escapeAttr(h.name)}" title="Archive habit"><i class="bi bi-trash3"></i></button></td></tr>`).join(""):'<tr><td colspan="34"><div class="empty-state"><i class="bi bi-plus-circle"></i>No habits yet. Add your first personal habit to begin.</div></td></tr>';
  $("dailyMonthSummary").textContent=getMonthSummary();renderDayDetails();
}
function renderDayDetails(){
  const iso=selectedDate,d=dayData(iso);$("selectedDate").value=iso;$("selectedDayTitle").textContent=fmt(iso,{weekday:"long",day:"numeric",month:"long"});$("dayNote").value=d.note||"";$("dayMood").value=d.mood||"";
  const s=dailyScore(iso);$("dailyScore").textContent=`${s.pct}%`;$("dailyProgressBar").style.width=`${s.pct}%`;$("dailyScoreText").textContent=s.total?`${s.done} of ${s.total} personal habits completed.`:"No personal habits were active on this date.";
  const missed=activeHabits(iso).filter(h=>!d.checks[h.id]);
  $("missedReasons").innerHTML=missed.length?missed.map(h=>`<div class="reason-row"><label for="reason-${h.id}">${escapeHTML(h.name)}</label><input class="form-control dark-input reason-input" id="reason-${h.id}" data-reason="${h.id}" maxlength="180" placeholder="Why didn't this happen? (optional)" value="${escapeAttr(d.reasons[h.id]||"")}"></div>`).join(""):'<p class="muted small mb-0">Lovely! No missed personal habits, or no habits were active.</p>';
}
function renderMandatory(){
  const t=todayISO(),d=dayData(t),items=activeMandatory(t),s=mandatoryScore(t);
  $("mandatoryDateLabel").textContent=fmt(t,{weekday:"long",day:"numeric",month:"short"});
  $("mandatoryPageScore").textContent=`${s.pct}%`;$("mandatoryPageSub").textContent=`${s.done} of ${s.total} completed`;$("mandatoryProgressLabel").textContent=`${s.pct}%`;$("mandatoryProgressBar").style.width=`${s.pct}%`;
  $("mandatoryList").innerHTML=items.length?items.map(h=>`<div class="mandatory-item"><input type="checkbox" class="habit-check mandatory-check" data-id="${h.id}" aria-label="Complete ${escapeAttr(h.name)}" ${d.mandatory[h.id]?"checked":""}><div class="flex-grow-1"><strong>${escapeHTML(h.name)}</strong>${h.description?`<small>${escapeHTML(h.description)}</small>`:""}</div><button class="edit-habit" data-edit-mandatory="${h.id}" aria-label="Edit ${escapeAttr(h.name)}"><i class="bi bi-pencil"></i></button><button class="delete-mandatory" data-archive-mandatory="${h.id}" aria-label="Archive routine"><i class="bi bi-trash3"></i></button></div>`).join(""):'<div class="empty-state"><i class="bi bi-heart"></i>No mandatory routines yet. Add the healthy routines you want to remember.</div>';
}

/* First reporting period: start date through the first Saturday.
   All later periods: Sunday through Saturday. */
function firstWeekEnd(start){const d=fromISO(start),offset=(6-d.getDay()+7)%7;return toISO(addDays(start,offset));}
function weekBounds(date){
  if(date<state.startDate)date=state.startDate;
  const firstEnd=firstWeekEnd(state.startDate);
  if(date<=firstEnd)return {start:state.startDate,end:firstEnd};
  const sunday=toISO(addDays(date,-fromISO(date).getDay()));
  return {start:sunday,end:toISO(addDays(sunday,6))};
}
function aggregateDates(dates){let total=0,done=0;dates.forEach(d=>{const s=allScore(d);total+=s.total;done+=s.done;});return {total,done,pct:total?clamp(done/total*100):0};}
function aggregateCategory(dates,type){let total=0,done=0;dates.forEach(d=>{const s=type==="personal"?dailyScore(d):mandatoryScore(d);total+=s.total;done+=s.done;});return {total,done,pct:total?clamp(done/total*100):0};}
function topMissed(dates){
  const map={};dates.forEach(d=>{activeHabits(d).forEach(h=>{map[h.id]??={name:h.name,total:0,done:0};map[h.id].total++;if(dayData(d).checks[h.id])map[h.id].done++;});activeMandatory(d).forEach(h=>{const id="m_"+h.id;map[id]??={name:h.name,total:0,done:0};map[id].total++;if(dayData(d).mandatory[h.id])map[id].done++;});});
  return Object.values(map).map(x=>({...x,missed:x.total-x.done,rate:x.total?clamp(x.done/x.total*100):0})).filter(x=>x.missed>0).sort((a,b)=>b.missed-a.missed).slice(0,5);
}
function buildInsights(dates,missed){
  if(!dates.length)return ["Start tracking to receive a useful report."];
  const result=[],s=aggregateDates(dates);
  if(s.pct>=80)result.push("Your consistency is strong. Keep the routine realistic so it stays sustainable.");
  else if(s.pct>=50)result.push("You have a foundation to build on. Choose one missed habit and make it easier to complete.");
  else result.push("Try reducing the size of one difficult habit. A 5-minute version is better than skipping it completely.");
  if(missed.length){const x=missed[0];result.push(`Your most-missed item is “${x.name}”. Consider changing its timing, reminder, or daily target.`);}
  const reasons=dates.flatMap(d=>Object.values(dayData(d).reasons||{})).filter(Boolean);
  if(reasons.length)result.push(`You recorded ${reasons.length} reason(s) for missed habits. Look for a repeated obstacle and plan around it.`);
  else result.push("Add a short reason when you miss a habit; it will make future advice more specific.");
  return result;
}
function renderWeekly(){
  $("weekPicker").value=weekDate;
  const w=weekBounds(weekDate),end=w.end>todayISO()?todayISO():w.end,dates=end>=w.start?dateRange(w.start,end).filter(d=>d>=state.startDate):[];
  const stats=aggregateDates(dates),personal=aggregateCategory(dates,"personal"),mandatory=aggregateCategory(dates,"mandatory"),missed=topMissed(dates);
  const dayTiles=dates.map(d=>{const s=allScore(d);return `<div class="day-tile"><span class="day-name">${fromISO(d).toLocaleDateString("en-IN",{weekday:"short"})}</span><strong>${s.pct}%</strong><small>${fmt(d,{day:"numeric",month:"short"})}</small></div>`;}).join("");
  const notes=dates.map(d=>({d,n:dayData(d).note})).filter(x=>x.n.trim()),insights=buildInsights(dates,missed);
  $("weeklyReport").innerHTML=`<div class="panel mb-3"><div class="panel-heading"><div><span class="eyebrow">REPORTING PERIOD</span><h3>${fmt(w.start)} – ${fmt(w.end)}</h3></div><span class="subtle-tag">${dates.length} of ${dateRange(w.start,w.end).length} days elapsed</span></div><div class="report-grid mt-3"><div class="report-metric"><span>Overall progress</span><strong>${stats.pct}%</strong></div><div class="report-metric"><span>Personal habits</span><strong>${personal.pct}%</strong></div><div class="report-metric"><span>Mandatory routine</span><strong>${mandatory.pct}%</strong></div><div class="report-metric"><span>Completed checks</span><strong>${stats.done}/${stats.total}</strong></div></div><div class="progress custom-progress"><div class="progress-bar" style="width:${stats.pct}%"></div></div><div class="report-day-grid">${dayTiles||'<div class="empty-state">No tracked days in this period yet.</div>'}</div></div>
  <div class="row g-3"><div class="col-lg-6"><div class="panel h-100"><span class="eyebrow">PATTERNS</span><h3 class="mb-3">What needs attention?</h3>${missed.length?`<ul class="insight-list">${missed.map(x=>`<li><strong>${escapeHTML(x.name)}</strong> — missed ${x.missed} of ${x.total} eligible days (${x.rate}% completed)</li>`).join("")}</ul>`:'<p class="muted small mt-3">Not enough habit data yet, or no misses recorded.</p>'}</div></div><div class="col-lg-6"><div class="panel h-100"><span class="eyebrow">YOUR NEXT STEPS</span><h3 class="mb-3">A gentle improvement plan</h3><ul class="insight-list">${insights.map(x=>`<li>${escapeHTML(x)}</li>`).join("")}</ul></div></div><div class="col-12"><div class="panel"><span class="eyebrow">YOUR WORDS</span><h3 class="mb-3">Daily reflections</h3>${notes.length?notes.map(x=>`<div class="report-note mb-2"><strong>${fmt(x.d,{weekday:"short",day:"numeric",month:"short"})}:</strong> ${escapeHTML(x.n)}</div>`).join(""):'<p class="muted small">You have not added reflections for this period. Your notes will appear here.</p>'}</div></div></div>`;
}
function habitRateInDates(h,dates,type){let total=0,done=0;dates.forEach(d=>{if(isActive(h,d)){total++;if(type==="personal"?dayData(d).checks[h.id]:dayData(d).mandatory[h.id])done++;}});return total?clamp(done/total*100):null;}
function renderMonthly(){
  $("reportMonth").value=reportMonth;
  const r=monthRange(reportMonth),end=r.end>todayISO()?todayISO():r.end,dates=end>=r.start?dateRange(r.start,end).filter(d=>d>=state.startDate):[];
  const stats=aggregateDates(dates),personal=aggregateCategory(dates,"personal"),mandatory=aggregateCategory(dates,"mandatory"),missed=topMissed(dates);
  /* Clip each reporting week to this month; each calendar date is included once only. */
  const weeks=[];let cursor=dates[0];
  while(cursor&&cursor<=end){const w=weekBounds(cursor),segment=dateRange(w.start,w.end).filter(d=>d>=r.start&&d<=end&&d>=state.startDate);if(segment.length)weeks.push({start:segment[0],end:segment[segment.length-1],...aggregateDates(segment)});const next=toISO(addDays(w.end,1));cursor=next>end?"":next;}
  const best=[...state.habits.map(h=>({h,type:"personal"})),...state.mandatory.map(h=>({h,type:"mandatory"}))].map(x=>({name:x.h.name,rate:habitRateInDates(x.h,dates,x.type)})).filter(x=>x.rate!==null).sort((a,b)=>b.rate-a.rate);
  const noteCount=dates.filter(d=>dayData(d).note.trim()).length;
  $("monthlyReport").innerHTML=`<div class="panel mb-3"><div class="panel-heading"><div><span class="eyebrow">MONTHLY SNAPSHOT</span><h3>${fromISO(r.start).toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</h3></div><span class="subtle-tag">${dates.length} tracked days</span></div><div class="report-grid mt-3"><div class="report-metric"><span>Overall progress</span><strong>${stats.pct}%</strong></div><div class="report-metric"><span>Personal habits</span><strong>${personal.pct}%</strong></div><div class="report-metric"><span>Mandatory routine</span><strong>${mandatory.pct}%</strong></div><div class="report-metric"><span>Reflections written</span><strong>${noteCount}</strong></div></div><div class="progress custom-progress"><div class="progress-bar" style="width:${stats.pct}%"></div></div></div>
  <div class="row g-3"><div class="col-lg-7"><div class="panel h-100"><span class="eyebrow">WEEK BY WEEK</span><h3 class="mb-3">Your progress sheet</h3><div class="table-responsive"><table class="table report-table"><thead><tr><th>Period within month</th><th>Days</th><th>Completed</th><th>Progress</th></tr></thead><tbody>${weeks.map(w=>`<tr><td>${fmt(w.start,{day:"numeric",month:"short"})} – ${fmt(w.end,{day:"numeric",month:"short"})}</td><td>${dateRange(w.start,w.end).length}</td><td>${w.done}/${w.total}</td><td><strong>${w.pct}%</strong></td></tr>`).join("")||'<tr><td colspan="4">No tracked days yet.</td></tr>'}</tbody></table></div></div></div><div class="col-lg-5"><div class="panel h-100"><span class="eyebrow">YOUR STRENGTHS</span><h3 class="mb-3">Most consistent habits</h3>${best.length?best.slice(0,5).map(x=>`<div class="attention-item"><strong>${escapeHTML(x.name)}</strong><span class="attention-rate">${x.rate}%</span></div>`).join(""):'<p class="muted small">Add habits to see your strengths.</p>'}</div></div><div class="col-lg-6"><div class="panel h-100"><span class="eyebrow">ROOM TO GROW</span><h3 class="mb-3">Habits needing attention</h3>${missed.length?`<ul class="insight-list">${missed.map(x=>`<li>${escapeHTML(x.name)} — ${x.missed} missed days out of ${x.total}</li>`).join("")}</ul>`:'<p class="muted small">No missed habits recorded so far.</p>'}</div></div><div class="col-lg-6"><div class="panel h-100"><span class="eyebrow">NEXT MONTH</span><h3 class="mb-3">Your improvement plan</h3><ul class="insight-list">${buildInsights(dates,missed).map(x=>`<li>${escapeHTML(x)}</li>`).join("")}<li>Choose one clear priority for next month instead of changing everything at once.</li></ul></div></div></div>`;
}
function renderSettings(){$("startDateSetting").value=state.startDate;}
function getMonthSummary(){const r=monthRange(dailyMonth),end=todayISO()<r.end?todayISO():r.end;let total=0,done=0;dateRange(r.start,end).forEach(d=>{if(d>=state.startDate)activeHabits(d).forEach(h=>{total++;if(dayData(d).checks[h.id])done++;});});return `${total?clamp(done/total*100):0}% complete • ${done}/${total} habit-days`;}

function openHabitModal(type,item=null){
  editingItem=item;$("habitForm").dataset.type=type;$("habitModalTitle").textContent=item?"Edit habit":"Add a personal habit";
  $("habitName").value=item?.name||"";$("habitDescription").value=item?.description||"";
  if(type==="mandatory")$("habitModalTitle").textContent=item?"Edit mandatory routine":"Add a mandatory routine";
  habitModal.show();setTimeout(()=>$("habitName").focus(),250);
}
function saveHabit(e){
  e.preventDefault();const type=$("habitForm").dataset.type,name=$("habitName").value.trim(),description=$("habitDescription").value.trim();if(!name)return;
  const list=type==="personal"?state.habits:state.mandatory;
  if(editingItem){const item=list.find(x=>x.id===editingItem.id);if(item){item.name=name;item.description=description;}}
  else list.push({id:uid(),name,description,createdAt:todayISO(),archivedAt:null});
  save();habitModal.hide();renderPage(activePage);showToast(editingItem?"Habit updated.":type==="personal"?"Habit added to Daily.":"Routine added to Mandatory.");editingItem=null;
}
function archiveItem(id,type){
  const list=type==="personal"?state.habits:state.mandatory,item=list.find(x=>x.id===id);if(!item)return;
  if(!confirm(`Archive "${item.name}"? Its past records will be kept.`))return;
  item.archivedAt=toISO(addDays(todayISO(),-1));save();renderPage(activePage);showToast("Item archived. Past records are preserved.");
}
function changeCheck(e){
  const el=e.target;
  if(el.classList.contains("daily-check")){const d=dayData(el.dataset.date);d.checks[el.dataset.habit]=el.checked;save();if(el.dataset.date===selectedDate)renderDayDetails();$("dailyMonthSummary").textContent=getMonthSummary();}
  if(el.classList.contains("mandatory-check")){dayData(todayISO()).mandatory[el.dataset.id]=el.checked;save();renderMandatory();}
}
function saveSelectedDay(){
  const d=dayData(selectedDate);d.note=$("dayNote").value.trim();d.mood=$("dayMood").value;
  document.querySelectorAll(".reason-input").forEach(el=>{d.reasons[el.dataset.reason]=el.value.trim();});
  save();showToast("Your day details have been saved.");
}
function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`habitly-backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(url);$("backupStatus").textContent="Backup exported. Keep the file somewhere safe.";
}
function importBackup(file){
  const reader=new FileReader();reader.onload=()=>{
    try{const data=JSON.parse(reader.result);if(!data||!Array.isArray(data.habits)||!Array.isArray(data.mandatory)||!data.days||!data.startDate)throw new Error("Invalid backup");
      if(!confirm("Importing will replace the tracker data currently saved in this browser. Continue?"))return;
      state={...freshState(),...data,version:2};save();renderPage(activePage);$("backupStatus").textContent="Backup imported successfully.";showToast("Backup restored successfully.");
    }catch(err){alert("This file doesn't look like a valid Habitly backup.");}
  };reader.readAsText(file);
}
function changeMonth(input,which){if(!input.value)return;if(which==="daily"){dailyMonth=input.value;renderDaily();}else{reportMonth=input.value;renderMonthly();}}
function moveMonth(key,delta){const d=fromISO(key+"-01");d.setMonth(d.getMonth()+delta);return monthKey(d);}

function init(){
  habitModal=new bootstrap.Modal($("habitModal"));messageModal=new bootstrap.Modal($("messageModal"));toast=new bootstrap.Toast($("appToast"),{delay:2300});
  document.querySelectorAll("[data-page]").forEach(el=>el.addEventListener("click",e=>{e.preventDefault();setPage(el.dataset.page);}));
  $("menuToggle").addEventListener("click",()=>{$("sidebar").classList.add("open");$("sidebarBackdrop").classList.add("show");});
  $("sidebarBackdrop").addEventListener("click",()=>{$("sidebar").classList.remove("open");$("sidebarBackdrop").classList.remove("show");});
  $("addHabitBtn").addEventListener("click",()=>openHabitModal("personal"));$("addMandatoryBtn").addEventListener("click",()=>openHabitModal("mandatory"));$("habitForm").addEventListener("submit",saveHabit);
  $("dailyBody").addEventListener("change",changeCheck);$("mandatoryList").addEventListener("change",changeCheck);
  $("dailyBody").addEventListener("click",e=>{const edit=e.target.closest("[data-edit]"),archive=e.target.closest("[data-archive]");if(edit)openHabitModal("personal",state.habits.find(h=>h.id===edit.dataset.edit));if(archive)archiveItem(archive.dataset.archive,"personal");});
  $("dailyHead").addEventListener("click",e=>{const b=e.target.closest("[data-select-date]");if(b){selectedDate=b.dataset.selectDate;renderDayDetails();renderDaily();}});
  $("mandatoryList").addEventListener("click",e=>{const edit=e.target.closest("[data-edit-mandatory]"),archive=e.target.closest("[data-archive-mandatory]");if(edit)openHabitModal("mandatory",state.mandatory.find(h=>h.id===edit.dataset.editMandatory));if(archive)archiveItem(archive.dataset.archiveMandatory,"mandatory");});
  $("dailyMonth").addEventListener("change",e=>changeMonth(e.target,"daily"));$("prevMonth").addEventListener("click",()=>{dailyMonth=moveMonth(dailyMonth,-1);renderDaily();});$("nextMonth").addEventListener("click",()=>{dailyMonth=moveMonth(dailyMonth,1);renderDaily();});
  $("selectedDate").addEventListener("change",e=>{if(e.target.value){selectedDate=e.target.value;renderDayDetails();}});$("saveDayDetails").addEventListener("click",saveSelectedDay);
  $("saveDashboardNote").addEventListener("click",()=>{dayData(todayISO()).note=$("dashboardNote").value.trim();save();showToast("Reflection saved.");});
  $("endDayBtn").addEventListener("click",()=>showMessage("evening",true));
  $("weekPicker").addEventListener("change",e=>{weekDate=e.target.value||todayISO();renderWeekly();});
  $("prevWeek").addEventListener("click",()=>{const w=weekBounds(weekDate);weekDate=toISO(addDays(w.start,-1));renderWeekly();});
  $("nextWeek").addEventListener("click",()=>{const w=weekBounds(weekDate);weekDate=toISO(addDays(w.end,1));renderWeekly();});
  $("reportMonth").addEventListener("change",e=>changeMonth(e.target,"report"));$("prevReportMonth").addEventListener("click",()=>{reportMonth=moveMonth(reportMonth,-1);renderMonthly();});$("nextReportMonth").addEventListener("click",()=>{reportMonth=moveMonth(reportMonth,1);renderMonthly();});
  $("saveSettings").addEventListener("click",()=>{const v=$("startDateSetting").value;if(!v){alert("Please choose a tracking start date.");return;}if(v>todayISO()){alert("The tracking start date cannot be in the future.");return;}state.startDate=v;save();renderPage(activePage);showToast("Tracking settings saved.");});
  $("exportBtn").addEventListener("click",exportBackup);$("importFile").addEventListener("change",e=>{if(e.target.files[0])importBackup(e.target.files[0]);e.target.value="";});
  $("headerDate").textContent=fmt(todayISO(),{weekday:"short",day:"numeric",month:"short"});
  $("authForm").addEventListener("submit",handleAuthSubmit);
  $("signOutBtn").addEventListener("click",async()=>{await syncStateToCloud();await supabaseClient.auth.signOut();currentUser=null;$("appShell").hidden=true;$("authGate").hidden=false;$("authPassword").value="";});
  document.addEventListener("visibilitychange",async()=>{if(document.visibilityState==="visible"&&currentUser){try{await loadCloudState();renderPage(activePage);}catch(err){console.warn("Cloud refresh skipped:",err);}}});
  window.addEventListener("focus",async()=>{if(currentUser){try{await loadCloudState();renderPage(activePage);}catch(err){console.warn("Cloud refresh skipped:",err);}}});
  if(!window.supabase||!window.supabase.createClient){$("authStatus").textContent="Could not load the sign-in service. Check your internet connection and refresh.";return;}
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  supabaseClient.auth.getSession().then(async({data,error})=>{if(error)throw error;if(data.session)await showSignedInApp(data.session);}).catch(err=>{$("authStatus").textContent=err.message||"Could not check your sign-in session.";});
}
document.addEventListener("DOMContentLoaded",init);
