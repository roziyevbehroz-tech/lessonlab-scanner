import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import sys

A4_WIDTH = 2480
A4_HEIGHT = 3508

def get_aruco_dict():
    if hasattr(cv2.aruco, 'DICT_ARUCO_ORIGINAL'):
        dict_id = cv2.aruco.DICT_ARUCO_ORIGINAL
    else:
        dict_id = 16 
    try:
        aruco_dict = cv2.aruco.getPredefinedDictionary(dict_id)
    except AttributeError:
        aruco_dict = cv2.aruco.Dictionary_get(dict_id)
    return aruco_dict

def generate_marker(aruco_dict, marker_id, size=1200):
    try:
        marker_img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, size)
    except AttributeError:
        marker_img = cv2.aruco.drawMarker(aruco_dict, marker_id, size)
    # The default drawMarker produces a 1-bit white border padding, which is good.
    pil_img = Image.fromarray(marker_img).convert('RGB')
    return pil_img

def draw_rotated_text(canvas, draw, text, position, angle, font, fill='black'):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    
    pad = 50
    txt_img = Image.new('RGBA', (tw + pad * 2, th + pad * 2), (255, 255, 255, 0))
    txt_draw = ImageDraw.Draw(txt_img)
    txt_draw.text((pad, pad), text, font=font, fill=fill)
    
    txt_rot = txt_img.rotate(angle, expand=True)
    px, py = position
    canvas.paste(txt_rot, (int(px - txt_rot.width // 2), int(py - txt_rot.height // 2)), txt_rot)

def draw_dashed_line(draw, x1, y1, x2, y2, color='black', width=4, dash_len=30):
    length = np.sqrt((x2-x1)**2 + (y2-y1)**2)
    dashes = int(length / dash_len)
    for i in range(dashes):
        if i % 2 == 0:
            start_x = x1 + (x2-x1) * (i/dashes)
            start_y = y1 + (y2-y1) * (i/dashes)
            end_x = x1 + (x2-x1) * ((i+1)/dashes)
            end_y = y1 + (y2-y1) * ((i+1)/dashes)
            draw.line([(start_x, start_y), (end_x, end_y)], fill=color, width=width)

def create_premium_card(aruco_dict, marker_id):
    canvas = Image.new('RGB', (A4_WIDTH, A4_HEIGHT), 'white')
    draw = ImageDraw.Draw(canvas)
    
    # Kichikroq marker, koprok oq joy
    marker_size = 1000
    center_x = A4_WIDTH // 2
    center_y = A4_HEIGHT // 2
    
    marker = generate_marker(aruco_dict, marker_id, marker_size)
    msize = marker.width
    mx = center_x - msize // 2
    my = center_y - msize // 2
    
    # Marker atrofida yana qo'shimcha oq ramka zaxirasi (ko'zga yaxshi ko'rinishi uchun)
    white_padding = 40
    outer_rect = [
        mx - white_padding, 
        my - white_padding, 
        mx + msize + white_padding, 
        my + msize + white_padding
    ]
    draw.rectangle(outer_rect, outline='white', width=white_padding)

    try:
        # Juda ingichka va kichik shriftlar (boshqalar ko'rmasligi uchun sirli)
        font_large = ImageFont.truetype("arial.ttf", 35) 
        font_small = ImageFont.truetype("arialbd.ttf", 45)
        font_logo = ImageFont.truetype("arial.ttf", 35)
    except IOError:
        font_large = font_small = font_logo = ImageFont.load_default()

    # Harflar markerga biroz yaqinroq
    offset_letters = msize // 2 + white_padding + 40
    
    # Ochiqroq rang (#555555) va kichik harflar, faqat o'quvchiga ko'rinadi
    draw_rotated_text(canvas, draw, "A", (center_x, center_y - offset_letters), 0, font_large, fill='#555555')
    draw_rotated_text(canvas, draw, "B", (center_x - offset_letters, center_y), 90, font_large, fill='#555555')
    draw_rotated_text(canvas, draw, "C", (center_x, center_y + offset_letters), 180, font_large, fill='#555555')
    draw_rotated_text(canvas, draw, "D", (center_x + offset_letters, center_y), -90, font_large, fill='#555555')
    
    # Burchakdagi IDlar
    player_num = marker_id + 1
    id_text = f"P {player_num}"
    cor_x = 250
    cor_y_top = 450
    cor_y_bot = A4_HEIGHT - 450
    
    # IDlar
    draw_rotated_text(canvas, draw, id_text, (cor_x, cor_y_top), 90, font_small, fill='#222222')
    draw_rotated_text(canvas, draw, id_text, (A4_WIDTH - cor_x, cor_y_top), 90, font_small, fill='#222222')
    draw_rotated_text(canvas, draw, id_text, (cor_x, cor_y_bot), -90, font_small, fill='#222222')
    draw_rotated_text(canvas, draw, id_text, (A4_WIDTH - cor_x, cor_y_bot), -90, font_small, fill='#222222')
    
    # L-Lab Vision Logo
    draw_rotated_text(canvas, draw, "L-Lab Vision", (center_x, cor_y_top - 50), 0, font_logo, fill='#CCCCCC')
    draw_rotated_text(canvas, draw, "L-Lab Vision", (center_x, cor_y_bot + 50), 180, font_logo, fill='#CCCCCC')
    draw_rotated_text(canvas, draw, "L-Lab Vision", (cor_x - 50, center_y), 90, font_logo, fill='#CCCCCC')
    draw_rotated_text(canvas, draw, "L-Lab Vision", (A4_WIDTH - cor_x + 50, center_y), -90, font_logo, fill='#CCCCCC')
    
    # Qirqish chiziqlari (scissors)
    sci_y_top = 250
    sci_y_bot = A4_HEIGHT - 250
    draw_dashed_line(draw, 100, sci_y_top, center_x - 100, sci_y_top, color='#AAAAAA')
    draw_dashed_line(draw, center_x + 100, sci_y_top, A4_WIDTH - 100, sci_y_top, color='#AAAAAA')
    draw_rotated_text(canvas, draw, "8<", (center_x, sci_y_top), 0, font_logo, fill='#AAAAAA')

    draw_dashed_line(draw, 100, sci_y_bot, center_x - 100, sci_y_bot, color='#AAAAAA')
    draw_dashed_line(draw, center_x + 100, sci_y_bot, A4_WIDTH - 100, sci_y_bot, color='#AAAAAA')
    draw_rotated_text(canvas, draw, "8<", (center_x, sci_y_bot), 180, font_logo, fill='#AAAAAA')

    # Makerni chizish
    canvas.paste(marker, (mx, my))
    return canvas

def main():
    print("🚀 Generating Premium 1-per-page Quizizz Style Cards...")
    aruco_dict = get_aruco_dict()
    NUM_CARDS = 40
    cards = [create_premium_card(aruco_dict, i) for i in range(NUM_CARDS)]
    
    assets_dir = os.path.join(os.path.dirname(__file__), "assets")
    os.makedirs(assets_dir, exist_ok=True)
    output_pdf = os.path.join(assets_dir, "qr_cards.pdf")
    
    cards[0].save(
        output_pdf, 
        "PDF", 
        resolution=300.0, 
        save_all=True, 
        append_images=cards[1:]
    )
    print(f"🎉 Saved {NUM_CARDS} cards to {output_pdf}")

if __name__ == "__main__":
    main()
