(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const state = { workspace: null, teamId: null, channelId: null, refreshing: false };
  let toastTimer;

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
    try { return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
    catch { return ""; }
  }

  function renderMessages() {
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
      return `<div class="msg ${isAi ? "ai" : ""}"><div class="avatar ${isAi ? "ai" : ""}">${isAi ? "✳" : esc(initials(name))}</div><div class="msgbody"><div class="msgmeta"><strong>${esc(name)}</strong>${isAi ? "<em>조장 제안</em>" : ""}<span>${esc(dateTime(message.createdAt))}</span></div><div class="bubble">${esc(message.body).replace(/\n/g, "<br>")}</div>${attachment}${quote}</div></div>`;
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
    $("#memberAvatars").innerHTML = members.slice(0, 5).map((member) => `<span title="${esc(member.displayName)}">${esc(initials(member.displayName))}</span>`).join("");
    $("#taskOwner").innerHTML = `<option value="${esc(currentUser.id)}">나에게</option>` + members.filter((member) => member.id !== currentUser.id).map((member) => `<option value="${esc(member.id)}">${esc(member.displayName)}</option>`).join("");
    $("#channelList").innerHTML = state.workspace.channels.map((channel, index) => `<a href="#chat" data-channel="${esc(channel.id)}" class="nav-item channel ${channel.id === state.channelId ? "active" : ""}"><span>#</span>${esc(channel.name)}</a>`).join("");
    $("#channelList").querySelectorAll("[data-channel]").forEach((link) => link.addEventListener("click", () => {
      state.channelId = link.dataset.channel;
      $("#channelName").textContent = state.workspace.channels.find((channel) => channel.id === state.channelId)?.name || "팀 대화";
      renderMembers(); renderMessages();
    }));
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

  function renderSummary() {
    const { messages, tasks, polls } = state.workspace;
    const ideas = messages.filter((message) => message.authorType === "user").slice(-5);
    const todo = tasks.filter((task) => task.status !== "done");
    const latestPoll = polls.find((poll) => poll.status === "open");
    const bullets = [];
    bullets.push(ideas.length ? `최근 대화: ${ideas.map((message) => `${message.authorName || "팀원"} — ${message.body}`).join(" / ")}` : "아직 공유된 아이디어가 없어요.");
    bullets.push(todo.length ? `남은 할 일: ${todo.map((task) => `${task.title} (${task.assigneeName || "담당 미정"})`).join(" / ")}` : "남은 할 일이 없어요.");
    bullets.push(latestPoll ? `진행 중인 일정 투표: ${latestPoll.title}` : "진행 중인 일정 투표가 없어요.");
    $("#modalBody").innerHTML = `<ul>${bullets.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
    $("#modalConfirm").style.display = "none";
    $("#modalBack").classList.add("show");
  }

  async function loadWorkspace() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const query = state.teamId ? `?teamId=${encodeURIComponent(state.teamId)}` : "";
      state.workspace = await api(`/api/workspace${query}`);
      state.teamId = state.workspace.team.id;
      if (!state.channelId || !state.workspace.channels.some((channel) => channel.id === state.channelId)) state.channelId = state.workspace.channels[0]?.id || null;
      $("#channelName").textContent = state.workspace.channels.find((channel) => channel.id === state.channelId)?.name || "팀 대화";
      renderMembers(); renderMessages(); renderTasks(); renderPolls();
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
      try { await api("/api/join", { method: "POST", body: JSON.stringify({ inviteCode: joinCode }) }); toast("초대된 팀에 참여했어요."); }
      catch (error) { toast(error.message); }
    }
    await loadWorkspace();
    setInterval(loadWorkspace, 12000);
  }

  $("#composeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#messageInput");
    const body = input.value.trim();
    if (!body || !state.workspace) return;
    $("#sendButton").disabled = true;
    try {
      await api("/api/messages", { method: "POST", body: JSON.stringify({ teamId: state.teamId, channelId: state.channelId, body }) });
      input.value = "";
      await loadWorkspace();
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

  $("#newPoll").addEventListener("click", async () => {
    const title = prompt("투표 질문을 입력하세요", "다음 모임에 가능한 시간은?");
    if (!title?.trim()) return;
    const choices = prompt("선택지를 쉼표로 나눠 입력하세요 (2~8개)", "금요일 16:00, 금요일 17:30, 금요일 19:00");
    if (!choices) return;
    try {
      await api("/api/polls", { method: "POST", body: JSON.stringify({ teamId: state.teamId, title: title.trim(), options: choices.split(",").map((item) => item.trim()).filter(Boolean) }) });
      await loadWorkspace(); toast("팀 일정 투표를 만들었어요.");
    } catch (error) { toast(error.message); }
  });

  $("#inviteButton").addEventListener("click", async () => {
    try {
      const { url } = await api("/api/invites", { method: "POST", body: JSON.stringify({ teamId: state.teamId }) });
      await navigator.clipboard.writeText(url); toast("팀 초대 링크를 복사했어요.");
    } catch (error) { toast(error.message); }
  });
  $("#teamMenu").addEventListener("click", async () => {
    if (!state.workspace) return;
    const options = state.workspace.teams.map((team, index) => `${index + 1}. ${team.name}`).join("\n");
    const choice = prompt(`팀 선택: 번호를 입력하거나 새 팀 이름을 입력하세요.\n${options}\n\n새 팀을 만들려면 팀 이름을 입력하세요.`);
    if (!choice?.trim()) return;
    const index = Number(choice.trim()) - 1;
    if (Number.isInteger(index) && state.workspace.teams[index]) { state.teamId = state.workspace.teams[index].id; state.channelId = null; await loadWorkspace(); return; }
    try {
      const result = await api("/api/teams", { method: "POST", body: JSON.stringify({ name: choice.trim() }) });
      state.teamId = result.team.id; state.channelId = result.channel.id; await loadWorkspace(); toast("새 팀을 만들었어요.");
    } catch (error) { toast(error.message); }
  });

  $("#noticeClose").addEventListener("click", () => { $("#notice").remove(); });
  $("#summaryButton").addEventListener("click", renderSummary);
  $("#openSummary").addEventListener("click", renderSummary);
  $("#summaryLink").addEventListener("click", renderSummary);
  $("#modalClose").addEventListener("click", () => $("#modalBack").classList.remove("show"));
  $("#modalBack").addEventListener("click", (event) => { if (event.target === $("#modalBack")) $("#modalBack").classList.remove("show"); });
  $("#modalConfirm").addEventListener("click", () => $("#modalBack").classList.remove("show"));
  $("#searchButton").addEventListener("click", () => {
    const term = prompt("대화에서 찾을 단어를 입력하세요");
    if (!term) return;
    const hit = state.workspace?.messages.find((message) => message.body.toLowerCase().includes(term.toLowerCase()));
    if (hit) { toast(`${hit.authorName || "모아"}: ${hit.body.slice(0, 90)}`); }
    else toast("일치하는 메시지를 찾지 못했어요.");
  });
  $("#newChannel").addEventListener("click", () => toast("채널 관리는 다음 업데이트에서 제공할게요."));
  $("#focusTasks").addEventListener("click", () => { document.querySelector("#taskInput").focus(); });
  $("#taskShortcut").addEventListener("click", () => { document.querySelector("#taskInput").focus(); });
  $("#emojiButton").addEventListener("click", () => { const input = $("#messageInput"); input.value += "🙂"; input.focus(); });
  $("#summaryLink").textContent = "대화와 업무 근거 보기 ↗";
  function showMobilePanel(target) { const panel = $(".right"); panel.classList.add("mobile-open"); if (target) document.querySelector(target).scrollIntoView({ behavior: "smooth", block: "start" }); }
  $("#mobileTasks").addEventListener("click", () => showMobilePanel("#tasks"));
  $("#mobileSchedule").addEventListener("click", () => showMobilePanel("#schedule"));
  $("#mobileSummary").addEventListener("click", renderSummary);
  $("#closeMobilePanel").addEventListener("click", () => $(".right").classList.remove("mobile-open"));
  start();
})();
