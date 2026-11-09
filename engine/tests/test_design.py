import copy
import json
import unittest
from test_engine import fixture
from models import validate
from optics import calculate_spectrum
from optimization import optimize
from agent import run_agent, endpoint_url, execute_tool


def target_project():
    p = validate(fixture())
    desired = copy.deepcopy(p)
    desired['layers'][0]['thickness_nm'] *= 1.15
    spectrum = calculate_spectrum(desired)
    p['target_points'] = [{'wavelength_nm': w, 'R_percent': spectrum['R_percent'][i], 'T_percent': spectrum['T_percent'][i]} for i, w in enumerate(spectrum['wavelength_nm']) if i % 30 == 0]
    return p


def variable(p):
    return {'side': 'front', 'id': p['layers'][0]['id'], 'min_nm': 30, 'max_nm': 120}


class OptimizationTests(unittest.TestCase):
    def test_fit_improves_real_spectrum_without_mutating_input_or_other_layers(self):
        p = target_project(); before = copy.deepcopy(p)
        result = optimize(p, [variable(p)])
        self.assertLess(result['final_rmse'], result['initial_rmse'] * 0.001)
        self.assertAlmostEqual(result['project']['layers'][0]['thickness_nm'], p['layers'][0]['thickness_nm'] * 1.15, places=4)
        self.assertEqual(p, before)
        self.assertEqual(result['project']['layers'][1:], p['layers'][1:])
        self.assertLess(result['spectrum']['max_energy_error'], 1e-10)

    def test_candidate_preserves_metadata_and_boundary_precision(self):
        p = target_project()
        p['settings']['substrate_n'] = 1.5200000000000002
        r = optimize(p, [variable(p)])
        self.assertEqual(r['project']['settings'], p['settings'])
        self.assertEqual(r['project']['materials'], p['materials'])

    def test_invalid_targets_bounds_and_duplicate_variables(self):
        p = target_project(); v = variable(p)
        bad = [[], [v, v], [{**v, 'id': 'missing'}], [{**v, 'side': 'other'}], [{**v, 'min_nm': 100}], [{**v, 'max_nm': float('nan')}]]
        for variables in bad:
            with self.subTest(variables=variables), self.assertRaises((ValueError, KeyError)):
                optimize(p, variables)
        p['target_points'][0]['wavelength_nm'] = 399
        with self.assertRaisesRegex(ValueError, '范围'):
            optimize(p, [v])
        p.pop('target_points')
        with self.assertRaisesRegex(ValueError, '目标'):
            optimize(p, [v])

    def test_budget_and_time_limit_return_best_bounded_candidate(self):
        p = target_project()
        result = optimize(p, [variable(p)], max_evaluations=10)
        self.assertLessEqual(result['evaluations'], 10)
        self.assertLessEqual(result['final_rmse'], result['initial_rmse'])
        result = optimize(p, [variable(p)], time_limit=0)
        self.assertEqual(result['evaluations'], 1)
        self.assertEqual(result['status'], 'budget')
        self.assertEqual(result['project'], p)

    def test_both_polarizations_and_rear_finite_substrate(self):
        for pol in ('s', 'p'):
            p = target_project(); p['settings']['polarization'] = pol; p['settings']['angle_deg'] = 30
            result = optimize(p, [variable(p)], 20)
            self.assertLessEqual(result['final_rmse'], result['initial_rmse'])
        p = target_project()
        p['settings'].update(substrate_model='incoherent', substrate_thickness_mm=1, exit_material='AIR')
        p['back_layers'] = [{**copy.deepcopy(p['layers'][0]), 'id': 'rear'}]
        result = optimize(p, [{**variable(p), 'id': 'rear', 'side': 'back'}], 10)
        self.assertEqual(result['project']['layers'], p['layers'])
        self.assertGreaterEqual(result['project']['back_layers'][0]['thickness_nm'], 30)


