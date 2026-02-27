import asyncio
import time
from aiogram import Router, F, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, ReactionTypeEmoji
from database import Database

router = Router()
db = Database()

pending_group_data = {}
active_group_sessions = {}
group_poll_map = {}
MIN_PLAYERS = 2



# ══════════════════════════════════════
#  1. SHAXSIY CHAT: "Guruhda o'ynash"
# ══════════════════════════════════════
@router.callback_query(F.data == "start_group")
async def start_group_handler(cb: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    selected = data.get("selected_tests", [])
    if not selected:
        return await cb.answer("⚠️ Kamida bitta test tanlang!", show_alert=True)

    settings = data.get("global_settings", {"mode": "Quiz mode", "timer": "30 s", "comp": "100% teng"})

    titles, all_q = [], []
    for tid in selected:
        t = db.get_test_title(tid)
        titles.append(t)
        qs = db.get_test_questions(tid)
        for q in qs:
            q['test_name'] = t
        all_q.extend(qs)

    timer_str = settings.get('timer', '30 s')
    ws = int(timer_str.split(" ")[0])
    if "min" in timer_str:
        ws *= 60

    # Pending data saqlash
    pending_group_data[cb.from_user.id] = {
        'test_ids': selected, 'settings': settings,
        'titles': titles, 'questions': all_q,
        'wait_sec': ws, 'timer_str': timer_str
    }

    # Inline query — guruhga yuborish
    inline_query = f"grouptest_{cb.from_user.id}"

    await cb.answer()
    await cb.message.edit_text(
        f"👥 <b>Guruhda o'ynash</b>\n\n"
        f"📝 <b>{', '.join(titles)}</b>\n"
        f"❓ {len(all_q)} ta savol  ⏱ {timer_str}\n\n"
        "✅ Testlar tayyor!\n\n"
        "🚀 Quyidagi tugmani bosing va guruhni tanlang.\n"
        "Bot avtomatik ravishda testni boshlaydi!",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🚀 Guruhga yuborish", switch_inline_query=inline_query)],
            [InlineKeyboardButton(text="⬅️ Orqaga", callback_data="back_to_select")]
        ])
    )


# ══════════════════════════════════════
#  2. GURUHDA QUIZ BOSHLASH (deep link orqali)
# ══════════════════════════════════════
async def start_group_quiz_in_chat(bot, chat_id, user_id, user_full_name, pdata):
    """Inline via_bot trigger orqali guruhda quiz sessiyasini yaratadi."""
    if chat_id in active_group_sessions:
        pending_group_data[user_id] = pdata  # qaytarib qo'yish
        await bot.send_message(chat_id, "⚠️ Allaqachon test davom etmoqda!")
        return

    questions = pdata['questions']
    if not questions:
        await bot.send_message(chat_id, "⚠️ Savollar topilmadi!")
        return

    titles = pdata['titles']
    timer_str = pdata['timer_str']

    # Session yaratish (unanswered_count qo'shildi)
    session = {
        'id': None, 'user_id': user_id,
        'questions': questions, 'titles': titles,
        'settings': pdata['settings'], 'wait_sec': pdata['wait_sec'],
        'index': 0, 'scores': {}, 'chat_id': chat_id,
        'status': 'waiting', 'ready_users': {},
        'invite_msg_id': None, 'advanced': set(),
        'unanswered_count': 0
    }
    active_group_sessions[chat_id] = session

    # ⚡ DARHOL quiz taklif xabar
    invite = await bot.send_message(
        chat_id,
        f"🏁 <b>Guruh Testi!</b>\n\n"
        f"📝 <b>{', '.join(titles)}</b>\n"
        f"❓ {len(questions)} ta savol  ⏱ {timer_str}\n\n"
        f"👤 Tashkilotchi: <b>{user_full_name}</b>\n\n"
        f"🎯 Kamida {MIN_PLAYERS} kishi kerak\n"
        f"To'xtatish: /stop\n\n"
        f"👥 Tayyor: <b>0</b>",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Men tayyorman!", callback_data=f"gr_{chat_id}")],
            [InlineKeyboardButton(text="❌ Bekor qilish", callback_data=f"gc_{chat_id}")]
        ])
    )
    session['invite_msg_id'] = invite.message_id

    # DB — background
    asyncio.create_task(_bg_save(session, chat_id, user_id, pdata))


