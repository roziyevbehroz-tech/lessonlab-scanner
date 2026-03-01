import re

with open(r'e:\\LLabbot\\scanner\\display.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace all unsafe innerText assignments with safe ones
# Pattern to match: document.getElementById('X').innerText = Y;
pattern = r"document\.getElementById\(['\"]([^'\"]+)['\"]\)\.innerText\s*=\s*(.+?);"

def replacer(match):
    element_id = match.group(1)
    assignment = match.group(2)
    return f"const _el_{element_id.replace('-', '_')} = document.getElementById('{element_id}');\n            if (_el_{element_id.replace('-', '_')}) _el_{element_id.replace('-', '_')}.innerText = {assignment};"

# Run regex sub
safe_html = re.sub(pattern, replacer, html)

# We also need to check querySelector
pattern2 = r"document\.querySelector\(['\"]([^'\"]+)['\"]\)\.innerText\s*=\s*(.+?);"

def replacer2(match):
    selector = match.group(1)
    assignment = match.group(2)
    # create a safe variable name from selector
    safe_var = "_elSel_" + re.sub(r'[^a-zA-Z0-9]', '', selector)
    return f"const {safe_var} = document.querySelector('{selector}');\n            if ({safe_var}) {safe_var}.innerText = {assignment};"

safe_html = re.sub(pattern2, replacer2, safe_html)

# Same for innerHTML assignments that might crash
pattern3 = r"document\.getElementById\(['\"]([^'\"]+)['\"]\)\.innerHTML\s*=\s*(.+?);"
def replacer3(match):
    element_id = match.group(1)
    assignment = match.group(2)
    if element_id == "toast-container": # skip some known safe ones if we want, but better safe everything
        pass
    return f"const _elH_{element_id.replace('-', '_')} = document.getElementById('{element_id}');\n            if (_elH_{element_id.replace('-', '_')}) _elH_{element_id.replace('-', '_')}.innerHTML = {assignment};"

safe_html = re.sub(pattern3, replacer3, safe_html)


pattern4 = r"document\.querySelector\(['\"]([^'\"]+)['\"]\)\.innerHTML\s*=\s*(.+?);"
def replacer4(match):
    selector = match.group(1)
    assignment = match.group(2)
    safe_var = "_elHSel_" + re.sub(r'[^a-zA-Z0-9]', '', selector)
    return f"const {safe_var} = document.querySelector('{selector}');\n            if ({safe_var}) {safe_var}.innerHTML = {assignment};"

safe_html = re.sub(pattern4, replacer4, safe_html)


with open(r'e:\\LLabbot\\scanner\\display.html', 'w', encoding='utf-8') as f:
    f.write(safe_html)
print("done")
