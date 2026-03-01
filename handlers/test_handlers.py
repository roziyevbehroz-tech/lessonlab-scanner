from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import FSInputFile, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
import os
from database import Database
from keyboards import (
    main_menu, get_items_keyboard, get_test_management_keyboard,
    get_test_action_keyboard, get_confirm_keyboard,
    get_ques_del_confirm_keyboard, cancel_kb,
    get_test_settings_keyboard, get_mode_selection_keyboard,
    get_writing_type_selection_keyboard,
    get_timer_selection_keyboard, get_comparison_selection_keyboard,
    get_ready_keyboard
)
from docx_generator import generate_test_docx

router = Router()
# Barcha test handlerlar faqat shaxsiy chatda ishlaydi
router.message.filter(F.chat.type == "private")
db = Database()

class TestDeletion(StatesGroup):
    selecting = State()
    confirming = State()

class QuestionDeletion(StatesGroup):
    waiting_for_indices = State()
    confirming = State()

# === Test boshqaruv paneli ===
# === Test Selection & Multi-Select Logic (v14.7) ===
async def init_selection_state(state: FSMContext):
    data = await state.get_data()
    # Don't overwrite if already exists (e.g. returning from settings)
    if "selected_tests" not in data:
        await state.update_data(selected_tests=[])

