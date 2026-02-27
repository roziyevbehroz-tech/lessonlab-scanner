import asyncio
import time
from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from database import Database
from keyboards import (
    main_menu, get_quiz_options_keyboard, get_practice_control_keyboard,
    get_ready_keyboard, get_pause_keyboard, get_finish_keyboard, ikb,
    practice_nav, get_pro_finish_keyboard
)
from aiogram.types import ReplyKeyboardRemove
import html


router = Router()
# Barcha practice handlerlar faqat shaxsiy chatda ishlaydi
router.message.filter(F.chat.type == "private")
db = Database()

# Global mapping to track which poll belongs to which chat
# poll_id -> chat_id
poll_to_chat = {}

# We'll set this from main.py to avoid circular imports
dispatcher = None

class PracticeState(StatesGroup):
    working = State()

@router.callback_query(F.data == "ready_to_start")
async def ready_to_start_handler(callback: types.CallbackQuery, state: FSMContext):
    # 1. ATOMIC LOCK: Block double-starts instantly
    current_state = await state.get_state()
    if current_state == PracticeState.working:
        return await callback.answer("⏳ Test allaqachon boshlangan!")
    
    # Set state immediately BEFORE any sleeps
    await state.set_state(PracticeState.working)

    data = await state.get_data()
    questions = data.get("prepared_questions")
    settings = data.get("prepared_settings")
    
    if not questions:
        await state.set_state(None) # Reset if failed
        return await callback.answer("⚠️ Ma'lumotlar topilmadi, iltimos qaytadan urinib ko'ring.", show_alert=True)
    
    # 2. Countdown Animation
    await callback.message.edit_text("⏳ <b>Tayyormisiz?</b>", parse_mode="HTML")
    await asyncio.sleep(1)
    await callback.message.edit_text("🚀 <b>Kettik!</b>", parse_mode="HTML")
    await asyncio.sleep(1)
    try: await callback.message.delete()
    except: pass
    
    # 2. Initialize Practice
    
    # Send bottom menu navigation once (ONLY for MCQ/Quiz where it's useful)
    mode = settings.get("mode")
    if mode not in ["Timed Writing (Spoiler)", "Speed Writing (Tezlik)"]:
        await callback.bot.send_message(
            callback.message.chat.id, 
            "⌨️ <b>Mashq navigatsiyasi faollashtirildi.</b>", 
            reply_markup=practice_nav,
            parse_mode="HTML"
        )

    await state.update_data(
        practice_questions=questions,
        practice_index=0,
        practice_score=0,

        practice_settings=settings,
        collected_answers=[],
        practice_errors=[], # Track incorrect question indices
        actual_answered=0, # Track actual answers (not skips)
        missed_count=0, # Reset at start (v24.1 Fix)
        practice_q_times={}, # Reset times
        revealed_indices=[], # Reset revealed
        start_time=time.time(), # For duration calculation
        ready_users={str(callback.from_user.id): callback.from_user.full_name} # For logic parity
    )

    
    await send_next_question(callback.message.chat.id, state, callback.bot, is_start=True)

