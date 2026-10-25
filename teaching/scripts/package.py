"""Package only deployable code. Never include local records, accounts or reports."""
from pathlib import Path
import hashlib
import json
import shutil
import tempfile

root = Path(__file__).resolve().parents[1]
dist = root / 'frontend' / 'dist'
if not (dist / 'index.html').is_file():
    raise SystemExit('Build teaching/frontend first: npm ci && npm run build')
release = root / '.release'
stage = Path(tempfile.mkdtemp(prefix='.package-', dir=root))
try:
    for name in ('api.php', 'index.php', '.htaccess'):
        shutil.copy2(root / 'public' / name, stage / name)
    (stage / '_app').mkdir()
    shutil.copy2(dist / 'index.html', stage / '_app' / 'index.html.blob')
    shutil.copytree(dist / 'assets', stage / 'assets')
    for folder, pattern in [('backend', '*.php'), ('schema', '*.sql'), ('templates', '*.docx'), ('scripts', '*.php')]:
        dest = stage / '_app' / folder
        dest.mkdir(parents=True)
        for source in (root / folder).glob(pattern):
            shutil.copy2(source, dest / (source.name + '.blob' if folder == 'templates' else source.name))
    (stage / '_app' / '.htaccess').write_text('Require all denied\n')
    manifest = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(stage.rglob('*')) if p.is_file()}
    # The manifest is local evidence; it is not part of the public website.
    (root / '.local').mkdir(exist_ok=True)
    (root / '.local' / 'release-manifest.json').write_text(json.dumps(manifest, indent=2))
    if release.exists():
        shutil.rmtree(release)  # generated code only; never runtime data
    stage.rename(release)
    print(f'Packaged {len(manifest)} files; private data excluded: {release}')
finally:
    if stage.exists():
        shutil.rmtree(stage)
