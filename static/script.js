// ══════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════
let impactCount        = 1;
let executionBlockCount= 0;
let chartInstances     = {};
let dashboardData      = {};
let allHistoryData     = [];
let currentUser        = null;   // { email, role }
let matrixData         = null;   // dados do último GET /api/competencies
let matrixDraftScores  = {};     // {competency_id: score} — rascunho local
let isAdmin            = false;  // controle global de privilégios admin
let isPrivileged       = false;  // controle global de gestor/admin

// ──────────────────────────────────────────────────────────────────
// PALETA DE CORES
// ──────────────────────────────────────────────────────────────────
const ENG_COLORS = [
    '#3674ef', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#6366f1'
];
function getEngColor(index, alpha = 1) {
    const hex = ENG_COLORS[index % ENG_COLORS.length];
    if (alpha === 1) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// Nota composta ponderada (todos os critérios, escala unificada 0-10)
function compositeScore(fb) {
    const exec  = fb.execution_score     || 0;
    const comm  = fb.communication_score || 0;
    const dev   = (fb.dev_score          || 0) * 2;
    const maint = (fb.maintain_score     || 0) * 2;
    const own   = (fb.ownership_score    || 0) * 2;
    const cult  = (fb.cultural_score     || 0) * 2;
    const study = (fb.study_score        || 0) * 2;
    const check = (fb.checklist_score    || 0) * 2;
    return ((exec + comm + dev + maint + own + cult + study + check) / 8).toFixed(1);
}

// ══════════════════════════════════════════════════════════════════
// AUTENTICAÇÃO
// ══════════════════════════════════════════════════════════════════

// Wrapper de fetch que redireciona 401 para o login
async function apiFetch(url, opts = {}) {
    const defaults = { credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    const res = await fetch(url, { ...defaults, ...opts, headers: { ...defaults.headers, ...(opts.headers || {}) } });
    if (res.status === 401) {
        showLoginOverlay();
        throw new Error('Sessão expirada');
    }
    return res;
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
            currentUser = await res.json();
            onAuthSuccess();
        } else {
            showLoginOverlay();
        }
    } catch {
        showLoginOverlay();
    }
}

function onAuthSuccess() {
    document.getElementById('login-overlay').style.display  = 'none';
    document.getElementById('app-container').style.display  = 'block';

    // Topbar
    const badge = document.getElementById('topbar-role-badge');
    badge.textContent  = currentUser.role;
    badge.className    = `role-badge ${currentUser.role}`;
    document.getElementById('topbar-email').textContent = currentUser.email;

    // Mostrar/esconder abas conforme role
    isPrivileged = ['admin', 'gestor'].includes(currentUser.role);
    isAdmin      = currentUser.role === 'admin';

    document.getElementById('nav-new').style.display       = isPrivileged ? '' : 'none';
    document.getElementById('nav-dashboard').style.display = isPrivileged ? '' : 'none';
    document.getElementById('nav-users').style.display     = isPrivileged ? '' : 'none';
    document.getElementById('nav-matrix').style.display    = '';

    // Ocultar opção admin no select para não-admins
    const adminOpt = document.getElementById('admin-role-option');
    if (adminOpt) adminOpt.style.display = isAdmin ? '' : 'none';

    // Se for 'user', mostrar só histórico
    if (!isPrivileged) {
        showTab('history');
    } else {
        showTab('new');
        const container = document.getElementById('execution-blocks-container');
        if (container && container.children.length === 0) {
            addExecutionBlock();
        }
    }

    startInactivityTimer();
}

function showLoginOverlay() {
    stopInactivityTimer();
    currentUser = null;
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    switchToLoginPanel();
}

// Troca de painel login ↔ código
function switchToCodePanel() {
    document.getElementById('login-panel').style.display = 'none';
    document.getElementById('code-panel').style.display  = 'block';
    const emailVal = document.getElementById('login-email').value;
    if (emailVal) document.getElementById('code-email').value = emailVal;
}

function switchToLoginPanel() {
    document.getElementById('code-panel').style.display  = 'none';
    document.getElementById('login-panel').style.display = 'block';
    clearAuthMessages();
}

function clearAuthMessages() {
    ['login-error', 'code-error', 'code-success'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.textContent = ''; }
    });
}

function showAuthError(panelId, msg) {
    const el = document.getElementById(panelId);
    el.textContent    = msg;
    el.style.display  = 'block';
}

// Login com senha
async function doLogin() {
    const btn   = document.getElementById('btn-login');
    const email = document.getElementById('login-email').value.trim();
    const pwd   = document.getElementById('login-password').value;
    clearAuthMessages();

    if (!email || !pwd) {
        showAuthError('login-error', 'Preencha e-mail e senha.');
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Entrando...';

    try {
        const res  = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pwd })
        });
        const data = await res.json();

        if (res.ok) {
            currentUser = { email: data.email, role: data.role };
            onAuthSuccess();
        } else if (data.needs_setup) {
            switchToCodePanel();
            document.getElementById('code-email').value = email;
        } else {
            showAuthError('login-error', data.error || 'Falha no login');
        }
    } catch {
        showAuthError('login-error', 'Erro de rede');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Entrar';
    }
}

// Solicitar código
async function doRequestCode() {
    const btn   = document.getElementById('btn-send-code');
    const email = document.getElementById('code-email').value.trim();
    clearAuthMessages();

    if (!email) {
        showAuthError('code-error', 'Informe o e-mail.');
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Enviando...';

    try {
        const res  = await fetch('/api/auth/request-code', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (res.ok) {
            document.getElementById('code-fields').style.display = 'block';
            const s = document.getElementById('code-success');
            s.textContent   = 'Código enviado! Verifique seu e-mail (válido por 15 min).';
            s.style.display = 'block';
        } else {
            showAuthError('code-error', data.error || 'Falha ao enviar código');
        }
    } catch {
        showAuthError('code-error', 'Erro de rede');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Enviar Código';
    }
}

// Verificar código e definir senha
async function doVerifyAndSetPassword() {
    const email = document.getElementById('code-email').value.trim();
    const code  = document.getElementById('code-input').value.trim();
    const pwd   = document.getElementById('code-new-password').value;
    clearAuthMessages();

    if (!code || !pwd) {
        showAuthError('code-error', 'Preencha o código e a nova senha.');
        return;
    }

    try {
        const res  = await fetch('/api/auth/verify-and-set-password', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, password: pwd })
        });
        const data = await res.json();

        if (res.ok) {
            currentUser = { email: data.email, role: data.role };
            onAuthSuccess();
        } else {
            showAuthError('code-error', data.error || 'Código ou senha inválidos');
        }
    } catch {
        showAuthError('code-error', 'Erro de rede');
    }
}

async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    showLoginOverlay();
}

