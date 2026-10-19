/* Shadow Line: every tunable rule and setting lives here. Saved games keep a copy of the rule
   values they started with, so changing this file never breaks a game in progress. */
(function (FY) {
  "use strict";

  FY.CONFIG = {
    rules: {
      rounds: 24, // Mr. X's travel log length; a double move fills two entries
      reveals: [3, 8, 13, 18, 24], // Mr. X surfaces after these moves
      detectivePawns: 5, // detective pieces on the board, shared out between detective players
      minDetectivePawns: 2,
      maxDetectivePawns: 7, // the classic game stops at 5; 6-7 is a big-group variant (Mr. X gets a black ticket per detective)
      detectiveTickets: { taxi: 11, bus: 8, underground: 4 },
      mrxTickets: { taxi: 4, bus: 3, underground: 3 },
      mrxBlack: "perDetective", // a number, or "perDetective" (one black ticket per detective pawn)
      mrxDoubles: 2,
      ticketsToMrX: true, // detectives' spent tickets go to Mr. X
      blackRidesFerry: true, // the ferry needs a black ticket (only Mr. X has them)
      trappedMrXLoses: true, // detectives also win if Mr. X has no legal move
      stuckDetectivesLose: true // Mr. X wins if no detective can move
    },

    players: { min: 2, max: 8, maxInLobby: 12 }, // max = people with a role (Mr. X + up to 7 detectives); extra people can watch

    ai: {
      thinkMs: 650, // pause before a computer move, so humans can follow it
      stepMs: 450 // pause between computer detectives
    },

    hints: {
      learningTips: true, // short rule explanations, each shown once
      tactical: false // possible Mr. X stations, coverage and danger tints
    },

    net: {
      peerPrefix: "fogyard-",
      codeLength: 4,
      codeAlphabet: "ABCDEFGHJKMNPQRSTUVWXYZ",
      // Optional TURN/STUN servers for players behind strict NATs, e.g.
      // [{ urls: "turn:turn.example.org:3478", username: "user", credential: "secret" }]
      iceServers: [],
      reconnectEveryMs: 2500,
      // Phones pause web pages when the screen locks or another app is open, so a quiet player is
      // only shown as away after this long (any message brings them straight back).
      awayAfterMs: 30000,
      reconnectGiveUpMs: 120000,
      defaultReferee: "verified" // "verified" or "trusted"
    },

    storagePrefix: "fogyard."
  };
})(window.FY = window.FY || {});
