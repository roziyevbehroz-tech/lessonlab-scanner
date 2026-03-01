import json
import os
import base64
import random
from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, FSInputFile
from aiogram.utils.keyboard import InlineKeyboardBuilder
from database import Database

router = Router()
db = Database()

# In-memory session tracking: {user_id: {chat_id, test_id, title, class_name, total_q}}
scanner_sessions = {}

SCANNER_BASE_URL = "https://roziyevbehroz-tech.github.io/lessonlab-scanner/scanner"

class ScannerSession(StatesGroup):
    selecting_class = State()

# === LLabQR tugmasi bosilganda ===
@router.callback_query(F.data.startswith("llab_qr_"))
async def start_llab_qr(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    count = db.get_question_count(test_id)

    if count == 0:
        return await callback.answer("Bu testda savollar yo'q!", show_alert=True)

    # Sinflar bormi tekshirish
    classes = db.get_user_classes(callback.from_user.id)

    if classes:
        # Sinfni tanlash
        await state.update_data(scanner_test_id=test_id)
        builder = InlineKeyboardBuilder()
        for class_id, class_name in classes:
            builder.button(
                text=f"🏫 {class_name}",
                callback_data=f"scan_class_{class_id}"
            )
        builder.adjust(1)
        builder.row(
            InlineKeyboardButton(text="👤 Sinfsiz davom etish", callback_data="scan_class_0")
        )
        builder.row(
            InlineKeyboardButton(text="⬅️ Orqaga", callback_data=f"run_sel_{test_id}")
        )

        await callback.message.edit_text(
            "🏫 <b>Qaysi sinf uchun skaner ishlatamiz?</b>\n\n"
            "Sinfni tanlang yoki sinfsiz davom eting:",
            reply_markup=builder.as_markup(), parse_mode="HTML"
        )
    else:
        # Sinf yo'q — to'g'ridan-to'g'ri havolalar
        await send_scanner_links(callback.message, test_id, class_id=None, user_id=callback.from_user.id)

    await callback.answer()

# === Sinf tanlandi ===
@router.callback_query(F.data.startswith("scan_class_"))
async def select_class_for_scan(callback: types.CallbackQuery, state: FSMContext):
    class_id = int(callback.data.split("_")[2])
    data = await state.get_data()
    test_id = data.get('scanner_test_id')

    if not test_id:
        return await callback.answer("Session topilmadi. Qaytadan boshlang.", show_alert=True)

    await state.clear()
    await send_scanner_links(
        callback.message,
        test_id,
        class_id=class_id if class_id > 0 else None,
        user_id=callback.from_user.id
    )
    await callback.answer()

# === Scanner va Display havolalarini yuborish ===
async def send_scanner_links(message, test_id, class_id=None, user_id=None, custom_test_data=None, mode="qr"):
    # Test ma'lumotlarini JSON formatga o'tkazish
    if custom_test_data:
        test_data = custom_test_data
    else:
        test_data = db.get_test_data_json(test_id, class_id)

    
    # Inject chat_id so results can be sent back to this chat
    if message.chat.id:
        test_data['chat_id'] = message.chat.id
        
    encoded = base64.b64encode(json.dumps(test_data, ensure_ascii=False).encode()).decode()

    # Generate unique session ID for real-time sync
    session_id = f"llab-{test_id}-{random.randint(1000, 9999)}"

    ct_val = class_id if class_id else 0
    if mode == "remote":
        scanner_url = f"{SCANNER_BASE_URL}/remote.html?test_id={test_id}&class_id={ct_val}&session={session_id}&data={encoded}"
        scanner_btn_text = "🎛 Pult bilan boshlash (Arduinoga Ulanish)"
    else:
        scanner_url = f"{SCANNER_BASE_URL}/index.html?test_id={test_id}&class_id={ct_val}&session={session_id}&data={encoded}"
        scanner_btn_text = "📱 Skanerni ochish (telefonda)"

    display_url = f"{SCANNER_BASE_URL}/display.html?test_id={test_id}&class_id={ct_val}&session={session_id}&mode={mode}"

    title = test_data['title']
    q_count = len(test_data['questions'])
    class_name = test_data.get('class_name', '')
    student_count = len(test_data.get('students', []))

    # Track session: store originating chat_id so results go back to correct chat
    if user_id:
        scanner_sessions[user_id] = {
            'chat_id': message.chat.id,
            'test_id': test_id,
            'title': title,
            'class_name': class_name,
            'total_q': q_count
        }

    info_lines = [
        f"✨ <b>L-Lab Vision — Premium Skaner</b>\n",
        f"📝 Test: <b>{title}</b>",
        f"❓ Savollar: <b>{q_count}</b> ta",
    ]
    if class_name:
        info_lines.append(f"🏫 Sinf: <b>{class_name}</b>")
        info_lines.append(f"👥 O'quvchilar: <b>{student_count}</b> ta")

    if mode == "remote":
        info_lines.extend([
            "",
            "💻 <b>Kompyuterda</b> — Pult qabul qilgichini ulab tugmani bosing",
            "🖥 <b>Whiteboardda</b> — Savollar uchun Display havolasini oching",
        ])
    else:
        info_lines.extend([
            "",
            "📱 <b>Telefonda</b> — Skaner tugmasini bosing",
            "🖥 <b>Whiteboardda</b> — Display havolasini oching",
        ])

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text=scanner_btn_text,
            web_app=WebAppInfo(url=scanner_url)
        )],
        [InlineKeyboardButton(
            text="🖥 Savollarni ko'rsatish (Displayda)",
            web_app=WebAppInfo(url=display_url)
        )],
        [InlineKeyboardButton(
            text="📄 QR kartochkalarni yuklab olish (PDF)",
            callback_data=f"download_qr_{test_id}_{student_count}"
        )],
        [InlineKeyboardButton(
            text="⬅️ Orqaga",
            callback_data=f"run_sel_{test_id}"
        )],
    ])

    await message.edit_text(
        "\n".join(info_lines),
        reply_markup=keyboard,
        parse_mode="HTML"
    )

# === QR kartalarni PDF formatda yuborish (standart fayl) ===
@router.callback_query(F.data.startswith("download_qr_"))
async def download_qr_cards(callback: types.CallbackQuery):
    await callback.answer("📄 PDF yuborilmoqda...", show_alert=False)
    
    pdf_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "qr_cards.pdf")
    
    if not os.path.exists(pdf_path):
        return await callback.message.answer("❌ QR kartalar fayli topilmadi.")
    
    doc = FSInputFile(pdf_path, filename="LLab_Vision_QR_kartalar.pdf")
    await callback.message.answer_document(
        doc,
        caption="📄 <b>LessonLab Vision — QR kodli kartalar</b>\n\n"
                "🖨 PDF A4 formatda.\n"
                "Har bir karta A/B/C/D javob variantlari bilan.\n\n"
                "👥 <b>Jami: 40 ta QR kodli kartalar.</b>",
        parse_mode="HTML"
    )
