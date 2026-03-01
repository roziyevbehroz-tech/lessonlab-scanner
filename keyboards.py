from aiogram.types import (
    ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

# === Yordamchi funksiyalar ===
def kb(*rows):
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=t) for t in r] for r in rows],
        resize_keyboard=True
    )

def ikb(*rows):
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=c) for t, c in r] for r in rows]
    )

# === Asosiy menyu ===
main_menu = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🌟 L-Lab Vision", web_app=WebAppInfo(url="https://roziyevbehroz-tech.github.io/lessonlab-scanner/miniapp/index.html?v=1.1")), KeyboardButton(text="♻️ Testlar")],
        [KeyboardButton(text="📕 Mening lug'atlarim"), KeyboardButton(text="📗 Mening testlarim")],
        [KeyboardButton(text="⚙️ Maxsus"), KeyboardButton(text="👤 Profil")]
    ],
    resize_keyboard=True
)

maxsus_menu = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🌐 Tarjima qilish"), KeyboardButton(text="⬇️ Yuklab olish")],
        [KeyboardButton(text="🏠 Asosiy menyu")]
    ],
    resize_keyboard=True
)

# Inline versiya (Topics/Forum rejimida ham ishlaydi)
inline_main_menu = ikb(
    [("♻️ Testlar", "home_tests"), ("📕 Lug'atim", "home_dict")],
    [("🌐 Tarjima", "home_translate"), ("📗 Testlarim", "home_my_tests")],
    [("⬇️ Yuklab olish", "home_download"), ("👤 Profil", "home_profile")]
)
 
cancel_kb = kb(["❌ Bekor qilish"])
stop_kb = kb(["⛔ To'xtatish"])

# === ♻️ Testlar bo'limi ===
def get_test_selection_menu():
    return ikb(
        [("📕 Lug'atlarimdan", "select_dict")],
        [("📗 Testlarimdan", "select_test")],
        [("🏠 Asosiy menyu", "main_menu")]
    )

# === Qo'shish / O'chirish tugmalari ===
def get_crud_keyboard(item_type="test"):
    add_cb = "add_test_start" if item_type == "test" else "add_dict"
    del_cb = "del_test_mode" if item_type == "test" else "del_dict"
    return ikb(
        [("➕ Qo'shish", add_cb), ("➖ O'chirish", del_cb)],
        [("🏠 Asosiy menyu", "main_menu")]
    )

# === Finish Screen ===
def get_finish_keyboard(error_count=0):
    builder = InlineKeyboardBuilder()
    if error_count > 0:
        builder.row(InlineKeyboardButton(text="❌ Xatolarni qayta ishlash", callback_data="practice_errors"))
    builder.row(InlineKeyboardButton(text="🏠 Asosiy menyu", callback_data="main_menu"))
    return builder.as_markup()

def get_pro_finish_keyboard(test_id, has_errors=False):
    """Ultimate 4-button Action Grid (v19.0)"""
    return ikb(
        [("🔄 Qayta boshlash", f"practice_restart_{test_id}"), ("❌ Xatolarni qayta...", "practice_errors")] if has_errors else [("🔄 Qayta boshlash", f"practice_restart_{test_id}")],
        [("👥 Guruhda o'ynash", "start_group"), ("📤 Ulashish", "share_test")],
        [("🏠 Asosiy menyu", "main_menu")]
    )