// Enter key nos inputs de login
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const loginPanel = document.getElementById('login-panel');
    const codePanel  = document.getElementById('code-panel');
    if (loginPanel && loginPanel.style.display !== 'none') doLogin();
    else if (codePanel && codePanel.style.display !== 'none') {
        const codeVisible = document.getElementById('code-fields').style.display !== 'none';
        if (codeVisible) doVerifyAndSetPassword();
        else doRequestCode();
    }
});

// ══════════════════════════════════════════════════════════════════
// TIMER DE INATIVIDADE (5 min)
// ══════════════════════════════════════════════════════════════════
const INACTIVITY_MS = 5 * 60 * 1000;  // 5 minutos
let inactivityTimer   = null;
let sessionCountdown  = null;
let lastActivity      = Date.now();

function resetActivity() {
    lastActivity = Date.now();
}

function startInactivityTimer() {
    stopInactivityTimer();

    // Monitorar interação
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, resetActivity, { passive: true })
    );

    // Verificar a cada 10 segundos
    inactivityTimer = setInterval(() => {
        const idle = Date.now() - lastActivity;
        if (idle >= INACTIVITY_MS) {
            stopInactivityTimer();
            doLogout();
        }
    }, 10_000);

    // Contador regressivo visível no overlay de login (mostra quando logado)
    updateTimerDisplay();
    sessionCountdown = setInterval(updateTimerDisplay, 1000);
}

function stopInactivityTimer() {
    if (inactivityTimer)  { clearInterval(inactivityTimer);  inactivityTimer  = null; }
    if (sessionCountdown) { clearInterval(sessionCountdown); sessionCountdown = null; }
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev =>
        document.removeEventListener(ev, resetActivity)
    );
}