async def _d(m):
    try: await m.delete()
    except: pass

async def _bg_save(session, cid, uid, pdata):
    try:
        session['id'] = db.save_group_session(cid, uid, pdata['test_ids'], pdata['settings'])
    except: pass


# ══════════════════════════════════════
#  ANSWER CHECKER (exact / fuzzy)
# ══════════════════════════════════════
def check_answer(user_text, correct_answer, comp_mode):
    """Javobni tekshirish: exact (100%) yoki fuzzy (75%)."""
    from difflib import SequenceMatcher
    
    ut = user_text.strip().lower()
    ca = correct_answer.strip().lower()
    
    if comp_mode == "100% teng" or comp_mode == "exact":
        return ut == ca
    else:  # O'xshash (Fuzzy Match >= 0.75)
        # Substring optimize check (Instant win for perfect substring)
        if ca in ut or ut in ca:
            return True
            
        # Mathematical similarity check (v23.0)
        similarity = SequenceMatcher(None, ut, ca).ratio()
        return similarity >= 0.75



def get_correct_answer_text(question):
    """Savoldan to'g'ri javob matnini olish."""
    for o in question.get('options', []):
        if o.get('is_correct'):
            return o['text']
    return ""


# ══════════════════════════════════════
#  3. "Men tayyorman!" — instant
# ══════════════════════════════════════
@router.callback_query(F.data.startswith("gr_"))
async def ready_handler(cb: types.CallbackQuery):
    chat_id = int(cb.data[3:])
    s = active_group_sessions.get(chat_id)
    if not s:
        return await cb.answer("⚠️ Topilmadi!", show_alert=True)
    if s['status'] != 'waiting':
        return await cb.answer("⚠️ Boshlangan!", show_alert=True)

    uid = str(cb.from_user.id)
    if uid in s['ready_users']:
        return await cb.answer("✅ Allaqachon tayyorsiz!", show_alert=True)

    s['ready_users'][uid] = cb.from_user.full_name
    s['scores'][uid] = {'name': cb.from_user.full_name, 'correct': 0, 'total': 0, 'total_time': 0.0}
    c = len(s['ready_users'])
    plist = "\n".join(f"  {i+1}. {n}" for i, n in enumerate(s['ready_users'].values()))

    if c < MIN_PLAYERS:
        await cb.answer(f"Qoyilmaqom! Tayyor: {c}. Yana {MIN_PLAYERS-c} kerak.", show_alert=True)
        try:
            await cb.message.edit_text(
                f"🏁 <b>Guruh Testi!</b>\n\n"
                f"📝 <b>{', '.join(s['titles'])}</b>\n"
                f"❓ {len(s['questions'])} savol  ⏱ {s['settings'].get('timer','30 s')}\n\n"
                f"⏳ Yana {MIN_PLAYERS-c} kishi kerak\n\n"
                f"👥 Tayyor: <b>{c}</b>\n{plist}",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="✅ Men tayyorman!", callback_data=f"gr_{chat_id}")],
                    [InlineKeyboardButton(text="❌ Bekor qilish", callback_data=f"gc_{chat_id}")]
                ])
            )
        except: pass
    else:
        # ⚡ KETTIK
        s['status'] = 'active'
        await cb.answer("🚀 Kettik!", show_alert=True)
        try:
            await cb.message.edit_text(
                f"🚀 <b>Kettik!</b>\n👥 {', '.join(s['ready_users'].values())}",
                parse_mode="HTML"
            )
        except: pass
        await asyncio.sleep(1)
        await send_q(cb.bot, chat_id)


# ══════════════════════════════════════
#  4. Bekor qilish
# ══════════════════════════════════════
@router.callback_query(F.data.startswith("gc_"))
async def cancel_handler(cb: types.CallbackQuery):
    chat_id = int(cb.data[3:])
    s = active_group_sessions.get(chat_id)
    if not s:
        return await cb.answer("⚠️ Topilmadi!", show_alert=True)
    uid = cb.from_user.id
    ok = uid == s['user_id']
    if not ok:
        try:
            m = await cb.bot.get_chat_member(chat_id, uid)
            ok = m.status in ['administrator', 'creator']
        except: pass
    if not ok:
        return await cb.answer("⚠️ Faqat tashkilotchi/admin!", show_alert=True)
    active_group_sessions.pop(chat_id, None)
    if s['id']:
        asyncio.create_task(_bgf(s['id']))
    await cb.answer("❌ Bekor qilindi!")
    try:
        await cb.message.edit_text("❌ <b>Bekor qilindi.</b>", parse_mode="HTML")
    except: pass