# === Ro'yxat klaviaturasi (Testlar / Lug'atlar / O'chirish) ===
def get_items_keyboard(items, item_type="test", db=None, custom_prefix=None, icon=None, selected_ids=None):
    builder = InlineKeyboardBuilder()
    selected = selected_ids or []
    prefix = custom_prefix or ("manage_test" if item_type == "test" else "view_dict")

    for i, (item_id, title) in enumerate(items, 1):
        count = f" ({db.get_question_count(item_id)} ta savol)" if db and item_type == "test" else ""
        mark = "✅" if item_id in selected else (icon or f"{i}.")
        builder.button(text=f"{mark} {title}{count}", callback_data=f"{prefix}_{item_id}")
    builder.adjust(1)

    if custom_prefix == "del_sel":
        builder.row(
            InlineKeyboardButton(text="➖ O'chirish", callback_data="trigger_delete"),
            InlineKeyboardButton(text="❌ Bekor qilish", callback_data="back_to_tests")
        )
    elif custom_prefix and custom_prefix.startswith("run_sel"):
        # Final buttons for the test/dict selection screen (v14.7 Multi-Select)
        count = len(selected)
        start_text = f"🚀 Boshlash ({count} ta)" if count > 0 else "🚀 Boshlash"
        
        # Determine the action callback (multi_test for both tests and dicts, or specific if needed)
        run_cb = "run_multi_test" if custom_prefix == "run_sel" else "run_multi_dict"
        settings_cb = "test_settings_global" if custom_prefix == "run_sel" else "dict_settings_test"
        
        builder.row(
            InlineKeyboardButton(text="⚙️ Sozlamalar", callback_data=settings_cb),
            InlineKeyboardButton(text=start_text, callback_data=run_cb)
        )
        builder.row(InlineKeyboardButton(text="🏠 Asosiy menyu", callback_data="main_menu"))
    elif not custom_prefix:
        add_cb = "add_test_start" if item_type == "test" else "add_dict"
        del_cb = "del_test_mode" if item_type == "test" else "del_dict"
        builder.row(
            InlineKeyboardButton(text="➕ Qo'shish", callback_data=add_cb),
            InlineKeyboardButton(text="➖ O'chirish", callback_data=del_cb)
        )
        builder.row(InlineKeyboardButton(text="🏠 Asosiy menyu", callback_data="main_menu"))
    else:
        builder.row(InlineKeyboardButton(text="🏠 Asosiy menyu", callback_data="main_menu"))

    return builder.as_markup()

# === Lug'at boshqaruvi (Smart Tester Style) ===
def get_dict_management_keyboard(dicts, page, total_pages):
    builder = InlineKeyboardBuilder()
    
    # Ro'yxat (Numbered list)
    for i, (d_id, name) in enumerate(dicts, 1):
        # We'll use a placeholder for word count if needed, or just the name
        builder.row(InlineKeyboardButton(text=f"{i}. {name}", callback_data=f"open_dict_{d_id}"))
    
    # Qo'shish / O'chirish (Row)
    builder.row(
        InlineKeyboardButton(text="➕ Qo'shish", callback_data="add_dict"),
        InlineKeyboardButton(text="➖ O'chirish", callback_data="del_dict_mode")
    )
    
    # Navigatsiya (Row)
    nav_row = []
    if page > 1:
        nav_row.append(InlineKeyboardButton(text="⬅️", callback_data=f"dict_list_p_{page-1}"))
    
    nav_row.append(InlineKeyboardButton(text="🏠 Asosiy menyu", callback_data="main_menu"))
    
    if page < total_pages:
        nav_row.append(InlineKeyboardButton(text="➡️", callback_data=f"dict_list_p_{page+1}"))
    
    builder.row(*nav_row)
    return builder.as_markup()

def get_dict_words_keyboard(words, dict_id, page, total_pages):
    builder = InlineKeyboardBuilder()
    for i, (w_id, word, trans) in enumerate(words, 1):
        builder.row(InlineKeyboardButton(text=f"{i}. {word} - {trans}", callback_data=f"word_view_{w_id}"))
    
    # Action Row
    builder.row(
        InlineKeyboardButton(text="➕ Qo'shish", callback_data=f"add_word_{dict_id}"),
        InlineKeyboardButton(text="♻️ Lug'atlarni olish", callback_data=f"fetch_words_{dict_id}")
    )
    
    # Navigation Row
    nav_row = []
    if page > 1:
        nav_row.append(InlineKeyboardButton(text="⬅️", callback_data=f"dict_view_{dict_id}_p_{page-1}"))
    else:
        nav_row.append(InlineKeyboardButton(text="⬅️", callback_data="none"))
        
    nav_row.append(InlineKeyboardButton(text="🔙 Orqaga", callback_data="select_dict"))
    
    if page < total_pages:
        nav_row.append(InlineKeyboardButton(text="➡️", callback_data=f"dict_view_{dict_id}_p_{page+1}"))
    else:
        nav_row.append(InlineKeyboardButton(text="➡️", callback_data="none"))
    
    builder.row(*nav_row)
    return builder.as_markup()

