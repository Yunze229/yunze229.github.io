(function() {
  'use strict';

  const WORKER_BASE = 'https://capsule.duyunze.com';
  const OAUTH_BASE  = 'https://auth.duyunze.com';
  const MAX_RECORDING_SECONDS = 300;

  const screens = {
    login:      document.getElementById('screen-login'),
    record:     document.getElementById('screen-record'),
    processing: document.getElementById('screen-processing'),
    edit:       document.getElementById('screen-edit'),
    published:  document.getElementById('screen-published'),
  };

  function showScreen(name) {
    for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
  }

  function showAlert(message, type, opts) {
    const area = document.getElementById('alert-area');
    area.innerHTML = '';
    const div  = document.createElement('div');
    div.className = 'alert ' + (type || 'error');
    div.textContent = message;
    area.appendChild(div);
    if (opts && opts.rescueBlob && opts.rescueBlob.size > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.style.marginTop = 'var(--space-3)';
      btn.textContent = '⬇️ 下载原始录音 / Download original recording';
      btn.addEventListener('click', () => {
        const b = opts.rescueBlob;
        const ext = b.type.includes('webm') ? 'webm'
                  : b.type.includes('mp4')  ? 'mp4'
                  : b.type.includes('ogg')  ? 'ogg'
                  : 'audio';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'voice-rescue-' + stamp + '.' + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      area.appendChild(btn);
    }
    if (type === 'success') setTimeout(() => { div.remove(); }, 8000);
  }
  function clearAlert() { document.getElementById('alert-area').innerHTML = ''; }

  // ===== OAuth =====
  function getStoredToken() { return sessionStorage.getItem('yunze_voice_gh_token'); }
  function setStoredToken(t) { sessionStorage.setItem('yunze_voice_gh_token', t); }
  function clearStoredToken() {
    sessionStorage.removeItem('yunze_voice_gh_token');
    sessionStorage.removeItem('yunze_voice_login');
  }
  function getStoredLogin() { return sessionStorage.getItem('yunze_voice_login'); }
  function setStoredLogin(l) { sessionStorage.setItem('yunze_voice_login', l); }

  function startLogin() {
    const url = OAUTH_BASE + '/auth?provider=github&scope=repo,user&site_id=duyunze.com';
    const w = 600, h = 700;
    const left = (screen.width - w) / 2;
    const top  = (screen.height - h) / 2;
    const popup = window.open(url, 'github_login', 'width=' + w + ',height=' + h + ',top=' + top + ',left=' + left);
    if (!popup) {
      showAlert('请允许弹窗 / Please allow popups for sign-in');
      return;
    }
    const handler = function(e) {
      if (typeof e.data !== 'string') return;
      if (e.data === 'authorizing:github') {
        popup.postMessage(e.data, e.origin);
        return;
      }
      if (e.data.indexOf('authorization:github:success:') === 0) {
        try {
          const payload = JSON.parse(e.data.replace('authorization:github:success:', ''));
          window.removeEventListener('message', handler);
          handleLoginSuccess(payload.token);
        } catch (err) {
          showAlert('登录数据解析失败 / Login data parse failed: ' + err.message);
        }
      } else if (e.data.indexOf('authorization:github:error:') === 0) {
        window.removeEventListener('message', handler);
        showAlert('登录失败 / Sign-in failed');
      }
    };
    window.addEventListener('message', handler);
  }

  async function handleLoginSuccess(token) {
    setStoredToken(token);
    try {
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) throw new Error('GitHub user fetch ' + r.status);
      const user = await r.json();
      setStoredLogin(user.login);
      renderUserInfo();
      showScreen('record');
      clearAlert();
    } catch (err) {
      clearStoredToken();
      showAlert('身份校验失败 / Identity check failed: ' + err.message);
    }
  }

  function renderUserInfo() {
    const login = getStoredLogin();
    const span  = document.getElementById('user-name');
    const link  = document.getElementById('logout-link');
    if (login) {
      span.textContent = '👋 ' + login;
      link.classList.remove('hidden');
    } else {
      span.textContent = '未登录 / Not signed in';
      link.classList.add('hidden');
    }
  }

  document.getElementById('login-btn').addEventListener('click', startLogin);
  document.getElementById('logout-link').addEventListener('click', function(e) {
    e.preventDefault();
    clearStoredToken();
    renderUserInfo();
    showScreen('login');
  });

  // ===== Recorder =====
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStart = 0;
  let timerInterval  = null;

  function fmtTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return m + ':' + s;
  }

  async function startRecording() {
    clearAlert();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showAlert('麦克风权限被拒 / Microphone access denied: ' + err.message);
      return;
    }
    recordedChunks = [];
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mime = candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (blob.size === 0) {
        showAlert('录音为空 / Empty recording');
        return;
      }
      processRecording(blob);
    };
    mediaRecorder.start();
    recordingStart = Date.now();
    const btn = document.getElementById('mic-btn');
    btn.classList.add('recording');
    btn.textContent = '⏹';
    btn.setAttribute('aria-label', '停止录音');
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - recordingStart) / 1000);
      document.getElementById('timer').textContent = fmtTime(sec);
      if (sec >= MAX_RECORDING_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    clearInterval(timerInterval);
    const btn = document.getElementById('mic-btn');
    btn.classList.remove('recording');
    btn.textContent = '🎙️';
    btn.setAttribute('aria-label', '开始录音');
  }

  document.getElementById('mic-btn').addEventListener('click', function() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') startRecording();
    else stopRecording();
  });

  // ===== Pipeline =====
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        const result = r.result;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function setStep(stepId, state) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (state === 'active') el.classList.add('active');
    if (state === 'done')   el.classList.add('done');
  }

  async function processRecording(blob) {
    showScreen('processing');
    setStep('step-upload', 'active');
    setStep('step-transcribe', '');
    setStep('step-polish', '');
    document.getElementById('processing-text').textContent = '上传中... / Uploading...';

    let audio_base64;
    try { audio_base64 = await blobToBase64(blob); }
    catch (err) {
      showAlert('音频读取失败 / Audio read failed: ' + err.message, 'error', { rescueBlob: blob });
      showScreen('record');
      return;
    }

    setStep('step-upload', 'done');
    setStep('step-transcribe', 'active');
    document.getElementById('processing-text').textContent = '转写中... / Transcribing...';

    const token = getStoredToken();
    let transcript;
    try {
      const r = await fetch(WORKER_BASE + '/voice/transcribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body:    JSON.stringify({ audio_base64 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'transcribe ' + r.status);
      transcript = data.transcript || '';
      if (!transcript.trim()) throw new Error('转写结果为空 / Empty transcript');
    } catch (err) {
      showAlert('转写失败 / Transcribe failed: ' + err.message, 'error', { rescueBlob: blob });
      showScreen('record');
      return;
    }

    setStep('step-transcribe', 'done');
    setStep('step-polish', 'active');
    document.getElementById('processing-text').textContent = 'AI 润色中... / AI polishing...';

    let polished;
    try {
      const r = await fetch(WORKER_BASE + '/voice/polish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body:    JSON.stringify({ transcript }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'polish ' + r.status);
      polished = data;
    } catch (err) {
      showAlert('润色失败 / Polish failed: ' + err.message, 'error', { rescueBlob: blob });
      showScreen('record');
      return;
    }

    setStep('step-polish', 'done');
    renderEditor(polished);
  }

  // ===== Editor =====
  let currentTags = [];
  let currentNotes = [];

  function renderEditor(d) {
    document.getElementById('f-title-en').value = d.title_en || '';
    document.getElementById('f-title-zh').value = d.title_zh || '';
    document.getElementById('f-slug').value     = d.slug || '';
    document.getElementById('f-body-en').value  = d.body_en || '';
    document.getElementById('f-body-zh').value  = d.body_zh || '';
    currentTags  = Array.isArray(d.tags) ? d.tags.slice() : [];
    currentNotes = Array.isArray(d.learning_notes) ? d.learning_notes.slice() : [];
    renderTags();
    renderNotes();
    showScreen('edit');
  }

  function renderTags() {
    const container = document.getElementById('f-tags');
    Array.from(container.querySelectorAll('.tag')).forEach(n => n.remove());
    const input = document.getElementById('f-tags-input');
    currentTags.forEach((tag, idx) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.addEventListener('click', () => { currentTags.splice(idx, 1); renderTags(); });
      chip.appendChild(x);
      container.insertBefore(chip, input);
    });
  }

  document.getElementById('f-tags-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = this.value.trim().replace(/^,|,$/, '');
      if (v && !currentTags.includes(v)) currentTags.push(v);
      this.value = '';
      renderTags();
    } else if (e.key === 'Backspace' && this.value === '' && currentTags.length) {
      currentTags.pop();
      renderTags();
    }
  });

  function renderNotes() {
    const container = document.getElementById('f-notes');
    container.innerHTML = '';
    currentNotes.forEach((note, idx) => {
      const det = document.createElement('details');
      det.open = idx === 0;
      const sum = document.createElement('summary');
      sum.textContent = note.phrase || '(未命名)';
      det.appendChild(sum);
      det.appendChild(buildNoteField('短语 / Phrase', 'phrase', note.phrase || '', idx, false));
      det.appendChild(buildNoteField('你说的 / You said', 'you_said', note.you_said || '', idx, true));
      det.appendChild(buildNoteField('地道说法 / Natural', 'correction', note.correction || '', idx, true));
      det.appendChild(buildNoteField('为什么（中文）', 'why_zh', note.why_zh || '', idx, true));
      det.appendChild(buildNoteField('Why (English)', 'why_en', note.why_en || '', idx, true));
      const rm = document.createElement('button');
      rm.className = 'remove-note';
      rm.type = 'button';
      rm.textContent = '✕ 删除这条 / Remove';
      rm.addEventListener('click', () => { currentNotes.splice(idx, 1); renderNotes(); });
      det.appendChild(rm);
      container.appendChild(det);
    });
    if (currentNotes.length === 0) {
      const p = document.createElement('p');
      p.style.color = 'var(--faint)';
      p.style.fontSize = '0.9rem';
      p.textContent = '没有学习笔记。点下面按钮手动加一条。 / No notes; add one below if you want.';
      container.appendChild(p);
    }
  }

  function buildNoteField(label, key, value, idx, multi) {
    const wrap = document.createElement('div');
    wrap.className = 'note-field';
    const lab = document.createElement('div');
    lab.textContent = label;
    wrap.appendChild(lab);
    const input = multi ? document.createElement('textarea') : document.createElement('input');
    if (!multi) input.type = 'text';
    input.value = value;
    input.addEventListener('input', () => {
      currentNotes[idx][key] = input.value;
      if (key === 'phrase') {
        const sum = input.closest('details').querySelector('summary');
        if (sum) sum.textContent = input.value || '(未命名)';
      }
    });
    wrap.appendChild(input);
    return wrap;
  }

  document.getElementById('add-note-btn').addEventListener('click', function() {
    currentNotes.push({ phrase: '', you_said: '', correction: '', why_zh: '', why_en: '' });
    renderNotes();
  });

  document.getElementById('redo-btn').addEventListener('click', function() {
    if (!confirm('放弃当前草稿重新录制？ / Discard current draft and record again?')) return;
    showScreen('record');
  });

  async function publishWith(isPrivate, clickedBtn) {
    clearAlert();
    const payload = {
      title_en: document.getElementById('f-title-en').value.trim(),
      title_zh: document.getElementById('f-title-zh').value.trim(),
      slug:     document.getElementById('f-slug').value.trim(),
      tags:     currentTags.slice(),
      body_en:  document.getElementById('f-body-en').value,
      body_zh:  document.getElementById('f-body-zh').value,
      learning_notes: currentNotes
        .filter(n => (n.phrase || '').trim() && (n.correction || '').trim()),
      private:  !!isPrivate,
    };
    if (!payload.title_en || !payload.body_en) {
      showAlert('英文标题和正文必填 / English title + body required');
      return;
    }
    const publishBtn = document.getElementById('publish-btn');
    const privateBtn = document.getElementById('save-private-btn');
    const allButtons = [publishBtn, privateBtn];
    const oldText = clickedBtn.textContent;
    allButtons.forEach(b => { b.disabled = true; });
    clickedBtn.textContent = isPrivate ? '保存中... / Saving...' : '发布中... / Publishing...';
    try {
      const r = await fetch(WORKER_BASE + '/voice/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getStoredToken() },
        body:    JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'publish ' + r.status);
      showPublished(data);
    } catch (err) {
      showAlert((isPrivate ? '保存失败 / Save failed: ' : '发布失败 / Publish failed: ') + err.message);
      allButtons.forEach(b => { b.disabled = false; });
      clickedBtn.textContent = oldText;
    }
  }

  document.getElementById('publish-btn').addEventListener('click', function() {
    publishWith(false, this);
  });
  document.getElementById('save-private-btn').addEventListener('click', function() {
    publishWith(true, this);
  });

  function showPublished(data) {
    const isPrivate = data.private === true;
    document.getElementById('published-title').textContent = isPrivate
      ? '🔒 已保存为私密日记 / Saved (private)'
      : '🎉 已发布！ / Published!';
    const p = document.getElementById('published-text');
    p.innerHTML = '';
    const a1 = document.createElement('p');
    if (isPrivate) {
      a1.innerHTML = '文件已写入主库 <code>' + data.post_path + '</code>，部署后会被密码加密。<br>The post is staticrypt-encrypted on deploy. Use the private password to read at: <a href="' + data.post_url + '" target="_blank">' + data.post_url + '</a>';
    } else {
      a1.innerHTML = '文件已写入主库 <code>' + data.post_path + '</code>。<br>部署完成后访问：<a href="' + data.post_url + '" target="_blank">' + data.post_url + '</a>';
    }
    p.appendChild(a1);
    if (data.learn_url) {
      const a2 = document.createElement('p');
      a2.innerHTML = '📖 学习笔记：<a href="' + data.learn_url + '" target="_blank">' + data.learn_url + '</a>';
      p.appendChild(a2);
    }
    showScreen('published');
  }

  document.getElementById('record-again-btn').addEventListener('click', function() {
    showScreen('record');
  });

  // ===== Init =====
  function init() {
    if (getStoredToken() && getStoredLogin()) {
      renderUserInfo();
      showScreen('record');
    } else {
      clearStoredToken();
      renderUserInfo();
      showScreen('login');
    }
  }
  init();
})();
