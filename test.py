import database; import pdf_generator; import json

# Patch pdf_generator to print x, y
old_multi_cell = pdf_generator.FPDF.multi_cell
def new_multi_cell(self, w, h, txt, *args, **kwargs):
    print(f"MULTI_CELL -> x:{self.get_x()}, y:{self.get_y()}, margins:(L:{self.l_margin}, R:{self.r_margin}), txt='{txt[:20]}...'")
    old_multi_cell(self, w, h, txt, *args, **kwargs)
pdf_generator.FPDF.multi_cell = new_multi_cell

conn = database.get_db_connection()
fb = conn.execute('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').fetchone()

if fb is None:
    print("No feedbacks found in the database. Creating a dummy feedback for testing.")
    fb_dict = {
        'engineer_name': 'Test Engineer',
        'engineer_email': 'test@example.com',
        'evaluator_name': 'Test Evaluator',
        'date_created': '2026-04-06 12:00:00',
        'execution_text': 'Good execution.',
        'execution_score': 4,
        'communication_text': 'Good communication.',
        'communication_score': 4,
        'dev_text': 'Good dev.',
        'dev_score': 4,
        'maintain_text': 'Good maintain.',
        'maintain_score': 4,
        'checklist_text': 'Good checklist.',
        'checklist_score': 4,
        'study_text': 'Good study.',
        'study_score': 4,
        'ownership_text': 'Good ownership.',
        'ownership_score': 4,
        'cultural_text': 'Good cultural.',
        'cultural_score': 4,
        'impacts': [{'text': 'Impact 1'}],
        'history': []
    }
else:
    fb_dict = dict(fb)
    if fb_dict.get('impacts_json'): fb_dict['impacts'] = json.loads(fb_dict['impacts_json'])
    history_rows = conn.execute('SELECT * FROM feedbacks WHERE engineer_name = ?', (fb_dict['engineer_name'],)).fetchall()
    fb_dict['history'] = [dict(h) for h in history_rows]


try:
    pdf_generator.generate_pdf(fb_dict, '/tmp/test.pdf')
    print('Sucesso')
except Exception as e:
    import traceback
    traceback.print_exc()
