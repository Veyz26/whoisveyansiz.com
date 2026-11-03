#!/bin/sh
# Local preview at http://localhost:8766/private/ (uses dev/config.php; seed with: php dev/seed-demo.php --reset)
cd "$(dirname "$0")/.." && BUDGET_CONFIG=dev/config.php exec php -S localhost:8766 dev/router.php
