import urllib.request
import json
import traceback

TOKEN = "8145781782:AAFfD5AE78OGA74-U0YmJGu3l9AqGcIGIKQ"
url = f"https://api.telegram.org/bot{TOKEN}/setChatMenuButton"

data = {
    "menu_button": {
        "type": "web_app",
        "text": "L-Lab App",
        "web_app": {
            "url": "https://roziyevbehroz-tech.github.io/lessonlab-scanner/miniapp/index.html"
        }
    }
}

req = urllib.request.Request(
    url,
    data=json.dumps(data).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

try:
    with urllib.request.urlopen(req) as response:
        print("Success:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.read().decode('utf-8'))
except Exception as e:
    print("Exception:", e)
    traceback.print_exc()
