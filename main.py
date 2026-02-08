import asyncio
import logging
import os # To'g'ri joyda import qilindi
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command
from aiogram.types import FSInputFile

# O'zimiz yozgan fayllarni ulaymiz
from database import Database
from test_parser import LessonLabParser
from file_handler import FileHandler
from keyboards import (
    main_menu, 
    get_items_keyboard, 
    get_test_actions_keyboard, 
    get_crud_keyboard,
    profile_keyboard
)

# ⚠️ TOKENNI SHU YERGA QO'YING
TOKEN = "8145781782:AAFfD5AE78OGA74-U0YmJGu3l9AqGcIGIKQ"

# Botni va yordamchi vositalarni sozlash
bot = Bot(token=TOKEN)
dp = Dispatcher()
db = Database()
parser = LessonLabParser()
file_handler = FileHandler()

# --- 1. /start KOMANDASI ---
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    user_name = message.from_user.first_name
    await message.answer(
        f"Assalomu alaykum, {user_name}! <b>LessonLab</b> platformasiga xush kelibsiz.\n\n"
        "♻️ <b>Testlar</b> - Bu lug'atlaringizni quiz va yozish rejimlari orqali yodlashga yordam beradigan xizmatdir.\n\n"
        "- botga avvaldan qo'shilgan lug'at kitoblardan\n"
        "- '📕 Mening lug'atim' bo'limiga qo'shgan lug'atlaringizdan\n"
        "- '📗 Mening testlarim' bo'limiga qo'shgan testlaringizdan\n"
        "- guruhlarda va shaxsiy chatlarda\n\n"
        "botdan foydalaning va lug'atlaringizni hech kimning yordamisiz yodlang!\n\n"
        "👇 Quyidagi bo'limlardan birini tanlang:",
        reply_markup=main_menu,
        parse_mode="HTML"
    )

# --- 2. ASOSIY MENYU TUGMALARI ---

# 2.1 📕 Mening lug'atim
@dp.message(F.text == "📕 Mening lug'atim")
async def show_my_dictionaries(message: types.Message):
    user_id = message.from_user.id
    dicts = db.get_user_dictionaries(user_id)
    
    msg_text = (
        "📕 <b>Mening lug'atim</b>\n\n"
        "Bu shaxsiy lug'atlaringizni quiz test va savol-javob usullari orqali "
        "yodlash uchun ularni botga qo'shishga yordamlashuvchi xizmatdir.\n\n"
        "➕ <b>Qo'shish</b> - Lug'atlaringiz uchun yangi nomdagi to'plamlaringizni qo'shing!\n\n"
        "➖ <b>O'chirish</b> - O'chirish rejimiga o'ting va to'plamlaringizni o'chiring!\n\n"
        "⏳ <i>Qo'shilgan to'plamlar ustiga bosing va to'plamga doir lug'atlarni qo'shing!</i>"
    )

    if dicts:
        await message.answer(msg_text, reply_markup=get_items_keyboard(dicts, item_type="dict"), parse_mode="HTML")
    else:
        await message.answer(msg_text, reply_markup=get_crud_keyboard(item_type="dict"), parse_mode="HTML")

# 2.2 📗 Mening testlarim
@dp.message(F.text == "📗 Mening testlarim")
async def show_my_tests(message: types.Message):
    user_id = message.from_user.id
    tests = db.get_user_tests(user_id)
    
    msg_text = (
        "📗 <b>Mening testlarim</b>\n\n"
        "Bu shaxsiy testlaringizni quiz test va savol-javob usullari orqali "
        "yodlash uchun ularni botga qo'shishga yordamlashuvchi xizmatdir.\n\n"
        "➕ <b>Qo'shish</b> - Testlaringiz uchun yangi nomdagi to'plamlaringizni qo'shing!\n\n"
        "➖ <b>O'chirish</b> - O'chirish rejimiga o'ting va to'plamlaringizni o'chiring!\n\n"
        "⏳ <i>Qo'shilgan to'plamlar ustiga bosing va to'plamga doir testlarni qo'shing!</i>"
    )

    if tests:
        await message.answer(msg_text, reply_markup=get_items_keyboard(tests, item_type="test"), parse_mode="HTML")
    else:
        await message.answer(msg_text, reply_markup=get_crud_keyboard(item_type="test"), parse_mode="HTML")

