# Colonist Game Analyst

Colonist Game Analyst is a Chrome extension that adds a clean side panel to help you follow the match in real time.

## Features

- Live **Hands** table with per-player resource tracking (including unknown steals)
- **Resource bank** snapshot
- **Dice history**
- **Trades & production** overview
- **Victory & awards**
- **Development cards** and **pieces**
- **Light / dark mode** toggle
- Export session data as JSON

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `extension` folder from this repository

Open [colonist.io](https://colonist.io), then click the extension icon to open the side panel.

## Usage Tips

- Keep the game tab open while you play.
- The tracker updates as new game feed messages appear.
- Use **Clear all** to start a fresh session.
- Use **Pause updates** if you want to inspect a stable snapshot.

## Development

Run tests:

```bash
npm test
```

## Disclaimer

This project is for match tracking and personal analysis. Do not use it for automation or behavior that violates platform rules.

## License

[MIT](LICENSE)
