from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
from database import Database
from keyboards import (
    get_items_keyboard, get_mode_selection_keyboard,
    get_timer_selection_keyboard, get_ready_keyboard,
    get_writing_type_selection_keyboard, get_comparison_selection_keyboard,
    get_test_action_keyboard, ikb
)
import math
import random

router = Router()
db = Database()
ITEMS_PER_PAGE = 8

# === Selection Logic ===
@router.callback_query(F.data == "select_dict")
async def select_dict_for_test(callback: types.CallbackQuery, state: FSMContext):
    dicts = db.get_user_dictionaries(callback.from_user.id)
    if not dicts:
        return await callback.answer("⚠️ Sizda hali lug'atlar yo'q!", show_alert=True)
    
    data = await state.get_data()
    selected = data.get("selected_dicts", [])
    
    await callback.message.edit_text(
        "📂 <b>Test uchun lug'atlarni tanlang:</b>\n"
        "<i>(Bir nechta lug'atni tanlashingiz mumkin)</i>",
        reply_markup=get_items_keyboard(dicts, item_type="dict", custom_prefix="run_sel_dict", selected_ids=selected),
        parse_mode="HTML"
    )

@router.callback_query(F.data.startswith("run_sel_dict_"))
async def toggle_dict_test_selection(callback: types.CallbackQuery, state: FSMContext):
    dict_id = int(callback.data.split("_")[-1])
    data = await state.get_data()
    selected = set(data.get("selected_dicts", []))
    
    if dict_id in selected:
        selected.remove(dict_id)
    else:
        selected.add(dict_id)
    
    selected_list = list(selected)
    await state.update_data(selected_dicts=selected_list)
    
    dicts = db.get_user_dictionaries(callback.from_user.id)
    await callback.message.edit_reply_markup(
        reply_markup=get_items_keyboard(dicts, item_type="dict", custom_prefix="run_sel_dict", selected_ids=selected_list)
    )

# === Settings Logic ===
@router.callback_query(F.data == "dict_settings_test")
async def manage_dict_settings(callback: types.CallbackQuery, state: FSMContext):
    await state.update_data(wizard_origin="dict")
    await callback.message.edit_text(
        "⚙️ <b>Lug'at testi sozlamalari</b>\n\n"
        "Rejimni tanlang:",
        reply_markup=get_mode_selection_keyboard(), parse_mode="HTML"
    )

# === Action Selection (same as tests) ===
@router.callback_query(F.data == "run_multi_dict")
async def dict_action_selection(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("selected_dicts", [])
    
    if not selected:
        return await callback.answer("⚠️ Iltimos, kamida bitta lug'atni tanlang!", show_alert=True)
    
    count = len(selected)
    
    settings = data.get("global_settings", {})
    mode = settings.get("mode", "Quiz mode")

    # Show the same action keyboard as tests
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="📱 Bu testni boshlash", callback_data="start_private_dict"))
    
    if mode == "Quiz mode" or mode == "quiz":
        builder.row(InlineKeyboardButton(text="✨ Guruhda QR kodli boshlash", callback_data="start_group_qr_dict"))
        builder.row(InlineKeyboardButton(text="🎛 Pult bilan boshlash", callback_data="start_group_remote_dict"))
        
    builder.row(InlineKeyboardButton(text="👥 Guruhda boshlash", callback_data="start_group_dict"))
    builder.row(InlineKeyboardButton(text="🔗 Testni ulashish", callback_data="share_dict_test"))
    builder.row(InlineKeyboardButton(text="⬅️ Orqaga", callback_data="back_to_select_dict"))
    
    dict_action_kb = builder.as_markup()

    await callback.message.edit_text(
        f"🚀 <b>Tanlangan {count} ta lug'at bilan nima qilamiz?</b>\n\n"
        "Kerakli usulni tanlang:",
        reply_markup=dict_action_kb, parse_mode="HTML"
    )

# === Back to dict selection ===
@router.callback_query(F.data == "back_to_select_dict")
async def back_to_dict_select(callback: types.CallbackQuery, state: FSMContext):
    await select_dict_for_test(callback, state)

def _prepare_dict_questions(selected, data):
    all_words = []
    titles = []
    for d_id in selected:
        name = db.get_dictionary_name(d_id)
        titles.append(f"#{name}")
        words = db.get_dictionary_words(d_id)
        all_words.extend(words)
        
    if not all_words:
        return None, None, None
    
    settings = data.get("global_settings", {
        "mode": "Quiz mode",
        "timer": "30 s",
        "comp": "100% teng"
    })
    
    prepared_questions = []
    if settings['mode'] == "Quiz mode":
        all_translations = [w[2] for w in all_words]
        for w_id, word, trans in all_words:
            correct = trans
            others = [t for t in all_translations if t != correct]
            distractors = random.sample(others, min(len(others), 3))
            
            options = [{'text': correct, 'is_correct': True}]
            for d in distractors:
                options.append({'text': d, 'is_correct': False})
            
            random.shuffle(options)
            
            prepared_questions.append({
                'id': w_id,
                'text': word,
                'options': options,
                'test_name': "Lug'atlarimdan"
            })
    else:
        for w_id, word, trans in all_words:
            prepared_questions.append({
                'id': w_id,
                'text': word,
                'options': [{'text': trans, 'is_correct': True}],
                'test_name': "Lug'atlarimdan"
            })
            
    random.shuffle(prepared_questions)
    return prepared_questions, titles, settings

# === Start Private Practice ===
@router.callback_query(F.data == "start_private_dict")
async def start_dict_test_summary(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("selected_dicts", [])
    
    if not selected:
        return await callback.answer("⚠️ Tanlangan lug'atlar topilmadi!", show_alert=True)
    
    prepared_questions, titles, settings = _prepare_dict_questions(selected, data)
    if not prepared_questions:
        return await callback.answer("⚠️ Tanlangan lug'atlarda so'zlar yo'q!", show_alert=True)
    
    await state.update_data(
        prepared_questions=prepared_questions,
        prepared_titles=titles,
        prepared_settings=settings
    )
    
    summary = (
        f"♻️ <b>Yangi Lug'at Testi</b>\n\n"
        f"<b>{' '.join(titles)}</b>\n"
        f"🖋 {len(prepared_questions)} ta savol\n"
        f"💬 {settings['mode']}\n"
        f"⏱ Har bir savolga {settings['timer']}\n\n"
        "/stop - Testni to'xtatish\n"
        "/next - Keyingi savolni olish\n\n"
        "🏁 Tayyor bo'lganingizda quyidagi tugmani bosing."
    )
    
    await callback.message.edit_text(summary, reply_markup=get_ready_keyboard(), parse_mode="HTML")

# === Guruhda QR kodli boshlash ===
@router.callback_query(F.data == "start_group_qr_dict")
async def start_group_qr_dict_logic(callback: types.CallbackQuery, state: FSMContext):
    from handlers.scanner_handlers import send_scanner_links
    data = await state.get_data()
    selected = data.get("selected_dicts", [])
    
    if not selected:
        return await callback.answer("⚠️ Tanlangan lug'atlar topilmadi!", show_alert=True)
    
    prepared_questions, titles, settings = _prepare_dict_questions(selected, data)
    if not prepared_questions:
        return await callback.answer("⚠️ Tanlangan lug'atlarda so'zlar yo'q!", show_alert=True)

    await callback.answer()
    
    # Custom test data for scanner
    custom_test_data = {
        'title': " | ".join(titles),
        'questions': prepared_questions,
        'students': [],
        'class_name': ''
    }
    
    # Use "dict" as test_id
    await send_scanner_links(
        callback.message, 
        test_id="dict_qr", 
        user_id=callback.from_user.id, 
        custom_test_data=custom_test_data
    )

# === Pult orqali lug'at boshlash ===
@router.callback_query(F.data == "start_group_remote_dict")
async def start_group_remote_dict_logic(callback: types.CallbackQuery, state: FSMContext):
    from handlers.scanner_handlers import send_scanner_links
    data = await state.get_data()
    selected = data.get("selected_dicts", [])
    
    if not selected:
        return await callback.answer("⚠️ Tanlangan lug'atlar topilmadi!", show_alert=True)
    
    prepared_questions, titles, settings = _prepare_dict_questions(selected, data)
    if not prepared_questions:
        return await callback.answer("⚠️ Tanlangan lug'atlarda so'zlar yo'q!", show_alert=True)

    await callback.answer()
    
    custom_test_data = {
        'title': " | ".join(titles),
        'questions': prepared_questions,
        'students': [],
        'class_name': ''
    }
    
    # Kelajakda remote_mode flagi qo'shilishi mumkin
    await send_scanner_links(
        callback.message, 
        test_id="dict_remote", 
        user_id=callback.from_user.id, 
        custom_test_data=custom_test_data,
        mode="remote"
    )


# === Guruhda boshlash (Inline query) ===
@router.callback_query(F.data == "start_group_dict")
async def start_group_dict_logic(callback: types.CallbackQuery, state: FSMContext):
    from handlers.group_handlers import pending_group_data
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

    data = await state.get_data()
    selected = data.get("selected_dicts", [])
    
    if not selected:
        return await callback.answer("⚠️ Tanlangan lug'atlar topilmadi!", show_alert=True)
    
    prepared_questions, titles, settings = _prepare_dict_questions(selected, data)
    if not prepared_questions:
        return await callback.answer("⚠️ Tanlangan lug'atlarda so'zlar yo'q!", show_alert=True)

    timer_str = settings.get('timer', '30 s')
    ws = int(timer_str.split(" ")[0])
    if "min" in timer_str:
        ws *= 60

    pending_group_data[callback.from_user.id] = {
        'test_ids': ["dict"], 'settings': settings,
        'titles': titles, 'questions': prepared_questions,
        'wait_sec': ws, 'timer_str': timer_str
    }

    inline_query = f"grouptest_{callback.from_user.id}"

    await callback.answer()
    await callback.message.edit_text(
        f"👥 <b>Guruhda Lug'at O'ynash</b>\n\n"
        f"📝 <b>{', '.join(titles)}</b>\n"
        f"❓ {len(prepared_questions)} ta so'z  ⏱ {timer_str}\n\n"
        "✅ Testlar tayyor!\n\n"
        "🚀 Quyidagi tugmani bosing va guruhni tanlang.\n"
        "Bot avtomatik ravishda testni boshlaydi!",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🚀 Guruhga yuborish", switch_inline_query=inline_query)],
            [InlineKeyboardButton(text="⬅️ Orqaga", callback_data="back_to_select_dict")]
        ])
    )

# === Testni ulashish ===
@router.callback_query(F.data == "share_dict_test")
async def share_dict_test_logic(callback: types.CallbackQuery, state: FSMContext):
    await callback.answer("🔗 Ulashish funksiyasi tez orada qo'shiladi!", show_alert=True)