# 2.3 👤 Profil
@dp.message(F.text == "👤 Profil")
async def show_profile(message: types.Message):
    user = message.from_user
    await message.answer(
        f"👤 <b>Foydalanuvchi:</b> {user.full_name}\n"
        f"ID: <code>{user.id}</code>\n\n"
        "⚙️ Profil sozlamalaringizni o'zgartirishingiz mumkin...",
        reply_markup=profile_keyboard,
        parse_mode="HTML"
    )

# 2.4 Boshqa bo'limlar (Stub)
@dp.message(F.text.in_({"♻️ Testlar", "🌐 Tarjima qilish", "⬇️ Yuklab olish"}))
async def show_stub(message: types.Message):
    await message.answer("🛠 Bu bo'lim tez orada ishga tushadi!")

# --- 3. TEST YARATISH (DOC VA TEXT) ---

# 3.1 Fayl yuklanganda
@dp.message(F.document)
async def handle_document(message: types.Message):
    document = message.document
    file_name = document.file_name
    file_ext = os.path.splitext(file_name)[1].lower()

    if file_ext not in ['.xlsx', '.docx', '.txt']:
        await message.answer("⚠️ Kechirasiz, faqat .xlsx, .docx yoki .txt formatlari qo'llab-quvvatlanadi.")
        return

    await message.answer("⏳ Fayl yuklanmoqda va tahlil qilinmoqda...")
    
    file = await bot.get_file(document.file_id)
    file_path = file.file_path
    
    # downloads papkasini tekshirish
    if not os.path.exists("downloads"):
        os.makedirs("downloads")
        
    destination = os.path.join("downloads", file_name)
    await bot.download_file(file_path, destination)

    parsed_data = None
    try:
        if file_ext == '.xlsx':
            parsed_data = file_handler.parse_excel(destination)
        elif file_ext == '.docx':
            text_content = file_handler.parse_word(destination)
            parsed_data = parser.parse_text(text_content)
            parsed_data['title'] = os.path.splitext(file_name)[0]
        elif file_ext == '.txt':
            with open(destination, 'r', encoding='utf-8') as f:
                text_content = f.read()
            parsed_data = parser.parse_text(text_content)
            parsed_data['title'] = os.path.splitext(file_name)[0]

        if not parsed_data or not parsed_data.get('questions'):
             await message.answer("⚠️ Fayldan savollar topilmadi. Formatni tekshiring.")
             return

        user_id = message.from_user.id
        if not parsed_data.get('title'):
            parsed_data['title'] = os.path.splitext(file_name)[0]
            
        test_id = db.save_full_test(user_id, parsed_data)
        os.remove(destination)

        await message.answer(
            f"✅ <b>Fayl muvaffaqiyatli yuklandi!</b>\n\n"
            f"📝 Sarlavha: {parsed_data['title']}\n"
            f"🔢 Savollar soni: {len(parsed_data['questions'])} ta\n\n"
            f"Testni '📗 Mening Testlarim' bo'limidan topishingiz mumkin.",
            parse_mode="HTML"
        )

    except Exception as e:
        await message.answer(f"❌ Xatolik yuz berdi: {str(e)}")
        if os.path.exists(destination):
            os.remove(destination)