async def _bgf(sid):
    try: db.finish_group_session(sid)
    except: pass


# ══════════════════════════════════════
#  5. SEND QUESTION — mode router
# ══════════════════════════════════════
async def send_q(bot, cid):
    s = active_group_sessions.get(cid)
    if not s or s['status'] != 'active':
        return
    idx = s['index']
    if idx in s['advanced']:
        return
    if idx >= len(s['questions']):
        return await finish(bot, cid)

    mode = s['settings'].get('mode', 'Quiz mode')
    if mode == 'Timed Writing (Spoiler)':
        await send_q_timed_write(bot, cid)
    elif mode == 'Speed Writing (Tezlik)':
        await send_q_speed_write(bot, cid)
    else:
        await send_q_poll(bot, cid)


# ══════════════════════════════════════
#  5a. QUIZ MODE (poll)
# ══════════════════════════════════════
async def send_q_poll(bot, cid):
    s = active_group_sessions.get(cid)
    if not s: return
    idx = s['index']
    q = s['questions'][idx]
    tot = len(s['questions'])
    w = s['wait_sec']
    opts = [o['text'] for o in q['options']]
    ci = next((i for i, o in enumerate(q['options']) if o['is_correct']), 0)
    h = (q.get('hint', '') or "")[:200]
    qt = q['text'][:280]

    try:
        sp = await bot.send_poll(
            chat_id=cid, question=f"[{idx+1}/{tot}] {qt}",
            options=opts, type='quiz', correct_option_id=ci,
            is_anonymous=False,
            explanation=h if h else None,
            open_period=w
        )
        group_poll_map[sp.poll.id] = {
            'chat_id': cid, 'qi': idx,
            'st': time.time(), 'ci': ci,
            'au': set(), 'mid': sp.message_id
        }
    except Exception as e:
        print(f"[GRP] Poll err: {e}")
        s['index'] = idx + 1
        return await send_q(bot, cid)

    asyncio.create_task(_tmr(bot, cid, idx, w))


async def _tmr(bot, cid, idx, w):
    await asyncio.sleep(w + 1)
    s = active_group_sessions.get(cid)
    if s and s['status'] == 'active' and s['index'] == idx and idx not in s['advanced']:
        s['advanced'].add(idx)

        # Auto-pause: hech kim javob bermadimi?
        pd_key = None
        for pk, pv in group_poll_map.items():
            if pv['chat_id'] == cid and pv['qi'] == idx:
                pd_key = pk
                break
        answered_count = len(group_poll_map[pd_key]['au']) if pd_key and pd_key in group_poll_map else 0

        if answered_count == 0:
            s['unanswered_count'] = s.get('unanswered_count', 0) + 1
            if s['unanswered_count'] >= 2:
                await pause_group_quiz(bot, cid)
                return
        else:
            s['unanswered_count'] = 0


        s['index'] = idx + 1
        await send_q(bot, cid)


# ══════════════════════════════════════
#  5b. TIMED WRITING (Spoiler) — Pro Visual UI
# ══════════════════════════════════════
def _build_timed_msg(s, remaining):
    """Timed writing uchun Pro vizual xabar."""
    idx = s['index']
    tot = len(s['questions'])
    q_text = s['questions'][idx]['text'][:280]
    total_time = s['wait_sec']
    
    # Time formatting (MM:SS)
    mins = remaining // 60
    secs = remaining % 60
    time_str = f"{mins:02d}:{secs:02d}"
    
    # Progress Bar & Clock Animation
    percent_left = remaining / max(total_time, 1)
    filled = int(percent_left * 10)
    empty = 10 - filled
    block = "🟥" if percent_left <= 0.25 else "🟦"
    prog_bar = (block * filled) + ("⬜️" * empty)
    
    clocks = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚']
    clock_emoji = clocks[remaining % 12]
    
    tracker = ""
    answers = s.get('write_answers', {})
    if answers:
        tracker += "\n<b>Topshirdi:</b>\n"
        for uid, data in answers.items():
            user_link = f"<a href='tg://user?id={uid}'>{data['name']}</a>"
            tracker += f"✅ {user_link}\n"
        
    return (
        f"[{idx+1}/{tot}] ❔ <b>{q_text}</b>\n\n"
        f"{clock_emoji} <b>{time_str}</b>\n"
        f"{prog_bar}\n"
        f"{tracker}"
    )


