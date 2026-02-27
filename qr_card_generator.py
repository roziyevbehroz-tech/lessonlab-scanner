"""
L-Lab Vision — QR (ArUco) marker kartalar PDF generator
Har bir o'quvchi uchun A/B/C/D javoblari bilan ArUco marker karta yaratadi.
"""
import os
import io
from PIL import Image, ImageDraw, ImageFont
from fpdf import FPDF

# ArUco marker pattern generator (Hamming code based)
VALID_ROWS = [
    [1, 0, 0, 0, 0],  # data bits 00
    [1, 0, 1, 1, 1],  # data bits 01
    [0, 1, 0, 0, 1],  # data bits 10
    [0, 1, 1, 1, 0],  # data bits 11
]

def generate_aruco_pattern(marker_id):
    """Generate 5x5 inner pattern for ArUco marker"""
    bits = []
    for i in range(5):
        shift = 2 * (4 - i)
        row_data = (marker_id >> shift) & 3
        bits.append(VALID_ROWS[row_data][:])
    return bits

def draw_aruco_marker(marker_id, cell_size=20):
    """Draw ArUco marker as PIL Image"""
    grid_size = 7  # 5x5 inner + 2 border
    total_size = grid_size * cell_size
    
    img = Image.new('RGB', (total_size, total_size), 'black')
    draw = ImageDraw.Draw(img)
    
    pattern = generate_aruco_pattern(marker_id)
    
    for row in range(5):
        for col in range(5):
            if pattern[row][col] == 1:
                x = (col + 1) * cell_size
                y = (row + 1) * cell_size
                draw.rectangle([x, y, x + cell_size - 1, y + cell_size - 1], fill='white')
    
    return img

def create_student_card_image(student_num, marker_id, card_w=400, card_h=500):
    """Create a single student card with ArUco marker and A/B/C/D labels"""
    img = Image.new('RGB', (card_w, card_h), 'white')
    draw = ImageDraw.Draw(img)
    
    # Border
    draw.rectangle([2, 2, card_w - 3, card_h - 3], outline='#333', width=2)
    
    # Try to load a font, fall back to default
    try:
        font_big = ImageFont.truetype("arial.ttf", 28)
        font_med = ImageFont.truetype("arial.ttf", 22)
        font_small = ImageFont.truetype("arial.ttf", 14)
        font_label = ImageFont.truetype("arialbd.ttf", 24)
    except:
        font_big = ImageFont.load_default()
        font_med = font_big
        font_small = font_big
        font_label = font_big
    
    # Header
    draw.text((card_w // 2, 20), f"L-Lab Vision", fill='#333', font=font_small, anchor='mt')
    draw.text((card_w // 2, 45), f"O'quvchi #{student_num}", fill='black', font=font_big, anchor='mt')
    
    # Dashed line
    for x in range(20, card_w - 20, 10):
        draw.line([(x, 80), (x + 5, 80)], fill='#aaa', width=1)
    
    # ArUco marker (centered)
    marker_size = 20
    marker = draw_aruco_marker(marker_id, marker_size)
    marker_px = marker.size[0]
    mx = (card_w - marker_px) // 2
    my = 110
    img.paste(marker, (mx, my))
    
    # A/B/C/D labels around the marker
    label_offset = 18
    labels = {
        'A': (mx + marker_px // 2, my - label_offset),           # top
        'B': (mx + marker_px + label_offset, my + marker_px // 2),  # right
        'C': (mx + marker_px // 2, my + marker_px + label_offset),  # bottom
        'D': (mx - label_offset, my + marker_px // 2),              # left
    }
    
    colors = {'A': '#e74c3c', 'B': '#27ae60', 'C': '#2980b9', 'D': '#f39c12'}
    
    for letter, (lx, ly) in labels.items():
        draw.text((lx, ly), letter, fill=colors[letter], font=font_label, anchor='mm')
    
    # Instructions
    iy = my + marker_px + 50
    draw.text((card_w // 2, iy), "Kartani aylantiring", fill='#666', font=font_small, anchor='mt')
    draw.text((card_w // 2, iy + 20), "javobingiz yuqoriga qarashi kerak", fill='#666', font=font_small, anchor='mt')
    
    # Marker ID (small, bottom)
    draw.text((card_w // 2, card_h - 15), f"ID: {marker_id}", fill='#bbb', font=font_small, anchor='mb')
    
    # Scissors icon
    draw.text((15, card_h - 15), "✂", fill='#aaa', font=font_small, anchor='lb')
    
    return img


def generate_cards_pdf(student_count=30, test_title="Test"):
    """Generate a PDF with all student marker cards.
    Returns: path to the generated PDF file.
    4 cards per A4 page (2x2 grid).
    """
    os.makedirs("downloads", exist_ok=True)
    pdf_path = os.path.join("downloads", f"qr_cards_{test_title[:20].replace(' ', '_')}.pdf")
    
    card_w, card_h = 400, 480
    
    # Generate all card images
    cards = []
    for i in range(student_count):
        card_img = create_student_card_image(i + 1, i, card_w, card_h)
        cards.append(card_img)
    
    # Create PDF with 4 cards per page (2x2)
    pdf = FPDF(orientation='P', unit='mm', format='A4')
    pdf.set_auto_page_break(False)
    
    # A4: 210 x 297 mm
    page_w, page_h = 210, 297
    margin = 10
    gap = 5
    
    # Card dimensions in mm (2 per row)
    c_w = (page_w - 2 * margin - gap) / 2  # ~97.5mm
    c_h = (page_h - 2 * margin - gap) / 2  # ~136mm
    
    cards_per_page = 4
    
    for idx, card in enumerate(cards):
        if idx % cards_per_page == 0:
            pdf.add_page()
            # Page header
            pdf.set_font('Helvetica', 'B', 10)
            pdf.set_text_color(150, 150, 150)
        
        pos = idx % cards_per_page
        col = pos % 2
        row = pos // 2
        
        x = margin + col * (c_w + gap)
        y = margin + row * (c_h + gap)
        
        # Save card image to temp buffer
        buf = io.BytesIO()
        card.save(buf, format='PNG')
        buf.seek(0)
        
        # Add to PDF
        temp_path = os.path.join("downloads", f"_temp_card_{idx}.png")
        card.save(temp_path)
        pdf.image(temp_path, x=x, y=y, w=c_w, h=c_h)
        os.remove(temp_path)
    
    pdf.output(pdf_path)
    return pdf_path
