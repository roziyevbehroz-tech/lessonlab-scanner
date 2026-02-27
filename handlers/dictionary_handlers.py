from aiogram import Router, F, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from database import Database
from keyboards import (
    main_menu, cancel_kb, 
    get_dict_management_keyboard, get_dict_words_keyboard,
    get_multi_del_keyboard
)
import math

router = Router()
db = Database()

class DictState(StatesGroup):
    adding_dict = State()
    adding_word = State()

ITEMS_PER_PAGE = 8

# === Main Entry ===
@router.message(F.text.in_({"📕 Mening lug'atlarim", "📕 Mening lug'atim"}))
async def dictionary_main_menu(message: types.Message, state: FSMContext, page: int = 1):
    await state.clear()
    try:
        dicts = db.get_user_dictionaries(message.from_user.id)
        total_pages = math.ceil(len(dicts) / ITEMS_PER_PAGE) or 1
        
        start = (page - 1) * ITEMS_PER_PAGE
        end = start + ITEMS_PER_PAGE
        current_dicts = dicts[start:end]
        
        kb = get_dict_management_keyboard(current_dicts, page, total_pages)
        await message.answer(
            "📕 <b>Mening lug'atlarim</b>\n\nBu yerda o'z lug'atlaringizni yaratishingiz va boshqarishingiz mumkin.", 
            reply_markup=kb, 
            parse_mode="HTML"
        )
    except Exception as e:
        print(f"ERROR in dictionary_main_menu: {e}")
        await message.answer(f"❌ Xatolik yuz berdi: {e}")

@router.callback_query(F.data == "select_dict")
async def select_dict_cb(callback: types.CallbackQuery, state: FSMContext):
    await callback.message.delete()
    await dictionary_main_menu(callback.message, state)

@router.callback_query(F.data.startswith("dict_list_p_"))
async def dict_list_pagination(callback: types.CallbackQuery, state: FSMContext):
    page = int(callback.data.split("_")[-1])
    await callback.message.delete()
    await dictionary_main_menu(callback.message, state, page)

# === Add Dictionary ===
@router.callback_query(F.data == "add_dict")
async def start_add_dict(callback: types.CallbackQuery, state: FSMContext):
    await state.set_state(DictState.adding_dict)
    await callback.message.answer(
        "✏️ Lug'atlar to'plamingiz uchun nom kiriting...\n\n"
        "Masalan, “1-dars lug'atlari” yoki “Ranglar”", 
        reply_markup=cancel_kb
    )
    await callback.answer()

@router.message(DictState.adding_dict)
async def process_add_dict(message: types.Message, state: FSMContext):
    if message.text and "Bekor qilish" in message.text:
        await state.clear()
        return await dictionary_main_menu(message, state)
    
    db.add_dictionary(message.from_user.id, message.text)
    await message.answer(f"✅ <b>{message.text}</b> lug'ati yaratildi!", parse_mode="HTML", reply_markup=main_menu)
    await dictionary_main_menu(message, state)

# === Open Dictionary / Word List ===
@router.callback_query(F.data.startswith("open_dict_"))
async def open_dict_handler(callback: types.CallbackQuery, state: FSMContext, dict_id: int = None, page: int = 1):
    if not dict_id:
        dict_id = int(callback.data.split("_")[-1])
    
    await state.update_data(current_dict_id=dict_id)
    words = db.get_dictionary_words(dict_id)
    dict_name = db.get_dictionary_name(dict_id)
    
    total_pages = math.ceil(len(words) / ITEMS_PER_PAGE) or 1
    start = (page - 1) * ITEMS_PER_PAGE
    end = start + ITEMS_PER_PAGE
    current_words = words[start:end]
    
    kb = get_dict_words_keyboard(current_words, dict_id, page, total_pages)
    text = f"📂 <b>Lug'at: {dict_name}</b>\n\nJami so'zlar: {len(words)} ta"
    
    try:
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    except:
        await callback.message.answer(text, reply_markup=kb, parse_mode="HTML")
    await callback.answer()