async def send_q_timed_write(bot, cid):
    s = active_group_sessions.get(cid)
    if not s: return
    idx = s['index']
    q = s['questions'][idx]
    correct = get_correct_answer_text(q)

    # Reset per-question state
    s['write_mode'] = 'timed'
    s['write_answers'] = {}
    s['write_correct'] = correct
    s['write_q_start'] = time.time()
    s['write_remaining'] = s['wait_sec']

    # Send initial message (NO INLINE BUTTONS)
    qmsg = await bot.send_message(
        cid, 
        _build_timed_msg(s, s['wait_sec']), 
        parse_mode="HTML",
        reply_markup=None
    )
    s['write_q_msg_id'] = qmsg.message_id

    asyncio.create_task(_writing_timer_loop(bot, cid, idx))


async def _writing_timer_loop(bot, cid, idx):
    """Ticking timer loop — updates every 2s."""
    s = active_group_sessions.get(cid)
    if not s: return
    
    remaining = s['wait_sec']
    while remaining > 0:
        # INSTANT BREAK: check before sleep
        curr_s = active_group_sessions.get(cid)
        if not curr_s or curr_s['status'] != 'active' or curr_s['index'] != idx or idx in curr_s['advanced']:
            return
            
        if len(curr_s.get('write_answers', {})) >= len(curr_s.get('ready_users', {})):
            break

        await asyncio.sleep(2)
        remaining -= 2
        if remaining < 0: remaining = 0
        
        # Re-check status after sleep
        s = active_group_sessions.get(cid)
        if not s or s['status'] != 'active' or s['index'] != idx or idx in s['advanced']:
            return

        s['write_remaining'] = remaining
        
        try:
            await bot.edit_message_text(
                chat_id=cid,
                message_id=s['write_q_msg_id'],
                text=_build_timed_msg(s, remaining),
                parse_mode="HTML"
            )
        except:
            pass # Ignore 'not modified'


    # Loop finished
    s = active_group_sessions.get(cid)
    if s and s['status'] == 'active' and s['index'] == idx and idx not in s['advanced']:
        s['advanced'].add(idx)
        await reveal_timed_answers(bot, cid, idx)



async def reveal_timed_answers(bot, cid, idx):
    """Morphing Reveal: edit question message into final results."""
    s = active_group_sessions.get(cid)
    if not s: return

    correct = s.get('write_correct', '')
    answers = s.get('write_answers', {})
    tot = len(s['questions'])
    q_text = s['questions'][idx]['text'][:280]

    # Auto-pause check
    if len(answers) == 0:
        s['unanswered_count'] = s.get('unanswered_count', 0) + 1
        if s['unanswered_count'] >= 2:
            await pause_group_quiz(bot, cid)
            return
    else:
        s['unanswered_count'] = 0


    # Build Morphing Final Text
    final_text = (
        f"[{idx+1}/{tot}] ❔ <b>{q_text}</b>\n\n"
        f"🏁 <b>Vaqt tugadi!</b>\n"
        f"✅ To'g'ri javob: <b>{correct}</b>\n\n"
        f"<b>Natijalar:</b>\n"
    )
    
    if answers:
        for uid, uname in s.get('ready_users', {}).items():
            user_link = f"<a href='tg://user?id={uid}'>{uname}</a>"
            if uid in answers:
                a = answers[uid]
                icon = "✅" if a['is_correct'] else "❌"
                final_text += f"{icon} {user_link}: {a['text']}\n"
            else:
                final_text += f"➖ {user_link}: [Hech nima]\n"
    else:
        final_text += "➖ Hech kim javob bermadi."

    # Morph!
    msg_id = s.get('write_q_msg_id')
    try:
        await bot.edit_message_text(
            chat_id=cid,
            message_id=msg_id,
            text=final_text,
            parse_mode="HTML"
        )
    except:
        await bot.send_message(cid, final_text, parse_mode="HTML")

    # Update scores
    for uid, a in answers.items():
        if uid not in s['scores']:
            name = s['ready_users'].get(uid, 'Unknown')
            s['scores'][uid] = {'name': name, 'correct': 0, 'total': 0, 'total_time': 0.0}
        s['scores'][uid]['total'] += 1
        s['scores'][uid]['total_time'] += a.get('time', 0)
        if a['is_correct']:
            s['scores'][uid]['correct'] += 1
    # Users who didn't answer
    for uid in s.get('ready_users', {}):
        if uid not in answers:
            if uid not in s['scores']:
                s['scores'][uid] = {'name': s['ready_users'][uid], 'correct': 0, 'total': 0, 'total_time': 0.0}
            s['scores'][uid]['total'] += 1

    asyncio.create_task(_bgs(s['id'], dict(s['scores'])))

    # Auto-Advance: wait 1.5s (Lightning Fast), then next
    await asyncio.sleep(1.5)
    s['index'] = idx + 1
    await send_q(bot, cid)