function updateTimerDisplay() {
    const remaining = Math.max(0, INACTIVITY_MS - (Date.now() - lastActivity));
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    const txt = document.getElementById('session-timer-text');
    if (txt) txt.textContent = `Sessão expira em ${min}:${String(sec).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════════════════════
// NAVEGAÇÃO DE TABS
// ══════════════════════════════════════════════════════════════════
function showTab(tabName) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav li').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).classList.add('active');
    const navItem = document.getElementById(`nav-${tabName}`);
    if (navItem) navItem.classList.add('active');

    if (tabName === 'history')        loadHistory();
    else if (tabName === 'dashboard') loadDashboardData();
    else if (tabName === 'users')     loadUsers();
    else if (tabName === 'matrix')    loadMatrix();
}

// ══════════════════════════════════════════════════════════════════
// BLOCOS DE EXECUÇÃO
// ══════════════════════════════════════════════════════════════════
function addExecutionBlock() {
    const container = document.getElementById('execution-blocks-container');
    if (!container) return;
    const id    = executionBlockCount++;
    const block = document.createElement('div');
    block.className = 'execution-block';
    block.id        = `execBlock_${id}`;
    block.innerHTML = `
        <div class="block-header">
            <h4>Entrega / Unidade de Execução</h4>
            <button type="button" class="btn-delete-block" onclick="removeExecutionBlock(${id})">Excluir Unidade</button>
        </div>
        <div class="date-grid">
            <div class="input-group">
                <label>Data de Início</label>
                <input type="date" class="exec-start-date">
            </div>
            <div class="input-group">
                <label>Data de Fim</label>
                <input type="date" class="exec-end-date">
            </div>
        </div>
        <div class="input-group">
            <label>Descrição da Execução</label>
            <textarea class="exec-desc-input" rows="2" placeholder="O que foi executado..."></textarea>
        </div>
        <div class="input-group">
            <label>Impacto Atrelado</label>
            <textarea class="exec-impact-input" rows="2" placeholder="Qual o impacto real desta entrega..."></textarea>
        </div>
        <div class="slider-group mini-slider">
            <label>Nota desta Entrega (1 a 10): <span class="exec-block-score-val">5</span></label>
            <input type="range" class="exec-block-score" min="1" max="10" value="5"
                oninput="this.previousElementSibling.querySelector('span').innerText=this.value; calculateExecutionAverage();">
        </div>
    `;
    container.appendChild(block);
    calculateExecutionAverage();
}

function removeExecutionBlock(id) {
    const block = document.getElementById(`execBlock_${id}`);
    if (block) { block.remove(); calculateExecutionAverage(); }
}

function calculateExecutionAverage() {
    const scores = document.querySelectorAll('.exec-block-score');
    let total = 0;
    scores.forEach(s => total += parseInt(s.value));
    const avg      = scores.length > 0 ? (total / scores.length).toFixed(1) : 0;
    const avgSlider = document.getElementById('execution_score');
    const avgDisplay= document.getElementById('val-exec-avg');
    if (avgSlider)  avgSlider.value    = avg;
    if (avgDisplay) avgDisplay.innerText = avg;
}

// ══════════════════════════════════════════════════════════════════
// FORMULÁRIO DE FEEDBACK
// ══════════════════════════════════════════════════════════════════
let editingFeedbackId = null;

document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveFeedback(false);
});

async function saveFeedback(isDraft) {
    const btn       = document.getElementById('btnSubmit');
    const btnDraft  = document.getElementById('btn-save-draft-fb');
    const statusMsg = document.getElementById('submit-status');

    if (btn) btn.disabled = true;
    if (btnDraft) btnDraft.disabled = true;
    
    if (btn && !isDraft) btn.innerText = 'Salvando...';
    if (btnDraft && isDraft) btnDraft.innerText = 'Salvando Rascunho...';
    
    statusMsg.className = 'status-msg';
    statusMsg.innerText = '';

    const executionBlocks = [];
    document.querySelectorAll('.execution-block').forEach(block => {
        executionBlocks.push({
            start_date:  block.querySelector('.exec-start-date').value,
            end_date:    block.querySelector('.exec-end-date').value,
            description: block.querySelector('.exec-desc-input').value,
            impact:      block.querySelector('.exec-impact-input').value,
            score:       parseInt(block.querySelector('.exec-block-score').value)
        });
    });

    const payload = {
        engineer_name:       document.getElementById('engineer_name').value,
        engineer_email:      document.getElementById('engineer_email').value,
        cc_email:            document.getElementById('cc_email').value,
        evaluator_name:      document.getElementById('evaluator_name').value,
        execution_score:     parseFloat(document.getElementById('execution_score').value),
        execution_text:      '',
        execution_blocks:    executionBlocks,
        impacts:             [],
        communication_score: parseInt(document.getElementById('communication_score').value),
        communication_text:  document.getElementById('communication_text').value,
        dev_score:           parseInt(document.getElementById('dev_score').value),
        dev_text:            document.getElementById('dev_text').value,
        maintain_score:      parseInt(document.getElementById('maintain_score').value),
        maintain_text:       document.getElementById('maintain_text').value,
        checklist_score:     parseInt(document.getElementById('checklist_score').value),
        checklist_text:      document.getElementById('checklist_text').value,
        study_score:         parseInt(document.getElementById('study_score').value),
        study_text:          document.getElementById('study_text').value,
        ownership_score:     parseInt(document.getElementById('ownership_score').value),
        ownership_text:      document.getElementById('ownership_text').value,
        cultural_score:      parseInt(document.getElementById('cultural_score').value),
        cultural_text:       document.getElementById('cultural_text').value,
        is_draft:            isDraft
    };

    try {
        const url = editingFeedbackId ? `/api/feedbacks/${editingFeedbackId}` : '/api/feedbacks';
        const method = editingFeedbackId ? 'PUT' : 'POST';

        const response = await apiFetch(url, {
            method: method,
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok) {
            statusMsg.classList.add('success');
            statusMsg.innerText = 'Sincronizando...';
            setTimeout(() => {
                statusMsg.innerText = isDraft ? 'Rascunho salvo com sucesso!' : 'Feedback salvo! Confira na aba Histórico.';
                document.getElementById('feedbackForm').reset();
                document.getElementById('val-exec-avg').innerText = '0';
                document.getElementById('val-comm').innerText     = '5';
                ['dev','maintain','checklist','study','ownership','cultural'].forEach(id => {
                    const el = document.getElementById(`val-${id}`);
                    if (el) el.innerText = '3';
                });
                document.getElementById('execution-blocks-container').innerHTML = '';
                editingFeedbackId = null;
                addExecutionBlock();
            }, 1000);
        } else {
            statusMsg.classList.add('error');
            statusMsg.innerText = 'Erro ao salvar: ' + (data.error || 'Tente novamente');
        }
    } catch (err) {
        if (err.message !== 'Sessão expirada') {
            statusMsg.classList.add('error');
            statusMsg.innerText = 'Falha de rede ao contatar servidor';
        }
    } finally {
        if (btn) {
            btn.disabled  = false;
            btn.innerText = 'Salvar Feedback';
        }
        if (btnDraft) {
            btnDraft.disabled = false;
            btnDraft.innerText = 'Salvar Rascunho';
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// HISTÓRICO
// ══════════════════════════════════════════════════════════════════
async function loadHistory() {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = "<tr><td colspan='5'>Carregando histórico...</td></tr>";
    try {
        const response = await apiFetch('/api/feedbacks');
        allHistoryData = await response.json();
        renderHistoryTable(allHistoryData);
    } catch (err) {
        if (err.message !== 'Sessão expirada')
            tbody.innerHTML = "<tr><td colspan='5'>Erro ao carregar histórico.</td></tr>";
    }
}

function renderHistoryTable(list) {
    const tbody     = document.getElementById('history-table-body');
    const isPriv    = currentUser && ['admin','gestor'].includes(currentUser.role);

    if (list.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5'>Nenhum registro encontrado.</td></tr>";
        return;
    }
    tbody.innerHTML = '';
    list.forEach(fb => {
        const tr = document.createElement('tr');
        const dp = new Date(fb.date_created);
        
        let statusText = fb.email_sent ? '✅ Enviado' : '⏳ Pendente';
        if (fb.is_draft) statusText = '📝 Rascunho';

        tr.innerHTML = `
            <td>${dp.toLocaleDateString('pt-BR')} ${dp.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</td>
            <td><strong>${fb.engineer_name}</strong></td>
            <td>${fb.evaluator_name}</td>
            <td>${statusText}</td>
            <td class="action-btns">
                ${!fb.is_draft ? `<a href="/api/feedbacks/${fb.id}/pdf" target="_blank" class="btn-download">PDF</a>` : ''}
                ${isPriv ? `
                    ${fb.is_draft ? `<button class="btn-secondary" onclick="editDraft(${fb.id})">Editar Rascunho</button>` : ''}
                    ${!fb.is_draft ? `<button class="btn-email" onclick="sendEmail(${fb.id}, this)">${fb.email_sent ? 'Reenviar' : 'Enviar E-mail'}</button>` : ''}
                    <button class="btn-delete" onclick="deleteHistory(${fb.id})">Excluir</button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function editDraft(id) {
    try {
        const response = await apiFetch(`/api/feedbacks/${id}`);
        if (!response.ok) throw new Error('Erro ao carregar rascunho');
        const fb = await response.json();

        editingFeedbackId = fb.id;

        document.getElementById('engineer_name').value = fb.engineer_name || '';
        document.getElementById('engineer_email').value = fb.engineer_email || '';
        document.getElementById('cc_email').value = fb.cc_email || '';
        document.getElementById('evaluator_name').value = fb.evaluator_name || '';
        
        document.getElementById('communication_score').value = fb.communication_score || 5;
        document.getElementById('val-comm').innerText = fb.communication_score || 5;
        document.getElementById('communication_text').value = fb.communication_text || '';

        ['dev', 'maintain', 'checklist', 'study', 'ownership', 'cultural'].forEach(field => {
            document.getElementById(`${field}_score`).value = fb[`${field}_score`] || 3;
            document.getElementById(`val-${field}`).innerText = fb[`${field}_score`] || 3;
            document.getElementById(`${field}_text`).value = fb[`${field}_text`] || '';
        });

        const container = document.getElementById('execution-blocks-container');
        container.innerHTML = '';
        if (fb.execution_blocks && fb.execution_blocks.length > 0) {
            fb.execution_blocks.forEach(block => {
                addExecutionBlock();
                const lastBlock = container.lastElementChild;
                lastBlock.querySelector('.exec-start-date').value = block.start_date || '';
                lastBlock.querySelector('.exec-end-date').value = block.end_date || '';
                lastBlock.querySelector('.exec-desc-input').value = block.description || '';
                lastBlock.querySelector('.exec-impact-input').value = block.impact || '';
                lastBlock.querySelector('.exec-block-score').value = block.score || 5;
                lastBlock.querySelector('.exec-block-score-val').innerText = block.score || 5;
            });
        } else {
            addExecutionBlock();
        }
        calculateExecutionAverage();

        showTab('new');
        window.scrollTo(0, 0);
    } catch (err) {
        alert(err.message);
    }
}

function filterHistory() {
    const nameFilter = document.getElementById('filter-name').value.toLowerCase();
    const dateFilter = document.getElementById('filter-date').value;
    const filtered   = allHistoryData.filter(fb => {
        const matchesName = fb.engineer_name.toLowerCase().includes(nameFilter);
        let matchesDate   = true;
        if (dateFilter) {
            const fbDay   = (fb.date_created || '').split(' ')[0];
            matchesDate   = fbDay === dateFilter;
        }
        return matchesName && matchesDate;
    });
    renderHistoryTable(filtered);
}

function clearFilters() {
    document.getElementById('filter-name').value = '';
    document.getElementById('filter-date').value = '';
    renderHistoryTable(allHistoryData);
}

async function deleteHistory(id) {
    if (!confirm('Tem certeza que deseja apagar permanentemente essa avaliação?')) return;
    try {
        await apiFetch(`/api/feedbacks/${id}`, { method: 'DELETE' });
        loadHistory();
    } catch (e) {
        if (e.message !== 'Sessão expirada') alert('Falha ao excluir item');
    }
}

async function sendEmail(id, btn) {
    if (!confirm('Enviar o PDF deste feedback por e-mail para o avaliado?')) return;
    btn.disabled    = true;
    btn.innerText   = 'Enviando...';
    try {
        const res  = await apiFetch(`/api/feedbacks/${id}/send-email`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert('E-mail enviado com sucesso!');
            loadHistory();
        } else {
            alert('Falha ao enviar: ' + (data.error || 'Erro desconhecido'));
            btn.disabled  = false;
            btn.innerText = 'Enviar E-mail';
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') {
            alert('Erro de rede ao tentar enviar e-mail.');
            btn.disabled  = false;
            btn.innerText = 'Enviar E-mail';
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// GERENCIAMENTO DE USUÁRIOS
// ══════════════════════════════════════════════════════════════════
async function loadUsers() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '<tr><td colspan="5">Carregando...</td></tr>';
    try {
        const res   = await apiFetch('/api/users');
        const users = await res.json();
        renderUsersTable(users);
    } catch (e) {
        if (e.message !== 'Sessão expirada')
            tbody.innerHTML = '<tr><td colspan="5">Erro ao carregar usuários.</td></tr>';
    }
}

function renderUsersTable(users) {
    const tbody   = document.getElementById('users-table-body');
    const isAdmin = currentUser && currentUser.role === 'admin';
    tbody.innerHTML = '';

    users.forEach(u => {
        const isMe     = u.email === (currentUser && currentUser.email);
        const isMaster = u.email === 'luiz@otmow.com';
        const tr       = document.createElement('tr');

        const roleOptions = ['admin', 'gestor', 'user']
            .filter(r => isAdmin || r !== 'admin')
            .map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`)
            .join('');

        tr.innerHTML = `
            <td>${u.email} ${isMe ? '<em style="color:#6b7280">(você)</em>' : ''}</td>
            <td>
                ${isAdmin && !isMaster
                    ? `<select class="role-select-inline" onchange="updateRole(${u.id}, this.value)">${roleOptions}</select>`
                    : `<strong>${u.role}</strong>`
                }
            </td>
            <td>${u.has_password
                ? '<span class="badge-has-pwd">✓ Definida</span>'
                : '<span class="badge-no-pwd">— Não definida</span>'
            }</td>
            <td>${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
            <td class="action-btns">
                ${isAdmin && !isMaster
                    ? `<button class="btn-reset-pwd" onclick="resetUserPwd(${u.id})">Reset Senha</button>
                       <button class="btn-delete" onclick="deleteUser(${u.id})">Excluir</button>`
                    : '<span style="color:#9ca3af; font-size:.85rem">—</span>'
                }
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function createUser() {
    const email   = document.getElementById('new-user-email').value.trim().toLowerCase();
    const role    = document.getElementById('new-user-role').value;
    const msgEl   = document.getElementById('user-form-msg');
    msgEl.style.display  = 'none';
    msgEl.className      = 'auth-msg';

    if (!email) {
        msgEl.textContent   = 'Informe o e-mail.';
        msgEl.classList.add('error');
        msgEl.style.display = 'block';
        return;
    }

    try {
        const res  = await apiFetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ email, role })
        });
        const data = await res.json();
        if (res.ok) {
            msgEl.textContent   = `Usuário ${email} adicionado! Ele deve usar "Primeiro acesso" para definir a senha.`;
            msgEl.classList.add('success');
            msgEl.style.display = 'block';
            document.getElementById('new-user-email').value = '';
            loadUsers();
        } else {
            msgEl.textContent   = data.error || 'Erro ao adicionar usuário';
            msgEl.classList.add('error');
            msgEl.style.display = 'block';
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') {
            msgEl.textContent   = 'Erro de rede';
            msgEl.classList.add('error');
            msgEl.style.display = 'block';
        }
    }
}

async function deleteUser(id) {
    if (!confirm('Remover este usuário permanentemente?')) return;
    try {
        const res  = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) loadUsers();
        else alert(data.error || 'Erro ao excluir');
    } catch (e) {
        if (e.message !== 'Sessão expirada') alert('Erro de rede');
    }
}

async function resetUserPwd(id) {
    if (!confirm('Redefinir (apagar) a senha deste usuário? Ele precisará criar nova senha no próximo acesso.')) return;
    try {
        const res  = await apiFetch(`/api/users/${id}/reset-password`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) { alert('Senha resetada.'); loadUsers(); }
        else alert(data.error || 'Erro ao resetar');
    } catch (e) {
        if (e.message !== 'Sessão expirada') alert('Erro de rede');
    }
}

async function updateRole(id, newRole) {
    try {
        const res  = await apiFetch(`/api/users/${id}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: newRole })
        });
        if (!res.ok) {
            const d = await res.json();
            alert(d.error || 'Erro ao alterar role');
            loadUsers(); // reverter UI
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') { alert('Erro de rede'); loadUsers(); }
    }
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════
let currentDashboardView = 'team';