class AgentTests(unittest.TestCase):
    def config(self):
        return {'api_key': 'test-key', 'model': 'test-model', 'endpoint': 'https://example.test/v1'}

    def test_real_tool_loop_draft_compute_and_history_without_storage(self):
        p = validate(fixture()); before = copy.deepcopy(p); bodies = []
        def transport(url, key, body):
            bodies.append(copy.deepcopy(body))
            name_args = [('read_project', {}), ('propose_thickness', {'side': 'front', 'layer': 1, 'thickness_nm': 70}), ('calculate_spectrum', {})]
            if len(bodies) <= 3:
                name, args = name_args[len(bodies) - 1]
                return {'status': 'completed', 'output': [{'type': 'reasoning', 'encrypted_content': 'test'}, {'type': 'function_call', 'call_id': str(len(bodies)), 'name': name, 'arguments': json.dumps(args)}]}
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '候选已计算，请预览后应用。'}]}]}
        r = run_agent(p, '修改并计算', self.config(), [{'role': 'user', 'content': '你好'}], transport)
        self.assertEqual(p, before)
        self.assertEqual(r['project']['layers'][0]['thickness_nm'], 70)
        self.assertEqual([t['tool'] for t in r['trace']], ['read_project', 'propose_thickness', 'calculate_spectrum'])
        self.assertFalse(bodies[0]['store'])
        self.assertIn('function_call_output', [i.get('type') for i in bodies[-1]['input']])
        self.assertIn('reasoning', [i.get('type') for i in bodies[-1]['input']])
        self.assertNotIn('api_key', json.dumps(bodies))

    def test_http_responses_protocol_against_local_fake_model(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread
        from agent import call_model
        received = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                received.append((self.path, self.headers.get('Authorization'), body))
                payload = {'output': [{'type': 'function_call', 'name': 'calculate_spectrum', 'call_id': 'local-1', 'arguments': '{}'}]} if len(received) == 1 else {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '本地协议仿真完成'}]}]}
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps(payload).encode())
        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                config = {**self.config(), 'endpoint': f'http://127.0.0.1:{server.server_port}/v1'}
                result = run_agent(fixture(), '计算光谱', config)
                self.assertEqual(result['answer'], '本地协议仿真完成')
                self.assertEqual(received[0][0], '/v1/responses')
                self.assertEqual(received[0][1], 'Bearer test-key')
                self.assertFalse(received[0][2]['store'])
                self.assertEqual(result['trace'][0]['tool'], 'calculate_spectrum')
                self.assertTrue(any(item.get('type') == 'function_call_output' for item in received[1][2]['input']))
            finally:
                server.shutdown(); thread.join()

    def test_invalid_tool_arguments_are_atomic(self):
        p = validate(fixture()); before = copy.deepcopy(p)
        for name, args in [('shell', {}), ('propose_thickness', {'side': 'front', 'layer': 0, 'thickness_nm': 20}), ('propose_thickness', {'side': 'front', 'layer': 1, 'thickness_nm': float('nan')}), ('calculate_spectrum', {'path': '/tmp'})]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                execute_tool(p, name, args)
            self.assertEqual(p, before)

    def test_connection_validation_prevents_redirect_credential_urls_and_missing_key(self):
        for endpoint in ('http://example.com/v1', 'https://key@host/v1', 'file:///tmp', 'https://host/v1?key=secret'):
            with self.assertRaises(ValueError): endpoint_url(endpoint)
        self.assertEqual(endpoint_url('http://127.0.0.1:8000/v1'), 'http://127.0.0.1:8000/v1/responses')
        with self.assertRaises(ValueError): run_agent(fixture(), '分析', {**self.config(), 'api_key': ''})

    def test_model_errors_tool_limit_and_incomplete_are_not_reported_as_success(self):
        p = fixture(); before = copy.deepcopy(p)
        for response in ({'status': 'incomplete', 'output': []}, {'output': []}, {'output': [{'type': 'function_call', 'name': 'read_project', 'call_id': '1', 'arguments': '{}'}]}):
            with self.assertRaises(ValueError):
                run_agent(p, '分析', self.config(), transport=lambda *args: response)
            self.assertEqual(p, before)