def get_multi_del_keyboard(items, item_type="dict", selected_ids=None, page=1, total_pages=1, dict_id=None):
    """Generic multi-select delete keyboard (Smart Tester Style)"""
    builder = InlineKeyboardBuilder()
    selected = selected_ids or []
    
    for item in items:
        item_id = item[0]
        name = item[1] if item_type == "dict" else f"{item[1]} — {item[2]}"
        mark = "✅" if item_id in selected else ""
        cb = f"sel_del_{item_type}_{item_id}"
        builder.row(InlineKeyboardButton(text=f"{mark} {name}".strip(), callback_data=cb))
    
    # Action Row: ➖ O'chirish & 📝 Tahrirlash
    confirm_cb = f"exec_del_{item_type}"
    edit_cb = f"exec_edit_{item_type}"
    builder.row(
        InlineKeyboardButton(text="➖ O'chirish", callback_data=confirm_cb),
        InlineKeyboardButton(text="📝 Tahrirlash", callback_data=edit_cb)
    )
    
    # Navigation Row
    nav = []
    prefix = f"del_{item_type}_p" if not dict_id else f"del_word_{dict_id}_p"
    
    if page > 1:
        nav.append(InlineKeyboardButton(text="⬅️", callback_data=f"{prefix}_{page-1}"))
    else:
        nav.append(InlineKeyboardButton(text="⬅️", callback_data="none"))
        
    cancel_cb = "select_dict" if item_type == "dict" else f"open_dict_{dict_id}"
    nav.append(InlineKeyboardButton(text="❌ Bekor qilish", callback_data=cancel_cb))
    
    if page < total_pages:
        nav.append(InlineKeyboardButton(text="➡️", callback_data=f"{prefix}_{page+1}"))
    else:
        nav.append(InlineKeyboardButton(text="➡️", callback_data="none"))
        
    builder.row(*nav)
    return builder.as_markup()

# === Tasdiqlash ===
def get_confirm_keyboard(action="delete"):
    return ikb([("✅ Ha", f"confirm_{action}"), ("❌ Yo'q", "cancel_action")])

# === Test boshqaruv paneli ===
def get_test_management_keyboard(test_id):
    return ikb(
        [("➕ Qo'shish", f"add_ques_{test_id}"), ("➖ O'chirish", f"del_ques_{test_id}")],
        [("♻️ Testlarni ko'rish", f"view_ques_{test_id}"), ("♻️ Sarlavhani tahrir...", f"edit_title_{test_id}")],
        [("🔙 Orqaga", "back_to_tests")]
    )

def get_test_action_keyboard(mode="quiz"):
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="📱 Shaxsiy ishlash", callback_data="start_private"))
    builder.row(InlineKeyboardButton(text="👥 Guruhda oddiy test", callback_data="start_group"))
    
    # Faqat test moduli 'quiz' bo'lganda interaktiv (QR/Pult) ko'rinadi
    if mode == "quiz":
        builder.row(InlineKeyboardButton(text="🚀 Interaktiv o'yin", callback_data="open_interactive_menu"))
        
    # Tahrirlash (Settings) - hozircha sozlamalarni ochadi (yoki tahrirlash menyusini)
    builder.row(InlineKeyboardButton(text="⚙️ Tahrirlash / Sozlamalar", callback_data="test_settings_global"))
    builder.row(InlineKeyboardButton(text="🔗 Testni ulashish", callback_data="share_test"))
    builder.row(InlineKeyboardButton(text="⬅️ Orqaga", callback_data="back_to_select"))
    
    return builder.as_markup()

def get_interactive_menu_keyboard():
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="✨ QR Kod usuli", callback_data="select_class_qr"))
    builder.row(InlineKeyboardButton(text="🎛 Pult usuli", callback_data="select_class_remote"))
    builder.row(InlineKeyboardButton(text="⬅️ Orqaga", callback_data="back_to_actions"))
    return builder.as_markup()

