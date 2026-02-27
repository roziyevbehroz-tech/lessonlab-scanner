"""
ArUco Marker PDF Generator - Quizizz Style
Har bir sahifada bitta marker, A4 format, professional dizayn
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, gray, lightgrey
import os

# A4 o'lchamlari
PAGE_WIDTH, PAGE_HEIGHT = A4

# ArUco marker patterns (5x5 grid, js-aruco compatible)
PATTERNS = {
    0: [[1,0,0,0,0],[1,0,1,1,1],[0,1,0,0,1],[0,1,1,1,0],[1,0,0,0,0]],
    1: [[1,0,1,1,1],[1,0,0,0,0],[0,1,1,1,0],[0,1,0,0,1],[1,0,1,1,1]],
    2: [[0,1,0,0,1],[0,1,1,1,0],[1,0,0,0,0],[1,0,1,1,1],[0,1,0,0,1]],
    3: [[0,1,1,1,0],[0,1,0,0,1],[1,0,1,1,1],[1,0,0,0,0],[0,1,1,1,0]],
    4: [[1,0,0,0,0],[0,1,0,0,1],[1,0,1,1,1],[0,1,1,1,0],[1,0,0,0,0]],
    5: [[1,0,1,1,1],[0,1,1,1,0],[1,0,0,0,0],[0,1,0,0,1],[1,0,1,1,1]],
    6: [[0,1,0,0,1],[1,0,0,0,0],[0,1,1,1,0],[1,0,1,1,1],[0,1,0,0,1]],
    7: [[0,1,1,1,0],[1,0,1,1,1],[0,1,0,0,1],[1,0,0,0,0],[0,1,1,1,0]],
    8: [[1,0,0,0,0],[1,0,0,0,0],[0,1,0,0,1],[0,1,0,0,1],[1,0,0,0,0]],
    9: [[1,0,1,1,1],[1,0,1,1,1],[0,1,1,1,0],[0,1,1,1,0],[1,0,1,1,1]],
    10: [[0,1,0,0,1],[0,1,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[0,1,0,0,1]],
    11: [[0,1,1,1,0],[0,1,1,1,0],[1,0,1,1,1],[1,0,1,1,1],[0,1,1,1,0]],
    12: [[1,0,0,0,0],[0,1,0,0,1],[0,1,0,0,1],[1,0,0,0,0],[1,0,0,0,0]],
    13: [[1,0,1,1,1],[0,1,1,1,0],[0,1,1,1,0],[1,0,1,1,1],[1,0,1,1,1]],
    14: [[0,1,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[0,1,0,0,1],[0,1,0,0,1]],
    15: [[0,1,1,1,0],[1,0,1,1,1],[1,0,1,1,1],[0,1,1,1,0],[0,1,1,1,0]],
    16: [[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,0]],
    17: [[1,0,1,1,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,0],[1,0,1,1,1]],
    18: [[0,1,0,0,1],[0,1,1,1,0],[0,1,0,0,1],[0,1,1,1,0],[0,1,0,0,1]],
    19: [[0,1,1,1,0],[0,1,0,0,1],[0,1,1,1,0],[0,1,0,0,1],[0,1,1,1,0]],
    20: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
    21: [[1,0,1,1,1],[1,0,1,1,1],[1,0,1,1,1],[1,0,1,1,1],[1,0,1,1,1]],
    22: [[0,1,0,0,1],[0,1,0,0,1],[0,1,0,0,1],[0,1,0,0,1],[0,1,0,0,1]],
    23: [[0,1,1,1,0],[0,1,1,1,0],[0,1,1,1,0],[0,1,1,1,0],[0,1,1,1,0]],
    24: [[1,0,0,0,0],[1,0,1,1,1],[0,1,1,1,0],[0,1,0,0,1],[1,0,0,0,0]],
    25: [[1,0,1,1,1],[1,0,0,0,0],[0,1,0,0,1],[0,1,1,1,0],[1,0,1,1,1]],
    26: [[0,1,0,0,1],[0,1,1,1,0],[1,0,1,1,1],[1,0,0,0,0],[0,1,0,0,1]],
    27: [[0,1,1,1,0],[0,1,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[0,1,1,1,0]],
    28: [[1,0,0,0,0],[0,1,0,0,1],[0,1,1,1,0],[1,0,1,1,1],[1,0,0,0,0]],
    29: [[1,0,1,1,1],[0,1,1,1,0],[0,1,0,0,1],[1,0,0,0,0],[1,0,1,1,1]],
}

def draw_marker(c, pattern, x, y, size):
    """ArUco markerni chizish"""
    cell_size = size / 7
    
    # Qora border
    c.setFillColor(black)
    c.rect(x, y, size, size, fill=1, stroke=0)
    
    # Oq ichki qism
    c.setFillColor(white)
    c.rect(x + cell_size, y + cell_size, cell_size * 5, cell_size * 5, fill=1, stroke=0)
    
    # Pattern chizish
    for i in range(5):
        for j in range(5):
            if pattern[i][j] == 1:
                c.setFillColor(black)
            else:
                c.setFillColor(white)
            # Y koordinatani teskari qilamiz (PDF koordinata tizimi)
            c.rect(x + (j + 1) * cell_size, y + (4 - i + 1) * cell_size, cell_size, cell_size, fill=1, stroke=0)

def draw_page(c, player_num):
    """Bitta sahifa - Quizizz uslubida"""
    # Marker o'lchami (katta)
    marker_size = 12 * cm
    
    # Markerni markazga joylashtirish
    marker_x = (PAGE_WIDTH - marker_size) / 2
    marker_y = (PAGE_HEIGHT - marker_size) / 2
    
    # Kesish chiziqlari (nuqtali)
    c.setStrokeColor(lightgrey)
    c.setLineWidth(0.5)
    c.setDash(3, 3)
    
    # Yuqori kesish chizig'i
    cut_y_top = marker_y + marker_size + 2*cm
    c.line(2*cm, cut_y_top, PAGE_WIDTH - 2*cm, cut_y_top)
    
    # Pastki kesish chizig'i
    cut_y_bottom = marker_y - 2*cm
    c.line(2*cm, cut_y_bottom, PAGE_WIDTH - 2*cm, cut_y_bottom)
    
    # Qaychi belgilari
    c.setFillColor(gray)
    c.setFont("Helvetica", 14)
    c.drawCentredString(PAGE_WIDTH/2, cut_y_top + 3*mm, "✂")
    c.drawCentredString(PAGE_WIDTH/2, cut_y_bottom - 5*mm, "✂")
    
    # LessonLab yozuvlari (4 tomonda)
    c.setFillColor(gray)
    c.setFont("Helvetica", 12)
    
    # Yuqorida
    c.drawCentredString(PAGE_WIDTH/2, marker_y + marker_size + 1*cm, "LessonLab")
    
    # Pastda (teskari)
    c.saveState()
    c.translate(PAGE_WIDTH/2, marker_y - 1*cm)
    c.rotate(180)
    c.drawCentredString(0, 0, "LessonLab")
    c.restoreState()
    
    # Chapda (vertikal)
    c.saveState()
    c.translate(marker_x - 1*cm, PAGE_HEIGHT/2)
    c.rotate(90)
    c.drawCentredString(0, 0, "LessonLab")
    c.restoreState()
    
    # O'ngda (vertikal teskari)
    c.saveState()
    c.translate(marker_x + marker_size + 1*cm, PAGE_HEIGHT/2)
    c.rotate(-90)
    c.drawCentredString(0, 0, "LessonLab")
    c.restoreState()
    
    # P raqamlari (4 burchakda)
    c.setFont("Helvetica-Bold", 24)
    c.setFillColor(black)
    
    p_text = f"P {player_num}"
    
    # Yuqori chap
    c.drawString(marker_x - 1.5*cm, marker_y + marker_size + 0.5*cm, p_text)
    
    # Yuqori o'ng
    c.drawRightString(marker_x + marker_size + 1.5*cm, marker_y + marker_size + 0.5*cm, p_text)
    
    # Pastki chap (teskari)
    c.saveState()
    c.translate(marker_x - 0.5*cm, marker_y - 0.5*cm)
    c.rotate(180)
    c.drawString(0, 0, p_text)
    c.restoreState()
    
    # Pastki o'ng (teskari)
    c.saveState()
    c.translate(marker_x + marker_size + 1.5*cm, marker_y - 0.5*cm)
    c.rotate(180)
    c.drawRightString(0, 0, p_text)
    c.restoreState()
    
    # A, B, C, D belgilari
    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(gray)
    
    # A - yuqorida
    c.drawCentredString(PAGE_WIDTH/2, marker_y + marker_size + 5*mm, "A")
    
    # B - o'ngda
    c.drawString(marker_x + marker_size + 5*mm, PAGE_HEIGHT/2, "B")
    
    # C - pastda
    c.drawCentredString(PAGE_WIDTH/2, marker_y - 8*mm, "C")
    
    # D - chapda
    c.drawRightString(marker_x - 5*mm, PAGE_HEIGHT/2, "D")
    
    # Markerni chizish
    pattern = PATTERNS.get(player_num - 1, PATTERNS[0])
    draw_marker(c, pattern, marker_x, marker_y, marker_size)

def generate_pdf(num_players=30, output_file="LessonLab_Markers.pdf"):
    """PDF yaratish"""
    c = canvas.Canvas(output_file, pagesize=A4)
    c.setTitle("LessonLab ArUco Markers")
    c.setAuthor("LessonLab")
    
    for i in range(1, num_players + 1):
        draw_page(c, i)
        c.showPage()
    
    c.save()
    print(f"✅ PDF yaratildi: {output_file}")
    print(f"📄 Sahifalar soni: {num_players}")
    return output_file

if __name__ == "__main__":
    # 30 ta o'quvchi uchun marker
    output_path = os.path.join(os.path.dirname(__file__), "LessonLab_Markers.pdf")
    generate_pdf(30, output_path)
