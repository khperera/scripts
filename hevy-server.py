"""Loopback-only LiftTracker companion; credentials never enter the browser."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API = 'https://api.hevyapp.com/v1'
MAX_BODY = 200_000
MAX_KEY_LENGTH = 4096
_session_api_key = None
_key_lock = threading.Lock()


def active_api_key():
    with _key_lock:
        return _session_api_key or os.environ.get('HEVY_API_KEY')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def upstream(method, route, body=None):
    key = active_api_key()
    if not key:
        return 503, {'error': 'HEVY_API_KEY is not configured on the companion.'}
    request = urllib.request.Request(API + route, data=body, method=method,
        headers={'api-key': key, 'Content-Type': 'application/json'})
    # urllib uses inherited HTTP(S)_PROXY and configured CA trust.
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        # Do not forward raw upstream error text or redirects to the browser.
        return error.code, {'error': f'Hevy returned HTTP {error.code}.',
                            'retry_after': error.headers.get('Retry-After')}
    except (OSError, ValueError):
        return 502, {'error': 'Hevy is unreachable. Check the network allowlist and connection.'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No URLs, credentials, or workout data in access logs.

    def respond(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self):
        global _session_api_key
        host = self.headers.get('Host', '')
        port = self.server.server_address[1]
        if host not in (f'127.0.0.1:{port}', f'localhost:{port}'):
            return self.respond(403, {'error': 'Local host only.'})
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + host:
            return self.respond(403, {'error': 'Same-origin requests only.'})
        url = urllib.parse.urlsplit(self.path)
        if url.path == '/api/status' and self.command == 'GET':
            with _key_lock:
                source = 'session' if _session_api_key else ('environment' if os.environ.get('HEVY_API_KEY') else 'none')
            return self.respond(200, {'configured': source != 'none', 'source': source})
        if url.path in ('/api/key', '/api/key/'):
            if origin != 'http://' + host or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.respond(403, {'error': 'Same-origin JSON is required.'})
            if self.command == 'POST':
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= MAX_KEY_LENGTH + 100:
                        return self.respond(413, {'error': 'Invalid key request size.'})
                    payload = json.loads(self.rfile.read(length))
                    key = payload.get('api_key') if isinstance(payload, dict) else None
                    if not isinstance(key, str) or not key.strip() or len(key.strip()) > MAX_KEY_LENGTH:
                        return self.respond(400, {'error': 'Enter a valid API key.'})
                    with _key_lock:
                        _session_api_key = key.strip()
                    return self.respond(200, {'configured': True, 'source': 'session'})
                except (ValueError, TypeError):
                    return self.respond(400, {'error': 'Expected an API key JSON value.'})
            if self.command == 'DELETE':
                with _key_lock:
                    _session_api_key = None
                    source = 'environment' if os.environ.get('HEVY_API_KEY') else 'none'
                return self.respond(200, {'configured': source != 'none', 'source': source})
            return self.respond(405, {'error': 'Method is not available.'})
        if url.path.startswith('/api/hevy/'):
            route = url.path[len('/api/hevy'):]
            lists = {'/user/info', '/exercise_templates', '/routines', '/routine_folders', '/workouts', '/workouts/events'}
            detail = re.fullmatch(r'/(routines|workouts)/([A-Za-z0-9_-]{1,100})', route)
            if route not in lists and not detail:
                return self.respond(404, {'error': 'Endpoint is not available.'})
            is_write = self.command == 'PUT' and detail and detail[1] == 'routines'
            if self.command != 'GET' and not is_write:
                return self.respond(405, {'error': 'Method is not available.'})
            body = None
            if is_write:
                if origin != 'http://' + host or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    return self.respond(403, {'error': 'Same-origin JSON is required.'})
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= MAX_BODY:
                        return self.respond(413, {'error': 'Invalid request size.'})
                    body = self.rfile.read(length)
                    payload = json.loads(body)
                    if not isinstance(payload, dict) or not isinstance(payload.get('routine'), dict):
                        raise ValueError()
                except (ValueError, TypeError):
                    return self.respond(400, {'error': 'Expected a routine JSON object.'})
            status, value = upstream(self.command, route + ('?' + url.query if url.query else ''), body)
            return self.respond(status, value)
        if self.command != 'GET':
            return self.respond(405, {'error': 'Method is not available.'})
        pathname = urllib.parse.unquote(url.path)
        relative = 'index.html' if pathname == '/' else pathname.lstrip('/')
        file = (ROOT / relative).resolve()
        # Serve only app assets, never dotfiles, exports, server files, or dependencies.
        permitted = (
            relative in ('index.html', 'planner.html', 'manifest.webmanifest') or
            (relative.startswith(('js/', 'css/')) and file.suffix in ('.js', '.css')) or
            (relative.startswith('assets/') and file.suffix == '.svg') or
            (relative.startswith('icons/') and file.suffix in ('.png', '.svg'))
        )
        if not permitted or not file.is_relative_to(ROOT) or not file.is_file():
            return self.respond(404, {'error': 'Not found.'})
        data = file.read_bytes()
        self.send_response(200)
        mime_type = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.webmanifest': 'application/manifest+json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
        }[file.suffix]
        self.send_header('Content-Type', mime_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_PUT = do_POST = do_DELETE = do_OPTIONS = dispatch


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8787'))
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'LiftTracker companion listening at http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()