# ══════════════════════════════════════
#  5c. SPEED WRITING (Tezlik) — race mode
# ══════════════════════════════════════
async def send_q_speed_write(bot, cid):
    s = active_group_sessions.get(cid)
    if not s: return
    idx = s['index']
    q = s['questions'][idx]
    tot = len(s['questions'])
    qt = q['text'][:280]
    correct = get_correct_answer_text(q)

    # Reset per-question state
    s['write_mode'] = 'speed'
    s['write_answers'] = {}
    s['write_correct'] = correct
    s['write_q_start'] = time.time()
    s['speed_solved'] = False

    msg = f"[{idx+1}/{tot}] ❔ <b>{qt}</b>\n\n⚡ <i>Tezlik rejimi! Birinchi bo'lib yozish kerak.</i>"
    from keyboards import speed_nav
    qmsg = await bot.send_message(cid, msg, parse_mode="HTML", reply_markup=speed_nav)
    s['write_q_msg_id'] = qmsg.message_id


    # (v22.2 Speed Fix): No fallback timer needed — Untimed Race.



async def _tmr_speed(bot, cid, idx, w):
    """Speed mode fallback timer."""
    await asyncio.sleep(w)
    s = active_group_sessions.get(cid)
    if s and s['status'] == 'active' and s['index'] == idx and idx not in s['advanced']:
        s['advanced'].add(idx)
        correct = s.get('write_correct', '')
        msg_id = s.get('write_q_msg_id')
        tot = len(s['questions'])
        
        reveal_text = (
            f"[{idx+1}/{tot}] ❔ <b>Vaqt tugadi!</b>\n"
            f"Hech kim to'g'ri topa olmadi.\n"
            f"To'g'ri javob: <b>{correct}</b>"
        )
        
        try:
            await bot.edit_message_text(reveal_text, cid, msg_id, parse_mode="HTML")
        except:
            await bot.send_message(cid, reveal_text, parse_mode="HTML")

        # Auto-pause check
        s['unanswered_count'] = s.get('unanswered_count', 0) + 1
        if s['unanswered_count'] >= 2:
            await pause_group_quiz(bot, cid)
            return

        
        await asyncio.sleep(1.5)
        s['index'] = idx + 1
        await send_q(bot, cid)