def get_class_selection_keyboard(classes, method="qr"):
    builder = InlineKeyboardBuilder()
    for c in classes:
        # callback: start_qr_12 or start_remote_12. c is a tuple (id, name)
        builder.row(InlineKeyboardButton(text=f"🏫 {c[1]}", callback_data=f"start_{method}_{c[0]}"))
    builder.row(InlineKeyboardButton(text="⬅️ Orqaga", callback_data="open_interactive_menu"))
    return builder.as_markup()

def get_ready_keyboard():
    return ikb(
        [("✅ Men tayyorman!", "ready_to_start")],
        [("⬅️ Orqaga", "back_from_ready")]
    )

def get_pause_keyboard():
    return ikb(
        [("▶️ Testni davom ettirish", "practice_resume")],
        [("🛑 Testni to'xtatish", "practice_stop")]
    )

def get_group_pause_keyboard():
    """Group specific pause controls with organized callbacks."""
    return ikb(
        [("▶️ Testni davom ettirish", "group_resume")],
        [("🛑 Testni to'xtatish", "group_stop")]
    )


def get_test_settings_keyboard():
    return ikb(
        [("💬 Rejim", f"set_mode_global"), ("⏱ Vaqt", f"set_timer_global")],
        [("🔍 Tekshiruv", f"set_comp_global")],
        [("🔙 Orqaga", "back_to_select")]
    )

def get_mode_selection_keyboard():
    return ikb(
        [("Quiz mode (ABCD)", "save_mode_quiz")],
        [("Writing mode (Yozma)", "set_writing_type")],
        [("🔙 Orqaga", "back_to_select")]
    )

def get_writing_type_selection_keyboard():
    return ikb(
        [("⏱ Vaqtli writing (Spoiler)", "save_mode_timed_write")],
        [("🚀 Vaqtsiz writing (Tezlik)", "save_mode_speed_write")],
        [("🔙 Orqaga", "test_settings_global")]
    )

def get_timer_selection_keyboard(back_to="set_mode_global"):
    return ikb(
        [("5 s", "save_time_5"), ("10 s", "save_time_10"), ("15 s", "save_time_15")],
        [("20 s", "save_time_20"), ("30 s", "save_time_30"), ("40 s", "save_time_40")],
        [("1 min", "save_time_60"), ("3 min", "save_time_180"), ("5 min", "save_time_300")],
        [("🔙 Orqaga", back_to)]
    )

def get_comparison_selection_keyboard(back_to="set_mode_global"):
    return ikb(
        [("🎯 100% teng", "save_comp_exact")],
        [("🔍 O'xshash", "save_comp_fuzzy")],
        [("🔙 Orqaga", back_to)]
    )

# === Practice Execution (v14.5) ===
practice_nav = kb(["⏭ Keyingi"], ["⏹ To'xtatish"])
speed_nav = kb(["⏸ Pausa", "⏹ Tugatish"])


def get_practice_control_keyboard():
    return ikb([("⏭ Keyingi", "practice_next"), ("⏹ To'xtatish", "practice_stop")])

def get_quiz_options_keyboard(options):
    """Generates options buttons with full text for MCQ (v17.0)."""
    builder = InlineKeyboardBuilder()
    for i, opt in enumerate(options):
        # Premium Style: 🔘 Option Text
        builder.row(InlineKeyboardButton(text=f"🔘 {opt['text']}", callback_data=f"poll_ans_{i}"))
    return builder.as_markup()

    return builder.as_markup()

# [DELETE] get_speed_control_keyboard removed (Replaced by speed_nav ReplyKeyboard)



def get_duplicate_management_keyboard(test_id):
    return ikb([("✅ HA, olib tashlash", f"rem_dup_{test_id}"), ("❌ YO'Q, qolsin", f"keep_dup_{test_id}")])

def get_ques_del_confirm_keyboard(test_id):
    return ikb([("✅ Ha, o'chirish", f"confirm_qdel_{test_id}"), ("❌ Bekor qilish", f"cancel_qdel_{test_id}")])

# === Profil ===
profile_keyboard = ikb(
    [("📝 Ma'lumotlarim", "profile_info"), ("♻️ Mening obunam", "profile_sub")],
    [("🔗 Taklif havolam", "profile_ref"), ("📥 Test yuborish", "profile_submit")],
    [("🏠 Asosiy menyu", "main_menu")]
)