@router.callback_query(F.data.startswith("run_sel_"))
async def toggle_test_selection(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    if test_id in selected:
        selected.remove(test_id)
    else:
        selected.append(test_id)
        
    await state.update_data(selected_tests=selected)
    
    # Refresh list
    tests = db.get_user_tests(callback.from_user.id)
    await callback.message.edit_reply_markup(
        reply_markup=get_items_keyboard(tests, item_type="test", db=db, custom_prefix="run_sel", selected_ids=selected)
    )

@router.callback_query(F.data == "run_random_test")
@router.callback_query(F.data == "run_multi_test") # Alias
async def run_selected_tests(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    if not selected:
        return await callback.answer("⚠️ Iltimos, kamida bitta testni tanlang!", show_alert=True)
    
    # Rejim guruh uchun settings dan olinadi (yoki default 'quiz')
    settings = data.get("global_settings", {})
    mode = settings.get("mode", "quiz")

    count = len(selected)
    await callback.message.edit_text(
        f"🚀 <b>Tanlangan {count} ta test bilan nima qilamiz?</b>\n\n"
        "Kerakli usulni tanlang:",
        reply_markup=get_test_action_keyboard(mode=mode), parse_mode="HTML"
    )

@router.callback_query(F.data == "start_private")
async def start_private_practice(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    if not selected:
        return await callback.answer("⚠️ Tanlangan testlar topilmadi!", show_alert=True)
        
    # Aggregate questions for summary
    all_questions = []
    titles = []
    for tid in selected:
        test_title = db.get_test_title(tid)
        titles.append(f"#{test_title}")
        qs = db.get_test_questions(tid)
        for q in qs:
            q['test_name'] = test_title
        all_questions.extend(qs)
        
    if not all_questions:
        return await callback.answer("⚠️ Tanlangan testlarda savollar yo'q!", show_alert=True)
        
    # Get settings
    settings = data.get("global_settings", {
        "mode": "Quiz mode",
        "timer": "30 s",
        "comp": "100% teng"
    })
    
    # Save prepared data to state for final start
    await state.update_data(
        prepared_questions=all_questions,
        prepared_titles=titles,
        prepared_settings=settings
    )
    
    summary = (
        f"♻️ <b>Yangi Mashq</b>\n\n"
        f"<b>{' '.join(titles)}</b>\n"
        f"🖋 {len(all_questions)} ta savol\n"
        f"💬 {settings['mode']}\n"
        f"⏱ Har bir savolga {settings['timer']}\n\n"
        "/stop - Testni to'xtatish\n"
        "/next - Keyingi savolni olish\n\n"
        "🏁 Tayyor bo'lganingizda quyidagi tugmani bosing."
    )
    
    await callback.message.edit_text(summary, reply_markup=get_ready_keyboard(), parse_mode="HTML")

@router.callback_query(F.data == "share_test")
async def share_test_logic(callback: types.CallbackQuery, state: FSMContext, bot: types.Bot):
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    if not selected:
        return await callback.answer("⚠️ Iltimos, ulanish uchun testni tanlang!", show_alert=True)
    
    if len(selected) > 1:
        return await callback.answer("⚠️ Hozircha faqat bittadan test ulashish mumkin. Bitta test qoldiring.", show_alert=True)
        
    test_id = selected[0]
    bot_info = await bot.get_me()
    bot_username = bot_info.username
    
    deep_link = f"https://t.me/{bot_username}?start=share_test_{test_id}"
    
    await callback.message.edit_text(
        f"🔗 <b>Ushbu test uchun maxsus havola:</b>\n\n"
        f"<code>{deep_link}</code>\n\n"
        f"<i>Havoladan nusxa olib hamkasbingizga yuboring. Ular bu havolaga kirib, testdan nusxa (clone) olishlari mumkin bo'ladi.</i>",
        reply_markup=get_test_action_keyboard(mode="quiz"), parse_mode="HTML"
    )

@router.callback_query(F.data == "open_interactive_menu")
async def open_interactive_menu(callback: types.CallbackQuery):
    from keyboards import get_interactive_menu_keyboard
    await callback.message.edit_text(
        "🚀 <b>Interaktiv o'yin usulini tanlang:</b>",
        reply_markup=get_interactive_menu_keyboard(), parse_mode="HTML"
    )

@router.callback_query(F.data == "back_to_actions")
async def back_to_actions(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    settings = data.get("global_settings", {})
    mode = settings.get("mode", "quiz")
    selected = data.get("selected_tests", [])
    count = len(selected)
    
    await callback.message.edit_text(
        f"🚀 <b>Tanlangan {count} ta test bilan nima qilamiz?</b>\n\n"
        "Kerakli usulni tanlang:",
        reply_markup=get_test_action_keyboard(mode=mode), parse_mode="HTML"
    )

@router.callback_query(F.data.in_(["select_class_qr", "select_class_remote"]))
async def select_class_for_interactive(callback: types.CallbackQuery):
    method = "qr" if "qr" in callback.data else "remote"
    classes = db.get_user_classes(callback.from_user.id)
    
    if not classes:
        return await callback.answer("⚠️ Sizda hali sinflar yo'q! L-Lab Vision orqali sinf qo'shing.", show_alert=True)
        
    from keyboards import get_class_selection_keyboard
    method_name = "✨ QR Kod" if method == "qr" else "🎛 Pult"
    
    await callback.message.edit_text(
        f"🏫 <b>{method_name} usuli uchun sinfni tanlang:</b>",
        reply_markup=get_class_selection_keyboard(classes, method=method), parse_mode="HTML"
    )

@router.callback_query(F.data.startswith("start_qr_"))
async def group_start_qr_logic(callback: types.CallbackQuery, state: FSMContext):
    from handlers.scanner_handlers import send_scanner_links
    class_id = int(callback.data.split("_")[2])
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    if not selected:
        return await callback.answer("⚠️ Iltimos, kamida bitta testni tanlang!", show_alert=True)
    
    await callback.answer()
    # Birinchi tanlangan testni QR scanner bilan ochish
    test_id = selected[0]
    await send_scanner_links(callback.message, test_id, user_id=callback.from_user.id, class_id=class_id)

@router.callback_query(F.data.startswith("start_remote_"))
async def group_start_remote_logic(callback: types.CallbackQuery, state: FSMContext):
    from handlers.scanner_handlers import send_scanner_links
    class_id = int(callback.data.split("_")[2])
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    if not selected:
        return await callback.answer("⚠️ Iltimos, kamida bitta testni tanlang!", show_alert=True)
    
    await callback.answer()
    test_id = selected[0]
    
    await send_scanner_links(callback.message, test_id, user_id=callback.from_user.id, mode="remote", class_id=class_id)


@router.callback_query(F.data.startswith("manage_test_"))
async def manage_test(callback: types.CallbackQuery):
    await callback.answer()
    test_id = int(callback.data.split("_")[2])
    title = db.get_test_title(test_id)
    count = db.get_question_count(test_id)
    await callback.message.edit_text(
        f"📗 <b>{title} ({count} ta savol)</b>\n\n"
        "⌛️ Testlaringiz ustida amallar bajarishingiz mumkin...",
        reply_markup=get_test_management_keyboard(test_id), parse_mode="HTML"
    )

# === Testni DOCX formatida ko'rish ===
@router.callback_query(F.data.startswith("view_ques_"))
async def view_test_as_docx(callback: types.CallbackQuery):
    test_id = int(callback.data.split("_")[2])
    title = db.get_test_title(test_id)
    questions = db.get_test_questions(test_id)

    if not questions:
        return await callback.answer("Bu testda hali savollar yo'q.", show_alert=True)

    await callback.answer("⌛️ Test fayli tayyorlanmoqda...")
    file_path = os.path.join(os.getcwd(), f"{title.replace(' ', '_')}.docx")
    generate_test_docx(title, questions, file_path)
    await callback.message.answer_document(
        FSInputFile(file_path),
        caption=f"📘 <b>{title}</b>\n❓ Savollar soni: {len(questions)} ta",
        reply_markup=main_menu,
        parse_mode="HTML"
    )

# === O'chirish rejimi ===
@router.callback_query(F.data == "del_test_mode")
async def enter_delete_mode(callback: types.CallbackQuery, state: FSMContext):
    tests = db.get_user_tests(callback.from_user.id)
    if not tests:
        return await callback.answer("Sizda o'chirish uchun testlar yo'q.", show_alert=True)

    await callback.answer("🗑 O'chirish rejimi yoqildi!", show_alert=True)
    await state.set_state(TestDeletion.selecting)
    await state.update_data(selected_ids=[])
    await callback.message.edit_text(
        "⌛️ <b>O'chirmoqchi bo'lgan testlaringizni tanlang...</b>\n\n"
        "Har bir testni bosib tanlang yoki tanlovdan chiqaring.",
        reply_markup=get_items_keyboard(tests, custom_prefix="del_sel", db=db),
        parse_mode="HTML"
    )

# === Tanlov (toggle) ===
@router.callback_query(TestDeletion.selecting, F.data.startswith("del_sel_"))
async def toggle_selection(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    data = await state.get_data()
    selected = data.get('selected_ids', [])

    if test_id in selected:
        selected.remove(test_id)
    else:
        selected.append(test_id)

    await state.update_data(selected_ids=selected)
    tests = db.get_user_tests(callback.from_user.id)
    await callback.message.edit_reply_markup(
        reply_markup=get_items_keyboard(tests, custom_prefix="del_sel", db=db, selected_ids=selected)
    )
    await callback.answer()

# === O'chirish tugmasi bosilganda ===
@router.callback_query(F.data == "trigger_delete")
async def trigger_delete(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get('selected_ids', [])

    if not selected:
        return await callback.answer("⚠️ Avval kamida bitta testni tanlang!", show_alert=True)

    count = len(selected)
    await callback.message.edit_text(
        f"⚠️ <b>Diqqat!</b>\n\n"
        f"Tanlangan {count} ta test butunlay o'chiriladi.\n"
        f"Davom etishni xohlaysizmi?",
        reply_markup=get_confirm_keyboard(), parse_mode="HTML"
    )
    await state.set_state(TestDeletion.confirming)

# === Tasdiqlash ===
@router.callback_query(TestDeletion.confirming, F.data == "confirm_delete")
async def confirm_delete(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get('selected_ids', [])

    for test_id in selected:
        db.delete_test(test_id)

    await callback.answer(f"✅ {len(selected)} ta test muvaffaqiyatli o'chirildi!", show_alert=True)

    # O'chirish rejimida qolamiz
    await state.update_data(selected_ids=[])
    await state.set_state(TestDeletion.selecting)

    tests = db.get_user_tests(callback.from_user.id)
    if tests:
        await callback.message.edit_text(
            "⌛️ <b>O'chirmoqchi bo'lgan testlaringizni tanlang...</b>",
            reply_markup=get_items_keyboard(tests, custom_prefix="del_sel", db=db),
            parse_mode="HTML"
        )
    else:
        await state.clear()
        await callback.message.edit_text(
            "📗 Sizda boshqa testlar qolmadi.",
            reply_markup=get_items_keyboard([], db=db)
        )

# === Testni boshqarish (📗 Mening testlarim) ===
@router.message(F.text == "📗 Mening testlarim")
async def show_user_tests(message: types.Message, state: FSMContext):
    tests = db.get_user_tests(message.from_user.id)
    if not tests:
        await message.answer("Sizda hali testlar yo'q.")
    else:
        await message.answer(
            "📗 <b>Mening testlarim:</b>",
            reply_markup=get_items_keyboard(tests, item_type="test", db=db),
            parse_mode="HTML"
        )


@router.callback_query(F.data == "select_test")
async def select_test_source(callback: types.CallbackQuery, state: FSMContext):
    tests = db.get_user_tests(callback.from_user.id)
    if not tests:
        await callback.answer("Testlar topilmadi", show_alert=True)
        return
    
    await init_selection_state(state)
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    
    await callback.message.edit_text(
        "📂 <b>Foydalanish uchun testlarni tanlang:</b>",
        reply_markup=get_items_keyboard(tests, item_type="test", db=db, custom_prefix="run_sel", selected_ids=selected),
        parse_mode="HTML"
    )
# === Global Settings Handlers (v14.6 Wizard Flow) ===
@router.callback_query(F.data == "test_settings_global")
async def manage_global_settings(callback: types.CallbackQuery, state: FSMContext):
    # Start the Wizard: Step 1 - Mode Selection
    await callback.message.edit_text(
        "⚙️ <b>Sozlashni boshlaymiz!</b>\n\n"
        "Avval mashq qilish rejimini tanlang:",
        reply_markup=get_mode_selection_keyboard(), parse_mode="HTML"
    )

@router.callback_query(F.data == "set_writing_type")
async def set_writing_type(callback: types.CallbackQuery):
    await callback.message.edit_text(
        "📝 <b>Writing (Yozma) rejimining usulini tanlang:</b>",
        reply_markup=get_writing_type_selection_keyboard(), parse_mode="HTML"
    )

@router.callback_query(F.data.startswith("save_mode_"))
async def save_global_mode(callback: types.CallbackQuery, state: FSMContext):
    mode_key = callback.data.removeprefix("save_mode_")  # quiz, timed_write, speed_write
    
    mode_map = {
        "quiz": "Quiz mode",
        "timed_write": "Timed Writing (Spoiler)",
        "speed_write": "Speed Writing (Tezlik)"
    }
    mode_val = mode_map.get(mode_key, "Quiz mode")
    
    # Update settings
    data = await state.get_data()
    settings = data.get("global_settings", {"mode": "Quiz mode", "timer": "30 s", "comp": "100% teng"})
    settings['mode'] = mode_val
    await state.update_data(global_settings=settings)
    
    # Track Wizard State
    wizard_mode = "quiz"
    if "timed" in mode_key: wizard_mode = "timed"
    elif "speed" in mode_key: wizard_mode = "speed"
    await state.update_data(wizard_mode=wizard_mode)
    
    # Route to next step
    if wizard_mode == "quiz":
        # Quiz -> Timer Selection
        await callback.message.edit_text(
            f"✅ <b>{mode_val}</b> tanlandi!\n\n"
            "Endi har bir savol uchun vaqt belgilang:",
            reply_markup=get_timer_selection_keyboard(back_to="test_settings_global"), # Back to Mode Select
            parse_mode="HTML"
        )
    elif wizard_mode == "timed":
        # Timed Writing -> Timer Selection
        await callback.message.edit_text(
            f"✅ <b>{mode_val}</b> tanlandi!\n\n"
            "Endi yozish uchun vaqt belgilang:",
            reply_markup=get_timer_selection_keyboard(back_to="set_writing_type"), # Back to Writing Type
            parse_mode="HTML"
        )
    elif wizard_mode == "speed":
        # Speed Writing -> Comparison Selection (Skip Timer)
        # Default timer doesn't matter for Speed, but let's keep it clean
        await callback.message.edit_text(
            f"✅ <b>{mode_val}</b> tanlandi!\n\n"
            "Endi javoblarni tekshirish usulini tanlang:",
            reply_markup=get_comparison_selection_keyboard(back_to="set_writing_type"), # Back to Writing Type
            parse_mode="HTML"
        )

@router.callback_query(F.data.startswith("save_time_"))
async def save_global_time(callback: types.CallbackQuery, state: FSMContext):
    time_val = int(callback.data.split("_")[2])
    label = f"{time_val} s" if time_val < 60 else f"{time_val//60} min"
    
    data = await state.get_data()
    settings = data.get("global_settings", {"mode": "Quiz mode", "timer": "30 s", "comp": "100% teng"})
    settings['timer'] = label
    await state.update_data(global_settings=settings)
    
    # Check wizard path
    wizard_mode = data.get("wizard_mode", "quiz")
    
    if wizard_mode == "quiz":
        # Quiz -> Finish
        await finish_wizard(callback, state, settings)
    elif wizard_mode == "timed":
        # Timed -> Comparison
        await callback.message.edit_text(
            f"✅ Vaqt belgilandi: <b>{label}</b>\n\n"
            "Endi javoblarni tekshirish usulini tanlang:",
            reply_markup=get_comparison_selection_keyboard(back_to="set_writing_type"), # Ideally back to timer... complexity. safe fallback
            parse_mode="HTML"
        )

@router.callback_query(F.data.startswith("save_comp_"))
async def save_global_comp(callback: types.CallbackQuery, state: FSMContext):
    comp_val = "100% teng" if callback.data.split("_")[2] == "exact" else "O'xshash"
    
    data = await state.get_data()
    settings = data.get("global_settings", {"mode": "Quiz mode", "timer": "30 s", "comp": "100% teng"})
    settings['comp'] = comp_val
    await state.update_data(global_settings=settings)
    
    # Finish Wizard
    await finish_wizard(callback, state, settings)

async def finish_wizard(callback: types.CallbackQuery, state: FSMContext, settings):
    data = await state.get_data()
    selected_tests = data.get("selected_tests", [])
    selected_dicts = data.get("selected_dicts", [])
    
    # If we came from dictionary selection, go back there
    if selected_dicts or "run_sel_dict" in callback.data or data.get("wizard_origin") == "dict":
        dicts = db.get_user_dictionaries(callback.from_user.id)
        kb = get_items_keyboard(dicts, item_type="dict", db=db, custom_prefix="run_sel_dict", selected_ids=selected_dicts)
        text = "⌛️ Lug'at to'plamlaridan birini tanlang:"
    else:
        tests = db.get_user_tests(callback.from_user.id)
        kb = get_items_keyboard(tests, item_type="test", db=db, custom_prefix="run_sel", selected_ids=selected_tests)
        text = "⌛️ Test to'plamlaridan birini tanlang:"

    await callback.message.edit_text(
        "✅ <b>Sozlamalar saqlandi!</b>\n\n"
        f"💬 Rejim: {settings['mode']}\n"
        f"⏱ Vaqt: {settings['timer']}\n"
        f"🔍 Taqqoslash: {settings['comp']}\n\n"
        "Endi bemalol mashq qilishingiz mumkin!\n"
        f"{text}",
        reply_markup=kb,
        parse_mode="HTML"
    )

# === Navigatsiya ===
@router.callback_query(F.data == "back_from_ready")
async def back_from_ready(callback: types.CallbackQuery, state: FSMContext):
    """Ready ekranidan orqaga — test tanlash ro'yxatiga qaytarish."""
    await callback.answer()
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    tests = db.get_user_tests(callback.from_user.id)
    
    await callback.message.edit_text(
        "📂 <b>Foydalanish uchun testlarni tanlang:</b>\n"
        "<i>(Ko'proq tanlash uchun ustiga bosing)</i>",
        reply_markup=get_items_keyboard(tests, item_type="test", db=db, custom_prefix="run_sel", selected_ids=selected),
        parse_mode="HTML"
    )

@router.callback_query(F.data == "back_to_select")
async def back_to_select(callback: types.CallbackQuery, state: FSMContext):
    await callback.answer()
    data = await state.get_data()
    # Check if we should go back to dictionaries
    if data.get("wizard_origin") == "dict" or data.get("selected_dicts"):
        from handlers.quiz_handlers import select_dict_for_test
        await state.update_data(selected_dicts=[]) # Clear
        await select_dict_for_test(callback, state)
    else:
        await state.update_data(selected_tests=[])  # Clear old selection
        await select_test_source(callback, state)

@router.callback_query(F.data == "back_to_tests")
async def back_to_tests(callback: types.CallbackQuery):
    await callback.answer()
    tests = db.get_user_tests(callback.from_user.id)
    await callback.message.edit_text(
        "📗 <b>Sizning testlaringiz:</b>",
        reply_markup=get_items_keyboard(tests, db=db), parse_mode="HTML"
    )

@router.callback_query(F.data == "cancel_action")
async def cancel_action(callback: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await back_to_tests(callback)
    await callback.answer("Amal bekor qilindi.")

# === Savollarni o'chirish (v13.0) ===
@router.callback_query(F.data.startswith("del_ques_"))
async def start_del_questions(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    questions = db.get_test_questions(test_id)
    title = db.get_test_title(test_id)
    
    if not questions:
        return await callback.answer("Ushbu testda savollar mavjud emas.", show_alert=True)

    await callback.answer("⌛️ Test fayli tayyorlanmoqda...")
    
    # 1. DOCX generatsiya va yuborish (Smarter bot kabi)
    file_path = os.path.join(os.getcwd(), f"{title.replace(' ', '_')}_review.docx")
    generate_test_docx(title, questions, file_path)
    await callback.message.answer_document(
        FSInputFile(file_path),
        caption=f"📝 <b>{title}</b>\n\nQaysi savollarni o'chirishni rejalashtirish uchun ushbu fayldan foydalanishingiz mumkin.",
        reply_markup=main_menu,
        parse_mode="HTML"
    )

    # 2. Savollar ro'yxatini ko'rsatish
    text = f"🗑 <b>Savollarni o'chirish: {title}</b>\n\n"
    for i, q in enumerate(questions, 1):
        line = f"{i}. {q['text'][:50]}...\n"
        if len(text + line) > 3000:
            text += "...va yana boshqa savollar."
            break
        text += line
    
    text += "\n✏️ Savol raqamlarini quyidagi usullarda yuboring:\n"
    text += "• <b>Bittalik</b>: <code>1</code>\n"
    text += "• <b>Ro'yxat</b>: <code>1, 3, 5</code>\n"
    text += "• <b>Diapazon</b>: <code>5-10</code> (5 dan 10 gacha)\n"
    text += "• <b>Aralash</b>: <code>1, 4, 10-15, 20</code>"

    await state.update_data(del_test_id=test_id, all_questions=questions)
    await state.set_state(QuestionDeletion.waiting_for_indices)
    await callback.message.answer(text, reply_markup=cancel_kb, parse_mode="HTML")

@router.message(QuestionDeletion.waiting_for_indices)
async def process_del_indices(message: types.Message, state: FSMContext):
    if message.text == "❌ Bekor qilish":
        data = await state.get_data()
        test_id = data.get('del_test_id')
        await state.clear()
        
        # Contextual return
        title = db.get_test_title(test_id)
        count = db.get_question_count(test_id)
        await message.answer("🏠 Amaliyot bekor qilindi. Asosiy menyu tiklandi.", reply_markup=main_menu)
        return await message.answer(
            f"📗 <b>{title} ({count} ta savol)</b>\n\n"
            "Testlaringiz ustida amallar bajarishingiz mumkin...",
            reply_markup=get_test_management_keyboard(test_id), parse_mode="HTML"
        )

    raw_input = message.text.replace(" ", "")
    data = await state.get_data()
    all_q = data.get('all_questions', [])
    test_id = data.get('del_test_id')

    try:
        to_del_indices = set()
        parts = raw_input.split(",")
        for part in parts:
            if "-" in part:
                start, end = map(int, part.split("-"))
                for r in range(start, end + 1):
                    to_del_indices.add(r)
            else:
                to_del_indices.add(int(part))
        
        # Validate indices
        valid_indices = [idx for idx in to_del_indices if 1 <= idx <= len(all_q)]
        if not valid_indices:
            return await message.answer("⚠️ Notog'ri raqamlar kiritildi. Iltimos, ro'yxatdagi raqamlardan foydalaning.")

        # Prepare summary
        to_del_ids = [all_q[i-1]['id'] for i in sorted(valid_indices)]
        summary_text = f"⚠️ <b>Diqqat! Quyidagi {len(to_del_ids)} ta savol butunlay o'chiriladi:</b>\n\n"
        for i in sorted(valid_indices):
            summary_text += f"• {i}-savol: {all_q[i-1]['text'][:40]}...\n"
        
        summary_text += "\nDavom etishni xohlaysizmi?"

        await state.update_data(target_q_ids=to_del_ids)
        await state.set_state(QuestionDeletion.confirming)
        await message.answer(summary_text, reply_markup=get_ques_del_confirm_keyboard(test_id), parse_mode="HTML")

    except ValueError:
        await message.answer("⚠️ Iltimos, faqat raqamlar va belgilarni (+, -) namunadagidek yuboring: <code>1, 3, 10-15</code>", parse_mode="HTML")

@router.callback_query(QuestionDeletion.confirming, F.data.startswith("confirm_qdel_"))
async def confirm_qdel(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    q_ids = data.get('target_q_ids', [])
    test_id = data.get('del_test_id')
    
    db.delete_questions(q_ids)
    await callback.answer(f"✅ {len(q_ids)} ta savol muvaffaqiyatli o'chirildi!", show_alert=True)
    
    await state.clear()
    # Go back to management
    title = db.get_test_title(test_id)
    count = db.get_question_count(test_id)
    await callback.message.edit_text(
        f"📗 <b>{title} ({count} ta savol)</b>\n\n"
        "⌛️ Testlaringiz ustida amallar bajarishingiz mumkin...",
        reply_markup=get_test_management_keyboard(test_id), parse_mode="HTML"
    )

@router.callback_query(QuestionDeletion.confirming, F.data.startswith("cancel_qdel_"))
async def cancel_qdel(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    await state.clear()
    await callback.answer("O'chirish bekor qilindi.")
    
    # Go back to management
    title = db.get_test_title(test_id)
    count = db.get_question_count(test_id)
    await callback.message.edit_text(
        f"📗 <b>{title} ({count} ta savol)</b>\n\n"
        "⌛️ Testlaringiz ustida amallar bajarishingiz mumkin...",
        reply_markup=get_test_management_keyboard(test_id), parse_mode="HTML"
    )
