import os
print(os.popen("git add miniapp/index.html miniapp/app.js miniapp/style.css").read())
print(os.popen('git commit -m "Force push miniapp files"').read())
print(os.popen("git push").read())
