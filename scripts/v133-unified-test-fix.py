from pathlib import Path

path = Path('test/offline-recovery.test.js')
text = path.read_text(encoding='utf-8')
old = "  assert.match(background, /project-console\\.js', 'components\\/offline-recovery\\/controller\\.js'/);"
new = "  assert.match(background, /const CONTENT_SCRIPT_FILES = Object\\.freeze\\([\\s\\S]*'project-console\\.js',[\\s\\S]*'components\\/offline-recovery\\/controller\\.js'/);\n  assert.match(background, /files: CONTENT_SCRIPT_FILES/);"
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one stale background assertion, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')
