from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database import Database
from test_parser import LessonLabParser
from keyboards import main_menu, get_items_keyboard, get_test_management_keyboard, cancel_kb, stop_kb

router = Router()
# Barcha creation handlerlar faqat shaxsiy chatda ishlaydi
router.message.filter(F.chat.type == "private")
db = Database()
parser = LessonLabParser()

class TestCreation(StatesGroup):
    waiting_for_title = State()
    waiting_for_questions = State()
    waiting_for_new_title = State()

# === Yangi test to'plami yaratish ===
@router.callback_query(F.data == "add_test_start")
async def start_create_test(callback: types.CallbackQuery, state: FSMContext):
    await callback.message.answer(
        "✏️ <b>Test to'plami uchun nom kiriting...</b>\n\n"
        "Masalan, \"Qobiliyatni aniqlash testi\" yoki\n"
        "\"Ayiqlar haqida 10 ta savol\"",
        reply_markup=cancel_kb, parse_mode="HTML"
    )
    await state.set_state(TestCreation.waiting_for_title)
    await callback.answer()

@router.message(TestCreation.waiting_for_title)
async def process_test_title(message: types.Message, state: FSMContext):
    if message.text == "❌ Bekor qilish":
        await state.clear()
        tests = db.get_user_tests(message.from_user.id)
        await message.answer("🏠 Amaliyot bekor qilindi.", reply_markup=main_menu)
        return await message.answer("📗 Sizning testlaringiz:", reply_markup=get_items_keyboard(tests, db=db))

    title = message.text
    db.save_full_test(message.from_user.id, {'title': title, 'questions': []})
    await state.clear()
    await message.answer(
        f"✅ <b>'{title}' nomli to'plam muvaffaqiyatli yaratildi!</b>",
        reply_markup=main_menu, parse_mode="HTML"
    )
    tests = db.get_user_tests(message.from_user.id)
    await message.answer("📗 Sizning testlaringiz:", reply_markup=get_items_keyboard(tests, db=db))

