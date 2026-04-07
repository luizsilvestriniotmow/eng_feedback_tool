import os
import json
import random
import smtplib
import datetime
from functools import wraps
from email.message import EmailMessage
from flask import Flask, request, jsonify, send_file, send_from_directory, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import database
import pdf_generator
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_url_path='', static_folder='static')
CORS(app, supports_credentials=True)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'otmow-dev-secret-mude-em-prod')
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(minutes=5)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

ALLOWED_DOMAIN = '@otmow.com'
ADMIN_EMAIL    = 'luiz@otmow.com'

# Ensure DB is initialized
database.init_db()

# ─── Decorators de autenticação ───────────────────────────────────────────────

def requires_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_email' not in session:
            return jsonify({"error": "Não autenticado"}), 401
        # Renovar sessão a cada request (sliding window de 5 min)
        session.modified = True
        return f(*args, **kwargs)
    return decorated

def requires_role(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if 'user_email' not in session:
                return jsonify({"error": "Não autenticado"}), 401
            if session.get('user_role') not in roles:
                return jsonify({"error": "Sem permissão para esta ação"}), 403
            session.modified = True
            return f(*args, **kwargs)
        return decorated
    return decorator

# ─── Helper de e-mail ─────────────────────────────────────────────────────────

def send_email(to, subject, body):
    sender_email    = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")
    if not sender_email or not sender_password:
        raise ValueError("Configuração de e-mail ausente (.env)")
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From']    = sender_email
    msg['To']      = to
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(sender_email, sender_password)
        smtp.send_message(msg)

# ─── Rotas estáticas ──────────────────────────────────────────────────────────

@app.route('/')
def serve_index():
    return send_from_directory('static', 'index.html')

# ─── Autenticação ─────────────────────────────────────────────────────────────

@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    if 'user_email' not in session:
        return jsonify({"error": "Não autenticado"}), 401
    session.modified = True
    return jsonify({
        "email": session['user_email'],
        "role":  session['user_role']
    })

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data  = request.json or {}
    email = (data.get('email') or '').strip().lower()
    pwd   = data.get('password', '')

    if ALLOWED_DOMAIN not in email:
        return jsonify({"error": f"Apenas e-mails {ALLOWED_DOMAIN} são permitidos"}), 403

    conn = database.get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    if not user:
        return jsonify({"error": "E-mail não cadastrado no sistema"}), 404

    user = dict(user)

    if not user.get('password_hash'):
        return jsonify({"error": "Senha não definida. Use 'Primeiro acesso' para criar sua senha.", "needs_setup": True}), 401

    if not check_password_hash(user['password_hash'], pwd):
        return jsonify({"error": "Senha incorreta"}), 401

    session.permanent = True
    session['user_email'] = user['email']
    session['user_role']  = user['role']

    return jsonify({"success": True, "email": user['email'], "role": user['role']})

@app.route('/api/auth/request-code', methods=['POST'])
def auth_request_code():
    data  = request.json or {}
    email = (data.get('email') or '').strip().lower()

    if ALLOWED_DOMAIN not in email:
        return jsonify({"error": f"Apenas e-mails {ALLOWED_DOMAIN} são permitidos"}), 403

    conn = database.get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user:
        conn.close()
        return jsonify({"error": "E-mail não cadastrado no sistema"}), 404

    code    = str(random.randint(100000, 999999))
    expiry  = (datetime.datetime.utcnow() + datetime.timedelta(minutes=15)).strftime('%Y-%m-%d %H:%M:%S')

    conn.execute(
        "UPDATE users SET verification_code = ?, code_expiry = ? WHERE email = ?",
        (code, expiry, email)
    )
    conn.commit()
    conn.close()

    try:
        send_email(
            to=email,
            subject="Ótmow | Código de Verificação",
            body=(
                f"Seu código de verificação é: {code}\n\n"
                f"Este código expira em 15 minutos.\n\n"
                f"Se você não solicitou este código, ignore este e-mail.\n\n"
                f"Ótmow Engenharia"
            )
        )
    except Exception as e:
        return jsonify({"error": f"Falha ao enviar e-mail: {str(e)}"}), 500

    return jsonify({"success": True, "message": "Código enviado para o e-mail"})

@app.route('/api/auth/verify-and-set-password', methods=['POST'])
def auth_verify_and_set_password():
    data     = request.json or {}
    email    = (data.get('email') or '').strip().lower()
    code     = (data.get('code') or '').strip()
    new_pwd  = data.get('password', '')

    if not new_pwd or len(new_pwd) < 6:
        return jsonify({"error": "A senha deve ter pelo menos 6 caracteres"}), 400

    conn = database.get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user:
        conn.close()
        return jsonify({"error": "E-mail não encontrado"}), 404

    user = dict(user)

    if user.get('verification_code') != code:
        conn.close()
        return jsonify({"error": "Código inválido"}), 401

    expiry_str = user.get('code_expiry', '')
    if expiry_str:
        expiry = datetime.datetime.strptime(expiry_str, '%Y-%m-%d %H:%M:%S')
        if datetime.datetime.utcnow() > expiry:
            conn.close()
            return jsonify({"error": "Código expirado. Solicite um novo."}), 401

    hashed = generate_password_hash(new_pwd)
    conn.execute(
        "UPDATE users SET password_hash = ?, verification_code = NULL, code_expiry = NULL WHERE email = ?",
        (hashed, email)
    )
    conn.commit()
    conn.close()

    session.permanent = True
    session['user_email'] = email
    session['user_role']  = user['role']

    return jsonify({"success": True, "email": email, "role": user['role']})

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({"success": True})

# ─── Gerenciamento de Usuários ────────────────────────────────────────────────

@app.route('/api/users', methods=['GET'])
@requires_role('admin', 'gestor')
def list_users():
    conn  = database.get_db_connection()
    users = conn.execute(
        "SELECT id, email, role, password_hash IS NOT NULL AS has_password, created_at FROM users ORDER BY created_at ASC"
    ).fetchall()
    conn.close()
    return jsonify([dict(u) for u in users])

@app.route('/api/users', methods=['POST'])
@requires_role('admin', 'gestor')
def create_user():
    data  = request.json or {}
    email = (data.get('email') or '').strip().lower()
    role  = data.get('role', 'user')

    if ALLOWED_DOMAIN not in email:
        return jsonify({"error": f"Apenas e-mails {ALLOWED_DOMAIN} são permitidos"}), 403

    if role not in ('admin', 'gestor', 'user'):
        return jsonify({"error": "Role inválido"}), 400

    # Apenas admin pode criar outro admin
    if role == 'admin' and session.get('user_role') != 'admin':
        return jsonify({"error": "Apenas admins podem criar outros admins"}), 403

    conn = database.get_db_connection()
    try:
        conn.execute("INSERT INTO users (email, role) VALUES (?, ?)", (email, role))
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "E-mail já cadastrado"}), 409
    conn.close()
    return jsonify({"success": True}), 201

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@requires_role('admin')
def delete_user(user_id):
    conn = database.get_db_connection()
    user = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Usuário não encontrado"}), 404
    if dict(user)['email'] == ADMIN_EMAIL:
        conn.close()
        return jsonify({"error": "Não é possível remover o Admin Master"}), 403
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/users/<int:user_id>/reset-password', methods=['POST'])
@requires_role('admin')
def reset_user_password(user_id):
    conn = database.get_db_connection()
    user = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Usuário não encontrado"}), 404
    if dict(user)['email'] == ADMIN_EMAIL and session['user_email'] != ADMIN_EMAIL:
        conn.close()
        return jsonify({"error": "Sem permissão"}), 403
    conn.execute(
        "UPDATE users SET password_hash = NULL, verification_code = NULL, code_expiry = NULL WHERE id = ?",
        (user_id,)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/users/<int:user_id>/role', methods=['PATCH'])
@requires_role('admin')
def update_user_role(user_id):
    data = request.json or {}
    role = data.get('role', '')
    if role not in ('admin', 'gestor', 'user'):
        return jsonify({"error": "Role inválido"}), 400
    conn = database.get_db_connection()
    user = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Usuário não encontrado"}), 404
    if dict(user)['email'] == ADMIN_EMAIL:
        conn.close()
        return jsonify({"error": "Não é possível alterar o role do Admin Master"}), 403
    conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# ─── Feedbacks ────────────────────────────────────────────────────────────────

@app.route('/api/feedbacks', methods=['GET', 'POST'])
@requires_login
def manage_feedbacks():
    user_role  = session.get('user_role')
    user_email = session.get('user_email')

    if request.method == 'POST':
        # Apenas admin e gestor podem criar feedbacks
        if user_role not in ('admin', 'gestor'):
            return jsonify({"error": "Sem permissão"}), 403
        try:
            data = request.json
            conn = database.get_db_connection()
            cursor = conn.cursor()

            impacts_str          = json.dumps(data.get('impacts', []))
            execution_blocks_str = json.dumps(data.get('execution_blocks', []))
            is_draft             = 1 if data.get('is_draft') else 0

            cursor.execute('''
                INSERT INTO feedbacks (
                    engineer_name, engineer_email, cc_email, evaluator_name,
                    execution_text, impacts_json, execution_score,
                    communication_text, communication_score,
                    dev_text, dev_score,
                    maintain_text, maintain_score,
                    checklist_text, checklist_score,
                    study_text, study_score,
                    ownership_text, ownership_score,
                    cultural_text, cultural_score,
                    execution_blocks_json,
                    email_sent, is_draft
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data.get('engineer_name'), data.get('engineer_email'), data.get('cc_email'),
                data.get('evaluator_name'), data.get('execution_text'), impacts_str,
                data.get('execution_score'), data.get('communication_text'), data.get('communication_score'),
                data.get('dev_text'), data.get('dev_score'),
                data.get('maintain_text'), data.get('maintain_score'),
                data.get('checklist_text'), data.get('checklist_score'),
                data.get('study_text'), data.get('study_score'),
                data.get('ownership_text'), data.get('ownership_score'),
                data.get('cultural_text'), data.get('cultural_score'),
                execution_blocks_str,
                0, is_draft
            ))
            feedback_id = cursor.lastrowid
            conn.commit()
            conn.close()

            return jsonify({"success": True, "id": feedback_id, "message": "Feedback salvo com sucesso."}), 201

        except Exception as e:
            if 'conn' in locals() and conn:
                try: conn.close()
                except: pass
            return jsonify({"error": str(e)}), 500

    # GET
    conn = database.get_db_connection()
    if user_role == 'user':
        # Engenheiro vê apenas seus próprios feedbacks
        feedbacks = conn.execute(
            'SELECT id, engineer_name, evaluator_name, date_created, email_sent, is_draft FROM feedbacks WHERE engineer_email = ? ORDER BY date_created DESC',
            (user_email,)
        ).fetchall()
    else:
        feedbacks = conn.execute(
            'SELECT id, engineer_name, evaluator_name, date_created, email_sent, is_draft FROM feedbacks ORDER BY date_created DESC'
        ).fetchall()
    conn.close()
    return jsonify([dict(fw) for fw in feedbacks])

@app.route('/api/feedbacks/<int:feedback_id>', methods=['GET', 'PUT', 'DELETE'])
@requires_login
def handle_single_feedback(feedback_id):
    user_role  = session.get('user_role')
    user_email = session.get('user_email')
    conn = database.get_db_connection()

    if request.method == 'GET':
        fb = conn.execute('SELECT * FROM feedbacks WHERE id = ?', (feedback_id,)).fetchone()
        conn.close()
        if not fb:
            return jsonify({"error": "Not found"}), 404
        fb_dict = dict(fb)
        if user_role == 'user' and fb_dict.get('engineer_email') != user_email:
            return jsonify({"error": "Sem permissão"}), 403
        fb_dict['impacts'] = json.loads(fb_dict.get('impacts_json') or '[]')
        fb_dict['execution_blocks'] = json.loads(fb_dict.get('execution_blocks_json') or '[]')
        return jsonify(fb_dict)

    if request.method == 'PUT':
        if user_role not in ('admin', 'gestor'):
            conn.close()
            return jsonify({"error": "Sem permissão"}), 403
        try:
            data = request.json
            impacts_str          = json.dumps(data.get('impacts', []))
            execution_blocks_str = json.dumps(data.get('execution_blocks', []))
            is_draft             = 1 if data.get('is_draft') else 0

            conn.execute('''
                UPDATE feedbacks SET
                    engineer_name=?, engineer_email=?, cc_email=?, evaluator_name=?,
                    execution_text=?, impacts_json=?, execution_score=?,
                    communication_text=?, communication_score=?,
                    dev_text=?, dev_score=?,
                    maintain_text=?, maintain_score=?,
                    checklist_text=?, checklist_score=?,
                    study_text=?, study_score=?,
                    ownership_text=?, ownership_score=?,
                    cultural_text=?, cultural_score=?,
                    execution_blocks_json=?,
                    is_draft=?
                WHERE id=?
            ''', (
                data.get('engineer_name'), data.get('engineer_email'), data.get('cc_email'),
                data.get('evaluator_name'), data.get('execution_text'), impacts_str,
                data.get('execution_score'), data.get('communication_text'), data.get('communication_score'),
                data.get('dev_text'), data.get('dev_score'),
                data.get('maintain_text'), data.get('maintain_score'),
                data.get('checklist_text'), data.get('checklist_score'),
                data.get('study_text'), data.get('study_score'),
                data.get('ownership_text'), data.get('ownership_score'),
                data.get('cultural_text'), data.get('cultural_score'),
                execution_blocks_str,
                is_draft,
                feedback_id
            ))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "message": "Feedback atualizado com sucesso."}), 200
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500

    if request.method == 'DELETE':
        if user_role not in ('admin', 'gestor'):
            conn.close()
            return jsonify({"error": "Sem permissão"}), 403
        conn.execute('DELETE FROM feedbacks WHERE id = ?', (feedback_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True}), 200

@app.route('/api/feedbacks/<int:feedback_id>/send-email', methods=['POST'])
@requires_role('admin', 'gestor')
def send_feedback_email(feedback_id):
    conn = database.get_db_connection()
    fb   = conn.execute('SELECT * FROM feedbacks WHERE id = ?', (feedback_id,)).fetchone()
    if not fb:
        conn.close()
        return jsonify({"error": "Not found"}), 404

    fb_dict      = dict(fb)
    history_rows = conn.execute(
        'SELECT * FROM feedbacks WHERE engineer_name = ? ORDER BY date_created ASC',
        (fb_dict['engineer_name'],)
    ).fetchall()
    conn.close()

    fb_dict['history']          = [dict(h) for h in history_rows]
    fb_dict['impacts']          = json.loads(fb_dict.get('impacts_json') or '[]')
    fb_dict['execution_blocks'] = json.loads(fb_dict.get('execution_blocks_json') or '[]')

    pdf_filename = f"feedback_{feedback_id}.pdf"
    pdf_path     = os.path.join(os.path.dirname(__file__), pdf_filename)
    pdf_generator.generate_pdf(fb_dict, pdf_path)

    email_recipient = fb_dict.get('engineer_email')
    cc_email        = (fb_dict.get('cc_email') or '').strip()
    sender_email    = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")

    if not sender_email or not sender_password:
        return jsonify({"error": "Configuração de e-mail ausente (.env)"}), 500

    try:
        msg = EmailMessage()
        msg['Subject'] = f"Feedback de Avaliação - {fb_dict['evaluator_name']}"
        msg['From']    = sender_email
        msg['To']      = email_recipient
        if cc_email:
            msg['Cc'] = cc_email
        msg.set_content(
            f"Olá {fb_dict['engineer_name']},\n\n"
            "Segue em anexo o arquivo PDF com as anotações geradas no nosso último feedback.\n\n"
            "Atenciosamente,\n"
            f"{fb_dict['evaluator_name']}"
        )

        with open(pdf_path, 'rb') as f:
            pdf_data = f.read()
        msg.add_attachment(pdf_data, maintype='application', subtype='pdf', filename=f"feedback_{fb_dict['engineer_name']}.pdf")

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, sender_password)
            smtp.send_message(msg)

        conn = database.get_db_connection()
        conn.execute('UPDATE feedbacks SET email_sent = 1 WHERE id = ?', (feedback_id,))
        conn.commit()
        conn.close()

        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/feedbacks/<int:feedback_id>/pdf', methods=['GET'])
@requires_login
def get_pdf(feedback_id):
    user_role  = session.get('user_role')
    user_email = session.get('user_email')

    conn = database.get_db_connection()
    fb   = conn.execute('SELECT * FROM feedbacks WHERE id = ?', (feedback_id,)).fetchone()
    if not fb:
        conn.close()
        return "Not found", 404

    fb_dict = dict(fb)

    # Engenheiro só pode baixar seu próprio PDF
    if user_role == 'user' and fb_dict.get('engineer_email') != user_email:
        conn.close()
        return "Sem permissão", 403

    history_rows = conn.execute(
        'SELECT * FROM feedbacks WHERE engineer_name = ? AND date_created <= ? ORDER BY date_created ASC',
        (fb_dict['engineer_name'], fb_dict['date_created'])
    ).fetchall()
    conn.close()

    fb_dict['history']          = [dict(h) for h in history_rows]
    fb_dict['impacts']          = json.loads(fb_dict.get('impacts_json') or '[]')
    fb_dict['execution_blocks'] = json.loads(fb_dict.get('execution_blocks_json') or '[]')

    temp_path = os.path.join(os.path.dirname(__file__), f"temp_dl_{feedback_id}.pdf")
    pdf_generator.generate_pdf(fb_dict, temp_path)
    return send_file(temp_path, as_attachment=True, download_name=f"feedback_{fb_dict['engineer_name']}.pdf")

@app.route('/api/dashboard', methods=['GET'])
@requires_login
def get_dashboard():
    user_role  = session.get('user_role')
    user_email = session.get('user_email')

    conn = database.get_db_connection()
    if user_role == 'user':
        rows = conn.execute(
            'SELECT * FROM feedbacks WHERE engineer_email = ? ORDER BY date_created ASC',
            (user_email,)
        ).fetchall()
    else:
        rows = conn.execute('SELECT * FROM feedbacks ORDER BY date_created ASC').fetchall()
    conn.close()

    data = {}
    for r in rows:
        eng = r['engineer_name']
        if eng not in data:
            data[eng] = []
        data[eng].append(dict(r))

    return jsonify(data)

# ─── Matriz de Competência ────────────────────────────────────────────────────

@app.route('/api/competencies/cycles', methods=['GET'])
@requires_login
def get_competency_cycles():
    """Retorna a lista de todos os ciclos de competência."""
    conn = database.get_db_connection()
    cycles = conn.execute("SELECT * FROM competency_cycles ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([dict(c) for c in cycles])


@app.route('/api/competencies', methods=['GET'])
@requires_login
def get_competencies():
    user_role  = session.get('user_role')
    user_email = session.get('user_email')
    is_priv    = user_role in ('admin', 'gestor')

    conn = database.get_db_connection()

    # Ciclo
    req_cycle_id = request.args.get('cycle_id')
    if req_cycle_id:
        cycle = conn.execute(
            "SELECT * FROM competency_cycles WHERE id = ?", (req_cycle_id,)
        ).fetchone()
    else:
        cycle = conn.execute(
            "SELECT * FROM competency_cycles WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()

    if not cycle:
        conn.close()
        return jsonify({"error": "Nenhum ciclo ativo. Crie um novo ciclo para começar."}), 404
        
    cycle_id   = cycle['id']
    cycle_name = cycle['name']
    is_active  = cycle['is_active'] == 1

    # Definições
    defs = [dict(d) for d in conn.execute(
        "SELECT * FROM competency_matrix_defs ORDER BY order_index ASC"
    ).fetchall()]

    # Verificar se o usuário atual já submeteu
    sub = conn.execute(
        "SELECT submitted_at FROM competency_submissions WHERE cycle_id=? AND user_email=?",
        (cycle_id, user_email)
    ).fetchone()
    user_submitted = sub is not None

    if is_priv:
        # Scores de todos os usuários
        all_scores = conn.execute('''
            SELECT cus.user_email, cus.competency_id, cus.score,
                   cs.submitted_at
            FROM competency_user_scores cus
            LEFT JOIN competency_submissions cs
                ON cs.cycle_id = cus.cycle_id AND cs.user_email = cus.user_email
            WHERE cus.cycle_id = ?
        ''', (cycle_id,)).fetchall()

        # Usuários que participaram do ciclo
        participants = conn.execute('''
            SELECT DISTINCT u.email
            FROM competency_submissions cs
            JOIN users u ON u.email = cs.user_email
            WHERE cs.cycle_id = ?
        ''', (cycle_id,)).fetchall()
        participant_emails = [p['email'] for p in participants]

        # Montar mapa {competency_id: {email: score}}
        score_map = {}
        for s in all_scores:
            cid = s['competency_id']
            if cid not in score_map:
                score_map[cid] = {}
            score_map[cid][s['user_email']] = s['score']

        # Calcular médias
        for d in defs:
            cid    = d['id']
            scores = list(score_map.get(cid, {}).values())
            d['scores_by_user'] = score_map.get(cid, {})
            d['avg_score']      = round(sum(scores) / len(scores), 2) if scores else None

        conn.close()
        return jsonify({
            "cycle_id":     cycle_id,
            "cycle_name":   cycle_name,
            "is_active":    is_active,
            "definitions":  defs,
            "participants": participant_emails,
            "is_privileged": True
        })
    else:
        # Scores do próprio usuário no ciclo ativo
        my_scores = {s['competency_id']: s['score'] for s in conn.execute(
            "SELECT competency_id, score FROM competency_user_scores WHERE cycle_id=? AND user_email=?",
            (cycle_id, user_email)
        ).fetchall()}

        conn.close()
        return jsonify({
            "cycle_id":      cycle_id,
            "cycle_name":    cycle_name,
            "is_active":     is_active,
            "definitions":   defs,
            "my_scores":     my_scores,
            "user_submitted": user_submitted,
            "is_privileged": False
        })


@app.route('/api/competencies/scores', methods=['POST'])
@requires_login
def save_competency_scores():
    """Salva/atualiza scores do usuário logado (draft — não bloqueia ainda)."""
    user_email = session.get('user_email')
    data       = request.json or {}
    scores     = data.get('scores', {})   # {competency_id: score}

    conn = database.get_db_connection()
    cycle = conn.execute(
        "SELECT id FROM competency_cycles WHERE is_active=1 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not cycle:
        conn.close()
        return jsonify({"error": "Nenhum ciclo ativo"}), 400
    cycle_id = cycle['id']

    # Verificar se já submeteu (bloqueado)
    sub = conn.execute(
        "SELECT 1 FROM competency_submissions WHERE cycle_id=? AND user_email=?",
        (cycle_id, user_email)
    ).fetchone()
    if sub:
        conn.close()
        return jsonify({"error": "Você já submeteu a avaliação neste ciclo. Aguarde o próximo ciclo."}), 409

    for comp_id_str, score in scores.items():
        comp_id = int(comp_id_str)
        score   = max(0, min(3, int(score)))
        conn.execute('''
            INSERT INTO competency_user_scores (cycle_id, user_email, competency_id, score, last_updated)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(cycle_id, user_email, competency_id)
            DO UPDATE SET score=excluded.score, last_updated=excluded.last_updated
        ''', (cycle_id, user_email, comp_id, score))

    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route('/api/competencies/submit', methods=['POST'])
@requires_login
def submit_competency():
    """Submete e bloqueia a avaliação do usuário para o ciclo atual."""
    user_email = session.get('user_email')

    conn = database.get_db_connection()
    cycle = conn.execute(
        "SELECT id FROM competency_cycles WHERE is_active=1 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not cycle:
        conn.close()
        return jsonify({"error": "Nenhum ciclo ativo"}), 400
    cycle_id = cycle['id']

    # Verificar se há pelo menos um score
    count = conn.execute(
        "SELECT COUNT(*) FROM competency_user_scores WHERE cycle_id=? AND user_email=?",
        (cycle_id, user_email)
    ).fetchone()[0]
    if count == 0:
        conn.close()
        return jsonify({"error": "Preencha pelo menos uma competência antes de submeter."}), 400

    try:
        conn.execute(
            "INSERT INTO competency_submissions (cycle_id, user_email) VALUES (?, ?)",
            (cycle_id, user_email)
        )
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "Você já submeteu neste ciclo."}), 409

    conn.close()
    return jsonify({"success": True})


@app.route('/api/competencies/cycle/new', methods=['POST'])
@requires_role('admin', 'gestor')
def new_cycle():
    """Abre um novo ciclo de avaliação, desativando o anterior."""
    data = request.json or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"error": "Informe o nome do novo ciclo"}), 400

    conn = database.get_db_connection()
    conn.execute("UPDATE competency_cycles SET is_active=0")
    conn.execute(
        "INSERT INTO competency_cycles (name, is_active) VALUES (?, 1)",
        (name,)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route('/api/competencies/reset', methods=['DELETE'])
@requires_role('admin')
def reset_competencies():
    """Limpa todo o histórico de ciclos e scores, preservando as definições."""
    conn = database.get_db_connection()
    try:
        conn.execute("DELETE FROM competency_submissions")
        conn.execute("DELETE FROM competency_user_scores")
        conn.execute("DELETE FROM competency_cycles")
        # Criar ciclo inicial limpo
        conn.execute("INSERT INTO competency_cycles (name, is_active) VALUES ('Ciclo 1', 1)")
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route('/api/competencies/cycle/<int:cycle_id>', methods=['DELETE'])
@requires_role('admin', 'gestor')
def delete_cycle(cycle_id):
    """Exclui um ciclo específico e todos os seus dados."""
    conn = database.get_db_connection()
    try:
        # Verificar se é o único ciclo
        count = conn.execute("SELECT COUNT(*) FROM competency_cycles").fetchone()[0]
        if count <= 1:
            return jsonify({"error": "Não é possível excluir o único ciclo do sistema."}), 400

        # Excluir dados vinculados
        conn.execute("DELETE FROM competency_submissions WHERE cycle_id = ?", (cycle_id,))
        conn.execute("DELETE FROM competency_user_scores WHERE cycle_id = ?", (cycle_id,))
        conn.execute("DELETE FROM competency_cycles WHERE id = ?", (cycle_id,))
        
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route('/api/competencies/definitions', methods=['POST'])
@requires_role('admin', 'gestor')
def add_competency_definition():
    """Adiciona uma nova competência à matriz."""
    data       = request.json or {}
    category   = (data.get('category') or '').strip()
    sub_cat    = (data.get('sub_category') or '').strip()
    docs       = (data.get('support_docs') or '').strip()
    target     = max(0, min(3, int(data.get('target_score', 2))))

    if not category or not sub_cat:
        return jsonify({"error": "Categoria e sub-categoria são obrigatórias"}), 400

    conn = database.get_db_connection()
    max_idx = conn.execute("SELECT COALESCE(MAX(order_index),0) FROM competency_matrix_defs").fetchone()[0]
    conn.execute(
        "INSERT INTO competency_matrix_defs (category, sub_category, support_docs, target_score, order_index) VALUES (?,?,?,?,?)",
        (category, sub_cat, docs, target, max_idx + 1)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True}), 201


@app.route('/api/competencies/definitions/<int:def_id>', methods=['PATCH', 'DELETE'])
@requires_role('admin', 'gestor')
def manage_competency_definition(def_id):
    if request.method == 'DELETE':
        conn = database.get_db_connection()
        conn.execute("DELETE FROM competency_user_scores WHERE competency_id=?", (def_id,))
        conn.execute("DELETE FROM competency_matrix_defs WHERE id=?", (def_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True})

    # PATCH: atualizar target_score (e opcionalmente outros campos)
    data   = request.json or {}
    fields, params = [], []

    if 'target_score' in data:
        fields.append("target_score=?")
        params.append(max(0, min(3, int(data['target_score']))))
    if 'category' in data:
        fields.append("category=?")
        params.append(data['category'].strip())
    if 'sub_category' in data:
        fields.append("sub_category=?")
        params.append(data['sub_category'].strip())
    if 'support_docs' in data:
        fields.append("support_docs=?")
        params.append(data['support_docs'].strip())

    if not fields:
        return jsonify({"error": "Nenhum campo para atualizar"}), 400

    params.append(def_id)
    conn = database.get_db_connection()
    conn.execute(f"UPDATE competency_matrix_defs SET {', '.join(fields)} WHERE id=?", params)
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route('/api/competencies/seed', methods=['POST'])
@requires_role('admin')
def seed_from_excel():
    """Popula as definições a partir do arquivo Excel."""
    excel_path = os.path.expanduser('~/Downloads/Team Competency Matrix.xlsx')
    if not os.path.exists(excel_path):
        return jsonify({"error": f"Arquivo não encontrado: {excel_path}"}), 404
    try:
        inserted = database.seed_competencies_from_excel(excel_path)
        return jsonify({"success": True, "inserted": inserted})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=True)
