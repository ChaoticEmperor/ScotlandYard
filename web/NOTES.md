# Find Mr. X: repo investigation notes

> The game was first called "Fog Yard", then "Shadow Line". It is now **Find Mr. X**, which says what the game is. Internal identifiers (`FY` namespace, `fogyard.` storage keys, `fogyard-` peer ids) keep the old name so saved games and online codes keep working across versions.

Source: `tim-koehler/ScotlandYard` (Scala, Apache-2.0). This fork keeps the LICENSE.
Only the abstract station graph and rule constants are used. No artwork, coordinates, logos or branding are taken.

## Where the board data lives

| What | File |
|---|---|
| Station graph (authoritative) | `GameInitializer/resources/stations.json` (a copy is in `GameInitializer/src/test/.../resources/stations.json`) |
| Station model | `Model/.../Station.scala`: `number`, `stationType`, `blackStation`, `neighbourTaxis`, `neighbourBuses`, `neighbourUndergrounds`, plus `tuiCoordinates` / `guiCoordinates` |
| Ticket types | `Model/.../TicketType.scala` (Taxi, Bus, Underground, Black) |

Each of the 200 entries has `number` 0-199.
- Entry 0 is a placeholder with no edges. The real board is stations 1-199.
- `guiCoordinates` and `tuiCoordinates` come from the official board artwork. **They are not used.** `layout.json` will be original.

### Graph statistics (measured)

- 199 real stations, 1-199.
- Taxi edges: 344 undirected.
- Bus edges: 99.
- Underground edges: 20.
- 14 underground stations: 1, 13, 46, 67, 74, 79, 89, 93, 111, 128, 140, 153, 163, 185.
- 62 bus stops: 48 bus-only plus the 14 underground stations.
- Degree range is 2-13, with no dead stations.
- The graph is connected: all 199 stations are reachable.
- `stationType` is the highest transport available at the station. It matches the edge lists for every station.
- `blackStation` is `false` for every station.

### Data problems found

