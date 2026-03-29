import os
import urllib.request
import json
from fpdf import FPDF
from datetime import datetime

class FeedbackPDF(FPDF):
    def header(self):
        # Logo Ótmow
        logo_path = os.path.join(os.path.dirname(__file__), 'static', 'logo.png')
        if not os.path.exists(logo_path):
            try:
                urllib.request.urlretrieve("https://otmow.com/wp-content/uploads/2025/10/logo-1.png", logo_path)
            except Exception as e:
                print("Could not download logo", e)
                
        # Header - Corporate Symmetry
        if os.path.exists(logo_path):
            self.image(logo_path, 15, 12, 40)
            
        self.set_y(15)
        self.set_font('helvetica', 'B', 16)
        # Ótmow Blue
        self.set_text_color(27, 56, 114) # var(--primary-hover) Dark Blue
        self.cell(0, 8, 'Desempenho Profissional', ln=True, align='R')
        
        self.set_font('helvetica', '', 11)
        self.set_text_color(54, 116, 239) # var(--primary-color) Blue
        self.cell(0, 6, 'Avaliação Contínua e Crescimento', ln=True, align='R')

        # Divider line
        self.set_draw_color(54, 116, 239)
        self.set_line_width(0.8)
        self.line(15, 30, 195, 30)
        self.ln(15)

    def footer(self):
        self.set_y(-15)
        self.set_draw_color(226, 232, 240)
        self.set_line_width(0.5)
        self.line(15, 282, 195, 282)
        self.set_font('helvetica', 'I', 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f'Comitê de Engenharia Ótmow | Confidencial | Página {self.page_no()}', align='C')