# ══════════════════════════════════════
#  6. Poll answer + auto-advance
# ══════════════════════════════════════
async def handle_group_poll_answer(pa: types.PollAnswer, bot):
    pd = group_poll_map.get(pa.poll_id)
    if not pd:
        return False
    s = active_group_sessions.get(pd['chat_id'])
    if not s:
        return False

    uid = str(pa.user.id)
    if uid in pd['au']:
        return True
    pd['au'].add(uid)

    # Kimdir javob berdi — unanswered reset
    s['unanswered_count'] = 0

    ok = pa.option_ids[0] == pd['ci']
    t = round(time.time() - pd['st'], 1)

    if uid not in s['scores']:
        s['scores'][uid] = {'name': pa.user.full_name, 'correct': 0, 'total': 0, 'total_time': 0.0}
    s['scores'][uid]['total'] += 1
    s['scores'][uid]['total_time'] += t
    if ok:
        s['scores'][uid]['correct'] += 1

    asyncio.create_task(_bgs(s['id'], dict(s['scores'])))

    # ⚡ AUTO-ADVANCE: hamma javob berdimi?
    idx = pd['qi']
    if len(pd['au']) >= len(s['ready_users']) and idx not in s['advanced']:
        s['advanced'].add(idx)
        try:
            await bot.stop_poll(chat_id=pd['chat_id'], message_id=pd['mid'])
        except: pass
        s['index'] = idx + 1
        await send_q(bot, pd['chat_id'])

    return True

async def _bgs(sid, sc):
    if sid:
        try: db.update_group_scores(sid, sc)
        except: pass


# ══════════════════════════════════════
#  7. Leaderboard
# ══════════════════════════════════════
async def finish(bot, cid):
    s = active_group_sessions.pop(cid, None)
    if not s: return

    for p in [k for k, v in group_poll_map.items() if v['chat_id'] == cid]:
        del group_poll_map[p]

    tot = len(s['questions'])
    rk = sorted(s['scores'].values(), key=lambda x: (-x['correct'], x['total_time']))
    md = ['🥇', '🥈', '🥉']
    if s['id']:
        asyncio.create_task(_bgf(s['id']))

    msg = f"🏁 <b>Test yakunlandi!</b>\n\n📝 <b>{', '.join(s['titles'])}</b>\n❓ {tot} savol | 👥 {len(rk)} qatnashchi\n\n"
    if rk:
        msg += "🏆 <b>Natijalar:</b>\n\n"
        for i, sc in enumerate(rk):
            m = md[i] if i < 3 else f"<b>{i+1}.</b>"
            p = round((sc['correct'] / tot) * 100) if tot else 0
            a = round(sc['total_time'] / max(sc['total'], 1), 1)
            msg += f"{m} <b>{sc['name']}</b> — {sc['correct']}/{tot} ({p}%) ⏱ {a}s\n"
        msg += "\n🏆 <b>G'oliblarni Tabriklaymiz!</b> 🎉"
    else:
        msg += "😔 Hech kim qatnashmadi."

    from keyboards import main_menu
    await bot.send_message(cid, msg, parse_mode="HTML", reply_markup=main_menu)

    # Increment test count for organizer
    db.increment_user_test_count(s['user_id'])

    asyncio.create_task(_na(bot, s, rk, tot))

async def _na(bot, s, rk, tot):
    try:
        a = f"✅ <b>Guruh testi yakunlandi!</b>\n📝 {', '.join(s['titles'])}\n👥 {len(rk)} qatnashchi"
        if rk: a += f"\n🥇 {rk[0]['name']} — {rk[0]['correct']}/{tot}"
        await bot.send_message(s['user_id'], a, parse_mode="HTML")
    except: pass


# ══════════════════════════════════════
#  8. Group Pause / Resume / Stop Logic (High Priority Controls)
# ══════════════════════════════════════

@router.callback_query(F.data == "speed_pause")
@router.message(F.chat.type.in_({"group", "supergroup"}), F.text.in_({"⏸ Pausa", "/pause"}))
async def group_speed_pause_handler(callback: types.CallbackQuery | types.Message):
    """Admin Manual Pause for Group Speed Writing."""
    cid = callback.message.chat.id if isinstance(callback, types.CallbackQuery) else callback.chat.id
    uid = callback.from_user.id
    bot = callback.bot
    s = active_group_sessions.get(cid)
    
    if not s or s['status'] != 'active':
        return
        
    if not await is_test_admin(cid, uid, bot, s):
        if isinstance(callback, types.CallbackQuery):
            await callback.answer("⚠️ Faqat admin yoki test boshlovchisi pauza qila oladi!", show_alert=True)
        return

    if isinstance(callback, types.CallbackQuery): await callback.answer("⏸ Test pauzalandi.")
    await pause_group_quiz(bot, cid)
    
    if isinstance(callback, types.CallbackQuery):
        await callback.message.delete()