function switchDashboardView(view) {
    currentDashboardView = view;
    document.querySelectorAll('.dash-nav-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');

    document.getElementById('dash-view-team').style.display       = view === 'team'       ? 'block' : 'none';
    document.getElementById('dash-view-individual').style.display = view === 'individual' ? 'block' : 'none';

    if (view === 'team') renderTeamCharts();
    else renderIndividualCharts();
}

async function loadDashboardData() {
    try {
        const res     = await apiFetch('/api/dashboard');
        dashboardData = await res.json();

        const select  = document.getElementById('engSelect');
        select.innerHTML = '<option value="">(Escolha um membro do time)</option>';
        Object.keys(dashboardData).sort().forEach(name => {
            const count = dashboardData[name].length;
            const opt   = document.createElement('option');
            opt.value   = name;
            opt.innerText = `${name} (${count} avaliação${count !== 1 ? 'ões' : ''})`;
            select.appendChild(opt);
        });

        switchDashboardView('team');
    } catch (e) {
        if (e.message !== 'Sessão expirada') console.error('Dashboard error', e);
    }
}

function renderTeamCharts() {
    Object.keys(chartInstances).forEach(key => {
        if (chartInstances[key]) { chartInstances[key].destroy(); chartInstances[key] = null; }
    });

    const allFeedbacks = Object.values(dashboardData).flat();
    if (allFeedbacks.length === 0) {
        document.getElementById('dash-view-team').querySelector('.dashboard-grid').innerHTML =
            '<div class="empty-state" style="grid-column:1/-1">Nenhum feedback cadastrado ainda.</div>';
        return;
    }

    // Radar equipe
    const radarMetrics = ['dev_score','maintain_score','checklist_score','study_score','ownership_score','cultural_score'];
    const teamAverages = radarMetrics.map(m => {
        const sum = allFeedbacks.reduce((acc, f) => acc + (f[m] || 0), 0);
        return parseFloat((sum / allFeedbacks.length).toFixed(2));
    });
    chartInstances['teamRadar'] = new Chart(
        document.getElementById('teamRadarChart').getContext('2d'), {
        type: 'radar',
        data: {
            labels: ['Desenvolver','Manter','Checklist','Estudo','Ownership','Cultura'],
            datasets: [{
                label: 'Média Global do Time',
                data: teamAverages,
                backgroundColor: 'rgba(54,116,239,0.25)',
                borderColor: '#3674ef',
                borderWidth: 2,
                pointBackgroundColor: '#3674ef',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            scales: {
                r: {
                    min: 0, max: 5,
                    ticks: { stepSize: 1, font: { size: 11 } },
                    pointLabels: { font: { size: 13, weight: '600' } },
                    grid: { color: 'rgba(0,0,0,0.06)' }
                }
            },
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw} / 5` } }
            }
        }
    });

    // Throughput mensal
    const monthlyData = {};
    allFeedbacks.forEach(f => {
        const date  = new Date(f.date_created);
        const key   = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
        const blocks= JSON.parse(f.execution_blocks_json || '[]');
        monthlyData[key] = (monthlyData[key] || 0) + blocks.length;
    });
    const sortedMonths = Object.keys(monthlyData).sort();
    chartInstances['throughput'] = new Chart(
        document.getElementById('throughputChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: sortedMonths.map(m => {
                const [y, mo] = m.split('-');
                return new Date(y, mo-1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            }),
            datasets: [{
                label: 'Unidades de Execução',
                data: sortedMonths.map(m => monthlyData[m]),
                backgroundColor: sortedMonths.map((_, i) => getEngColor(i, 0.8)),
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.raw} entregas` } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.04)' } },
                x: { grid: { display: false } }
            }
        }
    });

    // Compliance donut
    const sentCount    = allFeedbacks.filter(f => f.email_sent === 1).length;
    const notSentCount = allFeedbacks.length - sentCount;
    const pct          = allFeedbacks.length > 0 ? Math.round((sentCount / allFeedbacks.length) * 100) : 0;
    chartInstances['compliance'] = new Chart(
        document.getElementById('complianceChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: [`Enviados (${sentCount})`, `Pendentes (${notSentCount})`],
            datasets: [{ data: [sentCount, notSentCount], backgroundColor: ['#10b981','#e5e7eb'], borderWidth: 2, borderColor: ['#fff','#fff'], hoverOffset: 6 }]
        },
        options: {
            responsive: true,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${allFeedbacks.length > 0 ? Math.round((ctx.raw/allFeedbacks.length)*100) : 0}%` } }
            }
        },
        plugins: [{
            id: 'centerText',
            afterDraw(chart) {
                const { width, height, ctx: c } = chart;
                c.save();
                c.font = 'bold 28px Inter, sans-serif';
                c.fillStyle = '#1b3872';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(`${pct}%`, width/2, height/2 - 12);
                c.font = '13px Inter, sans-serif';
                c.fillStyle = '#6b7280';
                c.fillText('enviados', width/2, height/2 + 16);
                c.restore();
            }
        }]
    });

    // Scatter por engenheiro
    const engNames = Object.keys(dashboardData);
    chartInstances['scatter'] = new Chart(
        document.getElementById('impactScatterChart').getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: engNames.map((name, idx) => ({
                label: name,
                data: dashboardData[name].map(f => ({
                    x: f.execution_score,
                    y: JSON.parse(f.execution_blocks_json || '[]').length
                })),
                backgroundColor: getEngColor(idx, 0.75),
                pointRadius: 8,
                pointHoverRadius: 11
            }))
        },
        options: {
            responsive: true,
            scales: {
                x: { title: { display: true, text: 'Nota de Execução (1-10)', font: { weight: '600' } }, min: 0, max: 10, grid: { color: 'rgba(0,0,0,0.04)' } },
                y: { title: { display: true, text: 'Qtd de Entregas', font: { weight: '600' } }, min: 0, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.04)' } }
            },
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: nota ${ctx.raw.x}, ${ctx.raw.y} entregas` } }
            }
        }
    });

    renderLeaderboard();
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '';

    const rows = Object.keys(dashboardData).map(name => {
        const feedbacks    = dashboardData[name];
        const latest       = feedbacks[feedbacks.length - 1];
        const prev         = feedbacks.length > 1 ? feedbacks[feedbacks.length - 2] : null;
        const latestScore  = parseFloat(compositeScore(latest));
        const prevScore    = prev ? parseFloat(compositeScore(prev)) : null;
        return { name, latestScore, prevScore };
    }).sort((a, b) => b.latestScore - a.latestScore);

    rows.forEach(({ name, latestScore, prevScore }, idx) => {
        let trendHtml  = '<span class="trend-neutral">—</span>';
        let statusText = 'Estável';

        if (prevScore !== null) {
            const diff = latestScore - prevScore;
            if (diff > 0.09) {
                trendHtml  = `<span class="trend-up">▲ +${diff.toFixed(1)}</span>`;
                statusText = 'Em Evolução';
            } else if (diff < -0.09) {
                trendHtml  = `<span class="trend-down">▼ ${diff.toFixed(1)}</span>`;
                statusText = 'Atenção';
            }
        }

        const badgeClass = latestScore >= 7 ? 'score-high' : latestScore >= 5 ? 'score-mid' : 'score-low';
        const rank       = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}º`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rank} <strong>${name}</strong></td>
            <td><span class="score-badge ${badgeClass}">${latestScore} / 10</span></td>
            <td>${trendHtml}</td>
            <td>${statusText}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderIndividualCharts() {
    const selected = document.getElementById('engSelect').value;
    const wrapper  = document.getElementById('chartWrapper');

    if (!selected || !dashboardData[selected]) {
        wrapper.style.display = 'none';
        return;
    }
    wrapper.style.display = 'block';

    if (chartInstances['line'])  { chartInstances['line'].destroy();  chartInstances['line']  = null; }
    if (chartInstances['radar']) { chartInstances['radar'].destroy(); chartInstances['radar'] = null; }

    const feedbacks = dashboardData[selected];
    const labels    = feedbacks.map(f => new Date(f.date_created).toLocaleDateString('pt-BR'));

    chartInstances['line'] = new Chart(
        document.getElementById('lineChart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Execução',      data: feedbacks.map(f => f.execution_score),     borderColor: '#3674ef', backgroundColor: 'rgba(54,116,239,0.12)', tension: 0.35, fill: true, pointBackgroundColor: '#3674ef', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 6, pointHoverRadius: 9, borderWidth: 2.5 },
                { label: 'Comunicação',   data: feedbacks.map(f => f.communication_score),  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)',  tension: 0.35, fill: true, pointBackgroundColor: '#10b981', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 6, pointHoverRadius: 9, borderWidth: 2.5 },
                { label: 'Nota Composta', data: feedbacks.map(f => parseFloat(compositeScore(f))), borderColor: '#f59e0b', backgroundColor: 'transparent', tension: 0.35, fill: false, pointBackgroundColor: '#f59e0b', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 8, borderWidth: 2, borderDash: [6,4] }
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: { min: 0, max: 10, ticks: { stepSize: 2 }, grid: { color: 'rgba(0,0,0,0.04)' } },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}` } }
            }
        }
    });

    const latest   = feedbacks[feedbacks.length - 1];
    const previous = feedbacks.length > 1 ? feedbacks[feedbacks.length - 2] : null;
    const mapM     = fb => [fb.dev_score, fb.maintain_score, fb.checklist_score, fb.study_score, fb.ownership_score, fb.cultural_score];

    const radarDatasets = [{
        label: `Última (${new Date(latest.date_created).toLocaleDateString('pt-BR')})`,
        data: mapM(latest),
        backgroundColor: 'rgba(54,116,239,0.3)',
        borderColor: '#3674ef',
        borderWidth: 2,
        pointBackgroundColor: '#3674ef',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5
    }];

    if (previous) {
        radarDatasets.push({
            label: `Anterior (${new Date(previous.date_created).toLocaleDateString('pt-BR')})`,
            data: mapM(previous),
            backgroundColor: 'rgba(16,185,129,0.1)',
            borderColor: '#10b981',
            borderWidth: 2,
            borderDash: [5,5],
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 5
        });
    }

    chartInstances['radar'] = new Chart(
        document.getElementById('radarChart').getContext('2d'), {
        type: 'radar',
        data: { labels: ['Desenvolver','Manter','Checklist','Estudo','Ownership','Cultura'], datasets: radarDatasets },
        options: {
            responsive: true,
            scales: {
                r: {
                    min: 0, max: 5,
                    ticks: { stepSize: 1, font: { size: 11 } },
                    pointLabels: { font: { size: 13, weight: '600' } },
                    grid: { color: 'rgba(0,0,0,0.06)' }
                }
            },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw} / 5` } }
            }
        }
    });
}

// ══════════════════════════════════════════════════════════════════
// MATRIZ DE COMPETÊNCIA
// ══════════════════════════════════════════════════════════════════

async function loadCycleList() {
    const isPriv = currentUser && ['admin','gestor'].includes(currentUser.role);
    if (!isPriv) return;

    const select = document.getElementById('matrix-cycle-select');
    if (!select) return;

    try {
        const res = await apiFetch('/api/competencies/cycles');
        const cycles = await res.json();
        
        const currentVal = select.value;
        select.innerHTML = cycles.map(c => 
            `<option value="${c.id}" ${c.is_active ? 'style="font-weight:bold; color:var(--primary-color);"' : ''}>
                ${c.name} ${c.is_active ? '(Ativo)' : ''}
            </option>`
        ).join('');

        if (currentVal && cycles.find(c => c.id == currentVal)) {
            select.value = currentVal;
        }
    } catch (e) {
        console.error('Erro ao carregar ciclos', e);
    }
}

async function loadMatrix(cycleId = null) {
    const isPriv = currentUser && ['admin','gestor'].includes(currentUser.role);
    
    if (isPriv) await loadCycleList();

    try {
        let url = '/api/competencies';
        if (cycleId) url += `?cycle_id=${cycleId}`;
        
        const res = await apiFetch(url);
        matrixData = await res.json();
    } catch (e) {
        if (e.message !== 'Sessão expirada') {
            document.getElementById('matrix-cycle-label').textContent = 'Erro ao carregar dados.';
        }
        return;
    }

    const cycleLabel = matrixData.is_active ? `Ciclo Ativo: ${matrixData.cycle_name}` : `Histórico: ${matrixData.cycle_name} (Encerrado)`;
    document.getElementById('matrix-cycle-label').textContent = cycleLabel;

    document.getElementById('matrix-admin-bar').style.display  = isPriv ? 'flex' : 'none';
    document.getElementById('matrix-priv-view').style.display  = isPriv ? 'block' : 'none';
    document.getElementById('matrix-user-view').style.display  = isPriv ? 'none' : 'block';

    if (isPriv && (isAdmin || currentUser.role === 'gestor')) {
        const btnDel = document.getElementById('btn-delete-cycle');
        if (btnDel) btnDel.style.display = 'inline-block';
    }
    if (isPriv && isAdmin) {
        document.getElementById('btn-reset-matrix').style.display = 'inline-block';
    }

    // Sincronizar o select com o ciclo carregado (caso tenha sido carregado o default ativo)
    const cycleSelect = document.getElementById('matrix-cycle-select');
    if (isPriv && cycleSelect && !cycleId) {
        cycleSelect.value = matrixData.cycle_id;
    }

    // Inicializar rascunho com scores salvos no servidor
    if (!isPriv && matrixData.my_scores) {
        matrixDraftScores = { ...matrixData.my_scores };
    }

    if (isPriv) renderMatrixPriv();
    else        renderMatrixUser();
}

// ─── Visão Admin/Gestor ───────────────────────────────────────────
function heatClass(avg, target) {
    if (avg === null || avg === undefined) return 'heat-none';
    if (avg >= target)           return 'heat-green';
    if (avg >= target - 0.5)     return 'heat-yellow';
    return 'heat-red';
}

function scoreChip(score) {
    if (score === null || score === undefined) return '<span class="score-chip sn">—</span>';
    const cls = ['s0','s1','s2','s3'][score] || 'sn';
    return `<span class="score-chip ${cls}">${score}</span>`;
}

function renderMatrixPriv() {
    const defs         = matrixData.definitions || [];
    const participants = matrixData.participants || [];
    const thead        = document.getElementById('matrix-full-thead');
    const tbody        = document.getElementById('matrix-full-tbody');
    const emptyState   = document.getElementById('matrix-empty-state');
    const isAdmin      = currentUser.role === 'admin';
    const isPriv       = ['admin','gestor'].includes(currentUser.role);

    if (defs.length === 0) {
        tbody.innerHTML = '';
        thead.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    thead.innerHTML = '';
    const headerTr = document.createElement('tr');
    
    let headerCols = `
        <th style="min-width:140px;">Categoria</th>
        <th style="min-width:260px;">Competência</th>
        <th style="width:55px;">Docs</th>
        <th style="width:100px; text-align:center;">Target</th>
        ${participants.map(e => `<th style="min-width:80px; text-align:center;" title="${e}">${e.split('@')[0]}</th>`).join('')}
        <th class="avg-col">Média</th>
    `;
    
    if (isPriv && matrixData.is_active) {
        headerCols += '<th style="width:40px;"></th>';
    }
    
    headerTr.innerHTML = headerCols;
    thead.appendChild(headerTr);

    // Agrupar por categoria para mostrar rowspan
    let rows = '';
    let lastCat = null;
    defs.forEach(def => {
        const canEdit = isPriv && matrixData.is_active;
        
        // Inline Edit for Category
        const catValue = def.category !== lastCat ? def.category : '↳';
        const catDisplay = canEdit && def.category !== lastCat
            ? `<input class="matrix-input-cell" value="${def.category}" 
                onblur="updateCompField(${def.id}, 'category', this.value)">`
            : `<span style="${def.category !== lastCat ? '' : 'opacity:0.3;font-size:0.75rem;'}">${catValue}</span>`;

        // Inline Edit for Sub-category
        const subDisplay = canEdit
            ? `<input class="matrix-input-cell" value="${def.sub_category}" 
                onblur="updateCompField(${def.id}, 'sub_category', this.value)">`
            : def.sub_category;

        // Inline Edit for Target
        const targetSel = canEdit
            ? `<select class="target-select" onchange="updateTarget(${def.id}, this.value)">
                ${[0,1,2,3].map(v => `<option value="${v}" ${v===def.target_score?'selected':''}>${v}</option>`).join('')}
               </select>`
            : `<strong style="display:block; text-align:center;">${def.target_score}</strong>`;

        // Inline Edit for Docs
        const docsInput = canEdit
            ? `<input class="matrix-input-cell" placeholder="Link Docs" value="${def.support_docs || ''}" 
                onblur="updateCompField(${def.id}, 'support_docs', this.value)" style="text-align:center;">`
            : (def.support_docs ? `<a href="${def.support_docs}" target="_blank" class="docs-link">↗</a>` : '—');

        const userScores = participants.map(email => {
            const score = (def.scores_by_user || {})[email];
            return `<td style="text-align:center;">${scoreChip(score !== undefined ? score : null)}</td>`;
        }).join('');

        const avg    = def.avg_score;
        const hClass = heatClass(avg, def.target_score);
        const avgTxt = avg !== null ? avg.toFixed(1) : '—';

        // Trend Arrow
        let arrow = '';
        if (avg !== null) {
            if (avg < def.target_score) arrow = '<span class="trend-arrow trend-down">↓</span>';
            else if (avg > def.target_score) arrow = '<span class="trend-arrow trend-up">↑</span>';
        }

        const delBtn = canEdit
            ? `<td><button class="btn-del-comp" onclick="deleteCompetency(${def.id})" title="Excluir">✕</button></td>`
            : '';

        rows += `<tr>
            <td class="matrix-cat-cell">${catDisplay}</td>
            <td>${subDisplay}</td>
            <td style="text-align:center;">${docsInput}</td>
            <td style="text-align:center;">
                <div style="display:flex; align-items:center; justify-content:center;">
                    ${targetSel} ${arrow}
                </div>
            </td>
            ${userScores}
            <td class="avg-col ${hClass}">${avgTxt}</td>
            ${delBtn ? delBtn : (isPriv ? '<td></td>' : '')}
        </tr>`;

        lastCat = def.category;
    });
    tbody.innerHTML = rows;
}

// ─── Visão Engenheiro ─────────────────────────────────────────────
function renderMatrixUser() {
    const defs      = matrixData.definitions || [];
    const submitted = matrixData.user_submitted;
    const tbody     = document.getElementById('matrix-user-tbody');
    const banner    = document.getElementById('matrix-submitted-banner');
    const actions   = document.getElementById('matrix-user-actions');

    banner.style.display  = submitted ? 'flex' : 'none';
    actions.style.display = submitted ? 'none' : 'flex';

    if (defs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma competência cadastrada ainda.</td></tr>';
        return;
    }

    let rows = '';
    let lastCat = null;
    defs.forEach(def => {
        const catCell = def.category !== lastCat
            ? `<td class="matrix-cat-cell">${def.category}</td>`
            : `<td class="matrix-cat-cell" style="opacity:0.3;font-size:0.75rem;">↳</td>`;
        lastCat = def.category;

        const docsLink = def.support_docs
            ? `<a href="${def.support_docs}" target="_blank" class="docs-link">↗</a>`
            : `<span style="color:#d1d5db">—</span>`;

        const currentScore = matrixDraftScores[def.id] !== undefined ? matrixDraftScores[def.id] : null;
        const lockedAttr   = submitted ? 'class="locked"' : '';
        const disabledAttr = submitted ? 'disabled' : '';

        const radios = [3, 2, 1, 0].map(v => {
            const checked   = currentScore === v ? 'checked' : '';
            const rbClass   = `rb${v}`;
            return `<label class="score-radio-label ${submitted ? 'locked' : ''}" title="Nota ${v}">
                <input type="radio" name="score_${def.id}" value="${v}" ${checked} ${disabledAttr}
                    onchange="onScoreChange(${def.id}, ${v})">
                <span class="radio-btn ${rbClass}">${v}</span>
            </label>`;
        }).join('');

        rows += `<tr>
            ${catCell}
            <td>${def.sub_category}</td>
            <td style="text-align:center;">${docsLink}</td>
            <td><div class="score-radios">${radios}</div></td>
        </tr>`;
    });
    tbody.innerHTML = rows;
}

function onScoreChange(compId, score) {
    matrixDraftScores[compId] = score;
}

async function saveMatrixDraft() {
    const msgEl = document.getElementById('matrix-save-msg');
    msgEl.className = 'status-msg';
    msgEl.textContent = '';

    try {
        const res  = await apiFetch('/api/competencies/scores', {
            method: 'POST',
            body: JSON.stringify({ scores: matrixDraftScores })
        });
        const data = await res.json();
        if (res.ok) {
            msgEl.classList.add('success');
            msgEl.textContent = 'Rascunho salvo!';
        } else {
            msgEl.classList.add('error');
            msgEl.textContent = data.error || 'Erro ao salvar';
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') {
            msgEl.classList.add('error');
            msgEl.textContent = 'Erro de rede';
        }
    }
}

async function deleteSelectedCycle() {
    const cycleSelect = document.getElementById('matrix-cycle-select');
    const cycleId = cycleSelect.value;
    const cycleName = cycleSelect.options[cycleSelect.selectedIndex].text;

    if (!cycleId) {
        alert('Selecione um ciclo para excluir.');
        return;
    }

    if (!confirm(`TEM CERTEZA que deseja excluir o ciclo "${cycleName}"?\n\nISSO APAGARÁ TODAS AS AVALIAÇÕES E SCORES DESTE CICLO DE FORMA DEFINITIVA!`)) return;
    if (!confirm(`CONFIRMAÇÃO FINAL: Excluir permanentemente o ciclo "${cycleName}"?`)) return;

    try {
        const res = await apiFetch(`/api/competencies/cycle/${cycleId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            alert('Ciclo excluído com sucesso.');
            // Se excluiu o ativo, matrixData.is_active será afetado no próximo load
            loadMatrix(); 
            loadCycleList(); // Atualizar o dropdown
        } else {
            alert(data.error || 'Erro ao excluir ciclo');
        }
    } catch (e) {
        console.error('Erro ao excluir ciclo:', e);
    }
}

