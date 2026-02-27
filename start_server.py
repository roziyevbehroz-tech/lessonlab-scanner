import os
import sys
import json
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8000

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        SimpleHTTPRequestHandler.end_headers(self)

if __name__ == '__main__':
    print(f"Starting server on http://localhost:{PORT}")
    httpd = HTTPServer(('localhost', PORT), CORSRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
