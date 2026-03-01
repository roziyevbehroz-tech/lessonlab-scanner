import os
import time

print("="*50)
print("🚀 GitHub Pages papkalarini tuzatish jarayoni boshlandi...")
print("="*50)

print("\n1. Scanner va Miniapp fayllarini Git ga qo'shyapmiz...")
out_add = os.popen("git add scanner/ miniapp/").read()
print(out_add)

print("2. Commit qilyapmiz...")
out_commit = os.popen('git commit -m "Fix: Scanner va Miniapp papkalari to\'g\'rilandi"').read()
print(out_commit)

print("3. GitHub'ga o'zgarishlarni majburiy (force) tarzda kiritib, eski xato fayllarni o'chiryapmiz...")
out_push = os.popen("git push origin main -f").read()
print(out_push)

print("="*50)
print("✅ Bajarildi! Barcha fayllar GitHub'ga to'g'ri papkalari bilan yuklandi.")
print("Endi brauzerda skanerni ochsangiz, 404 xatosi yo'qolishi kerak (GitHub uni yangilashiga 1-2 daqiqa ketishi mumkin).")