@router.callback_query(F.data == "speed_stop")
@router.message(F.chat.type.in_({"group", "supergroup"}), F.text.in_({"⏹ Tugatish", "/stop"}))
async def group_speed_stop_handler(callback: types.CallbackQuery | types.Message):
    """Admin Manual Stop for Group Speed Writing."""
    cid = callback.message.chat.id if isinstance(callback, types.CallbackQuery) else callback.chat.id
    uid = callback.from_user.id
    bot = callback.bot
    s = active_group_sessions.get(cid)
    
    if not s:
        return
        
    if not await is_test_admin(cid, uid, bot, s):
        if isinstance(callback, types.CallbackQuery):
            await callback.answer("⚠️ Faqat admin yoki test boshlovchisi to'xtata oladi!", show_alert=True)
        return

    if isinstance(callback, types.CallbackQuery): await callback.answer("🛑 Test to'xtatildi!")
    if isinstance(callback, types.CallbackQuery): await callback.message.delete()
    
    await finish(bot, cid)

@router.message(
    F.chat.type.in_({"group", "supergroup"}),
    F.text.in_({"⏭ Keyingi", "/next"})
)
async def group_skip_handler(message: types.Message):
    """Admin Skip for Group Tests: Morphs the message and advances."""
    cid = message.chat.id
    uid = message.from_user.id
    s = active_group_sessions.get(cid)
    
    if not s or s['status'] != 'active':
        return
        
    if not await is_test_admin(cid, uid, message.bot, s):
        return

    # Morph to Skip (v22.3 Admin Control)
    idx = s['index']
    msg_id = s.get('write_q_msg_id')
    tot = len(s['questions'])
    q_text = s['questions'][idx]['text'][:280]
    correct = s.get('write_correct', 'Noma\'lum')

    reveal_text = (
        f"[{idx+1}/{tot}] ❔ <b>{q_text}</b>\n\n"
        f"➖ <b>Tashlab ketildi.</b>\n"
        f"✅ <b>Javob:</b> {correct}"
    )
    
    try: await message.bot.edit_message_text(reveal_text, cid, msg_id, parse_mode="HTML")
    except: pass
    
    if idx not in s['advanced']:
        s['advanced'].add(idx)
        await asyncio.sleep(1.5)
        s['index'] += 1
        s['speed_solved'] = False
        await send_q(message.bot, cid)

# ══════════════════════════════════════
#  9. GROUP TEXT ANSWER HANDLER (writing mode)
# ══════════════════════════════════════

@router.message(
    F.chat.type.in_({"group", "supergroup"}),
    F.text,
    ~F.text.startswith("/"),
    ~F.text.in_({"⏸ Pausa", "⏹ Tugatish", "⏭ Keyingi", "⏹ To'xtatish"})
)

async def handle_group_text_answer(message: types.Message):
    cid = message.chat.id
    s = active_group_sessions.get(cid)
    if not s or s['status'] != 'active':
        return
    wm = s.get('write_mode')
    if not wm:
        return  # Quiz mode — ignore text

    uid = str(message.from_user.id)
    # Foydalanuvchi ro'yxatdan o'tganmi?
    if uid not in s.get('ready_users', {}):
        return

    if wm == 'timed':
        await _handle_timed_answer(message, s, uid)
    elif wm == 'speed':
        await _handle_speed_answer(message, s, uid)


async def _handle_timed_answer(message, s, uid):
    """Timed Writing: IMMEDIATE delete, zero feedback."""
    cid = message.chat.id
    idx = s['index']

    # 1. DARHOL o'chirish
    try:
        await message.delete()
    except:
        pass

    # Foydalanuvchi allaqachon javob berganmi?
    if uid in s.get('write_answers', {}):
        return

    # Javobni saqlash
    correct = s.get('write_correct', '')
    comp = s['settings'].get('comp', "100% teng")
    is_correct = check_answer(message.text, correct, comp)
    t = round(time.time() - s.get('write_q_start', time.time()), 1)

    s['write_answers'][uid] = {
        'name': s['ready_users'][uid],
        'text': message.text.strip(),
        'is_correct': is_correct,
        'time': t
    }

    # Unanswered counter reset
    s['unanswered_count'] = 0


