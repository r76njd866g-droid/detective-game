"""Cross-chapter consistency of facts that puzzles and endings rely on. Run from the repo root."""
import re
from pathlib import Path

pages = {n: Path('index.html' if n == 2 else f'chapter{n}.html').read_text(encoding='utf-8') for n in range(2, 9)}
text = {n: re.sub(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+', '', s) for n, s in pages.items()}
failures = []

def check(ok, message):
    print(('PASS: ' if ok else 'FAIL: ') + message)
    if not ok:
        failures.append(message)

def stamp(chapter, pattern):
    match = re.search(pattern, text[chapter])
    assert match, (chapter, pattern)
    day, hh, mm = match.groups()
    return int(day) * 1440 + int(hh) * 60 + int(mm)

# 17 October: order → call → substitution → note → taxi → power cut.
order = stamp(6, r'ПРОЕКТ ЗАМЕНЫ ЛИСТА 8\\n(\d+) октября, (\d+):(\d+)')
call = stamp(7, r'(\d+) октября, (\d+):(\d+)\\nВход: архив, линия 4')
swap = stamp(3, r'Разрешение на изъятие: А\. Белов\.\\nДата: (\d+) октября, (\d+):(\d+)')
note = stamp(2, r"typewriter:\{[^}]*body:'(\d+) октября, (\d+):(\d+)")
power = stamp(2, r"power:\{[^}]*body:'(\d+) октября\\n\\n(\d+):(\d+) — плановое")
check(order < call < swap < note < power, 'evening of 17 October: order 19:30 < call 20:35 < substitution 20:50 < note 21:05 < power cut 21:15')

# 19 October night: station declaration → director's order 12/К → telegram → removal from the train.
declared = stamp(3, r"dispatch:\{[^}]*body:'(\d+) октября, (\d+):(\d+)")
order12 = stamp(5, r'Отправлено: (\d+) октября, (\d+):(\d+)')
receipt = stamp(5, r'"body": "(\d+) октября, (\d+):(\d+)\\nПринято распоряжение 12/К')
telegram = stamp(3, r"telegram:\{[^}]*body:'(\d+) октября, (\d+):(\d+)")
removed = stamp(3, r"timetable:\{[^}]*body:'(\d+) октября, (\d+):(\d+)")
check(declared < order12 < receipt < telegram < removed, 'R-8 route: declared 00:10 < order 12/К < receipt < telegram 00:30 < removed from train 00:35')

# Physical description of R-8 never changes.
for n in (3, 4, 5, 8):
    if n != 5:
        check('3,4 кг' in text[n], f'chapter {n}: R-8 weighs 3,4 кг')
    if n != 3:
        check('274' in text[n], f'chapter {n}: R-8 seal is 274')

# Nobody claims Rudnev arranged the telegram, which was sent after he left.
check('Руднев велел сохранить копирку накладной и служебный конверт' not in text[3], 'chapter 3: the telegram reached Orlova by mistake, not on Rudnev\'s order')
check('Скажешь, что пропал' not in text[7], 'chapter 7: the 20:35 call cannot know Rudnev will leave at 21:12')
check('выписку из восьмой папки' not in text[6] and 'В одной папке находится' not in text[4], 'sealed R-8 is not described as already opened before the registry')

# Mixed Latin/Cyrillic look-alikes inside Russian text (e.g. «серии C»).
for n, s in text.items():
    body = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', lambda m: m.group(0) if 'const' in m.group(0) else '', s, flags=re.S)
    bad = re.findall(r'(?:серии|бланк\w*|Р-|пломб\w*)\s?[A-Z]\b', body)
    check(not bad, f'chapter {n}: no Latin look-alike letters in series/markings {bad or ""}')

# Chapter numbering in the shared V–VIII engine is Roman, like the rest of the game.
for n in (5, 6, 7):
    check('Перейти в главу ${C.n+1}' not in text[n], f'chapter {n}: next-chapter button uses Roman numerals')

raise SystemExit(1 if failures else 0)
