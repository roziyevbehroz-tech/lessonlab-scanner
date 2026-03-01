import asyncio
import os
from dotenv import load_dotenv
print("[STARTUP] Loading .env...")
load_dotenv()  # Load environment variables before importing handlers
print("[STARTUP] .env loaded.")
import json
import paho.mqtt.client as mqtt
import threading
import pandas as pd
import io
from aiogram import Bot, Dispatcher, F, types, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import FSInputFile, BufferedInputFile, MenuButtonDefault, InlineQueryResultArticle, InputTextMessageContent, ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

print("[STARTUP] Initializing DB...")
from database import Database
db = Database()
print("[STARTUP] DB initialized.")

from test_parser import LessonLabParser
from file_handler import FileHandler
from keyboards import (
    main_menu, inline_main_menu, get_test_selection_menu, get_items_keyboard,
    get_crud_keyboard, cancel_kb, profile_keyboard, maxsus_menu
)

print("[STARTUP] Importing handlers...")
from handlers import (
    creation_handlers, scanner_handlers,
    test_handlers, practice_handlers,
    group_handlers, admin_handlers,
    dictionary_handlers, quiz_handlers
)
print("[STARTUP] Handlers imported.")

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from services.reporter import send_daily_email_report

TOKEN = "8145781782:AAFfD5AE78OGA74-U0YmJGu3l9AqGcIGIKQ"
bot = Bot(token=TOKEN)
dp = Dispatcher()
parser = LessonLabParser()
file_handler = FileHandler()

main_router = Router() # Created main_router

# === /start (faqat shaxsiy chat) ===
from aiogram.filters import CommandObject
@main_router.message(Command("start"), F.chat.type == "private") # Registered on main_router
async def cmd_start(message: types.Message, state: FSMContext, command: CommandObject):
    await state.clear()
    user_id = message.from_user.id
    db.update_user_activity(
        user_id=user_id,
        full_name=message.from_user.full_name,
        username=message.from_user.username
    )
    
    args = command.args
    if args and args.startswith("share_test_"):
        # 1. Parse Test ID
        try:
            test_id = int(args.split("_")[2])
        except ValueError:
            return await message.answer("❌ Noto'g'ri havola!")
            
        # 2. Check source
        source_title = db.get_test_title(test_id)
        if not source_title or source_title == "Noma'lum":
            return await message.answer("❌ Kechirasiz, bu test o'chirilgan yoki topilmadi.")
            
        await message.answer(f"⏳ <b>{source_title}</b> testi sizning bazangizga nusxalanmoqda...", parse_mode="HTML")
        
        # 3. Execute Clone
        new_test_id = db.clone_test(test_id, user_id)
        
        if new_test_id:
            # 4. Success -> Show Test Actions
            from keyboards import get_test_action_keyboard
            await state.update_data(selected_tests=[new_test_id])
            
            await message.answer(
                f"✅ <b>Test muvaffaqiyatli saqlandi!</b>\n\n"
                f"Siz endi bu testni o'z o'quvchilaringiz bilan ishlatishingiz mumkin. Nima qilamiz?",
                reply_markup=get_test_action_keyboard(mode="quiz"),
                parse_mode="HTML"
            )
            return
        else:
            return await message.answer("❌ Testni nusxalashda xatolik yuz berdi. Iltimos keyinroq urinib ko'ring.")

    # Normal Start
    await message.answer(
        f"✨ 👋 Assalomu alaykum, <b>{message.from_user.full_name}</b>!\n\n",
        reply_markup=main_menu,
        parse_mode="HTML"
    )

# === INLINE QUERY HANDLER (MiniApp Action Integration) ===
import re
from aiogram.types import InlineQueryResultArticle, InputTextMessageContent

@main_router.inline_query(lambda query: re.match(r"^(private|qr|remote|group|share)_(test|dict)_(\d+)$", query.query))
async def inline_miniapp_action_handler(inline_query: types.InlineQuery):
    user_id = inline_query.from_user.id
    query_text = inline_query.query
    parts = query_text.split('_')
    
    if len(parts) != 3:
        return await inline_query.answer([], cache_time=1)
        
    action_type, item_type, item_id = parts
    
    # Format a nice title
    action_names = {
        'private': 'Yakkaxon (Private)',
        'qr': 'Guruhda QR Bilim',
        'remote': 'Guruxda PULT bilan',
        'group': 'Odatiy Guruh (Poll)',
        'share': 'Ulashish'
    }
    
    item_names = {'test': 'Testni', 'dict': 'Lug\'atni'}
    title = f"🚀 {item_names.get(item_type, 'Itemni')} {action_names.get(action_type, action_type)} boshlash"
    
    trigger_text = f"⏳ Boshlanmoqda...\n[MINIAPP_ACTION:{query_text}]"
    
    result = InlineQueryResultArticle(
        id=f"action_{query_text}",
        title=title,
        description=f"Ushbu harakatni tasdiqlash uchun ustiga bosing",
        input_message_content=InputTextMessageContent(message_text=trigger_text)
    )
    await inline_query.answer([result], cache_time=1, is_personal=True)



# === INLINE QUERY HANDLER (guruhga test yuborish) ===
@main_router.inline_query(F.query.startswith("grouptest_")) # Registered on main_router
async def inline_quiz_handler(inline_query: types.InlineQuery):
    user_id = inline_query.from_user.id
    # Pending data borligini tekshirish
    pdata = group_handlers.pending_group_data.get(user_id)
    if not pdata:
        return await inline_query.answer([], cache_time=1)

    titles = pdata.get('titles', ['Test'])
    q_count = len(pdata.get('questions', []))
    timer_str = pdata.get('timer_str', '30 s')

    trigger_text = f"⏳ Test guruhga yuklanmoqda...\n[TID:quiz_UID:{user_id}]"
    result = InlineQueryResultArticle(
        id="group_quiz",
        title="🏁 Guruhda test boshlash",
        description=f"📝 {', '.join(titles)} | ❓ {q_count} savol | ⏱ {timer_str}",
        input_message_content=InputTextMessageContent(message_text=trigger_text)
    )
    await inline_query.answer([result], cache_time=1)

# === VIA_BOT CATCHER (inline trigger xabarni guruhda ushlash) ===
import re
@main_router.message(F.chat.type.in_({"group", "supergroup"}), F.via_bot) # Registered on main_router
async def catch_inline_trigger(message: types.Message):
    if not message.text or "[TID:" not in message.text:
        return
    bot_info = await message.bot.me()
    if message.via_bot.id != bot_info.id:
        return
    match = re.search(r"\[TID:[\w-]+_UID:(\d+)\]", message.text)
    if not match:
        return
    user_id = int(match.group(1))

    # Inline trigger xabarni o'chirish
    try:
        await message.delete()
    except:
        pass

    # Pending data olish
    pdata = group_handlers.pending_group_data.pop(user_id, None)
    if not pdata:
        await message.bot.send_message(
            message.chat.id,
            "⚠️ Test ma'lumotlari topilmadi!\n"
            "Avval shaxsiy chatda testlarni tanlang:\n"
            "Bot: @uzlessonlabbot → ♻️ Testlar → 👥 Guruhda o'ynash",
        )
        return

    # Guruhda quiz boshlash
    await group_handlers.start_group_quiz_in_chat(
        bot=message.bot,
        chat_id=message.chat.id,
        user_id=user_id,
        user_full_name=message.from_user.full_name,
        pdata=pdata
    )

# === Asosiy menyu tugmalari (faqat shaxsiy chat) ===
@main_router.message(F.chat.type == "private", F.text == "♻️ Testlar") # Registered on main_router
async def show_test_menu(message: types.Message):
    await message.answer(
        "♻️ <b>Testlar</b> — Bu lug'atlaringizni quiz va yozish rejimlari orqali yodlashga yordam beradigan xizmatdir.\n\n"
        "• Botga avvaldan qo'shilgan lug'at kitoblardan\n"
        "• \"📕 Mening lug'atim\" bo'limiga qo'shgan lug'atlaringizdan\n"
        "• \"📗 Mening testlarim\" bo'limiga qo'shgan testlaringizdan\n"
        "• Guruhlarda va shaxsiy chatlarda\n\n"
        "Botdan foydalaning va lug'atlaringizni hech kimning yordamisiz yodlang!\n\n"
        "⌛️ Quyidagi bo'limlardan biri uchun savollar ro'yxatini tanlang va testni boshlang:",
        reply_markup=get_test_selection_menu(), parse_mode="HTML"
    )

@main_router.message(F.chat.type == "private", F.text == "👤 Profil") # Registered on main_router
async def show_profile(message: types.Message):
    user = message.from_user
    await message.answer(
        f"👤 <b>{user.full_name}</b>\n"
        f"🆔 <code>{user.id}</code>\n\n"
        "⚙️ Profil sozlamalaringizni boshqaring:",
        reply_markup=profile_keyboard, parse_mode="HTML"
    )

@main_router.message(F.chat.type == "private", F.text == "⚙️ Maxsus")
async def show_maxsus_menu(message: types.Message):
    await message.answer("🛠 Maxsus xizmatlar oynasiga kirdingiz:", reply_markup=maxsus_menu)

@main_router.message(F.chat.type == "private", F.text == "🏠 Asosiy menyu")
async def back_to_main_menu_text(message: types.Message):
    await message.answer("🏠 Asosiy menyuga qaytdingiz:", reply_markup=main_menu)

@main_router.message(F.chat.type == "private", F.text == "🌐 Tarjima qilish")
async def show_translate(message: types.Message):
    await message.answer("🌐 <b>Tarjima qilish</b> xizmati tez orada ishga tushadi!", reply_markup=maxsus_menu, parse_mode="HTML")

@main_router.message(F.chat.type == "private", F.text == "⬇️ Yuklab olish")
async def show_download(message: types.Message):
    await message.answer("📥 <b>Yuklab olish</b> bo'limi tez orada qo'shiladi!", reply_markup=maxsus_menu, parse_mode="HTML")

# === Poll Answer Handler (guruh quiz uchun) ===
@dp.poll_answer()
async def handle_poll_answer(poll_answer: types.PollAnswer):
    """Barcha poll javoblarini qabul qilish — guruh quiz uchun."""
    if poll_answer.option_ids:  # Bo'sh javob (retracted) bo'lmasa
        await group_handlers.handle_group_poll_answer(poll_answer, bot)

# === Fayl yuklash (docx/xlsx/txt) ===
@main_router.message(F.chat.type == "private", F.document) # Registered on main_router
async def handle_document(message: types.Message):
    doc = message.document
    file_ext = os.path.splitext(doc.file_name)[1].lower()

    if file_ext not in ['.xlsx', '.docx', '.txt']:
        await message.answer("⚠️ Faqat .xlsx, .docx yoki .txt formatlar qo'llab-quvvatlanadi.", reply_markup=main_menu)
        return

    await message.answer("⏳ Fayl yuklanmoqda va tahlil qilinmoqda...")
    os.makedirs("downloads", exist_ok=True)
    path = os.path.join("downloads", doc.file_name)
    file = await bot.get_file(doc.file_id)
    await bot.download_file(file.file_path, path)

    try:
        if file_ext == '.xlsx':
            parsed = file_handler.parse_excel(path)
        elif file_ext == '.docx':
            text = file_handler.parse_word(path)
            parsed = parser.parse_text(text)
            parsed['title'] = os.path.splitext(doc.file_name)[0]
        else:
            with open(path, 'r', encoding='utf-8') as f:
                parsed = parser.parse_text(f.read())
            parsed['title'] = os.path.splitext(doc.file_name)[0]

        if not parsed.get('questions'):
            await message.answer("⚠️ Fayldan savollar topilmadi. Formatni tekshiring.", reply_markup=main_menu)
            return

        db.save_full_test(message.from_user.id, parsed)
        await message.answer(
            f"✅ <b>Fayl muvaffaqiyatli yuklandi!</b>\n\n"
            f"📝 Sarlavha: {parsed['title']}\n"
            f"🔢 Savollar soni: {len(parsed['questions'])} ta",
            reply_markup=main_menu,
            parse_mode="HTML"
        )
    except Exception as e:
        await message.answer(f"❌ Xatolik: {e}", reply_markup=main_menu)
    finally:
        if os.path.exists(path): os.remove(path)

# === Matn orqali test yaratish ===
@main_router.message(F.chat.type == "private", F.text & ~F.text.startswith("/"), StateFilter(None)) # Registered on main_router
async def handle_text_test(message: types.Message):
    skip = ["♻️ Testlar", "🌐 Tarjima qilish", "📕 Mening lug'atim", "📕 Mening lug'atlarim",
            "📗 Mening testlarim", "⬇️ Yuklab olish", "👤 Profil", "❌ Bekor qilish", "⛔ To'xtatish"]
    if message.text in skip:
        return

    parsed = parser.parse_text(message.text)
    if not parsed['questions']:
        await message.answer(
            "⚠️ <b>Test formati noto'g'ri.</b>\n\n"
            "Namuna:\n"
            "<code>#Mavzu nomi\n"
            "Savol matni?\n"
            "+To'g'ri javob\n"
            "-Noto'g'ri javob</code>",
            reply_markup=main_menu,
            parse_mode="HTML"
        )
        return

    db.save_full_test(message.from_user.id, parsed)
    await message.answer(
        f"✅ <b>Test muvaffaqiyatli saqlandi!</b>\n\n"
        f"📝 Sarlavha: {parsed['title']}\n"
        f"🔢 Savollar: {len(parsed['questions'])} ta",
        reply_markup=main_menu,
        parse_mode="HTML"
    )

# Routers inclusion logic (Order matters!)
dp.include_router(quiz_handlers.router)
dp.include_router(dictionary_handlers.router)
dp.include_router(creation_handlers.router)
practice_handlers.dispatcher = dp
dp.include_router(practice_handlers.router)
dp.include_router(group_handlers.router)
dp.include_router(test_handlers.router)
dp.include_router(scanner_handlers.router)
dp.include_router(admin_handlers.router)
dp.include_router(main_router) # LAST: contains /start and broad text handlers


# === Scanner natijalarini qabul qilish ===
@dp.message(F.web_app_data)
async def handle_scanner_data(message: types.Message):
    from handlers.scanner_handlers import scanner_sessions
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

    try:
        raw = message.web_app_data.data
        print(f"[SCANNER/MINIAPP] Received web_app_data ({len(raw)} bytes): {raw[:200]}")
        
        # 2. Otherwise handle as Scanner JSON Result
        data = json.loads(raw)
        action = data.get("action", "") or data.get("a", "")

        if action == "llab_qr_results":
            # === Get test info from session or data ===
            user_id = message.from_user.id
            session = scanner_sessions.pop(user_id, None)

            title = data.get("title") or data.get("n", "Test")
            total_q = data.get("total_questions") or data.get("q", 0)
            class_name = ""
            test_id = data.get("t", 0)
            target_chat_id = message.chat.id  # default: private chat

            if session:
                target_chat_id = session.get('chat_id', message.chat.id)
                title = session.get('title', title)
                total_q = session.get('total_q', total_q)
                class_name = session.get('class_name', '')
                test_id = session.get('test_id', test_id)

            # === Parse scores from any format ===
            scores = {}

            if "scores" in data:
                for sid, s in data["scores"].items():
                    scores[sid] = {
                        'name': s.get('n', f'#{sid}'),
                        'correct': s.get('c', 0),
                        'total': s.get('t', 0)
                    }
            elif "r" in data and "c" in data and "s" in data:
                correct_answers = data["c"]
                student_names = data["s"]
                all_r = data["r"]
                for q_idx, q_results in all_r.items():
                    correct_idx = correct_answers.get(str(q_idx))
                    if correct_idx is None:
                        correct_idx = correct_answers.get(
                            int(q_idx) if str(q_idx).isdigit() else q_idx, -1
                        )
                    for sid, ans_idx in q_results.items():
                        if sid not in scores:
                            scores[sid] = {
                                'name': student_names.get(str(sid), f'#{sid}'),
                                'correct': 0, 'total': 0
                            }
                        scores[sid]['total'] += 1
                        if int(ans_idx) == int(correct_idx):
                            scores[sid]['correct'] += 1
            elif "results" in data:
                all_results = data["results"]
                for q_idx, q_results in all_results.items():
                    for sid, r in q_results.items():
                        if sid not in scores:
                            scores[sid] = {
                                'name': r.get('name', f'#{sid}'),
                                'correct': 0, 'total': 0
                            }
                        scores[sid]['total'] += 1
                        if r.get('isCorrect'):
                            scores[sid]['correct'] += 1

            # === Build leaderboard message ===
            # QR: sorted by correct answers only (no time)
            sorted_scores = sorted(
                scores.values(),
                key=lambda x: x['correct'],
                reverse=True
            )

            medals = ['\U0001f947', '\U0001f948', '\U0001f949']

            # Header
            lines = [f"\U0001f3c6 \u00ab\u267b\ufe0f {title}\u00bb testi yakunlandi!\n"]
            if class_name:
                lines.append(f"\U0001f3eb {class_name}")
            lines.append(f"\u2753 Jami savollar: {total_q}")
            lines.append("")

            # Leaderboard
            if sorted_scores:
                for i, s in enumerate(sorted_scores):
                    pct = round((s['correct'] / total_q) * 100) if total_q > 0 else 0
                    medal = medals[i] if i < 3 else f"{i+1}."
                    lines.append(f"{medal} {s['name']} \u2014 {s['correct']}/{total_q} ({pct}%)")
                lines.append("")
                lines.append("\U0001f3c6 G\u2018oliblarni tabriklaymiz!")
            else:
                lines.append("Natijalar topilmadi.")

            leaderboard_text = "\n".join(lines)

            # Buttons
            buttons = []
            if test_id:
                buttons.append([InlineKeyboardButton(
                    text="\U0001f504 Qayta boshlash!",
                    callback_data=f"llab_qr_{test_id}"
                )])
                buttons.append([InlineKeyboardButton(
                    text="\U0001f680 Bu testni boshlash",
                    callback_data=f"run_sel_{test_id}"
                )])

            keyboard = InlineKeyboardMarkup(inline_keyboard=buttons) if buttons else None

            # === Send to originating chat ===
            if target_chat_id != message.chat.id:
                # Send to group
                await bot.send_message(
                    target_chat_id,
                    leaderboard_text,
                    parse_mode=None,
                    reply_markup=keyboard
                )
                # Confirmation in private
                await message.answer(
                    "\u2705 Natijalar guruhga yuborildi!",
                    reply_markup=main_menu
                )
            else:
                # Private chat — send directly
                await message.answer(
                    leaderboard_text,
                    parse_mode=None,
                    reply_markup=keyboard
                )
            
            # Increment test count for scanner admin
            db.increment_user_test_count(message.from_user.id)

        elif action == "finish_test":
            results = data.get("results", {})
            correct = sum(1 for r in results.values() if r.get("isCorrect"))
            total = len(results)
            await message.answer(
                f"\U0001f4ca <b>Natijalar qabul qilindi!</b>\n\n"
                f"\u2705 To'g'ri: {correct} ta\n"
                f"\u274c Noto'g'ri: {total - correct} ta",
                reply_markup=main_menu,
                parse_mode="HTML"
            )
    except Exception as e:
        import traceback
        traceback.print_exc()
        await message.answer(f"\u26a0\ufe0f Xatolik: {e}", reply_markup=main_menu)

# === Asosiy menyu callback ===
@dp.callback_query(F.data == "main_menu")
async def handle_main_menu(callback: types.CallbackQuery):
    await callback.message.delete()
    await callback.message.answer("🏠 Asosiy menyu", reply_markup=main_menu)

# === MQTT SETUP (Results Receiver) ===
# === MQTT SETUP (Results Receiver) ===
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def on_connect(client, userdata, flags, rc, properties):
    print(f"MQTT Connected with result code {rc}")
    client.subscribe("llab/results")

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        chat_id = payload.get('chat_id')
        results = payload.get('results')
        
        if chat_id and results:
            # Metadata from payload (v12.4 Persistence Fix)
            total_questions = payload.get('total_q', len(results))
            
            # 1. Process results: {qIdx: {studentId: {name, answer, isCorrect}}} 
            student_stats = {}
            for q_idx, scans in results.items():
                for s_id, data in scans.items():
                    name = data.get('name', 'Unknown')
                    if s_id not in student_stats:
                        student_stats[s_id] = {'name': name, 'correct': 0}
                    
                    if data.get('isCorrect'):
                        student_stats[s_id]['correct'] += 1

            # 2. Sort results by Correct answers (descending)
            sorted_students = sorted(
                student_stats.values(), 
                key=lambda x: x['correct'], 
                reverse=True
            )

            # 3. Apply Standard Competition Ranking (1, 1, 3...)
            final_data = []
            display_rank = 1
            for i, stats in enumerate(sorted_students):
                if i > 0 and stats['correct'] < sorted_students[i-1]['correct']:
                    display_rank = i + 1
                
                correct_count = stats['correct']
                wrong_count = max(0, total_questions - correct_count)
                score_pct = int((correct_count / total_questions) * 100) if total_questions > 0 else 0
                
                final_data.append({
                    "O'rin": display_rank,
                    "Ism": stats['name'],
                    "To'g'ri": correct_count,
                    "Xato": wrong_count,
                    "Foiz": f"{score_pct}%"
                })
            
            # 4. Generate Excel report
            output = io.BytesIO()
            df = pd.DataFrame(final_data)
            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                df.to_excel(writer, index=False, sheet_name='Natijalar')
                
                # Auto-adjust columns width
                worksheet = writer.sheets['Natijalar']
                for idx, col in enumerate(df.columns):
                    series = df[col]
                    max_len = max(series.astype(str).map(len).max(), len(col)) + 2
                    worksheet.set_column(idx, idx, max_len)
                
            output.seek(0)
            
            # Send to Telegram (Thread safe)
            asyncio.run_coroutine_threadsafe(
                bot.send_document(
                    chat_id=chat_id,
                    document=BufferedInputFile(output.read(), filename="natijalar.xlsx"),
                    caption=f"🏁 Test yakunlandi!\n📊 Natijalar: {len(final_data)} ta o'quvchi qatnashdi."
                ),
                loop
            )
            print(f"Results sent to {chat_id}")
            
            # Increment test count for the owner (optional, depending on payload availability)
            # In this context, chat_id is usually where results are sent.
            db.increment_user_test_count(chat_id)
            
    except Exception as e:
        print(f"MQTT Error: {e}")

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

