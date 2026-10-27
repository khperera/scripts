import importlib.util
import json
import os
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hevy_server', Path(__file__).parents[1] / 'hevy-server.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CompanionTests(unittest.TestCase):
    def setUp(self):
        bridge._session_api_key = None
        self.server = bridge.ThreadingHTTPServer(('127.0.0.1', 0), bridge.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.mock = patch.object(bridge, 'upstream', return_value=(200, {'ok': True})).start()

    def tearDown(self):
        bridge._session_api_key = None
        patch.stopall()
        self.server.shutdown()
        self.server.server_close()

    def request(self, route, method='GET', value=None, headers=None):
        req = urllib.request.Request(self.base + route, method=method,
            data=json.dumps(value).encode() if value is not None else None, headers=headers or {})
        try:
            response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_key_stays_server_side_and_assets_are_restricted(self):
        with patch.dict(os.environ, {'HEVY_API_KEY': 'mock-secret'}):
            code, body = self.request('/api/status')
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {'configured': True, 'source': 'environment'})
        self.assertNotIn(b'mock-secret', body)
        for route in ['/hevy-server.py', '/.git/config', '/package.json', '/lifttracker-2025-08-28.json', '/js/../hevy-server.py']:
            self.assertEqual(self.request(route)[0], 404)
        self.assertEqual(self.request('/')[0], 200)

    def test_uuid_reads_and_write_allowlist(self):
        rid = '12345678-abcd-1234-5678-123456789abc'
        self.assertEqual(self.request('/api/hevy/workouts/' + rid)[0], 200)
        self.assertEqual(self.request('/api/hevy/routines/' + rid, 'PUT', {'routine': {'title': 'Test'}},
            {'Origin': self.base, 'Content-Type': 'application/json'})[0], 200)
        self.assertEqual(self.request('/api/hevy/workouts', 'POST', {})[0], 405)
        self.assertEqual(self.request('/api/hevy/user/other')[0], 404)

    def test_user_key_stays_in_memory_overrides_environment_and_forget_falls_back(self):
        with patch.dict(os.environ, {'HEVY_API_KEY': 'environment-secret'}):
            code, body = self.request('/api/key', 'POST', {'api_key': 'user-entered-secret'},
                {'Origin': self.base, 'Content-Type': 'application/json'})
            self.assertEqual(code, 200)
            self.assertEqual(json.loads(body), {'configured': True, 'source': 'session'})
            self.assertNotIn(b'user-entered-secret', body)

            patch.stopall()
            with patch.object(bridge.urllib.request, 'build_opener') as build:
                build.return_value.open.side_effect = OSError('mock upstream')
                bridge.upstream('GET', '/user/info')
                req = build.return_value.open.call_args.args[0]
                self.assertEqual(req.get_header('Api-key'), 'user-entered-secret')

            status, status_body = self.request('/api/status')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(status_body), {'configured': True, 'source': 'session'})
            self.assertNotIn(b'user-entered-secret', status_body)

            code, body = self.request('/api/key', 'DELETE', {},
                {'Origin': self.base, 'Content-Type': 'application/json'})
            self.assertEqual(code, 200)
            self.assertEqual(json.loads(body), {'configured': True, 'source': 'environment'})
            self.assertIsNone(bridge._session_api_key)

    def test_rebinding_cross_origin_and_bad_json_rejected(self):
        self.assertEqual(self.request('/api/status', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/status', headers={'Origin': 'http://localhost:1'})[0], 403)
        self.assertEqual(self.request('/api/key', 'POST', {'api_key': 'blocked-secret'},
            {'Content-Type': 'application/json'})[0], 403)
        self.assertIsNone(bridge._session_api_key)
        self.assertEqual(self.request('/api/hevy/routines/abc', 'PUT', {}, {'Content-Type': 'application/json'})[0], 403)
        self.assertEqual(self.request('/api/hevy/routines/abc', 'PUT', [], {'Origin': self.base, 'Content-Type': 'application/json'})[0], 400)
        self.mock.assert_not_called()

    def test_upstream_uses_proxy_aware_opener_with_key_only_in_header(self):
        patch.stopall()
        with patch.dict(os.environ, {'HEVY_API_KEY': 'mock-secret'}), patch.object(bridge.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = OSError('blocked')
            code, body = bridge.upstream('GET', '/user/info')
            req = build.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url, 'https://api.hevyapp.com/v1/user/info')
            self.assertEqual(req.get_header('Api-key'), 'mock-secret')
            self.assertEqual(code, 502)
            self.assertNotIn('mock-secret', json.dumps(body))


if __name__ == '__main__':
    unittest.main()
