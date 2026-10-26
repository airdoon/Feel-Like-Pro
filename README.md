# Feel Like Pro

Готовый к развёртыванию проект находится в папке [`feel_like_pro_auth`](feel_like_pro_auth/README.md). Там лежат исходный код, `compose.yaml`, Dockerfile, конфигурация Caddy и подробная инструкция.

Для переноса на VPS можно загрузить всю папку `feel_like_pro_auth` либо распаковать `Feel-Like-Pro-deploy.zip` в отдельный каталог. Затем заполнить `.env` по образцу `.env.example` и выполнить в каталоге приложения:

```bash
docker compose up -d --build
```

Нужны собственные домен с DNS-записью на VPS, Telegram-бот и его токен, Telegram ID администратора, секреты и установленные Docker Engine + Compose plugin. Без этих данных настоящий Telegram-вход и HTTPS-сайт не могут быть запущены. Открытие `public/index.html` напрямую показывает только визуальный предпросмотр.
