"""Exercise the actual rsync exclusion contract against a disposable webroot."""
from pathlib import Path
import subprocess
import tempfile

workflow = Path(__file__).resolve().parents[2] / '.github/workflows/deploy.yml'
text = workflow.read_text()
assert "--exclude '/teaching-preview/'" in text
assert "--exclude '/teaching/'" in text
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    source, target = root / 'site', root / 'webroot'
    source.mkdir(); target.mkdir()
    (source / 'index.html').write_text('new rotation content')
    (target / 'index.html').write_text('old rotation')
    (target / 'old-asset.js').write_text('old')
    (target / 'rotation-config.php').write_text('preserve')
    for module in ('teaching-preview', 'teaching'):
        (target / module / '_private').mkdir(parents=True)
        (target / module / '_private' / 'db.sqlite').write_text('preserve data')
        (target / module / 'index.html').write_text('preserve app')
    subprocess.run(['rsync', '-a', '--delete', '--exclude', 'rotation-config.php', '--exclude', '/teaching-preview/', '--exclude', '/teaching/', str(source)+'/', str(target)+'/'], check=True)
    assert (target/'index.html').read_text() == 'new rotation content'
    assert not (target/'old-asset.js').exists()
    assert (target/'rotation-config.php').read_text() == 'preserve'
    for module in ('teaching-preview', 'teaching'):
        assert (target/module/'_private/db.sqlite').read_text() == 'preserve data'
        assert (target/module/'index.html').read_text() == 'preserve app'
print('Deploy isolation: old assets removed; both modules and private data preserved')
release = Path(__file__).resolve().parents[1] / '.release'
if release.is_dir():
    assert (release / 'index.php').is_file() and not (release / 'index.html').exists()
    assert not (release / '_private').exists()
    for file in (release / '_app').rglob('*'):
        if file.is_file():
            assert file.name == '.htaccess' or file.suffix in ('.php', '.sql', '.blob'), file
    print('Release: no private runtime data or Nginx static document extensions')