def generate_pdf(feedback_data, output_path):
    pdf = FeedbackPDF()
    pdf.set_margins(left=15, top=15, right=15)
    pdf.add_page()
    
    # Metadata Block (Boxed for symmetry)
    pdf.set_fill_color(247, 249, 252)
    pdf.set_draw_color(226, 232, 240)
    pdf.rect(15, 35, 180, 25, 'FD')
    
    pdf.set_y(38)
    pdf.set_x(20)
    pdf.set_font('helvetica', 'B', 11)
    pdf.set_text_color(27, 56, 114)
    pdf.cell(90, 6, f"Avaliado(a): {feedback_data.get('engineer_name', '')}")
    pdf.cell(90, 6, f"Data da Geração: {datetime.now().strftime('%d/%m/%Y')}", ln=True)
    
    pdf.set_x(20)
    pdf.cell(90, 6, f"Avaliador(a): {feedback_data.get('evaluator_name', '')}")
    pdf.set_font('helvetica', '', 10)
    eval_date = feedback_data.get('date_created', datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    if isinstance(eval_date, str) and ' ' in eval_date:
        eval_date = eval_date.split(' ')[0]
    pdf.cell(90, 6, f"Período/Data de Fechamento: {eval_date}", ln=True)
    pdf.ln(10)

    # Helper function
    def add_section(title, score, score_max, text, is_major=False):
        if pdf.get_y() > 240:
            pdf.add_page()
            
        pdf.set_font('helvetica', 'B', 13 if is_major else 11)
        pdf.set_text_color(27, 56, 114) # Dark Blue Headings
        pdf.cell(0, 10 if is_major else 8, title, ln=True)
        
        pdf.set_font('helvetica', 'B', 10)
        pdf.set_text_color(44, 162, 95) # Ótmow Green for scores
        pdf.cell(0, 6, f"Grau de Avaliação: {score} / {score_max}", ln=True)
        pdf.ln(1)
        
        pdf.set_font('helvetica', '', 10)
        pdf.set_text_color(0, 0, 0)
        if text:
            pdf.set_x(15)
            pdf.multi_cell(0, 5, text)
        pdf.ln(5)

    # 1. Execução
    if pdf.get_y() > 220: pdf.add_page()
    pdf.set_font('helvetica', 'B', 13)
    pdf.set_text_color(27, 56, 114)
    pdf.cell(0, 10, "1. Execução e Impacto das Entregas", ln=True)
    pdf.set_font('helvetica', 'B', 10)
    pdf.set_text_color(44, 162, 95)
    pdf.cell(0, 6, f"Média Geral de Execução: {feedback_data.get('execution_score', 0)} / 10", ln=True)
    pdf.ln(2)
    
    execution_blocks = feedback_data.get('execution_blocks', [])
    if execution_blocks:
        for idx, block in enumerate(execution_blocks):
            if pdf.get_y() > 240: pdf.add_page()
            
            # Sub-header for the block
            pdf.set_font('helvetica', 'B', 11)
            pdf.set_text_color(27, 56, 114)
            start = block.get('start_date', 'N/A')
            end = block.get('end_date', 'N/A')
            pdf.cell(0, 8, f"Entrega #{idx+1} | Período: {start} até {end}", ln=True)
            
            # Score for the block
            pdf.set_font('helvetica', 'I', 10)
            pdf.set_text_color(44, 162, 95)
            pdf.cell(0, 6, f"Nota desta Unidade: {block.get('score', 0)}/10", ln=True)
            
            # Description
            pdf.set_font('helvetica', 'B', 10)
            pdf.set_text_color(0, 0, 0)
            pdf.set_x(15)
            pdf.cell(0, 6, "Descrição:", ln=True)
            pdf.set_font('helvetica', '', 10)
            pdf.set_x(15)
            pdf.multi_cell(0, 5, block.get('description', ''))
            
            # Impact
            pdf.set_font('helvetica', 'B', 10)
            pdf.set_x(15)
            pdf.cell(0, 6, "Impacto Gerado:", ln=True)
            pdf.set_font('helvetica', '', 10)
            pdf.set_x(15)
            pdf.multi_cell(0, 5, block.get('impact', ''))
            
            pdf.ln(4)
            # Draw a subtle separator between blocks if not the last one
            if idx < len(execution_blocks) - 1:
                pdf.set_draw_color(226, 232, 240)
                pdf.line(15, pdf.get_y(), 195, pdf.get_y())
                pdf.ln(4)
    else:
        # Fallback para dados legados
        pdf.set_font('helvetica', 'B', 10)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(0, 6, "Resumo das Entregas:", ln=True)
        pdf.set_font('helvetica', '', 10)
        pdf.set_x(15)
        pdf.multi_cell(0, 5, feedback_data.get('execution_text', ''))
        
        impacts = feedback_data.get('impacts', [])
        if impacts:
            pdf.ln(2)
            pdf.set_font('helvetica', 'B', 10)
            pdf.cell(0, 6, "Impactos e Desdobramentos Reais (Resultados):", ln=True)
            pdf.set_font('helvetica', '', 10)
            for imp in impacts:
                pdf.set_x(15)
                pdf.multi_cell(0, 5, f"- {imp}")
    pdf.ln(6)

    # 2. Comunicação
    add_section("2. Comunicação Estratégica", feedback_data.get("communication_score", 0), 10, feedback_data.get("communication_text", ""), is_major=True)
    
    # Generic sections
    pdf.add_page("P")
    pdf.set_font('helvetica', 'B', 14)
    pdf.set_text_color(54, 116, 239)
    pdf.cell(0, 12, "Matriz de Desenvolvimento (Alinhamentos Finais)", ln=True)
    pdf.ln(2)

    add_section("A. Pontos a Desenvolver", feedback_data.get("dev_score", 0), 5, feedback_data.get("dev_text", ""))
    add_section("B. Pontos a Manter (Fortalezas)", feedback_data.get("maintain_score", 0), 5, feedback_data.get("maintain_text", ""))
    add_section("C. Senimento de Dono (Ownership)", feedback_data.get("ownership_score", 0), 5, feedback_data.get("ownership_text", ""))
    add_section("D. Alinhamento Cultural (Culture Fit)", feedback_data.get("cultural_score", 0), 5, feedback_data.get("cultural_text", ""))
    add_section("E. Checklist de Atividades", feedback_data.get("checklist_score", 0), 5, feedback_data.get("checklist_text", ""))
    add_section("F. Dicas de Leitura/Estudo", feedback_data.get("study_score", 0), 5, feedback_data.get("study_text", ""))

    # --- NOVO: GERAR GRÁFICOS NO BACKEND E EMBUTIR COMO APÊNDICE ---
    history = feedback_data.get('history', [])
    if history and len(history) > 0:
        pdf.add_page("P")
        pdf.set_font('helvetica', 'B', 16)
        pdf.set_text_color(27, 56, 114)
        pdf.cell(0, 15, "Dashboard de Evolução Contínua (Appêndice Analítico)", ln=True, align='C')
        pdf.ln(5)

        # Matplotlib Graph Generation (Lazy Loading)
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import numpy as np
        plt.style.use('bmh') # Clean aesthetic style

        # Plot 1: Line Chart
        dates = [f.get('date_created', '').split(' ')[0] for f in history]
        exec_scores = [f.get('execution_score', 0) for f in history]
        comm_scores = [f.get('communication_score', 0) for f in history]

        fig, ax = plt.subplots(figsize=(6, 3), dpi=200)
        ax.plot(dates, exec_scores, marker='o', color='#3674ef', linewidth=2, label='Execução')
        ax.plot(dates, comm_scores, marker='s', color='#2ca25f', linewidth=2, label='Comunicação')
        ax.set_ylim(0, 11)
        ax.set_ylabel('Scores de 1 a 10')
        ax.set_title('Histórico de Notas Gerais por Últimas Avaliações')
        ax.legend(loc='lower right')
        ax.grid(True, alpha=0.5)
        plt.tight_layout()
        line_path = os.path.join(os.path.dirname(__file__), "tmp_line_chart.png")
        plt.savefig(line_path)
        plt.close()

        # Build Page: Line Chart Insertion
        pdf.image(line_path, 15, pdf.get_y(), 180)
        pdf.ln(95) # space occupied by image

        # Plot 2: Radar Chart (Spider) comparing current with previous
        latest = history[-1]
        previous = history[-2] if len(history) > 1 else None
        
        labels = ['Desenvolver', 'Manter', 'Ownership', 'Cultura', 'Checklist', 'Estudo']
        
        def map_m(fb): return [
            fb.get('dev_score', 0), fb.get('maintain_score', 0), 
            fb.get('ownership_score', 0), fb.get('cultural_score', 0),
            fb.get('checklist_score', 0), fb.get('study_score', 0)
        ]
        
        stats_latest = map_m(latest)
        angles = np.linspace(0, 2 * np.pi, len(labels), endpoint=False).tolist()
        stats_latest += stats_latest[:1]
        angles += angles[:1]
        
        fig, ax = plt.subplots(figsize=(5, 5), dpi=200, subplot_kw=dict(polar=True))
        
        ax.plot(angles, stats_latest, color='#3674ef', linewidth=2, label='Atual')
        ax.fill(angles, stats_latest, color='#3674ef', alpha=0.25)

        if previous:
            stats_prev = map_m(previous)
            stats_prev += stats_prev[:1]
            ax.plot(angles, stats_prev, color='#2ca25f', linewidth=2, linestyle='dashed', label='Anterior')
            ax.fill(angles, stats_prev, color='#2ca25f', alpha=0.1)

        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(labels, fontsize=10)
        ax.set_ylim(0, 5.5)
        ax.set_yticks([1, 2, 3, 4, 5])
        ax.set_title('Radar de Métricas Especiais (Escala 1 a 5)', y=1.08)
        ax.legend(loc='upper right', bbox_to_anchor=(1.2, 1.1))
        
        plt.tight_layout()
        radar_path = os.path.join(os.path.dirname(__file__), "tmp_radar_chart.png")
        plt.savefig(radar_path)
        plt.close()

        # Build Page: Radar Chart Insertion
        # Centering the 120 width image (210 format paper: 210-120)/2 = 45
        pdf.image(radar_path, 45, pdf.get_y(), 120)

    pdf.output(output_path)
    return output_path
