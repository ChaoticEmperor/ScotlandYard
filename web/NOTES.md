# Fog Yard: repo investigation notes

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

Editions disagree on some numbers. Fog Yard follows the brief wherever it sets a value, and the official rules otherwise. Every value sits in one `CONFIG` object.

| Rule | Official rules | Repo | Fog Yard default |
|---|---|---|---|
| Length | The travel log has 24 moves. Classic rules say Mr. X wins after the 24th move. The Ravensburger text says "22 rounds" but still lists a reveal at move 24, which looks like an inconsistency. | 24 | **24 rounds** |
| Reveals | After moves 3, 8, 13, 18 and 24. Mr. X's marker stays until his next move. His start is never logged. | same | **3, 8, 13, 18, 24** |
| Detective tickets | 11/8/4 (current Ravensburger) or 10/8/4 (classic) | 11/8/4 | **11 / 8 / 4** |
| Mr. X tickets | Classic: taxi 4, bus 3, underground 3, plus whatever detectives spend. Ravensburger: draws from a general pile. | 99 each | **4 / 3 / 3, plus detectives' spent tickets** (brief) |
| Black tickets | 5 in the box. Some rule versions give one per detective. | 5 | **= number of detective pawns** (brief) |
| Double moves | 2, discarded after use, at most one per turn. If the first half lands on a reveal round, Mr. X shows himself there and then makes the second move. He cannot end either half on a detective. | none | **2, one per turn, reveal on the matching half** |
| Ferry | Mr. X only, black ticket only | none | **same** |
| Black ticket | Replaces any ticket and hides the transport used | any edge | **same, plus ferry** |
| Occupancy | Pieces may not end on an occupied station. On a bus or underground route a piece may pass over occupied stations; Fog Yard edges are direct, so this is automatic. | detectives only | **No two detectives share a station. Mr. X cannot move onto a detective.** |
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
