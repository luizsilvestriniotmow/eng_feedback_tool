import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'feedbacks.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # ── Feedbacks ────────────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS feedbacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer_name TEXT NOT NULL,
            engineer_email TEXT,
            cc_email TEXT,
            evaluator_name TEXT NOT NULL,
            date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            execution_text TEXT,
            impacts_json TEXT,
            execution_score INTEGER,
            communication_text TEXT,
            communication_score INTEGER,
            dev_text TEXT,
            dev_score INTEGER,
            maintain_text TEXT,
            maintain_score INTEGER,
            checklist_text TEXT,
            checklist_score INTEGER,
            study_text TEXT,
            study_score INTEGER,
            ownership_text TEXT,
            ownership_score INTEGER,
            cultural_text TEXT,
            cultural_score INTEGER,
            execution_blocks_json TEXT,
            email_sent BOOLEAN DEFAULT 0,
            is_draft BOOLEAN DEFAULT 0
        )
    ''')

    # Adicionar coluna is_draft se não existir (para bancos antigos)
    try:
        cursor.execute("ALTER TABLE feedbacks ADD COLUMN is_draft BOOLEAN DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # ── Usuários ─────────────────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            verification_code TEXT,
            code_expiry TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute(
        "INSERT OR IGNORE INTO users (email, role) VALUES (?, 'admin')",
        ('luiz@otmow.com',)
    )

    # ── Definições de Competência ─────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS competency_matrix_defs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            sub_category TEXT NOT NULL,
            support_docs TEXT DEFAULT '',
            target_score INTEGER NOT NULL DEFAULT 2,
            order_index INTEGER NOT NULL DEFAULT 0
        )
    ''')

    # ── Ciclos de Avaliação ───────────────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS competency_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1
        )
    ''')

    # Criar ciclo inicial se não existir
    cursor.execute("SELECT COUNT(*) FROM competency_cycles WHERE is_active = 1")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO competency_cycles (name, is_active) VALUES ('Ciclo Inicial', 1)"
        )

    # ── Scores por Usuário por Ciclo ──────────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS competency_user_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_id INTEGER NOT NULL,
            user_email TEXT NOT NULL,
            competency_id INTEGER NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(cycle_id, user_email, competency_id),
            FOREIGN KEY(cycle_id) REFERENCES competency_cycles(id),
            FOREIGN KEY(competency_id) REFERENCES competency_matrix_defs(id)
        )
    ''')

    # ── Controle de submissão por ciclo ──────────────────────────────
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS competency_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_id INTEGER NOT NULL,
            user_email TEXT NOT NULL,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(cycle_id, user_email)
        )
    ''')

    conn.commit()
    conn.close()


def seed_competencies_from_excel(excel_path):
    """Popula competency_matrix_defs a partir do arquivo Excel."""
    try:
        import openpyxl
    except ImportError:
        raise ImportError("Instale openpyxl: pip install openpyxl")

    wb = openpyxl.load_workbook(excel_path)
    ws = wb.active

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    current_category = None
    order_idx = 0
    inserted = 0

    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:  # pular cabeçalhos
            continue
        cat   = str(row[0]).strip() if row[0] else None
        skill = str(row[2]).strip() if row[2] else None
        docs  = str(row[3]).strip() if row[3] else ''

        if cat and cat != 'None':
            current_category = cat
        if skill and skill != 'None' and current_category:
            docs_clean = docs if docs != 'None' else ''
            cursor.execute(
                "SELECT COUNT(*) FROM competency_matrix_defs WHERE category=? AND sub_category=?",
                (current_category, skill)
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "INSERT INTO competency_matrix_defs (category, sub_category, support_docs, target_score, order_index) VALUES (?, ?, ?, 2, ?)",
                    (current_category, skill, docs_clean, order_idx)
                )
                order_idx += 1
                inserted += 1

    conn.commit()
    conn.close()
    return inserted


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


if __name__ == '__main__':
    init_db()
    print("Database inicializado.")