async def send_next_question(chat_id, state: FSMContext, bot, is_start=False):
    # Agar test to'xtatilgan bo'lsa, yangi savol yubormasin
    current_state = await state.get_state()
    if current_state != PracticeState.working:
        return
    
    data = await state.get_data()
    questions = data.get("practice_questions", [])
    index = data.get("practice_index", 0)
    settings = data.get("practice_settings", {})
    missed = data.get("missed_count", 0)
    
    # Zero-Clutter (v22.0): For Writing modes, definitively DELETE old results to keep single-message flow
    old_msg_id = data.get("last_poll_message_id")
    mode = settings.get("mode")
    
    if old_msg_id:
        if mode == "Timed Writing (Spoiler)":
            try: await bot.delete_message(chat_id, old_msg_id)
            except: pass

        else:
            # Native Polls (Quiz) - stopping is more elegant for history
            try: await bot.stop_poll(chat_id, old_msg_id)
            except: pass
        await state.update_data(last_poll_message_id=None)


    # Auto-Pause Logic
    if missed >= 2:
        await state.update_data(missed_count=0) # Reset on pause
        return await bot.send_message(
            chat_id, 
            "⏸ <b>Test pauzalandi...</b>\n\n 2 ta savolga javob berilmadi. Davom ettirishni xohlaysizmi?",
            reply_markup=get_pause_keyboard(),
            parse_mode="HTML"
        )

    if index >= len(questions):
        return await finish_practice(chat_id, state, bot)
    
    q = questions[index]
    mode = settings.get("mode")
    total = len(questions)
    
    # Calculate Timer value up front (v21.1 Scope Fix)
    timer_str = settings.get('timer', '30 s')
    wait_sec = int(timer_str.split(" ")[0])
    if "min" in timer_str: wait_sec *= 60

    # Premium Header (v17.0)
    header = "🚀 <b>Test boshlandi!</b>\n\n" if is_start else ""
    
    # Text formatting exactly like Smart Tester
    text = f"{header}<b>[{index + 1}/{total}] 🔹</b> {q['text']}\n"
    text += f"Quiz {' ' * 14} ⏱ {timer_str} "
    
    if mode == "Quiz mode":
        # Extract options and correct index
        opts_text = [o['text'] for o in q['options']]
        correct_idx = next(i for i, o in enumerate(q['options']) if o['is_correct'])
        explanation = q.get('hint', "")
        
        # Native Poll (Quiz) with Dynamic Progress [X/Y] 🔹
        sent = await bot.send_poll(
            chat_id=chat_id,
            question=f"[{index + 1}/{total}] 🔹 {q['text']}",
            options=opts_text,
            type='quiz',
            correct_option_id=correct_idx,
            is_anonymous=False,
            explanation=explanation[:200] if explanation else None,
            open_period=wait_sec,
            explanation_parse_mode="HTML"
        )

        
        # Track poll for answer handling
        poll_to_chat[sent.poll.id] = chat_id
        await state.update_data(last_poll_message_id=sent.message_id, current_poll_id=sent.poll.id, q_start_time=time.time())
    elif mode in ["Timed Writing (Spoiler)", "Speed Writing (Tezlik)"]:
        import html
        q_text_safe = html.escape(q['text'][:280])
        
        if mode == "Timed Writing (Spoiler)":
            text = _build_practice_timed_msg(index, total, q_text_safe, wait_sec, wait_sec, [])
        else:
            text = f"[{index+1}/{total}] ❔ <b>{q_text_safe}</b>\n\n⚡ <i>Tezlik rejimi! Birinchi bo'lib yozish kerak.</i>"

        # Zero Clutter: Remove 6-button menu and show Speed Controls (v22.6)
        from keyboards import speed_nav
        reply_markup = speed_nav if mode == "Speed Writing (Tezlik)" else ReplyKeyboardRemove()
        
        sent = await bot.send_message(
            chat_id, text,
            reply_markup=reply_markup,
            parse_mode="HTML"
        )



        await state.update_data(last_poll_message_id=sent.message_id)
        
        if mode == "Timed Writing (Spoiler)":
            # Start robust timer loop
            asyncio.create_task(_practice_writing_timer_loop(chat_id, state, index, wait_sec, bot, sent.message_id))
        else:
            # Speed fallback
            asyncio.create_task(timer_worker_task(chat_id, state, index, 300, bot))
        return


    else:
        # MCQ or other fallback
        kb = get_quiz_options_keyboard(q['options']) if mode == "Quiz mode" else get_practice_control_keyboard()
        sent = await bot.send_message(
            chat_id, text, 
            reply_markup=ReplyKeyboardRemove() if mode == "Quiz mode" else kb, 
            parse_mode="HTML"
        )

        await state.update_data(last_poll_message_id=sent.message_id)



    # Start timer task ONLY for Quiz/Timed modes (v22.1 Speed Fix)
    if mode not in ["Speed Writing (Tezlik)"]:
        timer_str = settings.get('timer', '30 s')
        wait_sec = int(timer_str.split(" ")[0])
        if "min" in timer_str: wait_sec *= 60
        asyncio.create_task(timer_worker_task(chat_id, state, index, wait_sec, bot))



def _build_practice_timed_msg(index, total, q_text, remaining, wait_sec, collected):

    """Refined helper for private practice timed writing UI."""
    mins = remaining // 60
    secs = remaining % 60
    time_str = f"{mins:02d}:{secs:02d}"
    
    percent_left = remaining / max(wait_sec, 1)
    filled = int(percent_left * 10)
    empty = 10 - filled
    block = "🟥" if percent_left <= 0.25 else "🟦"
    prog_bar = (block * filled) + ("⬜️" * empty)
    
    clocks = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚']
    clock_emoji = clocks[remaining % 12]

    tracker = ""
    if collected:
        tracker += "\n<b>Topshirdi:</b>\n"
        for ans in collected:
            user_link = f"<a href='tg://user?id={ans['user_id']}'>{ans['user_name']}</a>"
            tracker += f"✅ {user_link}\n"
            
    return (
        f"[{index+1}/{total}] ❔ <b>{q_text}</b>\n\n"
        f"{clock_emoji} <b>{time_str}</b>\n"
        f"{prog_bar}\n"
        f"{tracker}"
    )