@router.callback_query(F.data.startswith("dict_view_"))
async def dict_view_pagination(callback: types.CallbackQuery, state: FSMContext):
    parts = callback.data.split("_")
    dict_id = int(parts[2])
    page = int(parts[4])
    await open_dict_handler(callback, state, dict_id, page)

@router.callback_query(F.data.startswith("word_view_"))
async def word_click_auto_delete(callback: types.CallbackQuery, state: FSMContext):
    """Clicking a word automatically enters delete mode with that word selected"""
    word_id = int(callback.data.split("_")[-1])
    await state.update_data(sel_word_ids=[word_id])
    await word_delete_mode(callback, state)

# === Add Word ===
@router.callback_query(F.data.startswith("add_word_"))
async def start_add_word(callback: types.CallbackQuery, state: FSMContext):
    dict_id = int(callback.data.split("_")[-1])
    await state.update_data(current_dict_id=dict_id)
    await state.set_state(DictState.adding_word)
    await callback.message.answer(
        "📝 Yangi so'z va uning tarjimasini kiriting.\n\n"
        "Format: <b>so'z - tarjima</b>\n"
        "Masalan: <code>apple - olma</code>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await callback.answer()

@router.message(DictState.adding_word)
async def process_add_word(message: types.Message, state: FSMContext):
    if message.text and "Bekor qilish" in message.text:
        await state.clear()
        return await dictionary_main_menu(message, state)
    
    data = await state.get_data()
    dict_id = data.get("current_dict_id")
    
    import re
    # Har xil separatorlarni qo'llab-quvvatlash: dash, long dash, em-dash, colon, dot (if followed by space)
    # Shuningdek bulleto'larni (•, -, *) tozalash
    lines = message.text.split('\n')
    added_count = 0
    
    for line in lines:
        line = line.strip()
        if not line: continue
        
        # Sarlavhalarni (🔻, ▪️, #) o'tkazib yuborish
        if any(line.startswith(s) for s in ["🔻", "▪️", "#", "Unit"]):
            continue
            
        # Bulleto'larni (/s, •, - , * ) tozalash
        clean_line = re.sub(r'^[•\-\*\s\d\.]+', '', line).strip()
        
        # Separator bo'yicha ajratish: ' - ', ' – ', ' — ', ' : '
        # Yoki 'word /trans/ - translation' formatini qo'llab-quvvatlash
        parts = re.split(r'\s*[-–—:]\s*', clean_line, 1)
        
        if len(parts) == 2:
            word = parts[0].strip()
            trans = parts[1].strip()
            
            # IPA/Transcriptionni tozalash (agar kerak bo'lsa, /.../ qismini olib tashlash)
            # Masalan: "bed /bɛd/" -> "bed"
            word = re.sub(r'\s*/[^/]+/', '', word).strip()
            
            db.add_dictionary_word(dict_id, word, trans)
            added_count += 1

    if added_count > 0:
        await message.answer(f"✅ {added_count} ta so'z muvaffaqiyatli qo'shildi!", parse_mode="HTML")
    else:
        await message.answer(
            "⚠️ <b>Hech qanday so'z tanib olinmadi.</b>\n\n"
            "Iltimos, har bir qatorni quyidagi formatda yuboring:\n"
            "<code>so'z - tarjima</code>\n"
            "Yoki:\n"
            "<code>• so'z – tarjima</code>",
            parse_mode="HTML"
        )

# === Delete Mode (Dictionaries) ===
@router.callback_query(F.data == "del_dict_mode")
async def dict_delete_mode(callback: types.CallbackQuery, state: FSMContext, page: int = 1):
    dicts = db.get_user_dictionaries(callback.from_user.id)
    data = await state.get_data()
    selected = data.get("sel_dict_ids", [])
    
    total_pages = math.ceil(len(dicts) / ITEMS_PER_PAGE) or 1
    start = (page - 1) * ITEMS_PER_PAGE
    end = start + ITEMS_PER_PAGE
    
    kb = get_multi_del_keyboard(dicts[start:end], "dict", selected, page, total_pages)
    await callback.message.edit_text(
        "🗑 <b>O'chirish rejimi</b>\n\nO'chirmoqchi bo'lgan lug'atlaringizni tanlang:", 
        reply_markup=kb, 
        parse_mode="HTML"
    )

@router.callback_query(F.data.startswith("sel_del_dict_"))
async def toggle_dict_selection(callback: types.CallbackQuery, state: FSMContext):
    dict_id = int(callback.data.split("_")[-1])
    data = await state.get_data()
    selected = set(data.get("sel_dict_ids", []))
    
    if dict_id in selected:
        selected.remove(dict_id)
    else:
        selected.add(dict_id)
    
    await state.update_data(sel_dict_ids=list(selected))
    await dict_delete_mode(callback, state)

@router.callback_query(F.data == "exec_del_dict")
async def execute_dict_delete_conf(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("sel_dict_ids", [])
    if not selected:
        return await callback.answer("⚠️ Hech narsa tanlanmadi!")
    
    from keyboards import get_confirm_keyboard
    await callback.message.edit_text(
        "⚠️ <b>Diqqat!!!</b>\n\nTanlagan lug'atlaringizni o'chirmoqchimisiz?",
        reply_markup=get_confirm_keyboard("del_dict"),
        parse_mode="HTML"
    )

@router.callback_query(F.data == "confirm_del_dict")
async def confirm_dict_delete(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("sel_dict_ids", [])
    for d_id in selected:
        db.delete_dictionary(d_id)
    
    await state.update_data(sel_dict_ids=[])
    await callback.answer("✅ Tanlangan lug'atlar o'chirildi")
    await dictionary_main_menu(callback.message, state)

# === Word Selection & Action Mode ===
@router.callback_query(F.data == "del_word_mode")
async def word_delete_mode(callback: types.CallbackQuery, state: FSMContext, page: int = 1):
    data = await state.get_data()
    dict_id = data.get("current_dict_id")
    words = db.get_dictionary_words(dict_id)
    selected = data.get("sel_word_ids", [])
    
    total_pages = math.ceil(len(words) / ITEMS_PER_PAGE) or 1
    start = (page - 1) * ITEMS_PER_PAGE
    end = start + ITEMS_PER_PAGE
    
    kb = get_multi_del_keyboard(words[start:end], "word", selected, page, total_pages, dict_id)
    await callback.message.edit_text(
        "🗑 <b>Amal tanlash</b>\n\nO'chirmoqchi yoki tahrirlamoqchi bo'lgan so'zlarni tanlang:", 
        reply_markup=kb, 
        parse_mode="HTML"
    )

@router.callback_query(F.data.startswith("sel_del_word_"))
async def toggle_word_selection(callback: types.CallbackQuery, state: FSMContext):
    word_id = int(callback.data.split("_")[-1])
    data = await state.get_data()
    selected = set(data.get("sel_word_ids", []))
    
    if word_id in selected:
        selected.remove(word_id)
    else:
        selected.add(word_id)
    
    await state.update_data(sel_word_ids=list(selected))
    await word_delete_mode(callback, state)

@router.callback_query(F.data.startswith("del_word_"))
async def word_del_pagination(callback: types.CallbackQuery, state: FSMContext):
    parts = callback.data.split("_")
    if "_p_" in callback.data:
        dict_id = int(parts[2])
        page = int(parts[4])
        await word_delete_mode(callback, state, page)

@router.callback_query(F.data == "exec_del_word")
async def execute_word_delete_conf(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("sel_word_ids", [])
    if not selected:
        return await callback.answer("⚠️ Hech narsa tanlanmadi!")
    
    from keyboards import get_confirm_keyboard
    await callback.message.edit_text(
        "⚠️ <b>Diqqat!!!</b>\n\nTanlangan so'zlarni o'chirmoqchimisiz?",
        reply_markup=get_confirm_keyboard("del_word"),
        parse_mode="HTML"
    )

@router.callback_query(F.data == "confirm_del_word")
async def confirm_word_delete(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("sel_word_ids", [])
    dict_id = data.get("current_dict_id")
    for w_id in selected:
        db.delete_dictionary_word(w_id)
    
    await state.update_data(sel_word_ids=[])
    await callback.answer("✅ Tanlangan so'zlar o'chirildi")
    await open_dict_handler(callback, state, dict_id)

@router.callback_query(F.data == "exec_edit_word")
async def execute_edit_word_bulk(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("sel_word_ids", [])
    if not selected:
        return await callback.answer("⚠️ Hech narsa tanlanmadi!")
    
    # Tanlangan so'zlarni yig'ish
    words_to_edit = []
    dict_id = data.get("current_dict_id")
    all_words = db.get_dictionary_words(dict_id) # [(id, word, trans), ...]
    
    for w in all_words:
        if w[0] in selected:
            words_to_edit.append(f"{w[1]} — {w[2]}")
    
    if not words_to_edit:
        return await callback.answer("⚠️ So'zlar topilmadi!")

    words_text = "\n".join(words_to_edit)
    await state.set_state(DictState.adding_word)
    
    await callback.message.answer(
        "📝 <b>Tahrirlash rejimi</b>\n\n"
        "Quyidagi so'zlarni nusxalab oling, tahrirlang va qayta jo'nating:\n\n"
        f"<blockquote>{words_text}</blockquote>\n"
        "<i>Eslatma: Qayta yuborganingizda ular lug'atga yangidan qo'shiladi.</i>",
        parse_mode="HTML",
        reply_markup=cancel_kb
    )
    await callback.answer()

@router.callback_query(F.data == "exec_edit_dict")
async def execute_edit_dict_bulk(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("sel_dict_ids", [])
    if not selected:
        return await callback.answer("⚠️ Hech narsa tanlanmadi!")
    
    dicts = db.get_user_dictionaries(callback.from_user.id)
    dict_names = [d[1] for d in dicts if d[0] in selected]
    
    dict_text = "\n".join(dict_names)
    await state.set_state(DictState.adding_dict)
    
    await callback.message.answer(
        "📝 <b>Lug'at nomlarini tahrirlash</b>\n\n"
        "Quyidagi nomlarni nusxalab oling, tahrirlang va qayta jo'nating:\n\n"
        f"<blockquote>{dict_text}</blockquote>",
        parse_mode="HTML",
        reply_markup=cancel_kb
    )
    await callback.answer()

@router.callback_query(F.data == "cancel_action")
async def cancel_action_handler(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    # Qayerdan kelganini aniqlash
    if "sel_word_ids" in data and data["sel_word_ids"]:
        await word_delete_mode(callback, state)
    else:
        await dict_delete_mode(callback, state)
    await callback.answer()

@router.callback_query(F.data.startswith("fetch_words_"))
async def fetch_words_handler(callback: types.CallbackQuery):
    dict_id = int(callback.data.split("_")[-1])
    dict_name = db.get_dictionary_name(dict_id)
    words = db.get_dictionary_words(dict_id)
    
    if not words:
        return await callback.answer("⚠️ Bu lug'atda so'zlar mavjud emas!", show_alert=True)
    
    # Format: <blockquote>Mening lug'atim(name) ... - word - trans</blockquote>
    words_text = "\n".join([f"• {w[1]} — {w[2]}" for w in words])
    
    header = f"📕 Mening lug'atim({dict_name} ({len(words)} ta))"
    full_message = f"<blockquote expandable><b>{header}</b>\n\n{words_text}</blockquote>"
    
    await callback.message.answer(full_message, parse_mode="HTML")
    await callback.answer()

@router.callback_query(F.data == "none")
async def none_callback(callback: types.CallbackQuery):
    await callback.answer()
