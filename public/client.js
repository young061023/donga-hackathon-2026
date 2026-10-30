(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const state = { workspace: null, teamId: null, channelId: null, refreshing: false, parentMessageId: null };
  let toastTimer;
  let onlineEnabled = true;
  let presenceTimer = null;
  let presenceRequest = null;
  const brainstorming = globalThis.BrainstormGraph?.create({
    onStart: teamId => api(`/api/workspace?teamId=${encodeURIComponent(teamId)}`),
    onSelect: id => { state.parentMessageId = id; },
    onSummary: payload => api("/api/brainstorm", { method: "POST", body: JSON.stringify(payload) }),
    onError: message => toast(message),
  });

  function toast(message) {
    const el = $(".toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  async function api(path, options = {}) {
    const headers = options.body instanceof FormData
      ? (options.headers || {})
      : { "Content-Type": "application/json", ...(options.headers || {}) };
    const response = await fetch(path, {
      ...options,
      headers,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
    return data;
  }

  function initials(name) { return [...(name || "팀원")].slice(0, 1).join(""); }
  function dateTime(value) {
    try {
      const raw = String(value ?? "").trim();
      if (!raw) return "";
      const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
        ? `${raw.replace(" ", "T")}Z`
        : raw;
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    catch { return ""; }
  }

  function renderMessages() {
    brainstorming?.update(state.workspace, state.channelId);
    const { messages, currentUser } = state.workspace;
    const list = $("#messageList");
    if (!messages.length) {
      list.innerHTML = '<div style="padding:42px 12px;text-align:center;color:#858b80;font:11px/2 var(--kr)">아직 대화가 없어요.<br>팀의 첫 생각을 나눠보세요.</div>';
      return;
    }
    list.innerHTML = messages.filter((message) => !state.channelId || message.channelId === state.channelId).map((message) => {
      const isAi = message.authorType === "assistant";
      const isMe = message.authorId === currentUser.id;
      const name = isAi ? "모아" : isMe ? currentUser.displayName : message.authorName || "팀원";
      const source = message.sourceMessageId ? messages.find((item) => item.id === message.sourceMessageId) : null;
      const quote = source ? `<div class="quote-link">↳ ${esc(source.authorName || "팀원")} · “${esc(source.body.slice(0, 90))}”</div>` : "";
      const fileUrl = message.fileId ? `/api/files/${encodeURIComponent(message.fileId)}` : "";
      const attachment = !fileUrl ? "" : message.fileContentType?.startsWith("image/")
        ? `<a href="${esc(fileUrl)}" target="_blank" rel="noopener"><img class="attachment-preview" src="${esc(fileUrl)}" alt="${esc(message.fileName || "첨부 이미지")}" loading="lazy"></a><br><a class="attachment-link" href="${esc(fileUrl)}" target="_blank" rel="noopener">↗ ${esc(message.fileName || "첨부 파일")}</a>`
        : `<a class="attachment-link" href="${esc(fileUrl)}" target="_blank" rel="noopener">📎 ${esc(message.fileName || "첨부 파일")}${message.fileSize ? ` · ${(message.fileSize / 1024 / 1024).toFixed(1)}MB` : ""}</a>`;
      return `<div class="msg ${isAi ? "ai" : ""}" data-message-id="${esc(message.id)}"><div class="avatar ${isAi ? "ai" : ""}">${isAi ? "✳" : esc(initials(name))}</div><div class="msgbody"><div class="msgmeta"><strong>${esc(name)}</strong>${isAi ? "<em>조장 제안</em>" : ""}<span>${esc(dateTime(message.createdAt))}</span></div><div class="bubble">${esc(message.body).replace(/\n/g, "<br>")}</div>${attachment}${quote}</div></div>`;
    }).join("");
    const box = $("#chatScroll");
    box.scrollTop = box.scrollHeight;
  }

  function renderMembers() {
    const { members, currentUser, team } = state.workspace;
    $("#workspaceName").textContent = team.name;
    $("#teamName").textContent = team.name;
    $("#channelMeta").textContent = `${team.name} · ${members.length}명의 팀원`;
    $("#statusMember").textContent = currentUser.displayName;
    $("#meName").textContent = currentUser.displayName;
    $("#meAvatar").textContent = initials(currentUser.displayName);
    $("#memberAvatars").innerHTML = members.slice(0, 5).map((member) => `<span class="presence-avatar ${member.online ? "is-online" : "is-offline"}" title="${esc(member.displayName)} · ${member.online ? "온라인" : "오프라인"}">${esc(initials(member.displayName))}</span>`).join("");
    $("#taskOwner").innerHTML = `<option value="${esc(currentUser.id)}">나에게</option>` + members.filter((member) => member.id !== currentUser.id).map((member) => `<option value="${esc(member.id)}">${esc(member.displayName)}</option>`).join("");
    $("#channelList").innerHTML = state.workspace.channels.map((channel, index) => `<a href="#chat" data-channel="${esc(channel.id)}" class="nav-item channel ${channel.id === state.channelId ? "active" : ""}"><span>#</span>${esc(channel.name)}</a>`).join("");
    $("#channelList").querySelectorAll("[data-channel]").forEach((link) => link.addEventListener("click", () => {
      state.channelId = link.dataset.channel;
      $("#channelName").textContent = state.workspace.channels.find((channel) => channel.id === state.channelId)?.name || "팀 대화";
      renderMembers(); renderMessages();
    }));
  }

  function renderTeamRules() {
    if (!state.workspace) return;
    const rules = String(state.workspace.team.rules || "").split(/\r?\n/).map(rule => rule.trim()).filter(Boolean);
    $("#teamRulesList").innerHTML = rules.length
      ? `<ol style="margin:0;padding-left:17px;font:9px/1.8 var(--kr);color:#555b50">${rules.map(rule => `<li style="padding:3px 0 5px 2px">${esc(rule)}</li>`).join("")}</ol>`
      : '<p class="vote-note">아직 팀 약속이 없어요. 편집을 눌러 함께 정해보세요.</p>';
  }

  function renderTasks() {
    const { tasks, currentUser } = state.workspace;
    const list = $("#taskList");
    list.innerHTML = tasks.length ? tasks.map((task) => {
      const done = task.status === "done";
      const mine = task.assigneeId === currentUser.id;
      return `<label class="task ${done ? "done" : ""}"><input class="task-check" type="checkbox" data-task="${esc(task.id)}" ${done ? "checked" : ""}><span><span class="task-text">${esc(task.title)}</span><span class="task-meta">${esc(task.assigneeName || "담당 미정")}${mine ? " · 나" : ""}${task.dueText ? ` · ${esc(task.dueText)}` : ""}${task.sourceMessageId ? " · 대화에서 추가" : ""}</span></span></label>`;
    }).join("") : '<p class="vote-note">아직 등록된 할 일이 없어요.</p>';
    $("#taskHeaderCount").textContent = String(tasks.length);
    $("#myTaskCount").textContent = String(tasks.filter((task) => task.assigneeId === currentUser.id && task.status !== "done").length);
    const doneCount = tasks.filter((task) => task.status === "done").length;
    $("#progressLabel").textContent = `${doneCount} / ${tasks.length}`;
    list.querySelectorAll("[data-task]").forEach((input) => input.addEventListener("change", async () => {
      try {
        await api("/api/tasks", { method: "PATCH", body: JSON.stringify({ taskId: input.dataset.task, status: input.checked ? "done" : "todo" }) });
        await loadWorkspace();
      } catch (error) { toast(error.message); }
    }));
  }

  function setPresenceControls(online, updateWorkspace = true) {
    onlineEnabled = online;
    for (const id of ["presenceToggle", "presenceToggleMobile"]) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.setAttribute("aria-pressed", String(online));
      button.setAttribute("aria-label", `현재 ${online ? "온라인" : "오프라인"}. 눌러서 ${online ? "오프라인" : "온라인"}으로 전환`);
      button.querySelector(".presence-dot")?.classList.toggle("is-offline", !online);
      const label = document.getElementById(id === "presenceToggle" ? "presenceLabel" : "presenceLabelMobile");
      if (label) label.textContent = online ? "온라인" : "오프라인";
    }
    if (updateWorkspace && state.workspace) {
      state.workspace.members = state.workspace.members.map(member => member.id === state.workspace.currentUser.id ? { ...member, presenceMode: online ? "online" : "offline", online: online && member.online } : member);
      renderMembers();
    }
  }
  async function heartbeat(mode = "heartbeat") {
    if (!state.workspace || presenceRequest) return presenceRequest;
    const teamId = state.teamId;
    presenceRequest = api("/api/presence", { method: "POST", body: JSON.stringify({ teamId, mode }) })
      .then(result => { if (state.teamId === teamId) setPresenceControls(result.online, true); return result; })
      .catch(error => { if (mode !== "heartbeat") toast(error.message); return null; })
      .finally(() => { presenceRequest = null; });
    return presenceRequest;
  }
  async function togglePresence() {
    if (!state.workspace) return;
    const wasOnline = onlineEnabled;
    const result = await heartbeat(wasOnline ? "offline" : "online");
    if (!result) return;
    toast(wasOnline ? "오프라인 상태로 변경했어요." : "온라인 상태로 변경했어요.");
    await loadWorkspace();
  }
  $("#presenceToggle").addEventListener("click", togglePresence);
  $("#presenceToggleMobile").addEventListener("click", togglePresence);

  function renderPolls() {
    const polls = state.workspace.polls;
    const list = $("#pollList");
    if (!polls.length) {
      list.innerHTML = '<p class="vote-note">아직 일정 투표가 없어요. + 버튼으로 후보 시간을 제안해 보세요.</p>';
      return;
    }
    list.innerHTML = polls.map((poll) => `<div style="margin-bottom:16px"><div class="poll-date">${esc(poll.status === "open" ? "투표 진행 중" : "마감")}</div><strong style="display:block;font:10px/1.6 var(--kr);margin-bottom:8px">${esc(poll.title)}</strong>${poll.options.map((option) => {
      const voted = option.votes.some((vote) => vote.userId === state.workspace.currentUser.id);
      return `<button class="poll-choice ${voted ? "voted" : ""}" data-poll="${esc(poll.id)}" data-option="${esc(option.id)}" ${poll.status !== "open" ? "disabled" : ""}><span>${esc(option.label)}</span><span class="vote-count">${option.votes.length}명</span></button>`;
    }).join("")}<p class="vote-note">내 선택을 누르면 투표가 기록됩니다. 팀원 확인 후 일정을 확정해요.</p></div>`).join("");
    list.querySelectorAll("[data-poll]").forEach((button) => button.addEventListener("click", async () => {
      try { await api("/api/votes", { method: "POST", body: JSON.stringify({ pollId: button.dataset.poll, optionId: button.dataset.option }) }); await loadWorkspace(); toast("투표를 기록했어요."); }
      catch (error) { toast(error.message); }
    }));
  }

  let meetingSummaryRequest = 0;
  async function renderSummary() {
    if (!state.workspace || !state.teamId || !state.channelId) { toast("팀 대화를 불러온 뒤 다시 시도해 주세요."); return; }
    const requestId = ++meetingSummaryRequest;
    $("#modalIntro").textContent = "Gemini가 팀 대화와 할 일을 바탕으로 회의 내용을 정리하고 있어요.";
    $("#modalBody").innerHTML = '<p role="status">AI가 핵심 내용과 다음 행동을 정리하고 있어요…</p>';
    $("#modalConfirm").style.display = "none";
    $("#modalBack").classList.add("show");
    try {
      const { summary } = await api("/api/meeting-summary", {
        method: "POST",
        body: JSON.stringify({ teamId: state.teamId, channelId: state.channelId }),
      });
      if (requestId !== meetingSummaryRequest) return;
      const list = (items, render) => items.length ? `<ul>${items.map(render).join("")}</ul>` : '<p style="color:#90968b">아직 정리된 항목이 없어요.</p>';
      const decisions = list(summary.decisions, item => `<li>${esc(item.text)}<small style="display:block;color:#92988d;margin-top:3px">근거 대화 ${item.messageIds.length}개</small></li>`);
      const discussion = summary.discussionPoints.length ? `<ul>${summary.discussionPoints.map(item => `<li>${esc(item.text)}<small style="display:block;color:#92988d;margin-top:3px">근거 대화 ${item.messageIds.length}개</small></li>`).join("")}</ul>` : '<p style="color:#90968b">따로 정리할 논의 내용이 없어요.</p>';
      const actions = list(summary.actionItems, item => `<li>${esc(item.title)}<small style="display:block;color:#92988d;margin-top:3px">${esc(item.owner || "담당 미정")}${item.dueText ? ` · ${esc(item.dueText)}` : ""} · 근거 대화 ${item.messageIds.length}개</small></li>`);
      const questions = list(summary.openQuestions, item => `<li>${esc(item)}</li>`);
      $("#modalBody").innerHTML = `<p style="font:11px/1.8 var(--kr);color:#555b50">${esc(summary.overview)}</p><h3 style="font-size:11px;margin:18px 0 6px">결정된 내용</h3>${decisions}<h3 style="font-size:11px;margin:18px 0 6px">논의한 내용</h3>${discussion}<h3 style="font-size:11px;margin:18px 0 6px">다음 할 일</h3>${actions}<h3 style="font-size:11px;margin:18px 0 6px">열린 질문</h3>${questions}`;
      $("#modalIntro").textContent = "AI가 대화에서 근거를 찾아 정리했어요. 결정과 담당자를 팀에서 확인해 주세요.";
    } catch (error) {
      if (requestId !== meetingSummaryRequest) return;
      $("#modalIntro").textContent = "회의 정리를 불러오지 못했어요.";
      $("#modalBody").innerHTML = `<p role="alert" style="font:10px/1.8 var(--kr);color:#a34d3b">${esc(error.message)}</p><button type="button" data-summary-retry style="border:1px solid #e1e4d8;background:#fff;border-radius:4px;padding:8px 11px;font-size:9px">다시 시도</button>`;
      $("#modalBody [data-summary-retry]").addEventListener("click", renderSummary);
    }
  }

  async function loadWorkspace() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const query = state.teamId ? `?teamId=${encodeURIComponent(state.teamId)}` : "";
      state.workspace = await api(`/api/workspace${query}`);
      state.teamId = state.workspace.team.id;
      // Remember the selected team separately for each signed-in account.
      try { localStorage.setItem(`moa-team:${state.workspace.currentUser.id}`, state.teamId); } catch {}
      if (!state.channelId || !state.workspace.channels.some((channel) => channel.id === state.channelId)) state.channelId = state.workspace.channels[0]?.id || null;
      $("#channelName").textContent = state.workspace.channels.find((channel) => channel.id === state.channelId)?.name || "팀 대화";
      renderMembers(); renderMessages(); renderTasks(); renderPolls(); renderTeamRules();
      const self = state.workspace.members.find(member => member.id === state.workspace.currentUser.id);
      if (self) setPresenceControls(self.presenceMode === "online", false);
      const myStatus = state.workspace.workStatuses.find((row) => row.userId === state.workspace.currentUser.id);
      if (myStatus) $("#workStatus").value = myStatus.status;
      const params = new URLSearchParams(location.search);
      if (params.has("join")) history.replaceState({}, "", location.pathname);
    } catch (error) {
      $("#messageList").innerHTML = `<div style="padding:30px;color:#a33">${esc(error.message)}<br><button id="retryLoad" style="margin-top:10px">다시 시도</button></div>`;
      $("#retryLoad")?.addEventListener("click", () => loadWorkspace());
    } finally { state.refreshing = false; }
  }

  async function start() {
    const joinCode = new URLSearchParams(location.search).get("join");
    if (joinCode) {
      try {
        const result = await api("/api/join", { method: "POST", body: JSON.stringify({ inviteCode: joinCode }) });
        state.teamId = result.team.id;
        state.channelId = null;
        toast("초대된 팀에 참여했어요.");
      }
      catch (error) { toast(error.message); return; }
    } else {
      // Resolve the account before restoring its last selected team.
      try {
        const workspace = await api("/api/workspace");
        state.teamId = localStorage.getItem(`moa-team:${workspace.currentUser.id}`);
      } catch {}
    }
    await loadWorkspace();
    await heartbeat();
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = setInterval(() => { if (!document.hidden) heartbeat(); }, 15000);
    setInterval(() => { if (!document.hidden) loadWorkspace(); }, 10000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadWorkspace(); });
  }

  const pendingLeaderProposals = new Set();
  const pendingRoleAllocations = new Set();
  let leaderProposalError = "";
  let leaderProposalErrorTimer;
  function updateLeaderProposalStatus() {
    const status = $("#leaderProposalStatus");
    if (pendingRoleAllocations.size) {
      status.textContent = "✳ 모아가 팀원별 역할을 나누고 있어요…";
      status.hidden = false;
    } else if (pendingLeaderProposals.size) {
      status.textContent = "✳ 모아가 최신 대화에 답을 준비하고 있어요…";
      status.hidden = false;
    } else if (leaderProposalError) {
      status.textContent = leaderProposalError;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  }
  async function requestLeaderProposal(payload) {
    pendingLeaderProposals.add(payload.messageId);
    leaderProposalError = "";
    clearTimeout(leaderProposalErrorTimer);
    updateLeaderProposalStatus();
    try {
      const result = await api("/api/leader-proposal", { method: "POST", body: JSON.stringify(payload) });
      if (!result.skipped && state.teamId === payload.teamId) await loadWorkspace();
    } catch (error) {
      leaderProposalError = error.message;
      clearTimeout(leaderProposalErrorTimer);
      leaderProposalErrorTimer = setTimeout(() => { leaderProposalError = ""; updateLeaderProposalStatus(); }, 6500);
    } finally {
      pendingLeaderProposals.delete(payload.messageId);
      updateLeaderProposalStatus();
    }
  }
  async function requestRoleAllocation(payload) {
    pendingRoleAllocations.add(payload.messageId);
    updateLeaderProposalStatus();
    try {
      const result = await api("/api/role-allocation", { method: "POST", body: JSON.stringify(payload) });
      if (!result.skipped && state.teamId === payload.teamId) {
        await loadWorkspace();
        if (result.taskCount) toast(`AI가 역할을 나눠 할 일 ${result.taskCount}개를 등록했어요.`);
      }
    } catch (error) { toast(error.message); }
    finally {
      pendingRoleAllocations.delete(payload.messageId);
      updateLeaderProposalStatus();
    }
  }

  $("#composeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#messageInput");
    const body = input.value.trim();
    if (!body || !state.workspace) return;
    const teamId = state.teamId;
    const channelId = state.channelId;
    $("#sendButton").disabled = true;
    try {
      const result = await api("/api/messages", { method: "POST", body: JSON.stringify({ teamId, channelId, body, parentMessageId: state.parentMessageId }) });
      input.value = "";
      if (state.teamId === teamId && state.workspace) {
        const known = new Set(state.workspace.messages.map(message => message.id));
        state.workspace.messages.push(...result.messages.filter(message => !known.has(message.id)));
        renderMessages();
        if (result.taskAdded || result.pollCreated) await loadWorkspace();
      } else {
        await loadWorkspace();
      }
      if (result.pollCreated) toast("내일 모임 시간 투표를 만들었어요.");
      if (result.roleAllocationRequested && result.messageId) {
        void requestRoleAllocation({ teamId, channelId, messageId: result.messageId });
      }
      if (result.needsLeaderProposal && result.messageId) {
        void requestLeaderProposal({ teamId, channelId, messageId: result.messageId });
      }
    } catch (error) { toast(error.message); }
    finally { $("#sendButton").disabled = false; }
  });
  $("#messageInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composeForm").requestSubmit(); } });

  $("#uploadButton").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const selected = [...input.files];
    if (!selected.length || !state.workspace) return;
    const form = new FormData();
    form.append("teamId", state.teamId);
    selected.forEach((file) => form.append("files", file));
    $("#uploadButton").disabled = true;
    try {
      await api("/api/files", { method: "POST", body: form });
      await loadWorkspace();
      toast(`${selected.length}개 파일을 팀 대화에 올렸어요.`);
    } catch (error) { toast(error.message); }
    finally { input.value = ""; $("#uploadButton").disabled = false; }
  });

  $("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#taskInput");
    if (!input.value.trim() || !state.workspace) return;
    try {
      await api("/api/tasks", { method: "POST", body: JSON.stringify({ teamId: state.teamId, title: input.value.trim(), assigneeId: $("#taskOwner").value }) });
      input.value = ""; await loadWorkspace(); toast("팀 할 일에 저장했어요.");
    } catch (error) { toast(error.message); }
  });

  $("#statusSave").addEventListener("click", async () => {
    try { await api("/api/work-status", { method: "PUT", body: JSON.stringify({ teamId: state.teamId, status: $("#workStatus").value }) }); toast("업무 상태를 팀에 공유했어요."); await loadWorkspace(); }
    catch (error) { toast(error.message); }
  });

  let creatingPoll = false;
  let pollTeamId = null;
  function pollOptionValues() {
    return Array.from($("#pollOptionInputs").querySelectorAll("input"), input => input.value);
  }
  function renderPollOptionInputs(values) {
    $("#pollOptionInputs").innerHTML = values.map((value, index) => `<div class="poll-option-input"><span class="poll-option-number" aria-hidden="true">${index + 1}</span><input id="pollOption${index}" required maxlength="100" aria-label="시간 후보 ${index + 1}" placeholder="예: 11월 ${index + 1}일 오후 4시" value="${esc(value)}"><button type="button" data-remove-option="${index}" aria-label="시간 후보 ${index + 1} 삭제" ${values.length <= 2 ? "disabled" : ""}>×</button></div>`).join("");
    $("#pollOptionCount").textContent = `${values.length} / 8`;
    $("#addPollOption").disabled = values.length >= 8;
  }
  $("#newPoll").addEventListener("click", () => {
    if (!state.workspace || creatingPoll) return;
    pollTeamId = state.teamId;
    $("#createPollForm").reset();
    $("#pollDialogError").textContent = "";
    renderPollOptionInputs(["", ""]);
    $("#pollDialog").showModal();
    $("#pollTitle").focus();
  });
  $("#pollDialogClose").addEventListener("click", () => $("#pollDialog").close());
  $("#pollDialogCancel").addEventListener("click", () => $("#pollDialog").close());
  $("#pollDialog").addEventListener("click", event => {
    if (event.target !== $("#pollDialog")) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $("#addPollOption").addEventListener("click", () => {
    const values = pollOptionValues();
    if (values.length >= 8) return;
    renderPollOptionInputs([...values, ""]);
    $("#pollOptionInputs").querySelectorAll("input")[values.length].focus();
  });
  $("#pollOptionInputs").addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-option]");
    const values = pollOptionValues();
    if (!remove || values.length <= 2) return;
    const index = Number(remove.dataset.removeOption);
    values.splice(index, 1);
    renderPollOptionInputs(values);
    $("#pollOptionInputs").querySelectorAll("input")[Math.min(index, values.length - 1)].focus();
  });
  $("#createPollForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (creatingPoll || !pollTeamId) return;
    const title = $("#pollTitle").value.trim();
    const options = pollOptionValues().map(value => value.trim());
    $("#pollDialogError").textContent = "";
    if (!title || options.some(value => !value) || options.length < 2 || options.length > 8) {
      $("#pollDialogError").textContent = "질문과 시간 후보를 2개 이상 입력해 주세요."; return;
    }
    if (new Set(options.map(value => value.replace(/\s+/g, " ").toLocaleLowerCase())).size !== options.length) {
      $("#pollDialogError").textContent = "같은 시간 후보가 있어요. 서로 다른 후보를 입력해 주세요."; return;
    }
    creatingPoll = true;
    $("#pollFormFields").disabled = true;
    $("#createPollButton").disabled = true;
    $("#createPollButton").textContent = "투표 만드는 중…";
    try {
      await api("/api/polls", { method: "POST", body: JSON.stringify({ teamId: pollTeamId, title, options }) });
      $("#pollDialog").close();
      await loadWorkspace();
      toast("팀 일정 투표를 만들었어요.");
    } catch (error) { $("#pollDialogError").textContent = error.message; }
    finally {
      creatingPoll = false;
      $("#pollFormFields").disabled = false;
      $("#createPollButton").disabled = false;
      $("#createPollButton").textContent = "투표 시작하기 ↗";
    }
  });

  $("#inviteButton").addEventListener("click", async () => {
    try {
      const { url } = await api("/api/invites", { method: "POST", body: JSON.stringify({ teamId: state.teamId }) });
      await navigator.clipboard.writeText(url); toast("팀 초대 링크를 복사했어요.");
    } catch (error) { toast(error.message); }
  });
  function renderTeamChoices() {
    const query = $("#teamSearch").value.trim().toLocaleLowerCase();
    const teams = state.workspace.teams.filter(team => team.name.toLocaleLowerCase().includes(query));
    $("#teamDialogCount").textContent = `${state.workspace.teams.length}개`;
    $("#teamDialogList").innerHTML = teams.length ? teams.map(team => {
      const current = team.id === state.teamId;
      return `<li><button type="button" class="team-choice ${current ? "is-current" : ""}" data-team-id="${esc(team.id)}" ${current ? 'aria-current="true"' : ""}><span class="team-choice-avatar">${esc(initials(team.name))}</span><span class="team-choice-info"><strong>${esc(team.name)}</strong><small>${team.role === "owner" ? "팀 관리자" : "팀 멤버"}${current ? " · 현재 선택한 팀" : ""}</small></span><span class="team-choice-mark" aria-hidden="true">${current ? "✓" : "↗"}</span></button></li>`;
    }).join("") : '<li class="team-empty">검색한 이름의 팀이 없어요.</li>';
  }
  function openTeamDialog() {
    if (!state.workspace) { toast("팀 정보를 불러온 뒤 다시 눌러 주세요."); return; }
    $("#teamSearch").value = "";
    $("#teamDialogError").textContent = "";
    renderTeamChoices();
    $("#teamDialog").showModal();
    $("#teamSearch").focus();
  }
  $("#teamMenu").addEventListener("click", openTeamDialog);
  $("#teamMenuMobile").addEventListener("click", openTeamDialog);
  $("#teamDialogClose").addEventListener("click", () => $("#teamDialog").close());
  $("#teamDialog").addEventListener("click", event => {
    if (event.target !== $("#teamDialog")) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $("#teamSearch").addEventListener("input", renderTeamChoices);
  $("#teamDialogList").addEventListener("click", async event => {
    const choice = event.target.closest("[data-team-id]");
    if (!choice || !state.workspace.teams.some(team => team.id === choice.dataset.teamId)) return;
    state.teamId = choice.dataset.teamId;
    state.channelId = null;
    $("#teamDialog").close();
    await loadWorkspace();
  });
  let creatingTeam = false;
  $("#createTeamForm").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("#newTeamName").value.trim();
    if (!name || creatingTeam) return;
    creatingTeam = true;
    $("#createTeamButton").disabled = true;
    $("#createTeamButton").textContent = "만드는 중…";
    $("#teamDialogError").textContent = "";
    try {
      const result = await api("/api/teams", { method: "POST", body: JSON.stringify({ name }) });
      state.teamId = result.team.id; state.channelId = result.channel.id;
      $("#newTeamName").value = "";
      $("#teamDialog").close();
      await loadWorkspace();
      toast("새 팀을 만들었어요.");
    } catch (error) { $("#teamDialogError").textContent = error.message; }
    finally {
      creatingTeam = false;
      $("#createTeamButton").disabled = false;
      $("#createTeamButton").textContent = "＋ 팀 만들기";
    }
  });

  $("#noticeClose").addEventListener("click", () => { $("#notice").remove(); });
  $("#summaryButton").addEventListener("click", renderSummary);
  $("#openSummary").addEventListener("click", renderSummary);
  $("#summaryLink").addEventListener("click", renderSummary);
  $("#modalClose").addEventListener("click", () => $("#modalBack").classList.remove("show"));
  $("#modalBack").addEventListener("click", (event) => { if (event.target === $("#modalBack")) $("#modalBack").classList.remove("show"); });
  $("#modalConfirm").addEventListener("click", () => $("#modalBack").classList.remove("show"));
  function renderSearchResults(query) {
    const normalized = query.trim().toLocaleLowerCase();
    const results = state.workspace.messages.filter(message =>
      message.channelId === state.channelId && message.body.toLocaleLowerCase().includes(normalized),
    ).slice(-30).reverse();
    $("#searchResultCount").textContent = normalized ? `${results.length}${results.length === 30 ? "+" : ""}개` : "최근 대화";
    $("#searchResults").innerHTML = normalized ? results.length ? results.map(message => `<li><button type="button" class="search-result" data-search-message="${esc(message.id)}"><span class="search-result-author">${esc(message.authorName || (message.authorType === "assistant" ? "모아" : "팀원"))}<time>${esc(dateTime(message.createdAt))}</time></span><span class="search-result-text">${esc(message.body)}</span></button></li>`).join("") : '<li class="search-empty">일치하는 대화가 없어요.<br><small>다른 단어로 검색해 보세요.</small></li>' : '<li class="search-empty">찾고 싶은 단어를 입력해 주세요.</li>';
  }
  $("#searchButton").addEventListener("click", () => {
    if (!state.workspace) { toast("대화를 불러온 뒤 검색해 주세요."); return; }
    $("#searchDialog").showModal();
    $("#searchInput").value = "";
    renderSearchResults("");
    $("#searchInput").focus();
  });
  $("#searchDialogClose").addEventListener("click", () => $("#searchDialog").close());
  $("#searchDialog").addEventListener("click", event => {
    if (event.target !== $("#searchDialog")) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $("#searchForm").addEventListener("submit", event => { event.preventDefault(); renderSearchResults($("#searchInput").value); });
  $("#searchInput").addEventListener("input", event => renderSearchResults(event.currentTarget.value));
  $("#searchResults").addEventListener("click", event => {
    const result = event.target.closest("[data-search-message]");
    if (!result) return;
    const message = $("#messageList").querySelector(`[data-message-id="${CSS.escape(result.dataset.searchMessage)}"]`);
    $("#searchDialog").close();
    if (!message) { toast("검색한 대화가 최근 화면에 없어 목록을 새로 불러옵니다."); loadWorkspace(); return; }
    message.scrollIntoView({ behavior: "smooth", block: "center" });
    message.classList.add("search-message-highlight");
    setTimeout(() => message.classList.remove("search-message-highlight"), 2200);
  });
  $("#newChannel").addEventListener("click", () => toast("채널 관리는 다음 업데이트에서 제공할게요."));
  $("#focusTasks").addEventListener("click", () => { document.querySelector("#taskInput").focus(); });
  $("#taskShortcut").addEventListener("click", () => { document.querySelector("#taskInput").focus(); });
  $("#emojiButton").addEventListener("click", () => { const input = $("#messageInput"); input.value += "🙂"; input.focus(); });
  $("#summaryLink").textContent = "대화와 업무 근거 보기 ↗";
  $("#editTeamRules").addEventListener("click", () => {
    if (!state.workspace) { toast("팀 정보를 불러온 뒤 다시 눌러 주세요."); return; }
    $("#teamRulesInput").value = state.workspace.team.rules || "";
    $("#teamRulesError").textContent = "";
    $("#teamRulesDialog").showModal();
    $("#teamRulesInput").focus();
  });
  $("#teamRulesClose").addEventListener("click", () => $("#teamRulesDialog").close());
  $("#teamRulesCancel").addEventListener("click", () => $("#teamRulesDialog").close());
  let savingTeamRules = false;
  $("#teamRulesForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (savingTeamRules || !state.workspace) return;
    savingTeamRules = true;
    $("#teamRulesSave").disabled = true;
    $("#teamRulesSave").textContent = "저장 중…";
    $("#teamRulesError").textContent = "";
    try {
      const result = await api("/api/team-rules", { method: "PUT", body: JSON.stringify({ teamId: state.teamId, rules: $("#teamRulesInput").value }) });
      state.workspace.team.rules = result.rules;
      renderTeamRules();
      $("#teamRulesDialog").close();
      toast("팀 약속을 저장했어요.");
    } catch (error) { $("#teamRulesError").textContent = error.message; }
    finally {
      savingTeamRules = false;
      $("#teamRulesSave").disabled = false;
      $("#teamRulesSave").textContent = "저장하기";
    }
  });
  function showMobilePanel(target) { const panel = $(".right"); panel.classList.add("mobile-open"); if (target) document.querySelector(target).scrollIntoView({ behavior: "smooth", block: "start" }); }
  document.querySelectorAll("[data-workspace-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = link.dataset.workspaceNav;
      document.querySelectorAll("[data-workspace-nav]").forEach((item) => item.classList.toggle("active", item === link));
      if (target === "chat") {
        $(".right").classList.remove("mobile-open");
        $("#messageInput").focus({ preventScroll: true });
      } else if (target === "notes") {
        if (!state.workspace) { toast("팀 정보를 불러온 뒤 다시 눌러 주세요."); return; }
        renderSummary();
      } else {
        showMobilePanel(`#${target}`);
      }
    });
  });
  $("#mobileTasks").addEventListener("click", () => showMobilePanel("#tasks"));
  $("#mobileSchedule").addEventListener("click", () => showMobilePanel("#schedule"));
  $("#mobileRules").addEventListener("click", () => showMobilePanel("#teamRulesCard"));
  $("#mobileSummary").addEventListener("click", renderSummary);
  $("#closeMobilePanel").addEventListener("click", () => $(".right").classList.remove("mobile-open"));
  start();
})();