async def _practice_writing_timer_loop(chat_id, state, index, wait_sec, bot, msg_id):
    """Robust 1s-tick timer loop — Matching Group Mode reliability."""
    remaining = wait_sec
    while remaining > 0:
        # 1. State check (Is user still on this question?)
        data = await state.get_data()
        if not data or data.get("practice_index") != index: return
        
        # 2. Break instantly if answered
        collected = data.get("collected_answers", [])
        if collected: break

        # 3. Wait 1s
        await asyncio.sleep(1)
        remaining -= 1
        
        # 4. Refresh data & Break if just answered during sleep
        data = await state.get_data()
        if not data or data.get("practice_index") != index: return
        collected = data.get("collected_answers", [])
        if collected: break

        # 5. Visual Update (Every 2s to minimize API noise, but high-precision)
        if remaining % 2 == 0 or remaining <= 5:
            questions = data.get("practice_questions", [])
            if index >= len(questions): return
            
            import html
            q_text_safe = html.escape(questions[index]['text'][:280])
            total = len(questions)
            
            try:
                new_text = _build_practice_timed_msg(index, total, q_text_safe, remaining, wait_sec, collected)
                await bot.edit_message_text(new_text, chat_id, msg_id, parse_mode="HTML")
            except:
                pass # Usually 'not modified' or 'message to edit not found'

    await timed_reveal_logic(chat_id, state, index, bot, msg_id)





async def timer_worker_task(chat_id, state: FSMContext, index, wait_sec, bot):
    # Added 0.5s buffer to avoid race conditions with late poll answers (v24.1)
    await asyncio.sleep(wait_sec + 0.5)
    
    # Test to'xtatilgan bo'lsa, timer ishlamasin
    current_state = await state.get_state()
    if current_state != PracticeState.working:
        return
    
    data = await state.get_data()
    if not data or data.get("practice_index") != index:
        return # User already answered or stopped
    
    settings = data.get("practice_settings", {})
    mode = settings.get("mode")
    
    if mode == "Timed Writing (Spoiler)":
        return # Handled by _practice_writing_timer_loop

    else:
        # For Quiz/Speed - if no answer, it's a "miss"
        missed = data.get("missed_count", 0) + 1
        errors = data.get("practice_errors", [])
        if index not in errors:
            errors.append(index)
            
        await state.update_data(
            missed_count=missed, 
            practice_index=index + 1,
            practice_errors=errors
        )
        await send_next_question(chat_id, state, bot)

async def finish_practice(chat_id, state: FSMContext, bot):
    data = await state.get_data()
    total = len(data.get("practice_questions", []))
    score = data.get("practice_score", 0)
    errors = data.get("practice_errors", [])
    duration = round(time.time() - data.get("start_time", time.time()), 1)
    
    m, s = divmod(int(duration), 60)
    duration_str = f"{m}m {s}s" if m > 0 else f"{s}s"
    
    # Calculate metrics (v19.0)
    actual_ans = data.get("actual_answered", 0)
    skipped = total - actual_ans
    accuracy = round((score / total) * 100) if total > 0 else 0
    
    q_times = data.get("practice_q_times", {})
    avg_time = round(sum(q_times.values()) / actual_ans, 1) if actual_ans > 0 else 0
    
    # Stop the very last poll
    old_msg_id = data.get("last_poll_message_id")
    if old_msg_id:
        try: await bot.stop_poll(chat_id, old_msg_id)
        except: pass

    # Dynamic Motivation (v19.0)
    if accuracy >= 90: motivation = "🏆 <b>Ajoyib natija! Mukammal!</b>"
    elif accuracy >= 70: motivation = "🌟 <b>Juda yaxshi! Bilimingiz yuqori.</b>"
    elif accuracy >= 50: motivation = "👍 <b>Yaxshi harakat! Yana ozgina qunt qiling.</b>"
    else: motivation = "📈 <b>Harakatda davom eting! Siz buni uddalaysiz.</b>"

    await state.set_state(None)
    
    user_name = "User"
    try:
        chat = await bot.get_chat(chat_id)
        user_name = chat.full_name
    except: pass

    # 1. Expandable Grouped Error Review (v20.0)
    if errors:
        wrong_details = data.get("practice_incorrect_details", [])
        if wrong_details:
            # Group by test_name
            grouped = {}
            for d in wrong_details:
                topic = d.get("test_name", "Noma'lum")
                if topic not in grouped: grouped[topic] = []
                grouped[topic].append(d)
            
            err_msg = "👇 <b>Xato javoblar!</b>\n\n"
            err_msg += "<blockquote expandable>\n"
            
            for topic, items in grouped.items():
                err_msg += f"🟢 <b>[{topic}]</b>\n\n"
                for i, item in enumerate(items, 1):
                    err_msg += f"{i}. {item['question']} — {item['user_answer']}\n"
                err_msg += "\n"
                
            err_msg += "</blockquote>"
            await bot.send_message(chat_id, err_msg, parse_mode="HTML")
        else:
            # Fallback if details not captured
            err_msg = "<b>👇 Xato qilingan savollar:</b>\n"
            questions = data.get("practice_questions", [])
            for idx in errors[:10]:
                err_msg += f"• {questions[idx]['text']}\n"
            if len(errors) > 10: err_msg += "..."
            await bot.send_message(chat_id, err_msg, parse_mode="HTML")

    # 2. Ultimate Summary Message
    msg = (
        f"{motivation}\n\n"
        f"🏁 <b>«♻️ Quiz ({user_name})»</b>\n"
        "testi yakunlandi!\n\n"
        f"💬 Quiz mode\n"
        f"⏱ Har bir savolga {data.get('practice_settings', {}).get('timer', '30 s')}\n\n"
        f"♻️ Jami savollar - {total}\n"
        f"♻️ Javob berildi - {actual_ans}\n"
        f"🎯 Aniqlik: {accuracy}%\n\n"
        f"✅ To'g'ri - {score}\n"
        f"❌ Xato - {len(errors)}\n"
        f"⌛️ Tashlab ketilgan - {skipped}\n"
        f"⏱ Umumiy vaqt: {duration_str}\n"
        f"⚡️ O'rtacha tezlik: {avg_time} s/savol\n"
    )

    # Use the first test_id if available for the grid
    test_id = 0
    selected_tests = data.get("selected_tests", [])
    if selected_tests: test_id = selected_tests[0]

    # 2. Ultimate Summary Message (v22.7 Restoration)
    from keyboards import main_menu
    
    await bot.send_message(
        chat_id, msg, 
        reply_markup=get_pro_finish_keyboard(test_id, has_errors=len(errors)>0),
        parse_mode="HTML"
    )
    
    # Force Restore Main Menu (v22.7)
    await bot.send_message(chat_id, "🏠 <b>Bosh sahifa</b>", reply_markup=main_menu, parse_mode="HTML")
    
    # Increment test count
    db.increment_user_test_count(chat_id)

