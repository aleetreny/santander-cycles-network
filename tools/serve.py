"""Local preview server for site/ that never lets the browser cache files (python tools/serve.py 4180)."""
import functools
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4180
    handler = functools.partial(NoCache, directory='site')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
