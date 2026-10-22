"""Prepare CAF using the peer's existing isolated loopback PostgreSQL."""
import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--peer-status', default=r'E:\Netloom\Netloom-Radius\.tools\integration-demo\peer-status.json')
    args = parser.parse_args()
    status = json.loads(Path(args.peer_status).read_text(encoding='utf-8-sig'))
    db_url = json.loads(Path(status['caf_database_file']).read_text(encoding='utf-8-sig'))['DATABASE_URL']
    u = urlsplit(db_url)
    if u.hostname not in ['127.0.0.1', 'localhost'] or not u.path.startswith('/caf_demo_'):
        raise RuntimeError('Existing loopback caf_demo_ database required')
    connection = json.loads(Path(status['connection_file']).read_text(encoding='utf-8-sig'))
    if connection['caf_company_id'] != 'netloom-demo-company' or connection['caf_franchise_id'] != 'netloom-demo-franchise':
        raise RuntimeError('Explicit demo mapping mismatch')
    demo = ROOT / '.tools' / 'working-demo'
    demo.mkdir(parents=True, exist_ok=True)
    runtime_path = demo / 'runtime.json'
    if runtime_path.exists():
        runtime = json.loads(runtime_path.read_text(encoding='utf-8'))
    else:
        runtime = {k: secrets.token_urlsafe(40) for k in ['authSecret', 'workerToken', 'readToken', 'adminPassword']}
        runtime_path.write_text(json.dumps(runtime), encoding='utf-8')
    app = ROOT.parent / 'caf-working-demo-app'
    marker = app / '.caf-demo-owned'
    if app.exists() and (not marker.exists() or marker.read_text() != str(ROOT)):
        raise RuntimeError('Generated app directory belongs to another task; choose an empty CAF demo location')
    app.mkdir(exist_ok=True)
    marker.write_text(str(ROOT))
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    for name in files:
        if not name or name == '.env' or name.startswith('.env.') and name != '.env.example':
            continue
        source = ROOT / name
        if source.is_file():
            destination = app / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    modules = app / 'node_modules'
    if not modules.exists():
        if os.name == 'nt':
            shutil.copytree(ROOT / 'node_modules', modules, ignore=shutil.ignore_patterns('.cache'))
        else:
            modules.symlink_to(ROOT / 'node_modules', target_is_directory=True)
    values = {'DATABASE_URL': db_url, 'AUTH_SECRET': runtime['authSecret'], 'CAF_RADIUS_DEMO': '1', 'CAF_RADIUS_DEMO_ALLOW_HTTP': '1', 'CAF_RADIUS_WORKER_TOKEN': runtime['workerToken'], 'CAF_RADIUS_DEMO_ACCEPT_SYNTHETIC_ACTIVE': '0', 'CAF_DEMO_ADMIN_PASSWORD': runtime['adminPassword'], 'CAF_DEMO_WORKER_BASE_URL': 'http://127.0.0.1:18110', 'APP_URL': 'http://127.0.0.1:18110', 'NODE_ENV': 'development', 'RUN_SEED': '0', 'LOCAL_STORAGE_PATH': str(demo / 'storage')}
    (demo / 'env.json').write_text(json.dumps(values), encoding='utf-8')
    env = {**os.environ, **values}
    config = {'companyId': 'netloom-demo-company', 'sourceId': connection['source_id'], 'baseUrl': connection['radius_base_url'], 'radiusCompanyId': connection['radius_company_id'], 'radiusToken': connection['token'], 'cafReadToken': runtime['readToken'], 'franchiseMappings': {'netloom-demo-franchise': connection['radius_franchise_id']}}
    steps = [('migrate', ['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'], None), ('seed', ['node', 'scripts/seed-radius-demo.cjs'], None), ('binding', ['node', 'scripts/configure-radius-demo.cjs'], json.dumps(config))]
    for name, command, stdin in steps:
        with (demo / (name + '.log')).open('w', encoding='utf-8') as log:
            result = subprocess.run(command, cwd=app, env=env, input=stdin, text=True, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError('Isolated ' + name + ' failed; inspect private .tools/working-demo/' + name + '.log')
    state = {'app': str(app), 'env': str(demo / 'env.json'), 'peerStatus': str(Path(args.peer_status).resolve()), 'cafUrl': 'http://127.0.0.1:18110', 'radiusUrl': status['radius_url'], 'radiusLoginFile': status['radius_login_file'], 'companyId': 'netloom-demo-company', 'franchiseId': 'netloom-demo-franchise'}
    (demo / 'state.json').write_text(json.dumps(state), encoding='utf-8')
    (demo / 'access.txt').write_text('ISOLATED CAF / RADIUS MODEL - synthetic data only\nCAF: http://127.0.0.1:18110\nCompany reviewer: demo-company@caf.example.test\nFranchise submitter: demo-counter@caf.example.test\nSuper admin: demo-admin@caf.example.test\nDemo account password: ' + runtime['adminPassword'] + '\nRadius: ' + status['radius_url'] + '\nRadius login file: ' + status['radius_login_file'] + '\nStage-only. No real network activation.\n', encoding='utf-8')
    print(json.dumps({'prepared': True, 'cafUrl': state['cafUrl'], 'radiusUrl': state['radiusUrl'], 'accessFile': str(demo / 'access.txt')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(str(e) if isinstance(e, RuntimeError) else 'Demo preparation failed; check private inputs and local services', file=sys.stderr)
        sys.exit(1)
