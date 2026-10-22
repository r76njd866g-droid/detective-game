"""Serve only allowlisted staging assets. Local preview, not a hosted deployment."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
from urllib.parse import unquote, urlsplit

try:
    from .prepare_staging import PUBLIC_FILES
except ImportError:
    from prepare_staging import PUBLIC_FILES

class StagingHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if path != '/' and path not in {'/' + name for name in PUBLIC_FILES}:
            self.send_error(404, 'Not a public game asset')
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, 'Directory listing disabled')
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

def make_server(directory, host='127.0.0.1', port=8080):
    root = Path(directory).resolve(strict=True)
    if not (root / 'index.html').is_file():
        raise ValueError('Staging directory must contain index.html')
    return ThreadingHTTPServer((host, port), partial(StagingHandler, directory=str(root)))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--certfile', help='Optional already trusted TLS certificate; do not commit it')
    parser.add_argument('--keyfile', help='Optional TLS key; do not commit it')
    args = parser.parse_args()
    if bool(args.certfile) != bool(args.keyfile):
        parser.error('--certfile and --keyfile must be supplied together')
    server = make_server(args.directory, args.host, args.port)
    scheme = 'http'
    if args.certfile:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.certfile, args.keyfile)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = 'https'
    print(f'Local staging: {scheme}://{args.host}:{server.server_port}/', flush=True)
    print('For a phone use a separate HTTPS staging origin; remote localhost is not a phone URL.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