async def _handle_speed_answer(message, s, uid):
    """Speed Writing: first correct wins, morph xabar."""
    cid = message.chat.id
    idx = s['index']

    if s.get('speed_solved'):
        return

    correct = s.get('write_correct', '')
    comp = s['settings'].get('comp', '100% teng')
    is_correct = check_answer(message.text, correct, comp)

    if is_correct:
        s['speed_solved'] = True
        s['unanswered_count'] = 0

        # React 👍
        try: await message.react([ReactionTypeEmoji(emoji="👍")])
        except: pass

        # Score update
        t = round(time.time() - s.get('write_q_start', time.time()), 1)
        if uid not in s['scores']:
            s['scores'][uid] = {'name': message.from_user.full_name, 'correct': 0, 'total': 0, 'total_time': 0.0}
        s['scores'][uid]['correct'] += 1
        s['scores'][uid]['total'] += 1
        s['scores'][uid]['total_time'] += t

        # Update others
        for ruid in s.get('ready_users', {}):
            if ruid != uid:
                if ruid not in s['scores']:
                    s['scores'][ruid] = {'name': s['ready_users'][ruid], 'correct': 0, 'total': 0, 'total_time': 0.0}
                s['scores'][ruid]['total'] += 1

        asyncio.create_task(_bgs(s['id'], dict(s['scores'])))

        msg_id = s.get('write_q_msg_id')
        tot = len(s['questions'])
        q_text = s['questions'][idx]['text'][:280]
        
        solved_text = (
            f"[{idx+1}/{tot}] ❔ <b>{q_text}</b>\n\n"
            f"✅ <b>Javob:</b> {correct}"
        )

        try:
            await message.bot.edit_message_text(solved_text, cid, msg_id, parse_mode="HTML")
        except:
            await message.bot.send_message(cid, solved_text, parse_mode="HTML")

        # INSTANT advance
        if idx not in s['advanced']:
            s['advanced'].add(idx)
            await asyncio.sleep(1.5)
            s['index'] = idx + 1
            await send_q(message.bot, cid)
    else:
        # React 👎
        try: await message.react([ReactionTypeEmoji(emoji="👎")])
        except: pass



# ══════════════════════════════════════
#  8. Group Pause / Resume / Stop Logic
# ══════════════════════════════════════

async def pause_group_quiz(bot, cid):
    """Sends the Pause interface with Resume/Stop buttons."""
    s = active_group_sessions.get(cid)
    if not s: return
    
    s['status'] = 'paused'
    from keyboards import get_group_pause_keyboard
    
    msg = (
        "⏸ <b>Test pauzalandi...</b>\n\n"
        "Siz 2 ta savolga javob bermadingiz. Davom ettirishni xohlaysizmi?\n\n"
        "<i>(Faqat admin yoki test boshlovchisi tugmalardan foydalana oladi)</i>"
    )
    await bot.send_message(cid, msg, parse_mode="HTML", reply_markup=get_group_pause_keyboard())

async def is_test_admin(chat_id, user_id, bot, s):
    """Checks if user has permission to manage group quiz."""
    # 1. Check if organizer
    if str(user_id) == str(s.get('user_id')):
        return True

    
    # 2. Check if group admin
    try:
        member = await bot.get_chat_member(chat_id, user_id)
        if member.status in ['creator', 'administrator']:
            return True
    except:
        pass
    
    return False

@router.callback_query(F.data == "group_resume")
async def group_resume_handler(callback: types.CallbackQuery):
    cid = callback.message.chat.id
    uid = callback.from_user.id
    s = active_group_sessions.get(cid)
    
    if not s:
        await callback.answer("❌ Faol test topilmadi.")
        return

    if not await is_test_admin(cid, uid, callback.bot, s):
        await callback.answer("⚠️ Faqat admin yoki test boshlovchisi davom ettira oladi!", show_alert=True)
        return

    await callback.answer("▶️ Davom etamiz!")
    await callback.message.delete()
    
    s['status'] = 'active'
    s['unanswered_count'] = 0
    
    # Auto-advance to next question
    s['index'] += 1
    await send_q(callback.bot, cid)


# ══════════════════════════════════════
#  End of File
# ══════════════════════════════════════