async def _connect_mqtt():
    """MQTT ulanishni orqa fonda bajarish (main threadni bloklamaydi)"""
    try:
        await asyncio.to_thread(mqtt_client.connect, "broker.emqx.io", 1883, 60)
        mqtt_client.loop_start()
        print("[MQTT] Brokerga ulandi!")
    except Exception as e:
        print(f"[MQTT] Ulanib bo'lmadi (internet yo'q?): {e}")

# === Typing indicator middleware ===
@dp.message.outer_middleware()
async def typing_middleware(handler, event: types.Message, data):
    """Har bir xabarda 'typing...' indikatorini ko'rsatadi"""
    try:
        await data['bot'].send_chat_action(chat_id=event.chat.id, action="typing")
    except:
        pass
    return await handler(event, data)

@dp.callback_query.outer_middleware()
async def callback_typing_middleware(handler, event: types.CallbackQuery, data):
    """Callback bosilganda 'typing...' indikatorini ko'rsatadi"""
    try:
        await data['bot'].send_chat_action(chat_id=event.message.chat.id, action="typing")
    except:
        pass
    return await handler(event, data)

# === Activity Tracking Middleware ===
@dp.message.outer_middleware()
async def activity_middleware(handler, event: types.Message, data):
    """Barcha foydalanuvchi faolligini track qilish (DAU uchun)"""
    if event.from_user and not event.from_user.is_bot:
        try:
            db.update_user_activity(
                user_id=event.from_user.id,
                full_name=event.from_user.full_name,
                username=event.from_user.username
            )
        except Exception as e:
            print(f"[DB] Activity update error: {e}")
    return await handler(event, data)

# === BOT COMMANDS & MENU SETUP ===
async def setup_bot_commands(bot: Bot):
    commands = [
        types.BotCommand(command="start", description="Botni ishga tushirish"),
        types.BotCommand(command="help", description="Yordam"),
    ]
    await bot.set_my_commands(commands)
    
    # Doimiy WebApp tugmasini (Chap pastki burchakdagi Menu o'rniga) o'rnatish
    from aiogram.types import MenuButtonWebApp, WebAppInfo
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="L-Lab App",
            web_app=WebAppInfo(url="https://roziyevbehroz-tech.github.io/lessonlab-scanner/miniapp/index.html?v=1.1")
        )
    )



# === BOT STARTUP ===
async def main():
    global loop
    loop = asyncio.get_running_loop()
    
    await setup_bot_commands(bot)
    
    # MQTT ni orqa fonda ulash (bot darhol ishlaydi, MQTT o'zi ulanadi)
    asyncio.create_task(_connect_mqtt())
    
    # Scheduler setup
    scheduler = AsyncIOScheduler()
    # Daily email report at 23:55
    scheduler.add_job(send_daily_email_report, 'cron', hour=23, minute=55, args=[db])
    # Daily reset at midnight (00:00)
    scheduler.add_job(db.reset_daily_test_counts, 'cron', hour=0, minute=0)
    scheduler.start()
    
    print("[BOT] Smart Tester Bot ishga tushdi...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