# === Sarlavhani tahrirlash ===
@router.callback_query(F.data.startswith("edit_title_"))
async def start_edit_title(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    await state.update_data(editing_test_id=test_id)
    await callback.message.answer(
        "✏️ <b>To'plam uchun yangi nom kiriting...</b>",
        reply_markup=cancel_kb, parse_mode="HTML"
    )
    await state.set_state(TestCreation.waiting_for_new_title)
    await callback.answer()

@router.message(TestCreation.waiting_for_new_title)
async def process_new_title(message: types.Message, state: FSMContext):
    data = await state.get_data()
    test_id = data.get('editing_test_id')

    if message.text == "❌ Bekor qilish":
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

    new_title = message.text
    # Darhol kutish xabarini ko'rsatish
    loading_msg = await message.answer("⏳ Saqlanmoqda, iltimos kuting...")
    
    db.rename_test(test_id, new_title)
    await state.clear()

    # Kutish xabarini yangilash
    await loading_msg.edit_text(f"✅ Sarlavha <b>'{new_title}'</b> ga o'zgartirildi!", parse_mode="HTML")
    
    # Asosiy menyu + test boshqaruv paneli
    count = db.get_question_count(test_id)
    await message.answer("🏠 Asosiy menyu tiklandi.", reply_markup=main_menu)
    await message.answer(
        f"📗 <b>{new_title} ({count} ta savol)</b>\n\n"
        "Testlaringiz ustida amallar bajarishingiz mumkin...",
        reply_markup=get_test_management_keyboard(test_id), parse_mode="HTML"
    )

# === Savol qo'shish (qo'lda) ===
@router.callback_query(F.data.startswith("add_ques_"))
async def start_add_questions(callback: types.CallbackQuery, state: FSMContext):
    test_id = int(callback.data.split("_")[2])
    await state.update_data(current_test_id=test_id)
    await callback.message.answer(
        "⌛️ <b>Savollarni quyidagi namunadagidek yuboring:</b>\n\n"
        "1. O'zbekistonning poytaxti qaysi?\n"
        "- Samarqand\n"
        "+ Toshkent\n"
        "- Buxoro\n"
        "- Qashqadaryo\n\n"
        "2. 2 + 2 nechaga teng?\n"
        "- 3\n"
        "- 5\n"
        "- 6\n"
        "+ 4\n\n"
        "📌 <b>Qoidalar:</b>\n"
        "✅ To'g'ri javob oldiga <b>+</b> belgisini qo'ying.\n"
        "❌ Noto'g'ri javoblar oldiga <b>-</b> belgisini qo'ying.\n"
        "🔢 Savollarni raqamlashingiz shart emas, lekin raqamlasangiz ham tizim tushunadi.\n\n"
        "Bir nechta savol yuborishingiz mumkin. Tugatish uchun <b>⛔ To'xtatish</b> tugmasini bosing.",
        reply_markup=stop_kb, parse_mode="HTML"
    )
    await state.set_state(TestCreation.waiting_for_questions)
    await callback.answer()

@router.message(TestCreation.waiting_for_questions)
async def process_questions(message: types.Message, state: FSMContext):
    if message.text == "⛔ To'xtatish":
        data = await state.get_data()
        test_id = data.get('current_test_id')
        await state.clear()
        
        # Restore bottom bar and show management tools
        title = db.get_test_title(test_id)
        count = db.get_question_count(test_id)
        await message.answer("🏠 Savollar qo'shish to'xtatildi. Asosiy menyu tiklandi.", reply_markup=main_menu)
        return await message.answer(
            f"📗 <b>{title} ({count} ta savol)</b>\n\n"
            "Testlaringiz ustida amallar bajarishingiz mumkin...",
            reply_markup=get_test_management_keyboard(test_id), parse_mode="HTML"
        )

    data = await state.get_data()
    test_id = data.get('current_test_id')
    parsed = parser.parse_text(message.text)

    if not parsed['questions']:
        return await message.answer(
            "⚠️ <b>Formatda xatolik!</b>\n\n"
            "Iltimos, savollarni namunadagidek yuboring:\n\n"
            "<code>1. Savol matni?\n+ To'g'ri javob\n- Noto'g'ri javob</code>",
            parse_mode="HTML"
        )

    # Smart Duplicate Detection Flow (v12.8)
    duplicates = []
    for q in parsed['questions']:
        # Check if already exists in this test
        is_dup = db.find_duplicate_question(test_id, q)
        # Add it anyway (as per user instruction)
        new_id = db.add_single_question(test_id, q)
        if is_dup:
            duplicates.append(new_id)

    total_batch = len(parsed['questions'])
    dup_count = len(duplicates)

    if dup_count > 0:
        from keyboards import get_duplicate_management_keyboard
        await state.update_data(last_dup_ids=duplicates)
        await message.answer(
            f"✅ {total_batch} tadan {total_batch} ta test qo'shildi. {dup_count} tasi avval qo'shilgan.\n\n"
            f"<b>{total_batch} ta testdan {dup_count} tasi oldin qo'shilgan, oldin qo'shilgan testlarni olib tashlashni xohlaysizmi?</b>",
            reply_markup=get_duplicate_management_keyboard(test_id),
            parse_mode="HTML"
        )
    else:
        await message.answer(
            f"✅ {total_batch} tadan {total_batch} ta test qo'shildi. 0 tasi avval qo'shilgan.\n\n"
            "Yana yuborishingiz yoki <b>⛔ To'xtatish</b> tugmasini bosishingiz mumkin.",
            parse_mode="HTML"
        )

# === Dublikatlarni boshqarish ===
@router.callback_query(F.data.startswith("rem_dup_"))
async def remove_duplicates(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    dup_ids = data.get('last_dup_ids', [])
    if dup_ids:
        db.delete_questions(dup_ids)
        await callback.message.edit_text("✅ Dublikatlar olib tashlandi. Namunaga amal qilgan holda yangi test qo'shishingiz yoki test qo'shishni to'xtatishingiz mumkin.")
    else:
        await callback.message.edit_text("⚠️ O'chirish uchun dublikatlar topilmadi.")
    
    await callback.answer()

@router.callback_query(F.data.startswith("keep_dup_"))
async def keep_duplicates(callback: types.CallbackQuery, state: FSMContext):
    await callback.message.edit_text("📝 Dublikatlar qoldirildi. Namunaga amal qilgan holda yangi test qo'shishingiz yoki test qo'shishni to'xtatishingiz mumkin.")
    await callback.answer()
