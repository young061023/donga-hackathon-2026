(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Official Lucide SVG assets, pinned to lucide-static 1.65.0. See /icons/lucide/SOURCE.json.
  const iconNames = {"home":"house","send":"send","calendar":"calendar-days","tasks":"calendar-check-2","star":"network","user":"circle-user-round","plus":"plus","minus":"minus","search":"search","chevron-down":"chevron-down","close":"x","check-square":"square-check","plus-square":"square-plus","document":"file-text","spark":"sparkles","smile":"face-slightly-smiling","upload":"paperclip","arrow":"arrow-up-right","check":"check","logout":"log-out","menu":"menu","fit":"maximize","link":"paperclip"};
  const icon = name => {
    const glyph = iconNames[name] || 'sparkles';
    return `<svg class="icon lucide lucide-${glyph}" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/icons/lucide/sprite.svg?v=1.65.0#${glyph}"></use></svg>`;
  };
  const hydrate = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  const state = {workspace:null,teamId:null,channelId:null,refreshing:false,view:'chat',onlyMine:false,pollId:null,pollExpanded:false,modalKind:null,selectedIdea:null};
  const previews = new Map();
  let toastTimer,backFocus,loadPromise,loadAgain=false,messageSignature='',mapSignature='',mapNodes=[],mapPan={x:20,y:20},mapZoom=1,mapFitted=false,modalRevision=0;
  let mapParents = {};

  function toast(message) { const el=$('.toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2700); }
  async function api(path, options={}) {
    const headers=options.body instanceof FormData?(options.headers||{}):{'Content-Type':'application/json',...(options.headers||{})};
    const response=await fetch(path,{...options,headers,cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');
    return data;
  }
  const initials=name=>[...(name||'팀원')].slice(0,1).join('');
  function dateTime(value){try{return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}).format(new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)?value:value.replace(' ','T')+'Z'));}catch{return '';}}
  function requireWorkspace(){if(state.workspace)return true;toast('팀 정보를 불러온 뒤 다시 시도해 주세요.');return false;}
  function openModal(kind,title,body,intro='') {
    closeUserMenu();closeSidebar();backFocus=document.activeElement;state.modalKind=kind;modalRevision++;
    $('#modalPanel').dataset.kind=kind;$('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;$('#modalIntro').textContent=intro;$('#modalIntro').hidden=!intro;$('#modalConfirm').hidden=true;$('#modalBack').hidden=false;
    $('#summaryButton').classList.toggle('is-open',kind==='summary');hydrate($('#modalPanel'));
    const focus=$('#modalBody').querySelector('input,select,textarea,button')||$('#modalClose');focus.focus();
  }
  function closeModal(){ $('#modalBack').hidden=true;$('#summaryButton').classList.remove('is-open');state.modalKind=null;modalRevision++;if(backFocus?.isConnected)backFocus.focus(); }
  function closeSidebar(){ $('#sidebar').classList.remove('open');$('#sidebarScrim').hidden=true; }
  function showMobilePanel(target){$('#sidebar').classList.add('open');$('#sidebarScrim').hidden=innerWidth>700;if(target)$(target)?.scrollIntoView({behavior:'smooth',block:'nearest'});}
  function closeUserMenu(){ $('#userPopover').hidden=true;$('#userMenu').setAttribute('aria-expanded','false'); }
  function setView(view){state.view=view;document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$('#chatScroll').hidden=view!=='chat';$('#brainstormView').hidden=view!=='brainstorm';$('#viewLabel').textContent=view==='brainstorm'?'브레인스토밍':'채팅방';$('#messageInput').placeholder=view==='brainstorm'?'새로운 생각을 입력하고 가지를 이어보세요.':'메시지를 입력하세요.';renderPolls();closeSidebar();if(view==='brainstorm'){renderBrainstorm();if(!mapFitted)requestAnimationFrame(fitMap);}}

  function renderMessages(force=false) {
    const {messages,currentUser}=state.workspace;
    const shown=messages.filter(m=>!state.channelId||m.channelId===state.channelId);
    const signature=JSON.stringify([state.channelId,shown]);if(!force&&signature===messageSignature)return;messageSignature=signature;
    const box=$('#chatScroll'),atBottom=box.scrollHeight-box.clientHeight-box.scrollTop<90;
    $('#messageList').innerHTML=shown.length?shown.map(message=>{
      const ai=message.authorType==='assistant',me=message.authorId===currentUser.id;
      const name=ai?'AI 조장':me?'나':message.authorName||'팀원';
      const source=message.sourceMessageId?messages.find(m=>m.id===message.sourceMessageId):null;
      const quote=source?`<button class="quote-link" data-source="${esc(source.id)}">↳ ${esc(source.authorName||'팀원')} · “${esc(source.body.slice(0,90))}”</button>`:'';
      const fileUrl=message.fileId?`/api/files/${encodeURIComponent(message.fileId)}`:'';
      const attachment=!fileUrl?'':message.fileContentType?.startsWith('image/')?`<a href="${esc(fileUrl)}" target="_blank" rel="noopener"><img class="attachment-preview" src="${esc(fileUrl)}" alt="${esc(message.fileName||'첨부 이미지')}" loading="lazy"></a><a class="attachment-link" href="${esc(fileUrl)}" target="_blank" rel="noopener">${icon('link')}${esc(message.fileName||'첨부 파일')}</a>`:`<a class="attachment-link" href="${esc(fileUrl)}" target="_blank" rel="noopener">${icon('link')}${esc(message.fileName||'첨부 파일')}${message.fileSize?` · ${(message.fileSize/1024/1024).toFixed(1)}MB`:''}</a>`;
      return `<article class="msg ${ai?'ai':''} ${me?'me':''}" data-message-id="${esc(message.id)}"><div class="avatar ${ai?'ai':''}" aria-label="${esc(name)}">${ai?icon('spark'):esc(initials(me?currentUser.displayName:name))}</div><div class="msgbody"><div class="msgmeta"><strong>${esc(name)}</strong><time>${esc(dateTime(message.createdAt))}</time></div><div class="bubble">${esc(message.body).replace(/\n/g,'<br>')}</div>${attachment}${quote}</div></article>`;
    }).join(''):`<div class="empty-chat">${icon('send')}아직 대화가 없어요.<br>팀의 첫 생각을 나눠보세요.</div>`;
    if(force||atBottom)box.scrollTop=box.scrollHeight;
  }
  function renderMembers(){
    const {members,currentUser,team,channels,messages}=state.workspace;
    $('#workspaceName').textContent=team.name;$('#teamName').textContent=team.name;$('#channelMeta').textContent=`${team.name} · ${members.length}명의 팀원`;
    $('#channelName').textContent=channels.find(c=>c.id===state.channelId)?.name||'팀 대화';
    const choices=channels.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if($('#channelPicker').innerHTML!==choices)$('#channelPicker').innerHTML=choices;$('#channelPicker').value=state.channelId||'';
    $('#statusMember').textContent=`${members.length}명의 팀원`;$('#meName').textContent=currentUser.displayName;$('#meAvatar').textContent=initials(currentUser.displayName);
    $('#memberAvatars').innerHTML=members.slice(0,4).map(m=>`<span title="${esc(m.displayName)}">${esc(initials(m.displayName))}</span>`).join('')+(members.length>4?`<span>+${members.length-4}</span>`:'');
    const last=messages.at(-1);previews.set(team.id,last?{text:last.body,time:dateTime(last.createdAt)}:{text:'팀원과 생각을 나눠보세요.',time:''});renderRooms();
  }
  function renderRooms(){
    if(!state.workspace)return;const q=$('#roomSearch').value.trim().toLowerCase();
    $('#channelList').innerHTML=state.workspace.teams.filter(team=>team.name.toLowerCase().includes(q)).map(team=>{
      const preview=previews.get(team.id);return `<button class="room-row ${team.id===state.teamId?'active':''}" data-team="${esc(team.id)}" ${team.id===state.teamId?'aria-current="page"':''}><span class="room-avatar" aria-hidden="true"></span><span class="room-copy"><strong>${esc(team.name)}</strong><small>${esc(preview?.text||'팀원과 생각을 나눠보세요.')}</small></span><time>${esc(preview?.time||'')}</time></button>`;
    }).join('')||'<p class="empty-list">찾는 회의실이 없어요.</p>';
  }
  function renderTasks(){
    const {tasks,currentUser}=state.workspace,shown=state.onlyMine?tasks.filter(t=>t.assigneeId===currentUser.id):tasks;
    $('#taskList').innerHTML=shown.length?shown.map(task=>`<div class="task ${task.status==='done'?'done':''}"><input class="task-check" type="checkbox" id="task-${esc(task.id)}" data-task="${esc(task.id)}" ${task.status==='done'?'checked':''} aria-label="${esc(task.title)} 완료"><label for="task-${esc(task.id)}"><span class="task-text">${esc(task.title)}</span>${task.dueText?`<span class="task-due">${esc(task.dueText)}</span>`:''}${task.sourceMessageId?`<button type="button" class="task-source" data-source="${esc(task.sourceMessageId)}" title="약속한 대화 보기">대화에서 추가 ↗</button>`:''}</label><span class="task-owner" title="${esc(task.assigneeName||'담당 미정')}">${esc(task.assigneeName||'담당 미정')}</span></div>`).join(''):'<p class="empty-list">아직 등록된 할 일이 없어요.</p>';
    $('#taskHeaderCount').textContent=String(shown.length);const mine=tasks.filter(t=>t.assigneeId===currentUser.id&&t.status!=='done').length;$('#myTaskCount').textContent=String(mine);$('#myTaskCount').hidden=mine===0;
    $('#progressLabel').textContent=`${tasks.filter(t=>t.status==='done').length} / ${tasks.length} 완료${state.onlyMine?' · 내 할 일만 표시 중':''}`;
    $('#focusTasks').title=state.onlyMine?'전체 할 일 보기':'내 할 일만 보기';
  }
  function pollChoices(poll){return poll.options.map(option=>{const voted=option.votes.some(v=>v.userId===state.workspace.currentUser.id);return `<button class="poll-choice ${voted?'voted':''}" data-poll="${esc(poll.id)}" data-option="${esc(option.id)}" aria-pressed="${voted}" ${poll.status!=='open'?'disabled':''}><span>${esc(option.label)}</span><span class="vote-count">${option.votes.length}명</span></button>`;}).join('');}
  function pollParticipants(poll){return [...new Map(poll.options.flatMap(o=>o.votes).map(v=>[v.userId,v])).values()];}
  function renderPolls(){
    const polls=state.workspace?.polls||[],list=$('#pollList');$('#schedule').hidden=state.view!=='chat'||!polls.length;
    if(!polls.length){list.innerHTML='';return;}
    const poll=polls.find(p=>p.id===state.pollId)||[...polls].reverse().find(p=>p.status==='open')||polls.at(-1);state.pollId=poll.id;
    const people=pollParticipants(poll),expanded=state.pollExpanded;
    list.innerHTML=`<article class="poll-card ${expanded?'expanded':''}"><button class="poll-header" id="togglePoll" aria-expanded="${expanded}" aria-controls="pinnedPollBody"><span class="poll-icon">${icon('calendar')}</span><span class="poll-heading"><span class="poll-badge">${poll.status==='open'?'일정 투표 진행 중':'일정 투표 마감'}</span><h3>${esc(poll.title)}</h3></span>${icon('chevron-down')}</button><div id="pinnedPollBody" ${expanded?'':'hidden'}><div class="poll-options">${pollChoices(poll)}</div><footer class="poll-footer"><span class="avatar-stack">${people.slice(0,3).map(v=>`<span title="${esc(v.userName)}">${esc(initials(v.userName))}</span>`).join('')}</span><span>${people.length} / ${state.workspace.members.length}명 참여</span>${polls.length>1?`<button class="poll-more" data-poll-directory>전체 ${polls.length}개</button>`:''}<button class="poll-results" data-poll-results="${esc(poll.id)}">결과 보기</button></footer></div></article>`;
    if(state.modalKind==='poll-directory')renderPollDirectoryBody();
    if(state.modalKind==='poll-results')renderPollResultsBody();
  }
  function renderSummary(){
    if(!requireWorkspace())return;const {messages,tasks,polls}=state.workspace,ideas=messages.filter(m=>m.authorType==='user').slice(-5),todo=tasks.filter(t=>t.status!=='done'),latest=polls.find(p=>p.status==='open');
    openModal('summary','AI 회의 정리',`<section class="summary-block"><h3>최근 대화와 아이디어</h3>${ideas.length?ideas.map(m=>`<p>${esc(m.authorName||'팀원')} — ${esc(m.body)}</p><button class="summary-source" data-source="${esc(m.id)}">근거 대화 보기 ↗</button>`).join(''):'<p>아직 공유된 아이디어가 없어요.</p>'}</section><section class="summary-block"><h3>다음 할 일</h3>${todo.length?`<ul>${todo.map(t=>`<li>${esc(t.title)} · ${esc(t.assigneeName||'담당 미정')}${t.dueText?` · ${esc(t.dueText)}`:''}</li>`).join('')}</ul>`:'<p>남은 할 일이 없어요.</p>'}</section><section class="summary-block"><h3>다음 모임</h3><p>${latest?esc(latest.title):'진행 중인 일정 투표가 없어요.'}</p></section>`);
  }
  function ownerOptions(){const {members,currentUser}=state.workspace;return `<option value="${esc(currentUser.id)}">나에게</option>`+members.filter(m=>m.id!==currentUser.id).map(m=>`<option value="${esc(m.id)}">${esc(m.displayName)}</option>`).join('');}
  function openTaskModal(){
    if(!requireWorkspace())return;openModal('task','할 일 추가',`<form class="add-task" id="taskForm"><input class="field" id="taskInput" aria-label="새 할 일" placeholder="새 할 일 추가..." required maxlength="200"><select id="taskOwner" aria-label="담당자">${ownerOptions()}</select><button type="submit" aria-label="할 일 추가" title="할 일 추가">${icon('plus')}</button></form>`);
    $('#taskForm').addEventListener('submit',async event=>{event.preventDefault();const title=$('#taskInput').value.trim();if(!title)return;const button=$('#taskForm button');button.disabled=true;try{await api('/api/tasks',{method:'POST',body:JSON.stringify({teamId:state.teamId,title,assigneeId:$('#taskOwner').value})});closeModal();await loadWorkspace();toast('팀 할 일에 저장했어요.');}catch(error){toast(error.message);button.disabled=false;}});
  }
  function openPollModal(){
    if(!requireWorkspace())return;openModal('poll','우리 언제 만날까요?',`<form class="poll-create-form" id="pollForm"><div class="form-section"><label class="form-label" for="pollTitle">투표 질문</label><input class="field" id="pollTitle" placeholder="다음 모임에 가능한 시간은?" required maxlength="160"></div><div class="options-label"><label class="form-label">선택지</label><small id="optionCount">2 / 8</small></div><div class="poll-create-options" id="pollOptions"></div><button class="add-poll-option" type="button" id="addPollOption">＋ 시간 후보 추가</button><div class="poll-create-footer"><button type="submit" class="outline-button" id="createPollSubmit">투표하기</button></div></form>`);
    let nextOption=0;const addOption=()=>{if($('#pollOptions').children.length>=8)return;const row=document.createElement('div');row.className='poll-option-input';row.innerHTML=`<span class="option-number"></span><input aria-label="시간 후보" placeholder="예 : 11월 1일 오후 4시" maxlength="100" required id="poll-option-${++nextOption}"><button class="square-button" type="button" data-remove-option aria-label="시간 후보 삭제">${icon('close')}</button>`;$('#pollOptions').append(row);renumber();};
    const renumber=()=>{const rows=[...$('#pollOptions').children];rows.forEach((row,i)=>{row.querySelector('.option-number').textContent=i+1;row.querySelector('input').setAttribute('aria-label',`시간 후보 ${i+1}`);row.querySelector('button').disabled=rows.length<=2;});$('#optionCount').textContent=`${rows.length} / 8`;$('#addPollOption').disabled=rows.length>=8;};
    addOption();addOption();$('#addPollOption').onclick=()=>{addOption();$('#pollOptions').lastElementChild.querySelector('input').focus();};
    $('#pollOptions').onclick=event=>{const button=event.target.closest('[data-remove-option]');if(button&&$('#pollOptions').children.length>2){button.closest('.poll-option-input').remove();renumber();}};
    $('#pollForm').onsubmit=async event=>{event.preventDefault();const title=$('#pollTitle').value.trim(),options=[...$('#pollOptions').querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);if(!title||options.length<2){toast('질문과 2개 이상의 시간 후보를 입력해 주세요.');return;}const button=$('#createPollSubmit');button.disabled=true;try{const created=await api('/api/polls',{method:'POST',body:JSON.stringify({teamId:state.teamId,title,options})});state.pollId=created.id;state.pollExpanded=false;closeModal();setView('chat');await loadWorkspace();toast('팀 일정 투표를 만들었어요. 채팅 상단에서 확인해 주세요.');}catch(error){toast(error.message);button.disabled=false;}};
  }
  function openPollDirectory(){if(!requireWorkspace())return;if(!state.workspace.polls.length){openPollModal();return;}openModal('poll-directory','모임 일정 투표','');renderPollDirectoryBody();}
  function renderPollDirectoryBody(){if(state.modalKind!=='poll-directory')return;$('#modalBody').innerHTML=`<p class="modal-hint">한 사람당 한 시간을 선택해요. 다시 선택하면 내 투표가 변경돼요.</p><button class="text-button" id="newPollInDirectory">＋ 새 일정 투표 만들기</button>`+[...state.workspace.polls].reverse().map(p=>`<section class="poll-directory-item"><h3>${esc(p.title)}${p.status==='open'?'':' · 마감'}</h3>${pollChoices(p)}<button class="text-button" data-poll-results="${esc(p.id)}">결과 보기 ↗</button><button class="text-button" data-pin-poll="${esc(p.id)}">채팅 상단에서 보기</button></section>`).join('');$('#newPollInDirectory').onclick=openPollModal;}
  function openPollResults(id){state.resultsPollId=id;openModal('poll-results','일정 투표 결과','');renderPollResultsBody();}
  function renderPollResultsBody(){const poll=state.workspace.polls.find(p=>p.id===state.resultsPollId);if(!poll)return;const count=state.workspace.members.length;$('#modalBody').innerHTML=`<p class="modal-hint">${esc(poll.title)} · ${pollParticipants(poll).length} / ${count}명 참여</p>`+poll.options.map(o=>`<article class="poll-result-row"><div class="poll-result-title"><strong>${esc(o.label)}</strong><span>${o.votes.length}명</span></div><div class="poll-result-bar"><i style="width:${count?Math.min(100,o.votes.length/count*100):0}%"></i></div><p class="poll-result-voters">${o.votes.length?o.votes.map(v=>esc(v.userName||'팀원')).join(' · '):'아직 선택한 팀원이 없어요.'}</p></article>`).join('');}
  async function vote(button){if(button.disabled)return;const pollId=button.dataset.poll,optionId=button.dataset.option;document.querySelectorAll('[data-poll]').forEach(b=>b.disabled=true);try{await api('/api/votes',{method:'POST',body:JSON.stringify({pollId,optionId})});await loadWorkspace();toast('투표를 기록했어요.');}catch(error){toast(error.message);renderPolls();}}
  function openTeams(){if(!requireWorkspace())return;openModal('teams','우리 팀 회의실',`<div class="team-list-modal">${state.workspace.teams.map(t=>`<button class="team-list-item ${t.id===state.teamId?'selected':''}" data-select-team="${esc(t.id)}">${esc(t.name)}${t.id===state.teamId?icon('check'):icon('arrow')}</button>`).join('')}</div><form class="create-team-form" id="createTeamForm"><label class="sr-only" for="newTeamName">새 팀 이름</label><input class="field" id="newTeamName" placeholder="새 팀 이름을 입력하세요." required maxlength="80"><button class="primary-button" type="submit">팀 만들기</button></form><p class="modal-hint">기존 팀을 선택하거나 새 팀을 만들 수 있어요. 대화 채널은 회의실 제목 아래에서 선택해요.</p>`);$('#createTeamForm').onsubmit=async event=>{event.preventDefault();const name=$('#newTeamName').value.trim();if(!name)return;const button=$('#createTeamForm button');button.disabled=true;try{const result=await api('/api/teams',{method:'POST',body:JSON.stringify({name})});state.teamId=result.team.id;state.channelId=result.channel.id;resetTeamView();closeModal();await loadWorkspace();toast('새 팀을 만들었어요.');}catch(error){toast(error.message);button.disabled=false;}};}
  function resetTeamView(){messageSignature='';mapSignature='';mapFitted=false;state.selectedIdea=null;state.pollId=null;state.pollExpanded=false;mapParents={};}
  async function selectTeam(id){if(id===state.teamId){closeModal();closeSidebar();return;}state.teamId=id;state.channelId=null;resetTeamView();closeModal();closeSidebar();await loadWorkspace();}
  function openMembers(){if(!requireWorkspace())return;const labels={available:'업무 확인했어요',needs_adjustment:'일정 조정이 필요해요',away:'잠시 부재 중이에요'};openModal('members','함께하는 팀원',state.workspace.members.map(m=>{const status=state.workspace.workStatuses.find(s=>s.userId===m.id);return `<div class="member-row"><span class="member-avatar">${esc(initials(m.displayName))}</span><div><strong>${esc(m.displayName)}</strong><small>${m.role==='owner'?'팀장':'팀원'}${m.id===state.workspace.currentUser.id?' · 나':''}</small></div><span class="status-pill">${esc(status?labels[status.status]||'상태 미등록':'상태 미등록')}</span></div>`;}).join(''));}
  function openSearch(){if(!requireWorkspace())return;openModal('search','대화 검색',`<form class="search-modal-form" id="searchForm"><label class="sr-only" for="searchInput">검색어</label><input class="field" id="searchInput" placeholder="찾고 싶은 대화를 입력하세요." autocomplete="off"><div class="search-results" id="searchResults"></div></form>`);$('#searchForm').onsubmit=e=>e.preventDefault();$('#searchInput').oninput=()=>{const q=$('#searchInput').value.trim().toLowerCase();const matches=q?state.workspace.messages.filter(m=>m.body.toLowerCase().includes(q)):[];$('#searchResults').innerHTML=matches.length?matches.map(m=>`<button type="button" class="search-hit" data-source="${esc(m.id)}"><strong>${esc(m.body)}</strong><small>${esc(m.authorName||'AI 조장')} · ${esc(dateTime(m.createdAt))} · 원문 보기 ↗</small></button>`).join(''):q?'<p class="empty-list">일치하는 메시지를 찾지 못했어요.</p>':'';};}
  function jumpToMessage(id){const message=state.workspace.messages.find(m=>m.id===id);if(!message){toast('이 대화를 찾지 못했어요.');return;}closeModal();state.channelId=message.channelId;setView('chat');renderMembers();renderMessages(true);const el=[...$('#messageList').children].find(m=>m.dataset.messageId===id);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('source-highlight');setTimeout(()=>el?.classList.remove('source-highlight'),2200);}

  function parentKey(){return `teamplay-map-parents:${state.workspace.currentUser.id}:${state.teamId}`;}
  function readParents(){try{mapParents=JSON.parse(localStorage.getItem(parentKey())||'{}');if(!mapParents||typeof mapParents!=='object')mapParents={};}catch{mapParents={};}}
  function saveParents(){try{localStorage.setItem(parentKey(),JSON.stringify(mapParents));}catch{toast('지도 연결은 현재 화면에서만 유지돼요. 팀 대화는 서버에 저장됩니다.');}}
  function category(m){return /자료|조사|참고|링크|https?:|근거/.test(m.body)||m.fileId?1:/할게|맡|기한|까지|준비|일정|금요일|모임|다음 주/.test(m.body)?2:0;}
  function renderBrainstorm(){
    if(!state.workspace)return;const messages=state.workspace.messages.filter(m=>m.authorType==='user').slice(-24),signature=JSON.stringify([messages,state.selectedIdea,mapParents]);if(signature===mapSignature)return;mapSignature=signature;
    const names=['아이디어 펼치기','자료와 근거','다음 행동'],groups=names.map((name,i)=>({id:'group'+i,title:name,index:i,items:messages.filter(m=>category(m)===i)}));
    let cursor=65;const nodes=[];groups.forEach(g=>{const start=cursor;g.items.forEach(m=>{let depth=0,anc=mapParents[m.id],seen=new Set([m.id]);while(anc&&messages.some(x=>x.id===anc)&&!seen.has(anc)&&depth<4){seen.add(anc);depth++;anc=mapParents[anc];}nodes.push({id:m.id,title:m.body,author:m.authorName||'팀원',x:650+depth*270,y:cursor,w:228,h:110,parent:messages.some(x=>x.id===mapParents[m.id])?mapParents[m.id]:g.id});cursor+=134;});if(!g.items.length)cursor+=120;g.y=start+(cursor-start)/2-35;cursor+=70;});
    const height=Math.max(740,cursor),root={id:'root',title:state.workspace.team.name,author:'우리 팀의 생각',x:45,y:height/2-50,w:228,h:100};mapNodes=[root,...groups.map(g=>({id:g.id,title:g.title,author:`${g.items.length}개의 생각`,x:355,y:g.y,w:170,h:70,parent:'root',group:true})),...nodes];
    $('#mindmapCanvas').style.width=`${Math.max(1050,...mapNodes.map(n=>n.x+n.w+50))}px`;$('#mindmapCanvas').style.height=`${height}px`;
    const lines=mapNodes.filter(n=>n.parent).map(n=>{const p=mapNodes.find(x=>x.id===n.parent)||root,x1=p.x+p.w,y1=p.y+p.h/2,x2=n.x,y2=n.y+n.h/2,mid=(x1+x2)/2;return `<path d="M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}"/>`;}).join('');
    $('#mindmapCanvas').innerHTML=`<svg class="mindmap-lines" aria-hidden="true">${lines}</svg>`+mapNodes.map(n=>`<button class="map-node ${n.id==='root'?'root':''} ${n.group?'group':''} ${n.id===state.selectedIdea?'selected':''}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;min-height:${n.h}px" data-idea="${esc(n.id)}" title="${esc(n.title)}"><strong>${esc(n.title)}</strong><small>${esc(n.author)}${n.id!=='root'&&!n.group?' · 두 번 눌러 원문 보기':''}</small></button>`).join('');
    $('#mindmapHint').textContent=state.selectedIdea?`선택한 생각에서 가지 이어보기 · Enter로 팀 대화에 저장`:`최근 ${messages.length}개의 팀 대화 · 생각을 선택해 가지를 이어보세요.`;updateMapTransform();
  }
  function updateMapTransform(){$('#mindmapCanvas').style.transform=`translate(${mapPan.x}px,${mapPan.y}px) scale(${mapZoom})`;$('#mapZoomLabel').textContent=Math.round(mapZoom*100)+'%';}
  function fitMap(){if(state.view!=='brainstorm'||!mapNodes.length)return;const box=$('#mindmapViewport'),w=Math.max(...mapNodes.map(n=>n.x+n.w))+50,h=Math.max(...mapNodes.map(n=>n.y+n.h))+50;mapZoom=Math.max(.25,Math.min(1,(box.clientWidth-30)/w,(box.clientHeight-30)/h));mapPan={x:Math.max(15,(box.clientWidth-w*mapZoom)/2),y:Math.max(15,(box.clientHeight-h*mapZoom)/2)};mapFitted=true;updateMapTransform();}
  function zoomMap(factor){const box=$('#mindmapViewport'),old=mapZoom;mapZoom=Math.max(.25,Math.min(1.8,mapZoom*factor));mapPan={x:box.clientWidth/2-(box.clientWidth/2-mapPan.x)*mapZoom/old,y:box.clientHeight/2-(box.clientHeight/2-mapPan.y)*mapZoom/old};updateMapTransform();}

  async function loadWorkspace(){
    if(state.refreshing){loadAgain=true;return loadPromise;}
    state.refreshing=true;const requestedTeam=state.teamId;
    loadPromise=(async()=>{try{const data=await api(`/api/workspace${requestedTeam?`?teamId=${encodeURIComponent(requestedTeam)}`:''}`);if(requestedTeam!==state.teamId){loadAgain=true;return;}const changed=state.workspace?.team.id!==data.team.id;state.workspace=data;state.teamId=data.team.id;if(!state.channelId||!data.channels.some(c=>c.id===state.channelId))state.channelId=data.channels[0]?.id||null;if(changed)readParents();renderMembers();renderMessages(changed);renderTasks();renderPolls();if(state.view==='brainstorm')renderBrainstorm();const myStatus=data.workStatuses.find(r=>r.userId===data.currentUser.id);if(myStatus&&$('#userPopover').hidden)$('#workStatus').value=myStatus.status;if(new URLSearchParams(location.search).has('join'))history.replaceState({},'',location.pathname);}catch(error){if(!state.workspace){$('#messageList').innerHTML=`<div class="empty-chat">${esc(error.message)}<br><button class="outline-button" id="retryLoad" style="margin-top:15px;font-size:14px">다시 시도</button></div>`;$('#retryLoad').onclick=loadWorkspace;}else toast(error.message);}finally{state.refreshing=false;}})();
    await loadPromise;if(loadAgain){loadAgain=false;return loadWorkspace();}
  }
  async function start(){const joinCode=new URLSearchParams(location.search).get('join');if(joinCode){try{await api('/api/join',{method:'POST',body:JSON.stringify({inviteCode:joinCode})});toast('초대된 팀에 참여했어요.');}catch(error){toast(error.message);}}await loadWorkspace();setInterval(loadWorkspace,12000);}

  $('#composeForm').addEventListener('submit',async event=>{
    event.preventDefault();const input=$('#messageInput'),body=input.value.trim();if(!body||!requireWorkspace())return;const teamId=state.teamId,channelId=state.channelId,parent=state.view==='brainstorm'?state.selectedIdea:null;$('#sendButton').disabled=true;
    try{const result=await api('/api/messages',{method:'POST',body:JSON.stringify({teamId,channelId,body})});input.value='';if(parent&&result.messages?.[0]&&teamId===state.teamId){mapParents[result.messages[0].id]=parent;saveParents();}await loadWorkspace();if(state.view==='chat')$('#chatScroll').scrollTop=$('#chatScroll').scrollHeight;else requestAnimationFrame(fitMap);}catch(error){toast(error.message);}finally{$('#sendButton').disabled=false;}
  });
  $('#messageInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#composeForm').requestSubmit();}});
  $('#uploadButton').onclick=()=>{if(requireWorkspace())$('#fileInput').click();};
  $('#fileInput').addEventListener('change',async event=>{const input=event.currentTarget,selected=[...input.files];if(!selected.length||!requireWorkspace())return;const form=new FormData();form.append('teamId',state.teamId);selected.forEach(file=>form.append('files',file));$('#uploadButton').disabled=true;try{await api('/api/files',{method:'POST',body:form});await loadWorkspace();toast(`${selected.length}개 파일을 팀 대화에 올렸어요.`);}catch(error){toast(error.message);}finally{input.value='';$('#uploadButton').disabled=false;}});
  $('#statusSave').onclick=async()=>{if(!requireWorkspace())return;const button=$('#statusSave');button.disabled=true;try{await api('/api/work-status',{method:'PUT',body:JSON.stringify({teamId:state.teamId,status:$('#workStatus').value})});toast('업무 상태를 팀에 공유했어요.');await loadWorkspace();}catch(error){toast(error.message);}finally{button.disabled=false;}};
  $('#inviteButton').onclick=async()=>{if(!requireWorkspace())return;const button=$('#inviteButton');button.disabled=true;try{const {url}=await api('/api/invites',{method:'POST',body:JSON.stringify({teamId:state.teamId})});try{await navigator.clipboard.writeText(url);toast('팀 초대 링크를 복사했어요.');}catch{openModal('invite','팀 초대 링크',`<p class="modal-hint">이 링크를 팀원에게 공유해 주세요.</p><input class="field" id="inviteUrl" readonly aria-label="팀 초대 링크" value="${esc(url)}" style="font-size:13px;margin-top:20px">`);$('#inviteUrl').select();}}catch(error){toast(error.message);}finally{button.disabled=false;}};
  $('#teamMenu').onclick=openTeams;$('#newChannel').onclick=openTeams;$('#roomSearch').oninput=renderRooms;
  $('#channelPicker').onchange=()=>{state.channelId=$('#channelPicker').value;messageSignature='';renderMembers();renderMessages(true);};
  $('#summaryButton').onclick=renderSummary;$('#searchButton').onclick=openSearch;$('#membersButton').onclick=openMembers;$('#addTaskButton').onclick=openTaskModal;$('#taskShortcut').onclick=openTaskModal;
  $('#scheduleNav').onclick=openPollModal;$('#tasksNav').onclick=()=>showMobilePanel('#tasks');
  $('#focusTasks').onclick=()=>{state.onlyMine=!state.onlyMine;if(state.workspace)renderTasks();};
  $('#noticeClose').onclick=()=>$('#notice').hidden=true;$('#showNotice').onclick=()=>{$('#notice').hidden=false;closeUserMenu();};$('#emojiButton').onclick=()=>{$('#messageInput').value+='🙂';$('#messageInput').focus();};
  $('#userMenu').onclick=()=>{const open=$('#userPopover').hidden;$('#userPopover').hidden=!open;$('#userMenu').setAttribute('aria-expanded',String(open));if(open)$('#workStatus').focus();};
  $('#openSidebar').onclick=()=>showMobilePanel();$('#closeSidebar').onclick=closeSidebar;$('#sidebarScrim').onclick=closeSidebar;
  $('#modalClose').onclick=closeModal;$('#modalX').onclick=closeModal;$('#modalConfirm').onclick=closeModal;$('#modalBack').onclick=event=>{if(event.target===$('#modalBack'))closeModal();};
  $('#mapZoomIn').onclick=()=>zoomMap(1.2);$('#mapZoomOut').onclick=()=>zoomMap(1/1.2);$('#mapFit').onclick=fitMap;
  $('#brainstormHelp').onclick=()=>openModal('help','생각을 가지로 이어보세요',`<div class="summary-block"><p>팀의 최근 대화를 아이디어, 자료와 근거, 다음 행동으로 나눠 보여줘요.</p><p>생각을 선택한 뒤 아래 입력창으로 새 메시지를 보내면 선택한 생각에서 가지가 이어집니다. 메시지 내용은 기존 팀 대화에 저장돼요.</p><p>빈 공간을 끌어 지도를 이동하고 + / −로 확대·축소해 보세요. 생각을 두 번 누르면 원문 대화로 이동해요.</p><p>가지 연결 구조는 현재 브라우저에 저장됩니다. 다른 팀원과 공유되는 내용은 팀 대화에서 확인할 수 있어요.</p></div>`);
  document.addEventListener('click',event=>{
    if(!event.target.closest('#userPopover,#userMenu'))closeUserMenu();
    const view=event.target.closest('[data-view]');if(view){setView(view.dataset.view);return;}
    const team=event.target.closest('[data-team],[data-select-team]');if(team){selectTeam(team.dataset.team||team.dataset.selectTeam);return;}
    const source=event.target.closest('[data-source]');if(source){event.preventDefault();jumpToMessage(source.dataset.source);return;}
    const option=event.target.closest('[data-poll]');if(option){vote(option);return;}
    if(event.target.closest('#togglePoll')){const chat=$('#chatScroll'),bottom=chat.scrollHeight-chat.clientHeight-chat.scrollTop<90;state.pollExpanded=!state.pollExpanded;renderPolls();if(bottom)chat.scrollTop=chat.scrollHeight;return;}
    if(event.target.closest('[data-poll-directory]')){openPollDirectory();return;}
    const results=event.target.closest('[data-poll-results]');if(results){openPollResults(results.dataset.pollResults);return;}
    const pin=event.target.closest('[data-pin-poll]');if(pin){state.pollId=pin.dataset.pinPoll;state.pollExpanded=true;closeModal();setView('chat');return;}
    const idea=event.target.closest('[data-idea]');if(idea){state.selectedIdea=state.selectedIdea===idea.dataset.idea?null:idea.dataset.idea;document.querySelectorAll('[data-idea]').forEach(n=>n.classList.toggle('selected',n.dataset.idea===state.selectedIdea));$('#mindmapHint').textContent=state.selectedIdea?'선택한 생각에서 가지 이어보기 · Enter로 팀 대화에 저장':'생각을 선택하고 새로운 가지를 이어보세요.';return;}
  });
  $('#taskList').addEventListener('change',async event=>{const input=event.target.closest('[data-task]');if(!input)return;input.disabled=true;try{await api('/api/tasks',{method:'PATCH',body:JSON.stringify({taskId:input.dataset.task,status:input.checked?'done':'todo'})});await loadWorkspace();}catch(error){input.checked=!input.checked;toast(error.message);}finally{input.disabled=false;}});
  $('#mindmapCanvas').ondblclick=event=>{const id=event.target.closest('[data-idea]')?.dataset.idea;if(state.workspace?.messages.some(m=>m.id===id))jumpToMessage(id);};
  let drag=null;const viewport=$('#mindmapViewport');viewport.addEventListener('pointerdown',event=>{if(event.target.closest('.map-node'))return;drag={x:event.clientX,y:event.clientY,pan:{...mapPan}};viewport.setPointerCapture(event.pointerId);viewport.classList.add('dragging');});viewport.addEventListener('pointermove',event=>{if(!drag)return;mapPan={x:drag.pan.x+event.clientX-drag.x,y:drag.pan.y+event.clientY-drag.y};updateMapTransform();});const stopDrag=()=>{drag=null;viewport.classList.remove('dragging');};viewport.addEventListener('pointerup',stopDrag);viewport.addEventListener('pointercancel',stopDrag);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('#modalBack').hidden)closeModal();else{closeUserMenu();closeSidebar();}}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();}if(event.key==='Tab'&&!$('#modalBack').hidden){const controls=[...$('#modalPanel').querySelectorAll('button:not([disabled]),input,select,textarea,a[href]')].filter(el=>!el.hidden&&el.getClientRects().length);if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(innerWidth>700)closeSidebar();if(state.view==='brainstorm')fitMap();},150);});
  hydrate();start();
})();