# 3.2 Matn orqali
@dp.message(F.text & ~F.text.startswith("/")) 
async def handle_new_test_text(message: types.Message):
    # Menyudagi so'zlar bo'lsa, qaytarib yubormaslik uchun tekshiramiz
    if message.text in ["♻️ Testlar", "🌐 Tarjima qilish", "🏫 Mening Sinflarim", "📕 Mening lug'atim", "📗 Mening testlarim", "👤 Profil"]:
        return

    parsed_data = parser.parse_text(message.text)

    if not parsed_data['questions']:
        await message.answer(
            "⚠️ <b>Test yaratish formati:</b>\n\n"
            "#Mavzu Nomi\n"
            "Savol matni?\n"
            "+To'g'ri javob\n"
            "-Noto'g'ri javob",
            parse_mode="HTML"
        )
        return

    user_id = message.from_user.id
    test_id = db.save_full_test(user_id, parsed_data)

    await message.answer(
        f"✅ <b>Test muvaffaqiyatli saqlandi!</b>\n\n"
        f"📝 Sarlavha: {parsed_data['title']}\n"
        f"🔢 Savollar soni: {len(parsed_data['questions'])} ta",
        parse_mode="HTML"
    )

# --- 4. CALLBACK HANDLERS ---
@dp.callback_query(F.data.startswith("view_test_"))
async def view_test_details(callback: types.CallbackQuery):
    test_id = int(callback.data.split("_")[2])
    text = f"✅ <b>Test ID: {test_id}</b>\n\nTanlangan test bo'yicha amallar:"
    await callback.message.edit_text(text, reply_markup=get_test_actions_keyboard(test_id), parse_mode="HTML")

@dp.callback_query(F.data == "main_menu")
async def back_to_main(callback: types.CallbackQuery):
    await callback.message.delete()
    await callback.message.answer("🏠 Asosiy menyu", reply_markup=main_menu)

@dp.callback_query(F.data == "back_to_tests")
async def back_to_tests_list(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    tests = db.get_user_tests(user_id)
    if tests:
        await callback.message.edit_text("📗 Sizning Testlaringiz:", reply_markup=get_items_keyboard(tests, item_type="test"))
    else:
        await callback.message.edit_text("Sizda testlar yo'q.", reply_markup=get_crud_keyboard(item_type="test"))

# 4.4 Qo'shish tugmasi bosilganda (YANGI)
@dp.callback_query(F.data.in_({"add_test", "add_dict"}))
async def handle_add_button(callback: types.CallbackQuery):
    item_type = "test" if callback.data == "add_test" else "lug'at"
    
    msg = (
        f"➕ <b>Yangi {item_type} qo'shish</b>\n\n"
        f"Qo'shish uchun quyidagilardan birini qiling:\n"
        "1. 📄 <b>Excel (.xlsx)</b> yoki <b>Word (.docx)</b> fayl yuboring.\n"
        "2. ✍️ Quyidagi formatda <b>matn</b> yuboring:\n\n"
    )
    
    if item_type == "test":
        msg += (
            "#Mavzu Nomi\n"
            "Savol matni?\n"
            "+To'g'ri javob\n"
            "-Noto'g'ri javob"
        )
    else:
        msg += (
            "#Lug'at Nomi\n"
            "Word - Tarjima\n"
            "Apple - Olma"
        )
        
    await callback.message.answer(msg, parse_mode="HTML")
    await callback.answer() # Loadingni to'xtatish uchun

# 4.5 O'chirish tugmasi bosilganda (Stub)
@dp.callback_query(F.data.in_({"del_test", "del_dict"}))
async def handle_delete_button(callback: types.CallbackQuery):
    await callback.answer("🗑 O'chirish funksiyasi tez orada qo'shiladi!", show_alert=True)

# --- BOTNI ISHGA TUSHIRISH ---
async def main():
    logging.basicConfig(level=logging.INFO)
    
    # 1. Bot Menyu buyruqlarini o'rnatamiz
    commands = [
        types.BotCommand(command="start", description="Botni ishga tushirish"),
        types.BotCommand(command="help", description="Bot haqida yordam"),
        types.BotCommand(command="profile", description="Mening profilim"),
        types.BotCommand(command="add_test", description="Yangi test qo'shish"),
        types.BotCommand(command="stop", description="Jarayonni to'xtatish")
    ]
    await bot.set_my_commands(commands)
    
    print("🤖 LessonLab Bot ishga tushdi...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Bot to'xtatildi")