These were checked against the published rules and an independent, MIT-licensed station/connection dataset, [AlexElvers/scotland-yard-data](https://github.com/AlexElvers/scotland-yard-data). The dataset was used only to diff against; nothing was copied from it. Apart from the items below, the repo's taxi, bus and underground edges match it exactly.

1. **Taxi 13-24 was one-way.** It is listed only from 13 and confirmed by the dataset. **Made two-way.**
2. **Taxi 13-14 was one-way.** It is listed only from 14. Wikipedia notes this taxi line was removed on later boards, though older data still has it. **Removed**, to match the current board. The 13-14 *bus* link stays, so no station loses access.
3. **Taxi 58-75 was missing** in both directions. It is in the dataset. **Added.**
4. **Ferries were missing.** The repo has no ferry concept, and its Black ticket works on any normal edge. Both the dataset and the rulebook (example ferry move 157 to 115) give **three ferry links along the river: 108-115, 115-157 and 157-194.** **Added** as a separate `ferry` edge type, usable only by Mr. X with a black ticket.
5. **Already current: 198-199** is a taxi link (early boards had a bus there).

The result is `data/graph.json`, built by `tools/build-graph.mjs` and checked by `tools/validate-graph.mjs`. It has 199 stations: 345 taxi, 99 bus, 20 underground and 3 ferry links. It is symmetric and connected without ferries, and has no dead stations.

## Rules implemented in the repo

| Rule | Repo behaviour | Where |
|---|---|---|
| Rounds | `WINNING_ROUND = 24`. Mr. X wins when `round == 24 * players.length`. | `GameModel`, `Controller.checkMrXWin` |
| Reveal rounds | `MRX_VISIBLE_ROUNDS = (3, 8, 13, 18, 24)`, checked against the round just completed. | `GameModel`, `MoveCommand.updateMrXVisibility` |
| Turn order | Mr. X first, then Dt1..DtN, round-robin. `totalRound = ceil(round / nPlayers)`. | `GameModel` |
| Players | 1 Mr. X plus a configurable number of detectives. The initializer takes `nPlayers`, default 3. | `GameInitializer` |
| Detective tickets | Taxi 11, Bus 8, Underground 4. This matches the current Ravensburger rules; the older Milton Bradley rules give 10 taxi. | `GameInitializer` |
| Mr. X tickets | Taxi 99, Bus 99, Underground 99, **Black 5**, a fixed number independent of detective count. | `GameInitializer`, `MrX` |
| Double moves | **Not implemented.** | |
| Ticket handover | **Not implemented.** Detectives' spent tickets do not go to Mr. X. | `MoveCommand` |
| Move validity | Target is in bounds, differs from the current station, the matching neighbour set contains it, tickets are above 0, and the target is not occupied by a detective. Detectives cannot share a station with each other. The occupancy check skips Mr. X for detectives, so a detective may move onto him, which is the capture move. | `Controller.validateMove` |
| Bus and underground | A bus ticket needs a Bus or Underground station. An underground ticket needs an Underground station. | `Controller.isMeanOfTransportValid` |
| Black ticket | Mr. X only. Works on any normal neighbour edge, so it hides the transport used. | `Controller.isBlackMoveValid` |
| Mr. X start | Random from 13 positions: 35, 45, 51, 71, 78, 104, 106, 127, 132, 146, 166, 170, 172. | `GameInitializer` |
| Detective start | Random from 16 positions: 13, 26, 29, 34, 50, 53, 91, 94, 103, 112, 117, 123, 138, 141, 155, 174. | `GameInitializer` |
| Detective win | A detective's station equals Mr. X's. | `Controller.checkDetectiveWin` |
| Mr. X win | Survives 24 rounds, or **all** detectives are stuck. | `Controller.move`, `MoveCommand.nextRound` |
| Stuck detective | A detective with no usable ticket for their station type is skipped and marked stuck. | `MoveCommand.checkIfPlayerIsAbleToMove` |

Possible defects in the repo, which I will not copy:
- `r.nextInt(MAX_INDEX)` never picks the last start position.
- A detective can only be stuck by ticket exhaustion, not by being blocked by other detectives.
- Mr. X has no stuck check, so detectives cannot win by trapping him.

## Official rules check

Sources:
- [Ravensburger rulebook as transcribed on RulesPal](https://rulespal.com/scotland-yard/rulebook)
- [Ultra Board Games](https://ultraboardgames.com/scotland-yard/game-rules.php)
- [Transcribed classic English rules](https://gist.github.com/49ca696612413e06e45da914e6e07bc3)
- [Wikipedia](https://en.wikipedia.org/wiki/Scotland_Yard_(board_game))

Editions disagree on some numbers. Find Mr. X follows the brief wherever it sets a value, and the official rules otherwise. Every value sits in one `CONFIG` object.

| Rule | Official rules | Repo | Find Mr. X default |
|---|---|---|---|
| Length | The travel log has 24 moves. Classic rules say Mr. X wins after the 24th move. The Ravensburger text says "22 rounds" but still lists a reveal at move 24, which looks like an inconsistency. | 24 | **24 rounds** |
| Reveals | After moves 3, 8, 13, 18 and 24. Mr. X's marker stays until his next move. His start is never logged. | same | **3, 8, 13, 18, 24** |
| Detective tickets | 11/8/4 (current Ravensburger) or 10/8/4 (classic) | 11/8/4 | **11 / 8 / 4** |
| Mr. X tickets | Classic: taxi 4, bus 3, underground 3, plus whatever detectives spend. Ravensburger: draws from a general pile. | 99 each | **4 / 3 / 3, plus detectives' spent tickets** (brief) |
| Black tickets | 5 in the box. Some rule versions give one per detective. | 5 | **= number of detective pawns** (brief) |
| Double moves | 2, discarded after use, at most one per turn. If the first half lands on a reveal round, Mr. X shows himself there and then makes the second move. He cannot end either half on a detective. | none | **2, one per turn, reveal on the matching half** |
| Ferry | Mr. X only, black ticket only | none | **same** |
| Black ticket | Replaces any ticket and hides the transport used | any edge | **same, plus ferry** |
| Occupancy | Pieces may not end on an occupied station. On a bus or underground route a piece may pass over occupied stations; Find Mr. X edges are direct, so this is automatic. | detectives only | **No two detectives share a station. Mr. X cannot move onto a detective.** |
| Every piece must move | yes | yes | **yes** |
| Stuck detective | Stays put, still blocks its station, and is skipped | ticket check only | **Skipped if it has no legal move (tickets or blocked)** |
| Detectives win | A detective ends a move on Mr. X, or Mr. X has no legal move | landing only | **landing or trapping** |
| Mr. X wins | Survives the last move, or no detective can move | same | **same** |
| Players | 3-6 players, always 5 detective pawns split between the detective players (classic). Ravensburger fills in with "Bobbies" instead. | n players | **2-6 players. Detective pawns = `CONFIG.detectivePawns` (default 5), shared out between the detective players.** Bobbies are not used. |
| Start positions | 29 start cards in separate pools | 16 detective, 13 Mr. X (and the last card is never drawn) | **Repo pools, uniformly drawn, no repeats** |

Optional official variants, left out by default:
- Mr. X may not pass over pawns.
- Mr. X may reveal voluntarily in exchange for tickets.

## Note on the prototype

`web-prototype/index.html` is a single file of about 1,170 lines. It builds a **procedurally generated grid graph** rather than the repo's. It includes PeerJS 1.5.4 from jsDelivr, a canvas terrain painter, SVG pan/zoom, solo AI, hints and host-as-referee multiplayer. These are what I will keep and adapt.

The uploaded zip contained only `index.html`. There was no `map-preview.png`, so the terrain style follows the description in the brief.

## Product plan (agreed additions to the brief)

### Two views on mobile
- A bottom tab bar switches between **Play** and **Map**. On wide screens they sit side by side.
- **Play** shows:
  - the turn banner, round, and countdown to the next reveal
  - your tickets
  - your legal moves as large cards (destination plus transport)

  Tapping a card moves you, so a full game can be played without the map.
  - Each card can carry a learning cue, for example "this ferry needs a black ticket".
  - "Show on map" jumps to the move.
- **Map** is the full pan/zoom board. Choosing a card highlights the route there, and tapping a station opens the same move card.

### Game master (online)
- The host is always the **game master** and picks a seat:
  - **Mr. X**
  - **a detective** (controlling one or more pawns)
  - **not playing**
- In the lobby the game master gives out roles: who is Mr. X, and which detective pawns each player controls. There is also a "randomise" option.
- During play the game master can pause, hand a disconnected player's pawns to someone else, and end the game.

### Secrecy model (works for every game-master seat)
- Mr. X's position lives **only on Mr. X's device**. When the game master plays Mr. X, that device is the host's, as in the brief.
- The game master's device is the referee for public state:
  - turn order
  - ticket counts
  - detective moves, which it validates fully
  - the round log
- Mr. X's device validates its own move against the public state.
- On each move Mr. X's device sends only:
  - the ticket used
  - the station, on reveal rounds only
  - a commitment `SHA-256(station + round + secret salt)`
- After every detective move, the referee asks Mr. X's device whether he was caught or is now trapped, and waits for the answer.
- At game end Mr. X's device reveals the full route and salts. Every device then re-checks:
  - the commitments
  - adjacency
  - tickets
  - occupancy
  - the capture and trap answers

  A dishonest Mr. X client is caught and flagged.
- If Mr. X disconnects, the game pauses until he reconnects. The reconnect token is stored on his device.

### Activity history
- **Current session (main feature):** a live, round-by-round activity view for everyone:
  - every detective move (pawn, from, to, ticket)
  - Mr. X's tickets and reveals
  - double moves
  - skipped (stuck) pawns
  - joins, leaves and reassignments

  It can be filtered by player and shows per-player stats (tickets used, distance from Mr. X at each reveal). When the game ends, Mr. X's route fills in and a step-through replay plays on the map.
- **Saving:**
  - The game master's device autosaves the session to `localStorage` so the game resumes after a reload.
  - The game master can **export the session file** (JSON) and import it later to resume or replay.
  - Mr. X's secret part is exported separately from Mr. X's device, so the game master's file never contains hidden information during play.

### Hints
- **Learning tips: on by default.**
  - Short, contextual explanations of the rules, such as what a reveal round is, why a move is unavailable, how double moves and black tickets work, and that detectives' tickets go to Mr. X.
  - Each tip shows once.
  - They can be turned off in settings or by the game master.
- **Tactical hints: off by default.**
  - The overlay of possible Mr. X stations (the brief's Hints toggle), the coverage dots, and Mr. X's danger tint.
  - The player turns them on in solo play. Online, the game master allows or forbids them.
  - Detective hints use public information only.

## Station layout (`data/layout.json`)

`tools/build-layout.mjs` (deterministic, seed 7) creates original positions from the graph alone. It never reads the repo's `guiCoordinates`/`tuiCoordinates` or any board image.

1. **Weighted shortest paths.** Distances in hops, weighted taxi 1, bus 2.2, underground 3.6, ferry 2.4.
2. **Initial placement.** Classical MDS, rotated so the widest spread is horizontal.
3. **Stress majorization.** 400 SMACOF iterations, at 64 px per taxi hop.
4. **Local search** over 90 passes. It minimises:
   - taxi/taxi crossings
   - stations closer than 46 px
   - taxi or ferry routes passing within 20 px of an unrelated station
   - taxi hop lengths far from 64 px

   A reflection move is used to untangle crossings. Bus and underground routes are drawn as curves, so their crossings are weighted low.

Result:
- The canvas is 1179 × 1036 px at default zoom.
- Stations are at least 45 px apart; the requirement is 34.
- **0 taxi/taxi crossings.**
- No route grazes a station.

The ferry chain 108-115-157-194 becomes the river in the map art. The 8 places where taxi routes cross it are drawn as bridges.

`tools/validate-layout.mjs` re-checks all of this.

## Referee mode (anti-cheat option)

The game master's device runs the turns, which by itself would let the game master cheat. So the game master picks a **referee mode** in the lobby. It is shown to everyone before they join and on the game screen.

| | **Verified** (default) | **Trusted game master** |
|---|---|---|
| Who knows Mr. X's position | Only Mr. X's device | Mr. X's device **and the game master's** |
| Detective moves | Signed on the player's own device (WebCrypto ECDSA P-256; public keys swapped in the lobby). The game master relays them but cannot forge or change them. | Sent to the game master, who applies them |
| Rule checking | **Every device** keeps the full public log and re-checks turn order, tickets, occupancy, ticket handover, double/black use and reveal rounds after every event | The game master's device only |
| Mr. X honesty | A SHA-256 commitment on each move. At game end the route and salts are revealed and **every device** audits them, including the capture and trap answers he gave. | The game master's device checks Mr. X's moves directly |
| If someone cheats | Every device shows "Rule check failed" with the round and the reason. A false "not caught" answer reverses the result, for example "Detectives win: caught in round 7". | Not detectable |
| If Mr. X disconnects | The game pauses until he returns | The game master can take over Mr. X |
| Good for | Competitive games, or when the game master also plays | Casual games, or teaching with a non-playing game master who watches Mr. X |

What Verified cannot prevent:
- The game master can still stall the game by not relaying messages. Everyone sees the stall.
- A lie from Mr. X is proven only at game end, which is inherent without a trusted third party. It still cannot go unnoticed.

## Map style: real London (OpenStreetMap)

The board background is a stylized central-London map rendered from OpenStreetMap data into `assets/map.jpg`. The pipeline is in `tools/london/README.md`.
- **Fit.** The original station layout is fitted so the four ferry stations sit on the real Thames banks, between Battersea/Nine Elms and London Bridge/The Borough. North is up.
- **Result.** At about 8.5 m per pixel the board spans roughly 10 km, from Kilburn and Gospel Oak in the north to Oval in the south and from Earl's Court to Whitechapel. No non-ferry station touches the water.
- **Route clarity.** The real streets do not match the game's routes, so the map is drawn muted: pale roads, buff buildings and soft parks. The game's routes carry dark casings so they stay readable.
- **Names.** Only the real names drawn into the image are shown: districts, parks and "River Thames". The invented diorama names appear only on the painted fallback.
- **Fallback.** Without `assets/map.jpg` the procedural diorama painter is used. Its river follows the same Thames line.
- **Attribution.** "Map data © OpenStreetMap contributors" appears in the image corner, the About dialog and the README.

## Map style: illustrated city (default)

The board image is now an original illustrated city, built by `tools/city/`:
- **Streets are the routes.** Every taxi link is a street, bus lanes run along the streets, and every block is lined with small oblique-view houses.
- **Real geography** from OpenStreetMap: the Thames, parks, side streets beyond the network, and landmark positions shown with generic icons.
- **Other styles.** The plain London render (`tools/london/rasterize.cjs`, written to `assets/map-london.jpg`) and the painted diorama fallback (used when no `map.jpg` exists) remain available.

## What was built (implementation notes)

| Area | Files | Notes |
|---|---|---|
| Rules | `js/config.js`, `js/rules.js` | A pure reducer over events: Mr. X move, detective move, capture answer, trapped. Every rule constant is in `FY.CONFIG.rules`. Saved games carry their rule snapshot. |
| AI | `js/ai.js` | **Mr. X** scores destinations by: distance from detectives, how many detectives could reach them, safe exits, how much the ticket blurs the detectives' possible-station set, and ticket scarcity. Doubles are kept for escapes. **Detectives** minimise Mr. X's safe escapes from his possible *next* stations, plus team distance, with ticket management and hub positioning before reveals. Levels: easy, normal, hard. |
| Solo play | `js/game.js` | Controller for human vs computer; autosaves after every event (*Continue your game*). |
| UI | `js/ui.js`, `css/` | **Play** (move cards with learning and tactical cues, detective picker, inset map), **Map**, **Log** (by turn, filters, stats), travel log, tips, settings, help, About with attribution, end screen with rematch and replay. |
| Online | `js/net.js` | Game master hub over PeerJS; signed shared log re-verified by every device; verified and trusted referee modes; seats; reconnect and resume. |

### Measured AI balance

From `tests/test.mjs` and 200-game runs; the AI plays both sides.
- With 5 detectives, the detectives win about **23%** against a normal or hard Mr. X and **72%** against an easy one.
- With 3 detectives they win about **7%** against normal or hard, and about **50%** against easy.
- Against a Mr. X who moves at random, AI detectives win 99%+.

Humans as detectives get easy, normal or hard to choose from.

### Test status

| Test | What it covers | Result |
|---|---|---|
| `tests/test.mjs` | Station graph (symmetry, connectivity, dead stations); all 199 × 4 ticket move generators for detectives and Mr. X, ferries black-only; illegal events rejected; AI games replay from their logs with invariants holding | 100k+ checks, 0 failures |
| `tests/protocol.mjs` | Signed games as three parties. Detects: a piece moved by the wrong player, a move changed after signing, a forged signature, an altered revealed route, and Mr. X lying "not caught" (6/6) | 0 failures |
| `tests/ui-smoke.cjs` | Solo games through the real page at 360, 390 and 1280 px; tactical hints, replay and rematch; no horizontal scroll | Pass |
| `tests/online-smoke.cjs` | Three-player games: verified with guest Mr. X (guest reload + host reload/resume), trusted with guest Mr. X, verified with host Mr. X | Pass, with all devices agreeing and audits passing |
| `FY_TRANSPORT=peer node tests/online-smoke.cjs` | A full verified game over **real PeerJS/WebRTC** with a guest rejoin | Pass |

### Known limitations

- **Key exchange goes through the game master.** Public keys reach every device via the game master's device, so a malicious game master could swap keys in the lobby. The 🔑 fingerprints let players check for this out loud.
- **Late detection of Mr. X's lies.** In verified mode a lie by Mr. X is proven only at the end of the game, which is inherent without a third party. A Mr. X who disconnects for good stalls a verified game. Trusted mode lets the game master take over instead.
- **Offline relay.** The game master's device must stay open: it relays the log. It autosaves and can resume after a reload.
- **Peer-to-peer connectivity.** Some networks block peer-to-peer connections; configure a TURN server in `FY.CONFIG.net.iceServers`.
- **Street texture.** The illustrated map's side streets (outside the route network) come from OpenStreetMap, but the game's own streets are the station links, not real streets.

## Connecting devices (research summary)

| Setup | Works? | Notes |
|---|---|---|
| Every phone has internet (any networks) | **Yes** | The site loads from Netlify, and the public PeerJS server introduces the devices. PeerJS's built-in Google STUN and free, best-effort PeerJS TURN relays cover most NATs. |
| Same Wi-Fi or a hotspot **with** mobile data | **Yes** | Often the most reliable, because direct local connections are possible. |
| Strict networks (carrier-grade NAT, corporate or school Wi-Fi blocking UDP) | Usually, with TURN | Add a TURN server to `FY.CONFIG.net.iceServers`; it is now added to PeerJS's defaults instead of replacing them. Metered's free plan fits a static site. Cloudflare TURN needs a server-side token. |
| Hotspot **without** internet | **No (today)** | The site, the jsDelivr scripts and the PeerJS signalling server are all unreachable. Fixing this would need a service-worker cache plus QR-code signalling over raw WebRTC. iPhone hotspots reportedly isolate clients, so that path is unreliable. |
| One phone passed around (pass-and-play) | Not built yet | Needs no network at all; the cheapest offline option. |

Netlify Drop serves static files only. Netlify Functions can't hold WebSockets, so hosting our own signalling there isn't worthwhile. The public PeerJS server is the better choice. Self-hosting a PeerJS server (Render, Fly) adds cost or cold starts for little gain.

## Names, aliases and big groups

- **Names and aliases.** Each player sets their own name and an optional role alias on their own device: join screen, lobby *Edit*, or mid-game from the game menu. Mid-game changes become host-signed `rename` entries, so every device updates. The display formats are "Moriarty (Flora)", "Mr. X (Flora)" and "D2 · Holmes (Sam)". Solo setup has the same name field and an alias for Mr. X.
- **Up to 8 players.** That is Mr. X plus up to 7 detective pieces (`maxDetectivePawns: 7`; classic is 5), and up to 12 people in a lobby, the extras watching. With more detective players than pieces, the lobby raises the piece count automatically.
- **Balance.** In 200 AI games against a normal Mr. X, the detectives win about 30% with 5 pieces, 36% with 6 and 38% with 7. Mr. X's black tickets scale with the detective count.
- **Tested.** An 8-player online game ran on 8 devices with one detective each; the audit passed on every device (`FY_PLAYERS=8 node tests/online-smoke.cjs`).

## Refresh keeps your place

The device remembers which game it is in (`resume` in storage). After a refresh:
- **Solo games** reopen at the same move.
- **Guests** rejoin automatically.
- **The game master** re-opens the same code, lobby or game, and players reconnect on their own.

Leaving on purpose (*Leave game*, or *Leave* in the lobby) or finishing a game clears this. If the browser can't store anything (some private windows), the menu warns that a refresh will lose the game.

## Field fixes (from a real 8-player game)

- **"Offline" warnings.** Phones pause web pages when the screen locks or another app is open, and the 12-second timeout plus a sticky offline flag made active players look offline.
  - Now any message marks a player online again.
  - Players count as "away" only after 30 s (`FY.CONFIG.net.awayAfterMs`).
  - A page re-syncs as soon as it becomes visible again.
  - The game master's page says goodbye on reload, so guests reconnect at once.
  - Online games keep the screen on (Screen Wake Lock; can be turned off in Settings).
  - The banner appears only when the game is waiting on someone who is away.
- **One player shown twice.** This happened when the board had more detective pieces than detective players: the classic sharing rule gave the first player a second piece. Now the piece count follows the number of detective players (at least 5) unless the game master picks it. The lobby lists who controls which detective, and piece cards say "2 pieces".
- **Real double logins are blocked.**
  - **Second tab:** one tab per game per browser (Web Locks). A second tab offers "Play here instead" and tells the first tab why.
  - **Game master's own browser:** it can't also join as a guest.
  - **Profile switch:** `?profile=` only works on local test pages.
  - **Removing players:** the game master can remove a player in the lobby, and that device can't rejoin.
- **Map taps.** Dialogs opened from the map closed instantly, because the tap's click landed on the new backdrop. Fixed. Tapping a piece now shows who it is, their tickets or Mr. X's last sighting, and the station's routes.
- **Offline caching.** A service worker (`sw.js`, stamped by `tools/package.py`) caches the site and the pinned CDN files, so solo games load with no internet after one visit. There is also a web app manifest with icons for "Add to Home Screen". Online games still need internet.

Tests: `tests/offline-identity.cjs` covers offline loading and play, the second-tab takeover, the game master joining their own game, removal and away recovery.

## Game master tools (second round of field feedback)

- **Watching Mr. X.** *Game master can watch Mr. X* is on by default when the game master isn't playing. Mr. X's device privately sends his position to the game master after each move. Everyone sees the setting in the lobby, and the log says so at the start. It is off whenever the game master holds a detective, and Mr. X's device refuses to send in that case. In trusted mode the game master always sees him.
- **Removing a player mid-game.** *Players and seats* → **Remove**.
  - Their detectives go to another player or to **the computer**. The game master's device plays them; entries are authored as `ai` and signed with the game master's key.
  - In trusted games Mr. X can go to the computer too.
  - In verified games only Mr. X's phone knows his position, so removing Mr. X ends the game (a host-signed `end` entry). Every device rejects a Mr. X seat change in verified games.
  - **End the game** is also available on its own.
- **Map taps.** Tap slop was raised to 14 px, and taps snap to a glowing move target within about 44 screen px.
- Tested by `tests/online-smoke.cjs`: a watching game master sees Mr. X's true position, the computer finishes a removed detective's game with a passing audit, and removing Mr. X ends a verified game.

## On a "local hotspot like Mini Militia" mode

Mini Militia is a native app: it finds players with LAN broadcasts and talks over local sockets, and it keeps running in the background. A web page can do neither. Browsers have no LAN discovery or raw sockets, and they pause pages in the background.
- **Possible in the browser:** a no-internet mode on a hotspot. Each guest pairs by scanning two QR codes (WebRTC offer/answer without a server). This works on Android hotspots. iPhone hotspots reportedly isolate devices.
- **It wouldn't fix drops.** A dropped player would have to re-scan, and the drops people see come from phones sleeping or switching apps, which a local link suffers from too.
- **The real fix** for Mini-Militia-style play would be a small Android app wrapper (e.g. Capacitor) with local networking and a background service.
- **Recommended now:** deploy the latest build (false "offline" fixes, screen kept on, any message restores a player). Use a TURN server only if specific networks still fail.

## Small fixes after the rename

- **Hosting badge.** Free Netlify sites show a floating "Powered by Netlify" badge that covered the Log tab. The game now checks whether anything not its own covers the tab bar, and if so lifts the bar clear (`body.overlay-room`). The badge itself can be turned off in Netlify under Project configuration → General → Powered by Netlify badge.
- **"Spinner" on the map.** The selected piece's ring spun with `rotate()`, which on SVG turns around the map's centre, so the ring swung across the map. It now uses marching dashes and stays on the piece.
- **Inherited CI removed.** The original project's GitHub workflow, which pushed to the upstream author's repository, was deleted.

## Initials on the map, computer detectives online, sturdier badge handling

- **Initials.** Online, detective pieces show their player's initials instead of D1, D2: "David" becomes "Da", "Paul David" becomes "PD", using the alias if one is set. Clashes, or one player with several pieces, get a number ("Jo1", "Jo2"). Solo games and computer-played pieces keep D1…D7. Lists and logs still say "D2 · David".
- **Mixed human and computer detectives.** When there are more pieces than detective players, the game master chooses *Shared by players* (classic) or *Played by the computer*. Each player then keeps one piece, and the game master's device plays the rest. Tested with 2 human and 3 computer detectives; the audit passes.
- **Badge detection.** The game looks for any top-level fixed, sticky or absolute element that isn't its own and overlaps the tab bar. Hit-testing alone missed badges with `pointer-events: none`. It re-checks when such elements are added, and lifts the bar by exactly the covered height.

## Aliases in text, badge workaround removed, renamed to Find Mr. X

- **Aliases in text.** Online, detectives now go by their player's alias (or name, if no alias is set) everywhere text names them. Examples: "Holmes to move", "Moves for Holmes", "Holmes caught Moriarty", and the Log filters. The travel log and station info add who plays the piece: "Holmes (David)", "Sam (you)". One player with several pieces, or two players with the same name, get numbers ("Holmes 1", "Holmes 2"). Computer pieces and solo games keep D1, D2. Names are user text, so every HTML use is escaped. The seats dialog and system notes keep D1, D2, because they are about the seat, not the person.
- **Badge workaround removed.** The owner turned the "Powered by Netlify" badge off in the Netlify settings, so the tab-bar lifting code and its test are gone. If the badge comes back, it can be switched off again under Project configuration → General.
- **Name.** The game is now called **Find Mr. X**. Internal ids (`FY`, `fogyard.` keys, `fogyard-` peer ids) are unchanged, so saved games and codes keep working.

## Move lines on the map

- **Lines you can take.** When it is your turn, every line the selected piece can travel is lit on the map in its transport colour (white casing, flowing dashes), not just the destination stations. A black ticket lights the ferry, or each land line that joins the two stations. Reduced motion stops the flow.
- **Replay buttons.** In the dark theme the replay ◀ ▶ Done buttons were dark on dark. They now stay light in both themes, like the zoom buttons.
- **Trail of the last move.** A detective's move leaves a glow along the line it took, fading over about 3 seconds. Mr. X's own moves leave a trail only on his device, so nothing is given away.

## Player photos

- **Photo or initials.** Each player can add a photo on their own device: on the *Play online* screen, from *Edit* in the lobby, or mid-game from the game menu (*Change my name, alias or photo*). Their detective pieces on the map, the piece cards and the lobby list then show the photo. Without a photo they show the player's initials in the piece's coloured badge ("Paul Davidson" → "PD", "Sam" → "Sa", alias if one is set). One player with several pieces keeps the piece number: "PD1", or a small number on the photo.
- **Camera or gallery.** On phones the picker has two buttons: *Take photo* (`capture="user"`, opens the front camera) and *Choose photo* (the gallery or files). Android's newer photo picker shows only the gallery for a plain image field, so the camera needs its own button. Desktops show only *Choose photo*.
- **Small and local.** The picture is cropped to a centred square and shrunk on the phone to a 96 px JPEG (a few KB, capped at `FY.CONFIG.net.photoMaxChars`) before it is saved or sent. Nothing is uploaded to a server.
- **Outside the signed log.** Photos are decoration, so they never enter the signed game log. The game master keeps them with the player list and sends a `photos` message to every device when one is added, changed or removed, and to each device that (re)joins. Every device only accepts small `data:image/jpeg|png|webp` values. Changing only a photo mid-game doesn't write a rename entry.
- **Solo games and computer pieces** keep D1, D2…, since one person plays every piece.

Test: the mixed game in `tests/online-smoke.cjs` (`FY_GM=1`) adds a photo through the lobby's file picker and checks it on the other devices' lobby and map.
