# detective-game
Interactive detective mystery game with branching storylines, clues, puzzles, and multiple endings.

Доступны главы II–VIII. Запуск: `python -m http.server 8080`, затем
`http://localhost:8080`. Главы и служебная страница `saves.html` должны быть
доступны по одному адресу и порту. Интернет для игры не требуется.

Сохранения, экспорт/импорт и выбор прохождений: ссылка «Сохранения» в игре.
Старые записи не удаляются. См. [формат и ограничения](docs/SAVE_FORMAT.md).

Проверки: `node tests/saves.test.js`, `python tests/static_check.py`;
браузерный сценарий и ручная приёмка: [TESTING](docs/TESTING.md).

План будущего движка: [ENGINE_PLAN](docs/ENGINE_PLAN.md). Новые механики
на этом этапе не подключены. Восстановление главы I — отдельная задача.
