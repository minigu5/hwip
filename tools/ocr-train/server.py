import http.server, sys, os
OUT = sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n)
        with open(OUT, 'ab') as f: f.write(body + b'\n')
        self.send_response(204); self.end_headers()
    def log_message(self, *a): pass
os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(('127.0.0.1', 5288), H).serve_forever()
