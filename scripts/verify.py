#!/usr/bin/env python3
"""End-to-end verification with the Python standard library. Start services first."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request


def request(url):
    try:
        response = urllib.request.urlopen(url, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response), response.headers


def tags(span):
    return {tag['key']: tag['value'] for tag in span['tags']}


def verify():
    started = int(time.time() * 1_000_000)
    status, user, headers = request('http://localhost:3001/api/users/1')
    assert status == 200 and user == {'id': 1, 'name': 'Darpan', 'email': 'darpan@example.com'}, (status, user)
    assert headers['Access-Control-Allow-Origin'] == 'http://localhost:3000'
    query = urllib.parse.urlencode({'service': 'app-service', 'start': started, 'limit': 100})
    deadline = time.monotonic() + 30
    found = None
    while time.monotonic() < deadline:
        _, response, _ = request('http://localhost:16686/api/traces?' + query)
        for candidate in response.get('data') or []:
            spans = candidate['spans']
            processes = candidate['processes']
            def service(span):
                return processes[span['processID']]['serviceName']
            roots = [s for s in spans if service(s) == 'app-service'
                     and tags(s).get('span.kind') == 'server'
                     and tags(s).get('url.path', tags(s).get('http.target')) == '/api/users/1']
            outgoing = [s for s in spans if service(s) == 'app-service'
                        and tags(s).get('span.kind') == 'client'
                        and 'localhost:3002/users/1' in str(tags(s).get('url.full', tags(s).get('http.url')))]
            incoming = [s for s in spans if service(s) == 'data-service'
                        and tags(s).get('span.kind') == 'server']
            db = [s for s in spans if service(s) == 'data-service'
                  and tags(s).get('db.system.name', tags(s).get('db.system')) == 'postgresql'
                  and tags(s).get('db.query.text', tags(s).get('db.statement')) == 'SELECT * FROM users WHERE id = $1']
            if not (roots and outgoing and incoming and db):
                continue  # Independent exporters may send their batches at different times.
            ids = {s['spanID']: s for s in spans}
            assert len(ids) == len(spans), 'Duplicate span IDs'
            assert all(s['traceID'] == candidate['traceID'] for s in spans)
            assert not roots[0]['references'], 'Expected a fresh root trace'
            def descends_from(child, ancestor):
                seen = set()
                while child['spanID'] != ancestor['spanID']:
                    assert child['spanID'] not in seen, 'Cycle in parent chain'
                    seen.add(child['spanID'])
                    parents = [r for r in child['references'] if r['refType'] == 'CHILD_OF']
                    assert len(parents) == 1, 'Expected exactly one parent'
                    parent = parents[0]
                    assert parent['traceID'] == candidate['traceID']
                    assert parent['spanID'] in ids, 'Missing parent span'
                    child = ids[parent['spanID']]
                return True
            assert descends_from(outgoing[0], roots[0])
            assert descends_from(incoming[0], outgoing[0])
            assert descends_from(db[0], incoming[0])
            assert all(descends_from(span, roots[0]) for span in spans)
            found = candidate
            break
        if found:
            break
        time.sleep(1)
    assert found, 'No complete distributed trace in Jaeger within 30 seconds'
    print('PASS: user 1, CORS, automatic propagation, unique span IDs, DB SELECT, Jaeger export')
    print('Trace ID:', found['traceID'])
    for span in [roots[0], outgoing[0], incoming[0], db[0]]:
        print(f"  {service(span):12} {span['spanID']}  {span['operationName']}")
    for user_id, expected_status, expected in [
        ('2', 200, {'id': 2, 'name': 'John', 'email': 'john@example.com'}),
        ('999', 404, {'error': 'User not found'}),
        ('abc', 400, {'error': 'User ID must be a positive 32-bit integer'}),
        ('2147483648', 400, {'error': 'User ID must be a positive 32-bit integer'}),
    ]:
        status, body, _ = request('http://localhost:3001/api/users/' + user_id)
        assert status == expected_status and body == expected, (user_id, status, body)
    print('PASS: user 2, unknown ID, invalid ID, integer overflow')
    print('Open http://localhost:16686/trace/' + found['traceID'])


if __name__ == '__main__':
    try:
        verify()
    except (AssertionError, OSError, ValueError) as error:
        raise SystemExit(f'FAIL: {error}')
