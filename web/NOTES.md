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

1. **Two asymmetric taxi edges.** 13→24 is listed but 24→13 is not. 14→13 is listed but 13→14 is not. The bus and underground lists are symmetric. In the generator I will symmetrise (union of both directions) and log the fix. Station 13's list is `[4, 23, 24]`, station 24's is `[37, 38]` and station 14's is `[13, 15, 25]`. I need to confirm the intended edges here (see open questions).
2. **No ferry edges exist in the repo.** The Scala game has no ferry concept. `TicketType` has only Taxi/Bus/Underground/Black, and the Black ticket in the repo works on any normal edge instead of on ferries.

## Rules implemented in the repo

| Rule | Repo behaviour | Where |
|---|---|---|
| Rounds | `WINNING_ROUND = 24`. Mr. X wins when `round == 24 * players.length`. | `GameModel`, `Controller.checkMrXWin` |
| Reveal rounds | `MRX_VISIBLE_ROUNDS = (3, 8, 13, 18, 24)`, checked against the round just completed. | `GameModel`, `MoveCommand.updateMrXVisibility` |
| Turn order | Mr. X first, then Dt1..DtN, round-robin. `totalRound = ceil(round / nPlayers)`. | `GameModel` |
| Players | 1 Mr. X plus a configurable number of detectives. The initializer takes `nPlayers`, default 3. | `GameInitializer` |
| Detective tickets | Taxi 11, Bus 8, Underground 4. The official board uses 10 taxi. | `GameInitializer` |
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

## Differences between the repo and the brief

| Brief | Repo | Plan |
|---|---|---|
| Mr. X: taxi 4, bus 3, underground 3 | 99 each | Use the brief (official). All values live in one `CONFIG` object. |
| 2 double moves | none | Add. |
| Black tickets = number of detectives | 5 fixed | Use the brief. |
| Ferries need a black ticket | no ferries | Add ferry edges (see open questions). |
| Detectives' tickets go to Mr. X | no | Add. |
| Detectives win by trapping Mr. X | no | Add. |
| Detective tickets | taxi 11, bus 8, underground 4 | Keep as defaults and put them in `CONFIG`. Official is 10/8/4. |
| 2-6 players | 1 Mr. X + configurable detectives | Use the brief. |

Where the repo and the brief agree (24 rounds, reveals after 3/8/13/18/24, 199 stations), I keep them as they are.

## Open questions before Step 2

1. **Ferries.** The repo has none. The official board has four ferry links, which need a black ticket. I would add them to `graph.json` as a separate `ferry` edge type, in the chain 194-157-115-108-100, which are all existing stations in the repo's graph. The other choice is to invent ferry links on the original layout. I recommend the official chain, written in the notes as an addition not derived from the repo.
2. **The two asymmetric taxi edges.** Treat 13-24 and 13-14 as real, or drop them? Connectivity does not depend on them, so this is a judgement call. I recommend dropping neither unless you know they are errors: keeping both makes the edge list symmetric by union, and I cannot verify against the official board from here.
3. **Prototype.** The zip contained only `index.html`, with no `map-preview.png`. I copied it to `/web-prototype/index.html`. For Step 3 I will work from the prototype's procedural painter, and use the style description in the brief for the terrain. If you have the preview image, please add it.

## Note on the prototype

`web-prototype/index.html` is a single file of about 1,170 lines. It builds a **procedurally generated grid graph** rather than the repo's. It includes PeerJS 1.5.4 from jsDelivr, a canvas terrain painter, SVG pan/zoom, solo AI, hints and host-as-referee multiplayer. These are what I will keep and adapt.
