# send telegram notification
export TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
export TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
export TELEGRAM_MESSAGE="✅ [<a href=\\\"http://google.com\\\">blesswinsamuel/notify-telegram</a>]
success
<b>Workflow:</b> test
<b>Action:</b> testact
Test message from notify-telegram"

curl -X POST -H 'Content-Type: application/json' -d '{"chat_id": "'"$TELEGRAM_CHAT_ID"'", "text": "'"$TELEGRAM_MESSAGE"'", "parse_mode": "HTML"}' https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage

