# Scotland Yard (board game)

[![Build Status](https://travis-ci.com/tim-koehler/ScotlandYard.svg?branch=master)](https://travis-ci.com/tim-koehler/ScotlandYard)
[![Coverage Status](https://coveralls.io/repos/github/tim-koehler/ScotlandYard/badge.svg?branch=master)](https://coveralls.io/github/tim-koehler/ScotlandYard?branch=master)

## About

Scotland Yard is a board game in which a team of players, as police, cooperate to track down a player controlling a criminal around a board representing the streets of London, first published in 1983. It is named after Scotland Yard, the headquarters of London's Metropolitan Police Service. Scotland Yard is an asymmetric board game, with the detective players cooperatively solving a variant of the pursuit-evasion problem. The game is published by Ravensburger in most of Europe and Canada and by Milton Bradley in the United States. It received the Spiel des Jahres (Game of the Year) award in 1983.

![alt text](https://raw.githubusercontent.com/tim-koehler/ScotlandYard/master/resources/readMeScreenshot.PNG)

## Installation

```
git clone https://github.com/tim-koehler/ScotlandYard.git
```
then run the following to make the gui work (only works on linux):
```
xhost +local:$(id -un)
```
and finally
```
docker-compose up -d
```

## Background
This is a project build during the "Software Engeneering" lecture at the HTWG Konstanz

## Find Mr. X (web version)

`web/` contains **Find Mr. X**, a mobile-first browser version of the game, playable solo or online with 2 to 8 players (Mr. X plus up to 7 detectives; more people can join to watch). It is a static site: plain HTML, CSS and JavaScript with no build step and no frameworks. The only external scripts are PeerJS 1.5.4 and the Oswald font, both from jsDelivr and pinned to exact versions.

> Station network derived from tim-koehler/ScotlandYard (Apache-2.0). Find Mr. X is an unofficial fan project and is not affiliated with Ravensburger.
>
> Map data © OpenStreetMap contributors (ODbL). The illustrated board, station layout and landmark icons are original; no board artwork, scans or official station coordinates are used.

### Deploy on Netlify Drop

1. Open <https://app.netlify.com/drop>.
2. Drag **`web.zip`** (in the repository root) onto the page. Dragging the `web` folder also works.
3. Netlify gives you a public `https://…netlify.app` address. Share it with your players.

After one visit with internet, the site is saved on the phone: solo games then work fully offline. Online games still need internet. "Add to Home Screen" installs it like an app.

The site needs HTTPS for online play, which Netlify provides. For a quick local try, open `web/index.html` directly: solo play works from `file://`. To serve it locally, any static server works, e.g. `cd web && python3 -m http.server`.

To rebuild `web.zip` after changes, run `python3 web/tools/package.py`.

### How online play works

- **Hosting.** One player hosts and becomes the **game master**. They get a 4-letter code to share. Others choose *Play online* → enter the code → *Join game*.
- **Names and aliases.** Everyone types their own name, and optionally an alias for their role, on their own phone: on the join screen, from *Edit* in the lobby, or mid-game from the game menu. Nobody has to name everyone else. Mr. X then shows as "Mr. X (Flora)", or "Moriarty (Flora)" with an alias, and detectives as "D2 · Holmes (Sam)".
- **Photos.** Players can add a photo on the same screens. Their detective pieces then show it on the map and in the piece cards; without one they show the player's initials ("Paul Davidson" becomes "PD"). Photos are shrunk on the phone and only shared with the other players in the game.
- **Roles.** In the lobby the game master chooses who is **Mr. X**, who plays **detectives**, and who just watches. Watching includes the game master themselves, if they only want to referee. They also choose how many detective pieces go on the board (2 to 7; the classic game uses up to 5, and 6–7 is a big-group variant where Mr. X gets one black ticket per detective). The pieces are shared out between the detective players, and the count rises automatically when more people choose detective. They can pick a random Mr. X and allow tactical hints.
- **Connections.** Devices connect **peer to peer** through PeerJS (WebRTC). The game master's device is the hub. No game data is stored on a server; the public PeerJS server is only used to introduce devices to each other.
- **Referee mode.** The game master picks one in the lobby, and every player can see which:
  - **Verified** (default). Every move is signed on the player's own device (ECDSA). Mr. X's position never leaves his device: each of his moves carries a SHA-256 commitment, and at the end he reveals his route so every device can audit the whole game. A cheat by anyone, the game master included, is caught and named. To rule out impersonation, players compare the 🔑 key fingerprints shown in the lobby.
  - **Trusted game master.** The game master's device holds Mr. X's position (and can see it). This is simpler, and the game master can take over Mr. X if he leaves.
- **Reconnects.** If someone's connection drops, their screen shows *Connection lost. Reconnecting…* and they rejoin automatically. After a reload, they use *Rejoin game* from the online menu. If the game master reloads, *Resume hosting* restores the saved game and players reconnect on their own. From the game menu, the game master can hand an absent player's pieces to someone else.
- **Which network?** Any internet connection works. The phones don't need to be on the same Wi-Fi or hotspot, but each one needs internet: the site loads from Netlify, and PeerJS's public server introduces the devices to each other. A hotspot with no mobile data won't work (see `web/NOTES.md`).
- **TURN servers.** Players on strict networks (some corporate, school or mobile networks) may need a TURN relay. PeerJS already includes free, best-effort relays. For a dependable one, add yours to `FY.CONFIG.net.iceServers` in `web/js/config.js`; it is added to the defaults, not swapped for them. One option is Metered's free plan:
  `iceServers: [{ urls: ["turn:standard.relay.metered.ca:80", "turn:standard.relay.metered.ca:443?transport=tcp", "turns:standard.relay.metered.ca:443"], username: "…", credential: "…" }]`

### Tuning and tests

- **Rules.** Every rule constant lives in `FY.CONFIG` in `web/js/config.js`: rounds, reveal moves, ticket counts, black and double tickets, detective pieces, player limits and AI pacing.
- **Tests.** Run them with:
  - `node web/tests/test.mjs`: graph checks, move generators, rules and hundreds of AI games. No dependencies.
  - `node web/tests/protocol.mjs`: signed-log verification and cheat detection. No dependencies.
  - `node web/tests/ui-smoke.cjs`, `node web/tests/online-smoke.cjs` and `node web/tests/offline-identity.cjs`: real-browser solo games, three- and eight-player online games (`FY_PLAYERS=8`), offline loading, and one-seat-per-player checks. These need Playwright.
- **Data and map pipeline.** `web/tools/` holds the station graph builder and validators, the layout generator and the London map renderers. `web/NOTES.md` documents every decision.