async function submitMatrix() {
    const msgEl = document.getElementById('matrix-save-msg');
    console.log('[Submit] Iniciando submissão...', { matrixDraftScores });

    const scoreCount = Object.keys(matrixDraftScores).length;
    if (scoreCount === 0) {
        alert('Por favor, preencha pelo menos uma competência antes de submeter.');
        return;
    }

    if (!confirm('Ao submeter, sua avaliação ficará bloqueada até o próximo ciclo. Confirmar?')) return;

    // Primeiro salvar rascunho
    try {
        console.log('[Submit] Salvando rascunho antes da submissão definitiva...');
        const saveRes = await apiFetch('/api/competencies/scores', {
            method: 'POST',
            body: JSON.stringify({ scores: matrixDraftScores })
        });
        if (!saveRes.ok) {
            const d = await saveRes.json();
            msgEl.className = 'status-msg error';
            msgEl.textContent = d.error || 'Erro ao salvar rascunho';
            console.error('[Submit] Erro ao salvar rascunho:', d);
            return;
        }
    } catch (e) {
        console.error('[Submit] Erro de rede ao salvar rascunho:', e);
        if (e.message !== 'Sessão expirada') {
            msgEl.className = 'status-msg error';
            msgEl.textContent = 'Erro de rede ao salvar';
        }
        return;
    }

    // Depois submeter
    try {
        console.log('[Submit] Chamando endpoint de submissão definitiva...');
        const res  = await apiFetch('/api/competencies/submit', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            console.log('[Submit] Sucesso!');
            alert('Avaliação submetida com sucesso!');
            loadMatrix();
        } else {
            console.error('[Submit] Erro no endpoint de submissão:', data);
            msgEl.className = 'status-msg error';
            msgEl.textContent = data.error || 'Erro ao submeter';
        }
    } catch (e) {
        console.error('[Submit] Erro de rede na submissão:', e);
        if (e.message !== 'Sessão expirada') {
            msgEl.className = 'status-msg error';
            msgEl.textContent = 'Erro de rede';
        }
    }
}

// ─── Ações Admin ──────────────────────────────────────────────────
async function updateTarget(defId, newTarget) {
    try {
        const res = await apiFetch(`/api/competencies/definitions/${defId}`, {
            method: 'PATCH',
            body: JSON.stringify({ target_score: parseInt(newTarget) })
        });
        if (!res.ok) {
            const d = await res.json();
            alert(d.error || 'Erro ao atualizar target');
            loadMatrix();
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') { alert('Erro de rede'); loadMatrix(); }
    }
}

async function deleteCompetency(defId) {
    if (!confirm('Excluir esta competência? Todos os scores associados também serão removidos.')) return;
    try {
        const res  = await apiFetch(`/api/competencies/definitions/${defId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) loadMatrix();
        else alert(data.error || 'Erro ao excluir');
    } catch (e) {
        if (e.message !== 'Sessão expirada') alert('Erro de rede');
    }
}

async function updateCompField(defId, field, value) {
    const payload = {};
    payload[field] = value;
    try {
        const res = await apiFetch(`/api/competencies/definitions/${defId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const d = await res.json();
            console.error(d.error || 'Erro ao atualizar campo');
            loadMatrix();
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') loadMatrix();
    }
}

async function resetMatrixHistory() {
    if (!confirm('ATENÇÃO: Isso apagará TODOS os ciclos e avaliações submetidas até agora. As definições de competências serão mantidas. Deseja continuar?')) return;
    if (!confirm('Tem certeza absoluta? Esta ação não pode ser desfeita.')) return;

    try {
        const res = await apiFetch('/api/competencies/reset', { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            alert('Histórico resetado com sucesso.');
            loadMatrix();
        } else {
            alert(data.error || 'Erro ao resetar histórico');
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') alert('Erro de rede');
    }
}

// ─── Modais ───────────────────────────────────────────────────────
function openNewCycleModal() {
    document.getElementById('new-cycle-name').value = '';
    document.getElementById('modal-cycle-msg').style.display = 'none';
    document.getElementById('modal-new-cycle').style.display = 'flex';
}

function openAddCompetencyModal() {
    ['new-comp-category','new-comp-subcategory','new-comp-docs'].forEach(id =>
        document.getElementById(id).value = ''
    );
    document.getElementById('new-comp-target').value = '2';
    document.getElementById('modal-comp-msg').style.display = 'none';
    document.getElementById('modal-add-competency').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// Fechar modal clicando fora
document.addEventListener('click', (e) => {
    ['modal-new-cycle','modal-add-competency'].forEach(id => {
        const el = document.getElementById(id);
        if (el && e.target === el) closeModal(id);
    });
});

async function doNewCycle() {
    const name  = document.getElementById('new-cycle-name').value.trim();
    const msgEl = document.getElementById('modal-cycle-msg');
    msgEl.style.display = 'none';
    msgEl.className     = 'auth-msg';

    if (!name) {
        msgEl.textContent   = 'Informe o nome do ciclo.';
        msgEl.classList.add('error');
        msgEl.style.display = 'block';
        return;
    }
    try {
        const res  = await apiFetch('/api/competencies/cycle/new', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-new-cycle');
            matrixDraftScores = {};
            loadMatrix();
        } else {
            msgEl.textContent   = data.error || 'Erro ao criar ciclo';
            msgEl.classList.add('error');
            msgEl.style.display = 'block';
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') {
            msgEl.textContent   = 'Erro de rede';
            msgEl.classList.add('error');
            msgEl.style.display = 'block';
        }
    }
}

async function doAddCompetency() {
    const category    = document.getElementById('new-comp-category').value.trim();
    const sub_category= document.getElementById('new-comp-subcategory').value.trim();
    const support_docs= document.getElementById('new-comp-docs').value.trim();
    const target_score= parseInt(document.getElementById('new-comp-target').value);
    const msgEl       = document.getElementById('modal-comp-msg');
    msgEl.style.display = 'none';
    msgEl.className     = 'auth-msg';

    if (!category || !sub_category) {
        msgEl.textContent   = 'Categoria e competência são obrigatórias.';
        msgEl.classList.add('error');
        msgEl.style.display = 'block';
        return;
    }
    try {
        const res  = await apiFetch('/api/competencies/definitions', {
            method: 'POST',
            body: JSON.stringify({ category, sub_category, support_docs, target_score })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-add-competency');
            loadMatrix();
        } else {
            msgEl.textContent   = data.error || 'Erro ao adicionar';
            msgEl.classList.add('error');
            msgEl.style.display = 'block';
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') {
            msgEl.textContent   = 'Erro de rede';
            msgEl.classList.add('error');
            msgEl.style.display = 'block';
        }
    }
}

async function seedFromExcel() {
    if (!confirm('Importar competências do arquivo Excel? Itens já cadastrados não serão duplicados.')) return;
    try {
        const res  = await apiFetch('/api/competencies/seed', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(`Importação concluída! ${data.inserted} competências adicionadas.`);
            loadMatrix();
        } else {
            alert(data.error || 'Erro ao importar');
        }
    } catch (e) {
        if (e.message !== 'Sessão expirada') alert('Erro de rede');
    }
}

// ══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});