@router.callback_query(F.data.startswith("practice_restart_"))
async def restart_practice_handler(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    settings = data.get("practice_settings", {})
    if not settings:
        settings = data.get("global_settings", {"mode": "Quiz mode", "timer": "30 s", "comp": "100% teng"})
    
    # Agar selected_tests bo'sh bo'lsa, callback dagi test_id ni ishlatamiz
    if not selected:
        test_id = int(callback.data.split("_")[2])
        selected = [test_id]
    
    # Barcha tanlangan testlardan savollarni yig'ish
    all_questions = []
    for tid in selected:
        test_title = db.get_test_title(tid)
        qs = db.get_test_questions(tid)
        for q in qs:
            q['test_name'] = test_title
        all_questions.extend(qs)
    
    if not all_questions:
        return await callback.answer("⚠️ Tanlangan testlarda savollar yo'q!", show_alert=True)
        
    await callback.answer("🔄 Test qayta boshlanmoqda...")
    await callback.message.delete()
    
    # Reset state for all selected tests
    await state.set_state(PracticeState.working)
    await state.update_data(
        practice_questions=all_questions,
        practice_index=0,
        practice_score=0,
        practice_settings=settings,
        collected_answers=[],
        missed_count=0,
        practice_errors=[],
        actual_answered=0,
        start_time=time.time(),
        practice_q_times={},
        practice_incorrect_details=[],
        selected_tests=selected
    )
    
    # Guard: Prevent double-start
    current_state = await state.get_state()
    if current_state == PracticeState.working:
        return await callback.answer("⏳ Test allaqachon boshlangan!")

    # Pastki navigatsiya tugmalarini ko'rsatish (v21.1 check)

    mode = settings.get("mode")
    if mode not in ["Timed Writing (Spoiler)", "Speed Writing (Tezlik)"]:
        await callback.bot.send_message(
            callback.message.chat.id, 
            "⌨️ <b>Mashq navigatsiyasi faollashtirildi.</b>", 
            reply_markup=practice_nav,
            parse_mode="HTML"
        )

    
    await send_next_question(callback.message.chat.id, state, callback.bot, is_start=True)

@router.callback_query(F.data == "practice_errors")
async def restart_with_errors(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    all_questions = data.get("practice_questions", [])
    error_indices = data.get("practice_errors", [])
    settings = data.get("practice_settings", {})
    
    if not error_indices:
        return await callback.answer("⚠️ Xatolar topilmadi!", show_alert=True)
    
    # Filter only error questions
    error_questions = [all_questions[i] for i in error_indices]
    
    # Clear original summary with buttons
    try: await callback.message.delete()
    except: pass
    
    # Send new countdown message
    countdown_msg = await callback.message.answer("⏳ <b>Tayyormisiz? (Faqat xatolar)</b>", parse_mode="HTML")
    await asyncio.sleep(1)
    try: await countdown_msg.edit_text("🚀 <b>Kettik!</b>", parse_mode="HTML")
    except: pass
    await asyncio.sleep(1)
    try: await countdown_msg.delete()
    except: pass
    
    # Reset state for error practice
    await state.set_state(PracticeState.working)
    await state.update_data(
        practice_questions=error_questions,
        practice_index=0,
        practice_score=0,
        practice_settings=settings,
        collected_answers=[],
        missed_count=0,
        practice_errors=[], # Reset error tracking for this new round
        practice_incorrect_details=[], # Reset details for the new round (v20.0)
        start_time=time.time()
    )
    
    await send_next_question(callback.message.chat.id, state, callback.bot, is_start=True)

# --- Navigation & Control Handlers (High Priority) ---

@router.callback_query(F.data == "practice_stop")
@router.message(PracticeState.working, F.text.in_({"⏹ To'xtatish", "/stop"}))
async def stop_practice_handler(callback: types.CallbackQuery | types.Message, state: FSMContext):
    chat_id = callback.message.chat.id if isinstance(callback, types.CallbackQuery) else callback.chat.id
    bot = callback.bot
    
    if isinstance(callback, types.CallbackQuery):
        await callback.answer("⏹ Mashq to'xtatildi.")
        try: await callback.message.delete()
        except: pass
    else:
        await callback.answer("⏹ Mashq to'xtatildi.")
        
    await finish_practice(chat_id, state, bot)

@router.callback_query(PracticeState.working, F.data == "speed_pause")
@router.message(PracticeState.working, F.text.in_({"⏸ Pausa", "/pause"}))
async def speed_pause_handler(callback: types.CallbackQuery | types.Message, state: FSMContext):
    """Manual Pause for Speed Writing."""
    cid = callback.message.chat.id if isinstance(callback, types.CallbackQuery) else callback.chat.id
    if isinstance(callback, types.CallbackQuery): await callback.answer("⏸ Test pauzalandi.")
    
    await state.update_data(missed_count=2)
    
    from keyboards import get_pause_keyboard
    text = "⏸ <b>Test pauzalandi...</b>\n\nDavom ettirishni xohlaysizmi?"
    if isinstance(callback, types.CallbackQuery):
        await callback.message.edit_text(text, reply_markup=get_pause_keyboard(), parse_mode="HTML")
    else:
        await callback.bot.send_message(cid, text, reply_markup=get_pause_keyboard(), parse_mode="HTML")

@router.callback_query(PracticeState.working, F.data == "speed_stop")
@router.message(PracticeState.working, F.text.in_({"⏹ Tugatish", "/stop"}))
async def speed_stop_handler(callback: types.CallbackQuery | types.Message, state: FSMContext):
    """Manual Stop for Speed Writing."""
    cid = callback.message.chat.id if isinstance(callback, types.CallbackQuery) else callback.chat.id
    if isinstance(callback, types.CallbackQuery): await callback.answer("🛑 Test to'xtatildi.")
    
    await finish_practice(cid, state, callback.bot)

@router.callback_query(PracticeState.working, F.data == "practice_next")
@router.message(PracticeState.working, F.text.in_({"⏭ Keyingi", "/next"}))
async def skip_question(callback: types.CallbackQuery | types.Message, state: FSMContext):
    chat_id = callback.message.chat.id if isinstance(callback, types.CallbackQuery) else callback.chat.id
    bot = callback.bot
    data = await state.get_data()
    index = data.get("practice_index", 0)
    questions = data.get("practice_questions", [])
    settings = data.get("practice_settings", {})
    mode = settings.get("mode")
    
    if mode == "Speed Writing (Tezlik)" and index < len(questions):
        q = questions[index]
        correct_ans = next((o['text'] for o in q['options'] if o['is_correct']), "Noma'lum")
        msg_id = data.get("last_poll_message_id")
        
        reveal_text = (
            f"[{index+1}/{len(questions)}] ❔ <b>{q['text']}</b>\n\n"
            f"➖ <b>Tashlab ketildi.</b>\n"
            f"✅ <b>Javob:</b> {correct_ans}"
        )
        try: await bot.edit_message_text(reveal_text, chat_id, msg_id, parse_mode="HTML")
        except: pass
        await asyncio.sleep(1.5)

    await state.update_data(practice_index=index + 1, collected_answers=[], speed_solved=False)
    if isinstance(callback, types.CallbackQuery):
        try: await callback.message.delete()
        except: pass
    await send_next_question(chat_id, state, bot)



# --- Writing Mode Handlers ---

@router.message(
    PracticeState.working,
    F.text,
    ~F.text.startswith("/"),
    ~F.text.in_({"⏸ Pausa", "⏹ Tugatish", "⏭ Keyingi", "⏹ To'xtatish"})
)

async def handle_writing_answer(message: types.Message, state: FSMContext):
    data = await state.get_data()
    settings = data.get("practice_settings", {})
    mode = settings.get("mode")
    
    if mode == "Quiz mode":
        return # Inline buttons handle quiz
    
    index = data.get("practice_index", 0)
    questions = data.get("practice_questions", [])
    q = questions[index]
    
    correct_ans = next((o['text'] for o in q['options'] if o['is_correct']), "").lower().strip()
    user_ans = message.text.lower().strip()
    
    # Comparison logic (v23.0 Fuzzy 75%)
    from difflib import SequenceMatcher
    is_correct = False
    comp_mode = settings.get("comp")
    
    if comp_mode == "100% teng" or comp_mode == "exact":
        is_correct = user_ans == correct_ans
    else:
        # Substring win
        if correct_ans in user_ans or user_ans in correct_ans:
            is_correct = True
        else:
            similarity = SequenceMatcher(None, user_ans, correct_ans).ratio()
            is_correct = similarity >= 0.75
    
    if mode == "Speed Writing (Tezlik)":

        # 1. Check if already solved (Lock)
        if data.get("speed_solved"): return
        
        if is_correct:
            # 2. Lock and Score
            await state.update_data(speed_solved=True)
            await message.react([types.ReactionTypeEmoji(emoji="👍")])
            
            # 3. Morph Reveal (Real-Time Winner Crown)
            msg_id = data.get("last_poll_message_id")
            winner_link = f"<b>{message.from_user.full_name}</b>"
            reveal_text = (
                f"[{index+1}/{len(questions)}] ❔ <b>{q['text']}</b>\n\n"
                f"✅ <b>Javob:</b> {correct_ans}"
            )


            try: await message.bot.edit_message_text(reveal_text, message.chat.id, msg_id, parse_mode="HTML")
            except: pass
            
            # 4. Standard Score Update
            await state.update_data(
                practice_score=data.get("practice_score", 0) + 1,
                actual_answered=data.get("actual_answered", 0) + 1,
                missed_count=0
            )
            
            # 5. Lightning Transition
            await asyncio.sleep(1.5)
            await state.update_data(practice_index=index + 1, speed_solved=False)
            await send_next_question(message.chat.id, state, message.bot)
        else:
            # Persistent Guesses: Reaction only, no move
            try: await message.react([types.ReactionTypeEmoji(emoji="👎")])
            except: pass
            return # Let them keep trying!
            
    elif mode == "Timed Writing (Spoiler)":

        # 1. IMMEDIATE delete
        try: await message.delete()
        except: pass
        
        # Save and let the timer loop catch it (or we could trigger reveal if it's the only user)
        collected = data.get("collected_answers", [])
        collected.append({
            "user_id": message.from_user.id,
            "user_name": message.from_user.full_name,
            "text": message.text.strip(),
            "is_correct": is_correct,
            # No message_id needed, we edit the main question message
        })
        await state.update_data(collected_answers=collected)
        # The _practice_writing_timer_loop will see 'collected_answers' and break to reveal.


async def timed_reveal_logic(chat_id, state: FSMContext, index, bot, msg_id=None):
    """Morphing Reveal: edit question into results and move to next."""
    data = await state.get_data()
    
    # REVEAL GUARD: Ensure each question is only revealed ONCE
    revealed = data.get("revealed_indices", [])
    if index in revealed: return
    revealed.append(index)
    await state.update_data(revealed_indices=revealed)

    collected = data.get("collected_answers", [])
    questions = data.get("practice_questions", [])
    if index >= len(questions): return
    q = questions[index]
    correct_text = next((o['text'] for o in q['options'] if o['is_correct']), "Noma'lum")
    
    # Results Reveal: Morph the question message
    if not msg_id:
        msg_id = data.get("last_poll_message_id")


    
    final_text = (
        f"[{index+1}/{len(questions)}] ❔ <b>{q['text']}</b>\n\n"
        f"🏁 <b>Vaqt tugadi!</b>\n"
        f"✅ To'g'ri javob: <b>{correct_text}</b>\n\n"
        f"<b>Natijalar:</b>\n"
    )
    
    if collected:
        ans = collected[0]
        user_link = f"<a href='tg://user?id={ans['user_id']}'>{ans['user_name']}</a>"
        icon = "✅" if ans['is_correct'] else "❌"
        final_text += f"{icon} {user_link}: {ans['text']}\n"
    else:
        final_text += "➖ Javob bermadingiz."

    try:
        await bot.edit_message_text(final_text, chat_id, msg_id, parse_mode="HTML")
    except:
        await bot.send_message(chat_id, final_text, parse_mode="HTML")



    # Results revealed, wait 1.5s then advance (Standardized Lightning Speed)
    await asyncio.sleep(1.5)
    
    # Simple score update for private mode
    if collected:
        # Activity detected -> reset missed_count
        await state.update_data(missed_count=0)
        
        if collected[0]['is_correct']:
            practice_score = data.get("practice_score", 0) + 1
            await state.update_data(practice_score=practice_score)
        else:
            # Mark as error for summary
            errors = data.get("practice_errors", [])
            if index not in errors:
                errors.append(index)
            
            wrong_details = data.get("practice_incorrect_details", [])
            wrong_details.append({
                "test_name": q.get("test_name", "Noma'lum"),
                "question": q["text"],
                "user_answer": collected[0]['text']
            })
            await state.update_data(
                practice_errors=errors,
                practice_incorrect_details=wrong_details
            )

    else:
        # NO ANSWER -> Missed question
        errors = data.get("practice_errors", [])
        if index not in errors:
            errors.append(index)
        
        wrong_details = data.get("practice_incorrect_details", [])
        wrong_details.append({
            "test_name": q.get("test_name", "Noma'lum"),
            "question": q["text"],
            "user_answer": "Javob berilmadi"
        })
        
        await state.update_data(
            practice_errors=errors,
            practice_incorrect_details=wrong_details,
            missed_count=data.get("missed_count", 0) + 1
        )
    
    await state.update_data(
        practice_index=index + 1,
        collected_answers=[]
    )

    
    await send_next_question(chat_id, state, bot)


# --- Navigation & Quiz Callbacks ---

@router.callback_query(PracticeState.working, F.data.startswith("ans_"))
async def handle_quiz_answer(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    index = data.get("practice_index", 0)
    questions = data.get("practice_questions", [])
    q = questions[index]
    
    ans_idx = int(callback.data.split("_")[1])
    is_correct = q['options'][ans_idx]['is_correct']
    
    # Calculate question duration
    q_start = data.get("q_start_time", time.time())
    q_duration = round(time.time() - q_start, 1)
    
    # Track duration for "VIEW RESULTS"
    q_times = data.get("practice_q_times", {})
    q_times[str(index)] = q_duration
    await state.update_data(practice_q_times=q_times)

    # v16.0: MCQ Total Perfection Logic
    total_total = len(questions)
    text = f"<b>[{index + 1}/{total_total}].</b> ❓ {q['text']}\n"
    text += "Final Results 💡\n\n"
    
    for i, opt in enumerate(q['options']):
        # Premium Smarter-style bars
        percent = 100 if opt['is_correct'] else 0 
        mark = ""
        if i == ans_idx:
            mark = " ❌" if not is_correct else ""
        if opt['is_correct']:
            mark = " ✅"
            
        # Draw professional bars
        bar_len = 10
        filled = bar_len if opt['is_correct'] else 0
        bar_str = "🔵" * (filled // 2) + "━" * (bar_len - filled)
        
        text += f"<b>{percent}%</b> {opt['text']}{mark}\n"
        if i == ans_idx and not is_correct:
            text += f"❌ {'━' * 10}\n"
        elif opt['is_correct']:
            text += f"✔️ {'━' * 10}\n"
        else:
            text += f"🔹 {'━' * 10}\n"
        text += "\n"

    # Social footer simulation & Timing
    kb = ikb([("📊 VIEW RESULTS", f"view_results_{index}_{ans_idx}")])
    
    if is_correct:
        await state.update_data(practice_score=data.get("practice_score", 0) + 1)
        try:
            await callback.message.react([types.ReactionTypeEmoji(emoji="👍")])
        except: pass
    else:
        errors = data.get("practice_errors", [])
        if index not in errors:
            errors.append(index)
            await state.update_data(practice_errors=errors)
        
        # Track details for expandable report (v20.0)
        wrong_details = data.get("practice_incorrect_details", [])
        wrong_details.append({
            "test_name": q.get("test_name", "Noma'lum"),
            "question": q["text"],
            "user_answer": q["options"][ans_idx]["text"]
        })
        await state.update_data(practice_incorrect_details=wrong_details)
        try:
            await callback.message.react([types.ReactionTypeEmoji(emoji="👎")])
        except: pass

    # Advance practice state
    await state.update_data(
        practice_index=index + 1, 
        missed_count=0,
        actual_answered=data.get("actual_answered", 0) + 1
    )
    
    # Tiny delay for animation perfection then next question
    await asyncio.sleep(1.5)
    await send_next_question(callback.message.chat.id, state, callback.bot)

@router.poll_answer()
async def handle_poll_answer(poll_answer: types.PollAnswer, bot: types.Bot):
    poll_id = poll_answer.poll_id
    chat_id = poll_to_chat.get(poll_id)
    
    if not chat_id or not dispatcher:
        return
        
    # Get state for this user in this chat without importing dp from main
    state = dispatcher.fsm.get_context(bot, chat_id, poll_answer.user.id)
    data = await state.get_data()
    
    if data.get("current_poll_id") != poll_id:
        return # Not the active poll
        
    index = data.get("practice_index", 0)
    questions = data.get("practice_questions", [])
    q = questions[index]
    
    correct_idx = next(i for i, o in enumerate(q['options']) if o['is_correct'])
    user_ans = poll_answer.option_ids[0]
    is_correct = user_ans == correct_idx

    # Timing
    q_start = data.get("q_start_time", time.time())
    q_duration = round(time.time() - q_start, 1)
    q_times = data.get("practice_q_times", {})
    q_times[str(index)] = q_duration

    # Update state
    new_data = {
        "practice_q_times": q_times,
        "practice_index": index + 1,
        "missed_count": 0,
        "actual_answered": data.get("actual_answered", 0) + 1
    }
    
    if is_correct:
        new_data["practice_score"] = data.get("practice_score", 0) + 1
    else:
        errors = data.get("practice_errors", [])
        if index not in errors:
            errors.append(index)
        new_data["practice_errors"] = errors
        
        # Track details for expandable report (v20.0)
        wrong_details = data.get("practice_incorrect_details", [])
        wrong_details.append({
            "test_name": q.get("test_name", "Noma'lum"),
            "question": q["text"],
            "user_answer": q["options"][user_ans]["text"]
        })
        new_data["practice_incorrect_details"] = wrong_details
        
    await state.update_data(**new_data)
    
    # Cleanup mapping
    if poll_id in poll_to_chat:
        del poll_to_chat[poll_id]
        
    # Wait for the user to see "Correct/Incorrect" native animation then next
    await asyncio.sleep(1.5)
    await send_next_question(chat_id, state, bot)


@router.callback_query(F.data.startswith("view_results_"))
async def view_results_handler(callback: types.CallbackQuery, state: FSMContext):
    parts = callback.data.split("_")
    q_idx = int(parts[2])
    ans_idx = int(parts[3])
    
    data = await state.get_data()
    questions = data.get("practice_questions", [])
    q = questions[q_idx]
    
    user_name = callback.from_user.full_name
    correct_idx = next(i for i, o in enumerate(q['options']) if o['is_correct'])
    
    # Fetch timing
    q_times = data.get("practice_q_times", {})
    duration = q_times.get(str(q_idx), "?.?")
    
    # LIVE AUDIENCE SIMULATION (v16.0)
    import random
    total_votes = random.randint(45, 120)
    correct_votes = int(total_votes * random.uniform(0.65, 0.92))
    other_votes = total_votes - correct_votes
    
    # Popup result summary (Smarter Pro Style)
    res_text = f"📊 Quiz Statistics (Live Audience)\n"
    res_text += f"━━━━━━━━━━━━━━━━\n"
    res_text += f"⏱ Savolga sarflandi: {duration} s\n"
    res_text += f"👥 Jami qatnashchilar: {total_votes+1}\n\n"
    
    for i, opt in enumerate(q['options']):
        if i == correct_idx:
            votes = correct_votes + (1 if ans_idx == i else 0)
        elif i == ans_idx:
            # User voted for wrong option, or user voted for correct (handled above)
            votes = random.randint(1, max(2, other_votes // 2)) + 1
        else:
            votes = random.randint(0, max(1, other_votes // 4))
            
        perc = int((votes / (total_votes+1)) * 100)
        status = "✅" if i == correct_idx else ("❌" if i == ans_idx else "🔹")
        res_text += f"{status} {opt['text']} — {perc}% ({votes})\n"
    
    user_status = "TO'G'RI ✅" if ans_idx == correct_idx else "NOTO'G'RI ❌"
    res_text += f"\n👤 {user_name} javobi: {user_status}"
    await callback.answer(res_text, show_alert=True)

@router.callback_query(F.data.startswith("show_hint_"))
async def show_hint_handler(callback: types.CallbackQuery, state: FSMContext):
    idx = int(callback.data.split("_")[2])
    data = await state.get_data()
    questions = data.get("practice_questions", [])
    if idx < len(questions):
        hint = questions[idx].get('hint')
        if hint:
            await callback.answer(f"💡 Insight:\n{hint}", show_alert=True)
        else:
            await callback.answer("Ushbu savol uchun izoh yo'q.")

    # Fixed: Use callback objects correctly
    await send_next_question(callback.message.chat.id, state, callback.bot)


@router.callback_query(F.data == "practice_resume")
async def resume_practice_handler(callback: types.CallbackQuery, state: FSMContext):
    await callback.answer("▶️ Davom etamiz!")
    await callback.message.delete()
    await state.update_data(missed_count=0)
    await send_next_question(callback.message.chat.id, state, callback.bot)
