const $ = id => document.getElementById(id);
const mcqs = window.EXAM_MCQ, coding = window.EXAM_CODING;
let answers = Array(30).fill(null), codeAnswers = Array(4).fill(""), editors = [], started = false, submitted = false;
let remaining = 120 * 60, timerId = null, resultData = null, submitting = false;
let currentUser = null, activeEndTime = null, examStartedAt = null, draftSaveTimer = null;
const fallbackValues = Array(4).fill("");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message, bad=false) { const el=$("toast"); el.textContent=message; el.className="toast"+(bad?" bad":""); setTimeout(()=>el.classList.add("hidden"),4500); }
function renderMCQs() {
  $("mcqContainer").innerHTML = mcqs.map((q,i)=>`<article class="question-card" id="question-${i}"><div class="q-top"><span class="q-number">QUESTION ${String(i+1).padStart(2,"0")} / 30 · 2 MARKS</span><span class="q-topic">${esc(q.topic)}</span></div><p class="q-text">${esc(q.en).replace(/\n/g,"<br>")}</p><p class="q-ar" dir="rtl">${esc(q.ar)}</p>${q.en.includes("\n")?`<pre class="q-code">${esc(q.en.split("\n").slice(1).join("\n"))}</pre>`:""}<div class="options">${q.options.map((op,j)=>`<label class="option" id="opt-${i}-${j}"><input type="radio" name="q${i}" value="${j}"><span class="option-letter">${"ABCD"[j]}</span><span class="option-text">${esc(op)}</span></label>`).join("")}</div></article>`).join("");
  mcqs.forEach((q,i)=>document.querySelectorAll(`input[name="q${i}"]`).forEach(r=>r.addEventListener("change",()=>{answers[i]=Number(r.value);document.querySelectorAll(`#question-${i} .option`).forEach(x=>x.classList.remove("selected"));$(`opt-${i}-${r.value}`).classList.add("selected");updateProgress();saveDraft();})));
}
function renderCoding() {
  $("codingContainer").innerHTML = coding.map((q,i)=>`<article class="coding-card"><div class="coding-head"><h3>${esc(q.title)} <span class="marks">· ${q.marks} MARKS</span></h3><span class="difficulty ${q.levelClass}">${esc(q.level)}</span></div><p class="coding-prompt">${esc(q.en)}</p><p class="coding-prompt" dir="rtl">${esc(q.ar)}</p><div class="requirements"><b>REQUIREMENTS / المطلوب:</b><br>${q.requirements.map(x=>"• "+esc(x)).join("<br>")}<br><br><span class="hint">Output format: ${["maximum minimum average","uppercase-count lowercase-count digit-count","sum of all n values","five sorted integers in ascending order"][i]}</span><br><span class="hint">Hint: ${esc(q.hint)}</span></div><div class="editor-toolbar"><span><i></i> main.cpp · C++17</span><span class="editor-actions"><button class="small-btn" id="reset-${i}">Reset</button><button class="run-btn" id="run-${i}">▶ Run Code</button></span></div><div class="editor-shell"><div class="line-gutter" id="gutter-${i}">1</div><div class="editor-host" id="editor-${i}"><textarea class="code-fallback" id="fallback-${i}" spellcheck="false" placeholder="// Write your C++17 solution here...&#10;#include &lt;iostream&gt;&#10;using namespace std;"></textarea></div></div><div class="stdin-wrap"><label for="stdin-${i}">CUSTOM INPUT <span>stdin</span></label><textarea id="stdin-${i}" class="stdin" placeholder="Enter input for your program..."></textarea></div><div class="console"><div class="console-head"><span>CONSOLE</span><span id="status-${i}" class="status-idle">Not run yet</span></div><pre id="output-${i}" class="console-output">Run your program to see output here.</pre><div class="console-meta" id="meta-${i}"></div></div><div class="coding-foot"><span>Code is saved in this page until submission.</span><span id="count-${i}">0 characters</span></div></article>`).join("");
  coding.forEach((q,i)=>{
    const fallback=$(`fallback-${i}`);
    fallback.addEventListener("input",()=>{fallbackValues[i]=fallback.value;codeAnswers[i]=fallback.value;updateProgress();updateGutter(i);saveDraft();});
    fallback.addEventListener("keydown",e=>{if(e.key==="Tab"){e.preventDefault();const s=fallback.selectionStart;fallback.setRangeText("    ",s,fallback.selectionEnd,"end");fallback.dispatchEvent(new Event("input"));}});
    $(`run-${i}`).addEventListener("click",()=>runCode(i));
    $(`reset-${i}`).addEventListener("click",()=>{setCode(i,"");$(`output-${i}`).textContent="Editor cleared.";setStatus(i,"Ready","idle");});
    $(`stdin-${i}`).value = ["10 20 30 40 50","Hello World 123","5\n1 2 3 4 5","5 4 3 2 1"][i];
  });
  loadMonaco();
}
function loadMonaco() {
  const loader=document.createElement("script");loader.src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js";
  loader.onload=()=>{if(!window.require)return;window.require.config({paths:{vs:"https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs"}});window.require(["vs/editor/editor.main"],()=>{
    document.querySelectorAll(".code-fallback").forEach((ta,i)=>{
      const initial=ta.value;
      ta.style.display="none";
      const editor=monaco.editor.create($(`editor-${i}`),{value:initial,language:"cpp",theme:"vs-dark",automaticLayout:true,minimap:{enabled:false},fontSize:13,lineHeight:21,scrollBeyondLastLine:false,wordWrap:"on",tabSize:4,insertSpaces:true,overviewRulerLanes:0,hideCursorInOverviewRuler:true,scrollbar:{verticalScrollbarSize:8,horizontalScrollbarSize:8}});
      editors[i]=editor;
      editor.onDidChangeModelContent(()=>{codeAnswers[i]=editor.getValue();$(`count-${i}`).textContent=editor.getValue().length+" characters";updateProgress();saveDraft();});
    });
  });};
  loader.onerror=()=>toast("Monaco could not load. The built-in editor fallback is active.",true);
  document.head.appendChild(loader);
}
function updateGutter(i){const n=($(`fallback-${i}`).value.match(/\n/g)||[]).length+1;$(`gutter-${i}`).textContent=Array.from({length:n},(_,j)=>j+1).join("\n");$(`count-${i}`).textContent=$(`fallback-${i}`).value.length+" characters";}
function getCode(i){return editors[i]?editors[i].getValue():$(`fallback-${i}`).value;}
function setCode(i,value){if(editors[i])editors[i].setValue(value);else{$(`fallback-${i}`).value=value;fallbackValues[i]=value;codeAnswers[i]=value;updateGutter(i);updateProgress();}}
function setStatus(i,text,kind){$(`status-${i}`).textContent=text;$(`status-${i}`).className="status-"+kind;}
async function runCode(i){
  const source=getCode(i);codeAnswers[i]=source;
  if(!source.trim()){toast("Write your C++ code before running.",true);return;}
  const btn=$(`run-${i}`);btn.disabled=true;btn.textContent="Compiling…";setStatus(i,"Compiling","running");$("output-"+i).textContent="Sending code to C++17 compiler…";$("meta-"+i).textContent="";
  try{
    const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source_code:source,stdin:$(`stdin-${i}`).value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Compiler request failed.");
    const success=data.statusId===3;
    let output="";
    if(data.compileOutput)output+="[COMPILER OUTPUT]\n"+data.compileOutput+"\n";
    if(data.stderr)output+="[STDERR]\n"+data.stderr+"\n";
    if(data.stdout)output+="[OUTPUT]\n"+data.stdout;
    if(data.message)output+="\n"+data.message;
    if(!output.trim())output=success?"Program finished successfully with no output.":"No output returned.";
    $("output-"+i).textContent=output;setStatus(i,data.status,success?"success":data.statusId===6?"error":"warning");
    $("meta-"+i).textContent=`Execution time: ${data.time??"—"} s · Memory: ${data.memory??"—"} KB`;
  }catch(err){$("output-"+i).textContent=err.message;setStatus(i,"Request failed","error");}
  finally{btn.disabled=false;btn.textContent="▶ Run Code";}
}
function updateProgress(){
  const mcqDone=answers.filter(x=>x!==null).length,codeDone=codeAnswers.filter(x=>x.trim()).length,total=mcqDone+codeDone;
  $("progressText").textContent=`${total} of 34 answered`;$("progressPercent").textContent=Math.round(total/34*100)+"%";$("progressBar").style.width=(total/34*100)+"%";$("answeredFinal").textContent=mcqDone;$("codingFinal").textContent=codeDone;
}
function draftKey(){return currentUser?`beschool_exam_draft_${currentUser.email}`:"";}
function saveDraft(){
  if(!currentUser || !started || submitted)return;
  const code=Array.from({length:4},(_,i)=>getCode(i));
  try{localStorage.setItem(draftKey(),JSON.stringify({answers,code,name:$("candidateName").value.trim(),group:$("candidateGroup").value.trim(),savedAt:new Date().toISOString()}));}catch{}
  clearTimeout(draftSaveTimer);
  draftSaveTimer=setTimeout(()=>fetch("/api/save-draft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({answers,code})}).catch(()=>{}),700);
}
function loadDraft(serverDraft=null){
  if(!currentUser)return;
  try{
    const raw=localStorage.getItem(draftKey());
    const d=raw?JSON.parse(raw):serverDraft;
    if(!d)return;
    if(Array.isArray(d.answers)&&d.answers.length===30)answers=d.answers;
    if(Array.isArray(d.code)&&d.code.length===4)codeAnswers=d.code;
    if(d.name)$("candidateName").value=d.name;
    if(d.group)$("candidateGroup").value=d.group;
  }catch{}
}
function restoreDraftIntoEditors(){
  codeAnswers.forEach((value,i)=>{if(value)setCode(i,value);});
  answers.forEach((value,i)=>{if(value!==null&&Number.isInteger(value)){const radio=document.querySelector(`input[name="q${i}"][value="${value}"]`);if(radio){radio.checked=true;$(`opt-${i}-${value}`).classList.add("selected");}}});
}
function showExam(attempt){
  started=true;activeEndTime=new Date(attempt.endTime).getTime();examStartedAt=attempt.startTime;
  $("authPanel").classList.add("hidden");$("candidatePanel").classList.add("hidden");$("intro").classList.add("hidden");document.querySelector(".exam-meta").classList.add("hidden");document.querySelector(".instructions").classList.add("hidden");
  $("candidateDisplay").textContent="· "+$("candidateName").value.trim()+" · "+currentUser.email;
  $("examArea").classList.remove("hidden");renderMCQs();renderCoding();restoreDraftIntoEditors();updateProgress();window.scrollTo({top:0,behavior:"smooth"});
  tick();clearInterval(timerId);timerId=setInterval(tick,1000);
}
async function startExam(){
  const name=$("candidateName").value.trim();if(!name){$("startError").textContent="Please enter your full name before starting.";$("candidateName").focus();return;}
  $("startBtn").disabled=true;$("startBtn").textContent="Starting…";
  try{
    const response=await fetch("/api/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,group:$("candidateGroup").value.trim()})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not start the exam.");
    answers=Array(30).fill(null);codeAnswers=Array(4).fill("");saveDraft();showExam(data.attempt);
  }catch(err){$("startError").textContent=err.message;$("startBtn").disabled=false;$("startBtn").innerHTML='Start Examination <span>→</span>';}
}
function tick(){
  if(submitted||!activeEndTime)return;
  remaining=Math.max(0,Math.ceil((activeEndTime-Date.now())/1000));
  const m=Math.floor(remaining/60),s=remaining%60;$("timer").querySelector("strong").textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
  if(remaining<=300)$("timer").classList.add("warning");
  if(remaining<=0){clearInterval(timerId);submitExam(true);}
}
async function setupGoogleSignIn(){
  try{
    const configResponse=await fetch("/api/config");const config=await configResponse.json();
    if(!config.googleClientId){$("authStatus").textContent="Google login is not configured yet. The administrator must add GOOGLE_CLIENT_ID in the hosting environment.";return;}
    let tries=0;const wait=setInterval(()=>{
      tries++;
      if(window.google?.accounts?.id){clearInterval(wait);window.google.accounts.id.initialize({client_id:config.googleClientId,callback:handleGoogleCredential,auto_select:false});window.google.accounts.id.renderButton($("googleSignInButton"),{theme:"outline",size:"large",shape:"rectangular",text:"signin_with",width:280});$("authStatus").textContent="Sign in with the Google account you will use for the exam.";}
      else if(tries>40){clearInterval(wait);$("authStatus").textContent="Google Sign-In could not load. Refresh the page and try again.";}
    },250);
  }catch{$("authStatus").textContent="Could not load the sign-in configuration. Refresh the page.";}
}
async function handleGoogleCredential(response){
  $("authError").textContent="";$("authStatus").textContent="Verifying your Google account…";
  try{
    const authResponse=await fetch("/api/auth/google",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential:response.credential})});
    const authData=await authResponse.json();if(!authResponse.ok)throw new Error(authData.error||"Google sign-in failed.");
    currentUser=authData.user;
    const meResponse=await fetch("/api/me");const me=await meResponse.json();if(!meResponse.ok)throw new Error(me.error||"Could not load your exam record.");
    $("authPanel").classList.add("hidden");
    if(me.attempt){
      if(me.attempt.status==="IN_PROGRESS"){
        $("candidateName").value=me.attempt.fullName||currentUser.name;
        loadDraft(me.draft);showExam(me.attempt);
        if(me.attempt.remainingSeconds<=0)submitExam(true);
      }else{
        $("authPanel").classList.remove("hidden");$("authError").textContent="This Google account has already used its exam attempt. A second attempt is not allowed.";
        $("authStatus").textContent=`Attempt status: ${me.attempt.status}. Contact the exam administrator if you believe this is an error.`;
      }
    }else{
      $("candidatePanel").classList.remove("hidden");$("candidateName").value=currentUser.name||"";$("authStatus").textContent=`Signed in as ${currentUser.email}`;
    }
  }catch(err){currentUser=null;$("authError").textContent=err.message;$("authStatus").textContent="Please try signing in again.";}
}
function requestSubmit(){const unanswered=answers.filter(x=>x===null).length,emptyCode=Array.from({length:4},(_,i)=>getCode(i)).filter(x=>!x.trim()).length;$("confirmMessage").textContent=`${unanswered} unanswered MCQs and ${emptyCode} empty coding responses. The server will compile your code and grade hidden test cases. Continue?`;$("confirmModal").classList.remove("hidden");}
async function submitExam(auto=false){
  if(submitted||submitting)return;submitting=true;$("confirmModal").classList.add("hidden");$("submitBtn").disabled=true;$("submitBtn").textContent="Grading exam…";
  try{
    const code=Array.from({length:4},(_,i)=>getCode(i));
    const response=await fetch("/api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("candidateName").value.trim(),group:$("candidateGroup").value.trim(),answers,code})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not submit the exam.");
    submitted=true;clearInterval(timerId);try{localStorage.removeItem(draftKey());}catch{}resultData={...data,answers:[...answers],code};
    renderResults(data);$("examArea").classList.add("hidden");$("resultArea").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"});
  }catch(err){toast(err.message,true);$("submitBtn").disabled=false;$("submitBtn").innerHTML='Submit Final Exam <span>↗</span>';submitting=false;}
}
function renderResults(data){
  $("resultCandidate").textContent=`${data.candidate.name}${data.candidate.group?" · "+data.candidate.group:""} · ${new Date(data.submittedAt).toLocaleString()}`;
  $("scoreValue").textContent=data.total.score;$("scoreRing").style.setProperty("--score",(data.total.score/100*100)+"%");
  $("mcqScore").textContent=`${data.mcq.score}/60`;$("codingScore").textContent=`${data.coding.score}/40`;$("correctCount").textContent=`${data.mcq.correct}/30`;
  $("resultNote").textContent=data.total.score>=90?"Outstanding work! Excellent command of C++ concepts and coding.":data.total.score>=75?"Very good performance. Keep practicing the topics that need improvement.":data.total.score>=50?"Good effort. Review the feedback and practice the coding problems.":"Keep learning. Review the course topics and try the challenges again.";
  $("reviewContainer").innerHTML=mcqs.map((q,i)=>{const a=answers[i],correctAnswer=data.mcq.answerKey[i],ok=a===correctAnswer;return `<div class="review-row"><p><b>Q${i+1}.</b> ${esc(q.en.split("\n")[0])}<br><span class="muted">Your answer: ${a===null?"Not answered":"ABCD"[a]+" — "+esc(q.options[a])}</span><br><span class="${ok?"correct":"incorrect"}">Correct: ${"ABCD"[correctAnswer]} — ${esc(q.options[correctAnswer])}</span></p><span class="review-answer ${ok?"correct":"incorrect"}">${ok?"+2":"0"}</span></div>`;}).join("");
  $("codingReview").innerHTML=data.coding.problems.map(p=>`<div class="coding-result-row"><div class="coding-result-head"><strong>${esc(p.title)}</strong><b>${p.score} / ${p.marks}</b></div><div class="test-progress"><div style="width:${p.passed/p.total*100}%"></div></div><p>${p.passed}/${p.total} hidden test cases passed · ${esc(p.status)}</p>${p.compileError?`<pre class="error-details">${esc(p.compileError)}</pre>`:""}</div>`).join("");
}
function downloadResult(){
  if(!resultData)return;const d=resultData;let t=`BESCHOOL — C++ FINAL EXAM RESULT\nCandidate: ${d.candidate.name}\nGroup: ${d.candidate.group}\nSubmitted: ${new Date(d.submittedAt).toLocaleString()}\nFINAL SCORE: ${d.total.score}/100\nMCQ: ${d.mcq.score}/60 (${d.mcq.correct}/30 correct)\nCODING: ${d.coding.score}/40\n\nCODING TEST RESULTS\n`;
  d.coding.problems.forEach(p=>t+=`${p.title}: ${p.score}/${p.marks} — ${p.passed}/${p.total} tests — ${p.status}\n`);
  t+="\nMCQ ANSWERS\n";mcqs.forEach((q,i)=>{const a=d.answers[i];t+=`Q${i+1}: ${a===null?"Blank":"ABCD"[a]+" - "+q.options[a]} | Correct: ${"ABCD"[d.mcq.answerKey[i]]}\n`;});
  d.code.forEach((s,i)=>t+=`\n\nCODING ${i+1}\n${s||"No code submitted."}\n`);
  const blob=new Blob([t],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="BeSchool_Final_Exam_Result.txt";a.click();URL.revokeObjectURL(url);
}
$("startBtn").addEventListener("click",startExam);$("submitBtn").addEventListener("click",requestSubmit);$("cancelSubmit").addEventListener("click",()=>$("confirmModal").classList.add("hidden"));$("confirmSubmit").addEventListener("click",()=>submitExam(false));$("downloadBtn").addEventListener("click",downloadResult);
window.addEventListener("beforeunload",e=>{if(started&&!submitted){e.preventDefault();e.returnValue="";}});

setupGoogleSignIn();
